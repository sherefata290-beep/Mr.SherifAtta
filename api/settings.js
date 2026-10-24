import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  sanitizeText,
  sanitizeUrl,
  methodNotAllowed,
  serverError,
} from './security.js';

const PUBLIC_KEYS = new Set(['homepage_image', 'footer']);
// Never expose via generic settings GET without admin; whatsapp_config holds tokens
const SENSITIVE_KEYS = new Set(['whatsapp_config']);

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'settings', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { key } = req.query;
      if (key) {
        const safeKey = sanitizeText(key, 80);
        if (!PUBLIC_KEYS.has(safeKey)) {
          const admin = await requireAdmin(req, res);
          if (!admin) return;
        }
        if (SENSITIVE_KEYS.has(safeKey)) {
          return res.status(403).json({ error: 'استخدم /api/whatsapp لإدارة هذا الإعداد' });
        }
        const { data, error } = await supabase.from('settings').select('*').eq('key', safeKey).maybeSingle();
        if (error) throw error;
        return res.status(200).json(data || { key: safeKey, value: '' });
      }
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { data, error } = await supabase.from('settings').select('*').order('key', { ascending: true });
      if (error) throw error;
      // Strip sensitive values from bulk list
      const safe = (data || []).map((row) =>
        SENSITIVE_KEYS.has(row.key) ? { ...row, value: '[protected]' } : row
      );
      return res.status(200).json(safe);
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const body = req.body || {};
      const key = sanitizeText(body.key, 80);
      if (!key) return res.status(400).json({ error: 'المفتاح مطلوب' });
      if (SENSITIVE_KEYS.has(key)) {
        return res.status(403).json({ error: 'استخدم /api/whatsapp لحفظ إعدادات واتساب' });
      }

      let value = body.value;
      if (key.includes('image') || key.includes('url')) {
        value = sanitizeUrl(value) || sanitizeText(value, 2000);
      } else {
        value = sanitizeText(value, 5000);
      }

      const { data: existing } = await supabase.from('settings').select('*').eq('key', key).maybeSingle();
      if (existing) {
        const { data, error } = await supabase.from('settings').update({ value }).eq('key', key).select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      const { data, error } = await supabase.from('settings').insert({ key, value }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const key = sanitizeText(req.body?.key, 80);
      if (!key) return res.status(400).json({ error: 'المفتاح مطلوب' });
      const { error } = await supabase.from('settings').delete().eq('key', key);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'settings');
  }
}
