import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireFullAdmin,
  sanitizeText,
  sanitizeEmail,
  verifyAccountsPin,
  ROLE_META,
  STAFF_ROLES,
  methodNotAllowed,
  serverError,
  ADMIN_BOOTSTRAP_EMAIL,
} from './security.js';

function normalizeRole(role) {
  let r = String(role || '').toLowerCase().trim();
  if (r === 'support') r = 'users'; // legacy
  // Prefer canonical staff roles (exclude storing pure legacy alias when creating)
  if (r === 'users' || r === 'reports' || r === 'admin' || r === 'content' || r === 'exams' || r === 'curriculum') return r;
  return STAFF_ROLES.has(r) ? r : null;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'admin-accounts', limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    // Unlock check (full admin + pin)
    if (req.method === 'POST' && req.body?.action === 'unlock') {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;
      if (!verifyAccountsPin(req.body?.pin)) {
        return res.status(403).json({ error: 'الرقم السري غير صحيح' });
      }
      return res.status(200).json({
        ok: true,
        roles: Object.entries(ROLE_META).map(([id, meta]) => ({ id, ...meta })),
      });
    }

    // List staff accounts
    if (req.method === 'GET') {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;
      if (!verifyAccountsPin(req.query?.pin)) {
        return res.status(403).json({ error: 'الرقم السري مطلوب أو غير صحيح' });
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', Array.from(STAFF_ROLES))
        .order('created_at', { ascending: true });
      if (error) throw error;

      return res.status(200).json({
        accounts: data || [],
        roles: Object.entries(ROLE_META).map(([id, meta]) => ({ id, ...meta })),
      });
    }

    // Create staff account
    if (req.method === 'POST' && (!req.body?.action || req.body?.action === 'create')) {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;
      if (!verifyAccountsPin(req.body?.pin)) {
        return res.status(403).json({ error: 'الرقم السري غير صحيح' });
      }

      const email = sanitizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const full_name = sanitizeText(req.body?.full_name || '', 80);
      const role = normalizeRole(req.body?.role);

      if (!email) return res.status(400).json({ error: 'بريد إلكتروني غير صالح' });
      if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف على الأقل' });
      if (!full_name) return res.status(400).json({ error: 'الاسم مطلوب' });
      if (!role) return res.status(400).json({ error: 'اختر دوراً صالحاً' });

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (createErr) {
        const msg = createErr.message || 'فشل إنشاء الحساب';
        if (/already|registered|exists/i.test(msg)) {
          return res.status(400).json({ error: 'هذا البريد مسجّل مسبقاً' });
        }
        throw createErr;
      }

      const userId = created?.user?.id;
      if (!userId) return res.status(500).json({ error: 'تعذر إنشاء المستخدم' });

      const { data: existing } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      let profile;
      if (existing) {
        const { data, error } = await supabase
          .from('profiles')
          .update({ full_name, role, email })
          .eq('id', userId)
          .select()
          .single();
        if (error) throw error;
        profile = data;
      } else {
        const { data, error } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            email,
            full_name,
            role,
            avatar_url: '',
            total_points: 0,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;
        profile = data;
      }

      return res.status(201).json(profile);
    }

    // Update staff account
    if (req.method === 'PUT') {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;
      if (!verifyAccountsPin(req.body?.pin)) {
        return res.status(403).json({ error: 'الرقم السري غير صحيح' });
      }

      const id = String(req.body?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const { data: target } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });

      const updates = {};
      if (req.body?.full_name != null) {
        const name = sanitizeText(req.body.full_name, 80);
        if (!name) return res.status(400).json({ error: 'الاسم غير صالح' });
        updates.full_name = name;
      }

      if (req.body?.role != null) {
        const role = normalizeRole(req.body.role);
        if (!role) return res.status(400).json({ error: 'دور غير صالح' });
        // Prevent demoting the last full admin / bootstrap
        if (
          target.role === 'admin' &&
          role !== 'admin' &&
          (target.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL || id === admin.user.id)
        ) {
          // allow demoting self only if not bootstrap? keep bootstrap always admin
          if (target.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL) {
            return res.status(400).json({ error: 'لا يمكن تغيير دور حساب المشرف الأساسي' });
          }
        }
        updates.role = role;
      }

      const password = req.body?.password != null ? String(req.body.password) : '';
      if (password) {
        if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف على الأقل' });
        const { error: pwErr } = await supabase.auth.admin.updateUserById(id, { password });
        if (pwErr) throw pwErr;
      }

      if (req.body?.full_name != null) {
        await supabase.auth.admin.updateUserById(id, {
          user_metadata: { full_name: updates.full_name || target.full_name },
        });
      }

      if (!Object.keys(updates).length && !password) {
        return res.status(400).json({ error: 'لا توجد تعديلات' });
      }

      let profile = target;
      if (Object.keys(updates).length) {
        const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
        if (error) throw error;
        profile = data;
      }

      return res.status(200).json(profile);
    }

    // Delete / demote staff account
    if (req.method === 'DELETE') {
      const admin = await requireFullAdmin(req, res);
      if (!admin) return;
      if (!verifyAccountsPin(req.body?.pin)) {
        return res.status(403).json({ error: 'الرقم السري غير صحيح' });
      }

      const id = String(req.body?.id || '').trim();
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      if (id === admin.user.id) return res.status(400).json({ error: 'لا يمكن حذف حسابك الحالي' });

      const { data: target } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });
      if (target.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL) {
        return res.status(400).json({ error: 'لا يمكن حذف حساب المشرف الأساسي' });
      }

      // Demote to student instead of hard-deleting auth user (safer)
      const { data, error } = await supabase
        .from('profiles')
        .update({ role: 'student' })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, profile: data });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'admin-accounts');
  }
}
