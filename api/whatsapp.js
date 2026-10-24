/**
 * WhatsApp admin API.
 * Token: ONLY process.env.WHATSAPP_ACCESS_TOKEN (Secrets) — never saved via UI/DB.
 * GET  → connection status
 * POST save_config → non-secret prefs only
 * POST test_connection → verify Graph API
 * POST test_send → one test message
 */
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireFullAdmin,
  methodNotAllowed,
  serverError,
  sanitizeText,
} from './security.js';
import {
  loadWhatsAppConfig,
  saveWhatsAppConfig,
  publicWhatsAppStatus,
  isWhatsAppConfigured,
  normalizeWhatsAppTo,
  fetchPhoneStatus,
  sendWhatsAppText,
  invalidateWhatsAppConfigCache,
} from './wa-client.js';

const CONNECTED_MSG = '🟢 WhatsApp API Connected Successfully';

function parseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return b;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'whatsapp', limit: 40, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;

      if (req.query?.logs === '1' || req.query?.logs === 'true') {
        const { default: sb } = await import('./db-client.js');
        const { data, error } = await sb
          .from('parent_notify_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return res.status(200).json({ ok: true, logs: data || [] });
      }

      invalidateWhatsAppConfigCache();
      const cfg = await loadWhatsAppConfig({ force: true });
      const status = publicWhatsAppStatus(cfg);

      if (!isWhatsAppConfigured(cfg)) {
        return res.status(200).json({
          ...status,
          ok: false,
          connected: false,
          message:
            'أضف WHATSAPP_ACCESS_TOKEN من تبويب Secrets (System User Token). لا يُحفظ الـ Token في الواجهة.',
        });
      }

      const live = await fetchPhoneStatus(cfg);
      if (!live.ok) {
        // Do not echo raw token-related payloads beyond Meta error message
        return res.status(200).json({
          ...status,
          ok: false,
          connected: false,
          message:
            live.json?.error?.message ||
            'فشل التحقق من Meta — راجع WHATSAPP_ACCESS_TOKEN في Secrets',
          graph_error_code: live.json?.error?.code || null,
        });
      }

      return res.status(200).json({
        ...status,
        ok: true,
        connected: true,
        message: CONNECTED_MSG,
        display_phone_number: live.json?.display_phone_number || null,
        verified_name: live.json?.verified_name || null,
        quality_rating: live.json?.quality_rating || null,
      });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;

      const body = parseBody(req);
      const action = String(
        body.action || (req.method === 'PUT' ? 'save_config' : '')
      ).toLowerCase();

      // Reject any attempt to save token via API
      if (body.access_token || body.token || body.WHATSAPP_ACCESS_TOKEN) {
        return res.status(400).json({
          ok: false,
          error:
            'لا يمكن حفظ Access Token من الواجهة. ضعه فقط في Secrets باسم WHATSAPP_ACCESS_TOKEN',
        });
      }

      if (action === 'save_config' || (req.method === 'PUT' && !action)) {
        // Non-secret prefs only — force parent notify stays as submitted but default path is off
        const cfg = await saveWhatsAppConfig({
          test_to: body.test_to,
          template_name: body.template_name,
          template_lang: body.template_lang,
          // Respect explicit admin toggle, but do not auto-enable on deploy
          parent_notify_enabled:
            body.parent_notify_enabled != null
              ? Boolean(body.parent_notify_enabled)
              : false,
          allow_text_fallback: body.allow_text_fallback,
          incomplete_threshold: body.incomplete_threshold,
        });
        return res.status(200).json({
          ok: true,
          saved: true,
          message: 'تم حفظ الإعدادات (بدون Token — الـ Token من Secrets فقط)',
          ...publicWhatsAppStatus(cfg),
        });
      }

      if (action === 'test_connection') {
        invalidateWhatsAppConfigCache();
        const cfg = await loadWhatsAppConfig({ force: true });
        if (!isWhatsAppConfigured(cfg)) {
          return res.status(400).json({
            ok: false,
            connected: false,
            error:
              'WHATSAPP_ACCESS_TOKEN غير مضبوط في Secrets',
          });
        }
        const live = await fetchPhoneStatus(cfg);
        if (!live.ok) {
          return res.status(502).json({
            ok: false,
            connected: false,
            error: live.json?.error?.message || 'فشل الاتصال بـ Meta Graph API',
            code: live.json?.error?.code || null,
          });
        }
        return res.status(200).json({
          ok: true,
          connected: true,
          message: CONNECTED_MSG,
          display_phone_number: live.json?.display_phone_number || null,
          verified_name: live.json?.verified_name || null,
          quality_rating: live.json?.quality_rating || null,
          phone_number_id: cfg.phoneNumberId,
          waba_id: cfg.wabaId,
          ...publicWhatsAppStatus(cfg),
        });
      }

      if (action === 'test_send') {
        invalidateWhatsAppConfigCache();
        const cfg = await loadWhatsAppConfig({ force: true });
        if (!isWhatsAppConfigured(cfg)) {
          return res.status(400).json({
            error: 'WHATSAPP_ACCESS_TOKEN غير مضبوط في Secrets',
          });
        }

        const live = await fetchPhoneStatus(cfg);
        if (!live.ok) {
          return res.status(400).json({
            ok: false,
            error: live.json?.error?.message || 'فشل التحقق من الـ Token',
            code: live.json?.error?.code || null,
          });
        }

        const toRaw = body.to || cfg.testTo;
        const to = normalizeWhatsAppTo(toRaw);
        if (!to) {
          return res.status(400).json({
            error: 'أدخل رقم اختبار (مثال: 2010xxxxxxxx)',
          });
        }

        const text =
          sanitizeText(
            body.message ||
              'English Mastery · WhatsApp Cloud API test ✅\nMr. Sherif Atta',
            500
          ) || 'English Mastery WhatsApp test ✅';

        const result = await sendWhatsAppText({ to, body: text, cfg });
        if (!result.ok) {
          return res.status(502).json({
            ok: false,
            error: result.error || 'فشل إرسال رسالة الاختبار',
            code: result.error_code || null,
            kind: result.error_kind || null,
          });
        }
        return res.status(200).json({
          ok: true,
          message: `${CONNECTED_MSG} · Test message sent`,
          to,
          message_id: result.message_id ? 'sent' : 'ok',
          display_phone_number: live.json?.display_phone_number || null,
        });
      }

      // Parent sample / bulk notify intentionally not auto-run here unless admin uses cron endpoint
      if (action === 'send_parent_sample') {
        return res.status(403).json({
          ok: false,
          error:
            'الإرسال التلقائي لولي الأمر موقوف. فعّله يدويًا لاحقًا من إعدادات التنبيهات عند الحاجة.',
        });
      }

      return res.status(400).json({
        error: 'إجراء غير معروف — test_connection | test_send | save_config',
      });
    }

    return methodNotAllowed(res);
  } catch (err) {
    // Never log secrets
    console.error('[whatsapp] error:', err?.message || err);
    return serverError(res, err, 'whatsapp');
  }
}
