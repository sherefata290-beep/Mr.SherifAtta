import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAuth,
  sanitizeEmail,
  methodNotAllowed,
  serverError,
} from './security.js';

/**
 * After Google OAuth, verify the email already has a platform account (profiles row).
 * Unregistered Google users are signed out server-side (auth user deleted) and rejected.
 */
export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'google-gate', limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method !== 'POST') return methodNotAllowed(res);

    const user = await requireAuth(req, res);
    if (!user) return;

    const email = sanitizeEmail(user.email);
    if (!email) {
      try {
        await supabase.auth.admin.deleteUser(user.id);
      } catch {}
      return res.status(403).json({
        ok: false,
        error: 'لا يمكن التحقق من البريد الإلكتروني لحساب Google.',
      });
    }

    // Prefer match by auth user id (email signup + linked Google identity)
    const { data: byId, error: byIdErr } = await supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', user.id)
      .maybeSingle();
    if (byIdErr) throw byIdErr;

    if (byId?.id) {
      return res.status(200).json({ ok: true, profile: byId });
    }

    // Fallback: account was created earlier with this email
    const { data: byEmail, error: byEmailErr } = await supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('email', email)
      .maybeSingle();
    if (byEmailErr) throw byEmailErr;

    if (byEmail?.id) {
      // Registered email exists — allow Google session (identity may be separate)
      return res.status(200).json({ ok: true, profile: byEmail, email_match: true });
    }

    // Not registered on the platform — remove the OAuth auth user and block
    try {
      await supabase.auth.admin.deleteUser(user.id);
    } catch (delErr) {
      console.error('google-gate deleteUser failed:', delErr?.message || delErr);
    }

    return res.status(403).json({
      ok: false,
      error:
        'لا يمكن الدخول بحساب Google إلا بعد إنشاء حساب على المنصة بنفس البريد الإلكتروني أولاً.',
    });
  } catch (err) {
    return serverError(res, err, 'google-gate');
  }
}
