import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  sanitizeEmail,
  methodNotAllowed,
  serverError,
} from './security.js';

/**
 * Public endpoint: check whether an email already has a platform profile.
 * Used by login UI to redirect unregistered emails to sign-up.
 */
export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'check-email', limit: 40, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res);

    const raw =
      req.method === 'GET'
        ? req.query?.email
        : req.body?.email;

    const email = sanitizeEmail(raw);
    if (!email) {
      return res.status(400).json({ exists: false, error: 'بريد إلكتروني غير صالح' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ exists: Boolean(data?.id), email });
  } catch (err) {
    return serverError(res, err, 'check-email');
  }
}
