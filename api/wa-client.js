/**
 * WhatsApp Business Cloud API client (Meta official).
 * Access token: ONLY from process.env.WHATSAPP_ACCESS_TOKEN (Secrets).
 * Never log token values. Never store token in DB or source.
 */
import supabase from './db-client.js';

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const DEFAULT_PHONE_NUMBER_ID = '1282802908249416';
const DEFAULT_WABA_ID = '937397659416477';
const SETTINGS_KEY = 'whatsapp_config';

let dbMetaCache = null;
let dbMetaLoadedAt = 0;
const CACHE_TTL_MS = 15_000;

function envToken() {
  return String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
}

function envPhoneNumberId() {
  return String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || DEFAULT_PHONE_NUMBER_ID
  ).trim();
}

function envWabaId() {
  return String(
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
      process.env.WHATSAPP_WABA_ID ||
      DEFAULT_WABA_ID
  ).trim();
}

function parseDbMeta(raw) {
  if (!raw) return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object') return {};
    return {
      testTo: String(v.test_to || v.testTo || '').trim(),
      templateName: String(v.template_name || v.templateName || '').trim(),
      templateLang: String(v.template_lang || v.templateLang || 'ar').trim() || 'ar',
      // Auto parent notify: default OFF unless explicitly enabled in DB or env
      parentNotifyEnabled:
        v.parent_notify_enabled != null
          ? Boolean(v.parent_notify_enabled)
          : v.parentNotifyEnabled != null
            ? Boolean(v.parentNotifyEnabled)
            : false,
      allowTextFallback:
        v.allow_text_fallback != null
          ? Boolean(v.allow_text_fallback)
          : v.allowTextFallback != null
            ? Boolean(v.allowTextFallback)
            : true,
      incompleteThreshold: Math.max(
        1,
        Math.min(20, Number(v.incomplete_threshold || v.incompleteThreshold) || 2)
      ),
    };
  } catch {
    return {};
  }
}

/**
 * Token ALWAYS from Secrets/env only.
 * Phone/WABA from env (with known defaults).
 * Non-secret prefs (template, test_to, flags) may come from DB.
 */
export async function loadWhatsAppConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && dbMetaCache && now - dbMetaLoadedAt < CACHE_TTL_MS) {
    return buildConfig(dbMetaCache);
  }
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();
    if (!error) {
      dbMetaCache = parseDbMeta(data?.value);
      dbMetaLoadedAt = now;
    } else {
      dbMetaCache = dbMetaCache || {};
    }
  } catch {
    dbMetaCache = dbMetaCache || {};
  }
  return buildConfig(dbMetaCache);
}

function buildConfig(meta = {}) {
  const envParent = process.env.WHATSAPP_PARENT_NOTIFY;
  // Default OFF. Only ON if env is explicitly "1"/"true" OR DB says true AND env is not "0"
  let parentNotifyEnabled = false;
  if (envParent != null && String(envParent).trim() !== '') {
    parentNotifyEnabled = String(envParent).trim() !== '0' && String(envParent).trim() !== 'false';
  } else {
    parentNotifyEnabled = Boolean(meta.parentNotifyEnabled);
  }

  const token = envToken();
  return {
    token,
    phoneNumberId: envPhoneNumberId(),
    wabaId: envWabaId(),
    testTo: meta.testTo || String(process.env.WHATSAPP_TEST_TO || '').trim(),
    templateName: meta.templateName || String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim(),
    templateLang:
      meta.templateLang ||
      String(process.env.WHATSAPP_TEMPLATE_LANG || 'ar').trim() ||
      'ar',
    parentNotifyEnabled,
    allowTextFallback:
      meta.allowTextFallback != null
        ? meta.allowTextFallback
        : String(process.env.WHATSAPP_ALLOW_TEXT_FALLBACK || '1').trim() !== '0',
    incompleteThreshold: meta.incompleteThreshold || 2,
    source: token ? 'environment' : 'none',
  };
}

/** Sync snapshot — env token + last cached meta */
export function getWhatsAppConfig() {
  return buildConfig(dbMetaCache || {});
}

export function invalidateWhatsAppConfigCache() {
  dbMetaCache = null;
  dbMetaLoadedAt = 0;
}

/**
 * Save non-secret WhatsApp preferences only (never access_token).
 */
export async function saveWhatsAppConfig(partial = {}) {
  const current = await loadWhatsAppConfig({ force: true });
  const next = {
    // NEVER persist access_token
    test_to: String(partial.test_to != null ? partial.test_to : current.testTo || '').trim(),
    template_name: String(
      partial.template_name != null ? partial.template_name : current.templateName || ''
    ).trim(),
    template_lang:
      String(
        partial.template_lang != null ? partial.template_lang : current.templateLang || 'ar'
      ).trim() || 'ar',
    parent_notify_enabled:
      partial.parent_notify_enabled != null
        ? Boolean(partial.parent_notify_enabled)
        : Boolean(current.parentNotifyEnabled),
    allow_text_fallback:
      partial.allow_text_fallback != null
        ? Boolean(partial.allow_text_fallback)
        : Boolean(current.allowTextFallback),
    incomplete_threshold: Math.max(
      1,
      Math.min(
        20,
        Number(
          partial.incomplete_threshold != null
            ? partial.incomplete_threshold
            : current.incompleteThreshold
        ) || 2
      )
    ),
    updated_at: new Date().toISOString(),
  };

  const value = JSON.stringify(next);
  const { error: upErr } = await supabase.from('settings').upsert(
    {
      key: SETTINGS_KEY,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (upErr) {
    const { data: existing } = await supabase
      .from('settings')
      .select('key')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from('settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', SETTINGS_KEY);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('settings').insert({
        key: SETTINGS_KEY,
        value,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
  }

  invalidateWhatsAppConfigCache();
  return loadWhatsAppConfig({ force: true });
}

export function maskToken(token) {
  const t = String(token || '');
  if (!t) return '';
  if (t.length <= 12) return '••••••••••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export function publicWhatsAppStatus(cfg) {
  return {
    configured: Boolean(cfg.token && cfg.phoneNumberId),
    token_set: Boolean(cfg.token),
    token_source: cfg.token ? 'WHATSAPP_ACCESS_TOKEN (Secrets)' : 'missing',
    // never expose token or full mask that could leak meaningful content in logs carelessly
    token_masked: cfg.token ? '•••• (Secrets)' : '',
    token_length: cfg.token ? cfg.token.length : 0,
    phone_number_id: cfg.phoneNumberId || '',
    phone_number_id_set: Boolean(cfg.phoneNumberId),
    waba_id: cfg.wabaId || '',
    waba_id_set: Boolean(cfg.wabaId),
    test_to: cfg.testTo || '',
    test_to_set: Boolean(cfg.testTo),
    template_name: cfg.templateName || '',
    template_set: Boolean(cfg.templateName),
    template_lang: cfg.templateLang || 'ar',
    parent_notify_enabled: Boolean(cfg.parentNotifyEnabled),
    auto_parent_notify: Boolean(cfg.parentNotifyEnabled),
    allow_text_fallback: Boolean(cfg.allowTextFallback),
    incomplete_threshold: cfg.incompleteThreshold || 2,
    config_source: cfg.source || 'none',
    graph_version: process.env.WHATSAPP_GRAPH_VERSION || 'v21.0',
  };
}

export function isWhatsAppConfigured(cfg) {
  const c = cfg || getWhatsAppConfig();
  return Boolean(c.token && c.phoneNumberId);
}

export function isMaskedTokenValue() {
  return true;
}

export function isLikelyAccessToken(raw) {
  const s = String(raw || '').trim();
  return Boolean(s && s.length >= 40 && !/\s/.test(s));
}

export function explainWhatsAppError(errorMessage, errorCode) {
  const msg = String(errorMessage || '');
  const code = Number(errorCode) || 0;
  const lower = msg.toLowerCase();

  if (
    lower.includes('authentication') ||
    lower.includes('invalid oauth') ||
    lower.includes('access token') ||
    code === 190 ||
    code === 10
  ) {
    return {
      ar: 'Access Token غير صالح. حدّث WHATSAPP_ACCESS_TOKEN من تبويب Secrets.',
      retryable: true,
      kind: 'auth',
    };
  }
  if (
    lower.includes('(#131030)') ||
    lower.includes('not a valid whatsapp') ||
    lower.includes('recipient phone number not in allowed list') ||
    code === 131030
  ) {
    return {
      ar: 'الرقم غير مسموح في وضع الاختبار. أضفه كـ Test recipient في Meta.',
      retryable: true,
      kind: 'recipient',
    };
  }
  if (
    lower.includes('(#131047)') ||
    lower.includes('re-engagement') ||
    lower.includes('24 hour') ||
    lower.includes('outside the allowed window') ||
    code === 131047
  ) {
    return {
      ar: 'خارج نافذة 24 ساعة — يلزم Template معتمد.',
      retryable: true,
      kind: 'window',
    };
  }
  return { ar: msg || 'فشل الإرسال عبر WhatsApp', retryable: true, kind: 'other' };
}

export function normalizeWhatsAppTo(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/\D/g, '');
  if (/^20(10|11|12|15)\d{8}$/.test(s)) return s;
  if (/^0(10|11|12|15)\d{8}$/.test(s)) return `20${s.slice(1)}`;
  if (/^(10|11|12|15)\d{8}$/.test(s)) return `20${s}`;
  if (s.length >= 10 && s.length <= 15) return s;
  return '';
}

async function graphFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: String(text || '').slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

export async function fetchPhoneStatus(cfg) {
  const c = cfg || (await loadWhatsAppConfig());
  if (!isWhatsAppConfigured(c)) {
    return { ok: false, error: 'not_configured' };
  }
  return graphFetch(
    `/${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
    { token: c.token }
  );
}

export async function sendWhatsAppText({ to, body, cfg } = {}) {
  const c = cfg || (await loadWhatsAppConfig());
  if (!isWhatsAppConfigured(c)) {
    return { ok: false, error: 'not_configured' };
  }
  const normalized = normalizeWhatsAppTo(to);
  if (!normalized) return { ok: false, error: 'invalid_phone' };
  const text = String(body || '').slice(0, 4096);
  if (!text) return { ok: false, error: 'empty_body' };

  const result = await graphFetch(`/${c.phoneNumberId}/messages`, {
    method: 'POST',
    token: c.token,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalized,
      type: 'text',
      text: { preview_url: false, body: text },
    },
  });

  if (!result.ok) {
    const raw = result.json?.error?.message || `graph_${result.status}`;
    const code = result.json?.error?.code || null;
    const explained = explainWhatsAppError(raw, code);
    return {
      ok: false,
      error: explained.ar,
      error_raw: raw,
      error_code: code,
      error_kind: explained.kind,
      channel: 'text',
    };
  }
  return {
    ok: true,
    message_id: result.json?.messages?.[0]?.id || '',
    channel: 'text',
  };
}

export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode = 'ar',
  bodyParams = [],
  cfg,
} = {}) {
  const c = cfg || (await loadWhatsAppConfig());
  if (!isWhatsAppConfigured(c)) {
    return { ok: false, error: 'not_configured' };
  }
  const normalized = normalizeWhatsAppTo(to);
  if (!normalized) return { ok: false, error: 'invalid_phone' };
  const name = String(templateName || c.templateName || '').trim();
  if (!name) return { ok: false, error: 'template_missing' };

  const components = [];
  const params = (bodyParams || [])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((text) => ({ type: 'text', text }));
  if (params.length) {
    components.push({ type: 'body', parameters: params });
  }

  const result = await graphFetch(`/${c.phoneNumberId}/messages`, {
    method: 'POST',
    token: c.token,
    body: {
      messaging_product: 'whatsapp',
      to: normalized,
      type: 'template',
      template: {
        name,
        language: { code: languageCode || c.templateLang || 'ar' },
        ...(components.length ? { components } : {}),
      },
    },
  });

  if (!result.ok) {
    const raw = result.json?.error?.message || `graph_${result.status}`;
    const code = result.json?.error?.code || null;
    const explained = explainWhatsAppError(raw, code);
    return {
      ok: false,
      error: explained.ar,
      error_raw: raw,
      error_code: code,
      error_kind: explained.kind,
      channel: 'template',
    };
  }
  return {
    ok: true,
    message_id: result.json?.messages?.[0]?.id || '',
    channel: 'template',
  };
}

export async function sendParentAlertMessage({
  to,
  studentName,
  incompleteCount,
  cfg,
} = {}) {
  const c = cfg || (await loadWhatsAppConfig());
  const name = String(studentName || 'الطالب').trim() || 'الطالب';
  const count = Number(incompleteCount) || 0;

  if (c.templateName) {
    const tpl = await sendWhatsAppTemplate({
      to,
      templateName: c.templateName,
      languageCode: c.templateLang || 'ar',
      bodyParams: [name, String(count)],
      cfg: c,
    });
    if (tpl.ok) return { ...tpl, channel: 'template' };
    if (!c.allowTextFallback) return { ...tpl, channel: 'template' };
  }

  const body =
    `تنبيه English Mastery\n` +
    `ولي الأمر الفاضل،\n` +
    `لدى ${name} عدد ${count} من الحصص غير المكتملة وتحتاج إلى المتابعة.\n` +
    `— Mr. Sherif Atta`;

  const text = await sendWhatsAppText({ to, body, cfg: c });
  return { ...text, channel: 'text' };
}

export { SETTINGS_KEY };
