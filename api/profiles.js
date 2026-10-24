import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAuth,
  requireAdmin,
  getAuthUser,
  sanitizeText,
  sanitizeEmail,
  ADMIN_BOOTSTRAP_EMAIL,
  methodNotAllowed,
  serverError,
} from './security.js';

const ALLOWED_GRADES = new Set([
  'primary_3',
  'primary_4',
  'primary_5',
  'primary_6',
  'prep_1',
  'prep_2',
  'prep_3',
]);

function sanitizeParentPhone(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  const cleaned = raw.replace(/[^\d+\-\s()]/g, '').slice(0, 20);
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return cleaned;
}

function sanitizeGradeLevel(value) {
  if (value == null) return '';
  const g = String(value).trim();
  return ALLOWED_GRADES.has(g) ? g : '';
}

async function getExtras(userId) {
  try {
    const [contactRes, gradeRes, accessRes] = await Promise.all([
      supabase.from('profile_contacts').select('parent_phone').eq('user_id', userId).maybeSingle(),
      supabase.from('student_grades').select('grade_level').eq('user_id', userId).maybeSingle(),
      supabase.from('code_redemptions').select('id').eq('user_id', userId).limit(1).maybeSingle(),
    ]);
    return {
      parent_phone: contactRes.data?.parent_phone || '',
      grade_level: gradeRes.data?.grade_level || '',
      // Unlock content only after redeeming an access code (not just picking a grade)
      has_access: Boolean(accessRes.data?.id),
    };
  } catch (err) {
    console.error('getExtras failed:', err?.message || err);
    return { parent_phone: '', grade_level: '', has_access: false };
  }
}

async function saveGrade(userId, grade_level) {
  if (!grade_level) {
    await supabase.from('student_grades').delete().eq('user_id', userId);
    return;
  }
  await supabase.from('student_grades').upsert({
    user_id: userId,
    grade_level,
    created_at: new Date().toISOString(),
  });
}

async function attachExtras(profiles) {
  if (!profiles?.length) return profiles || [];
  try {
    const ids = profiles.map((p) => p.id);
    const [contactsRes, gradesRes, accessRes] = await Promise.all([
      supabase.from('profile_contacts').select('user_id, parent_phone').in('user_id', ids),
      supabase.from('student_grades').select('user_id, grade_level').in('user_id', ids),
      supabase.from('code_redemptions').select('user_id').in('user_id', ids),
    ]);
    const phoneMap = Object.fromEntries((contactsRes.data || []).map((c) => [c.user_id, c.parent_phone || '']));
    const gradeMap = Object.fromEntries((gradesRes.data || []).map((g) => [g.user_id, g.grade_level || '']));
    const accessSet = new Set((accessRes.data || []).map((r) => r.user_id));
    return profiles.map((p) => ({
      ...p,
      parent_phone: phoneMap[p.id] || '',
      grade_level: gradeMap[p.id] || '',
      has_access: accessSet.has(p.id),
    }));
  } catch (err) {
    console.error('attachExtras failed:', err?.message || err);
    return profiles.map((p) => ({
      ...p,
      parent_phone: p.parent_phone || '',
      grade_level: p.grade_level || '',
      has_access: Boolean(p.has_access),
    }));
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'profiles', limit: 80, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { id } = req.query;

      if (id) {
        const authUser = await getAuthUser(req);
        const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(200).json({});

        const isSelf = authUser?.id === id;
        let isAdmin = false;
        if (authUser) {
          const me = await supabase.from('profiles').select('role').eq('id', authUser.id).maybeSingle();
          isAdmin =
            ['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support'].includes(me.data?.role) ||
            authUser.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL;
        }
        if (isSelf || isAdmin) {
          const extras = await getExtras(id);
          return res.status(200).json({ ...data, ...extras });
        }
        {
          const extras = await getExtras(id);
          return res.status(200).json({
            id: data.id,
            full_name: data.full_name,
            total_points: data.total_points || 0,
            role: ['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support'].includes(data.role) ? data.role : 'student',
            avatar_url: data.avatar_url || '',
            grade_level: extras.grade_level || '',
            has_access: Boolean(extras.has_access),
          });
        }
      }

      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { data, error } = await supabase.from('profiles').select('*').order('total_points', { ascending: false });
      if (error) throw error;
      return res.status(200).json(await attachExtras(data));
    }

    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const body = req.body || {};
      if (body.id && body.id !== user.id) {
        return res.status(403).json({ error: 'لا يمكن إنشاء ملف لمستخدم آخر' });
      }

      const email = sanitizeEmail(body.email || user.email);
      if (!email) return res.status(400).json({ error: 'بريد إلكتروني غير صالح' });
      if (email !== (user.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'البريد لا يطابق الحساب المسجّل' });
      }

      const parent_phone = sanitizeParentPhone(body.parent_phone || user.user_metadata?.parent_phone || '');
      const grade_level = sanitizeGradeLevel(body.grade_level || user.user_metadata?.grade_level || '');

      const { data: existing } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (existing) {
        if (parent_phone) {
          await supabase.from('profile_contacts').upsert({
            user_id: user.id,
            parent_phone,
            created_at: new Date().toISOString(),
          });
        }
        // Allow first-time grade selection if not set yet (e.g. completed signup form)
        const extras = await getExtras(user.id);
        if (grade_level && !extras.grade_level) {
          await saveGrade(user.id, grade_level);
          extras.grade_level = grade_level;
        }
        return res.status(200).json({ ...existing, ...extras });
      }

      const role = email === ADMIN_BOOTSTRAP_EMAIL ? 'admin' : 'student';
      const full_name = sanitizeText(body.full_name || user.user_metadata?.full_name || email.split('@')[0], 80);

      const { data, error } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email,
          full_name: full_name || email.split('@')[0],
          role,
          avatar_url: '',
          total_points: 0,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;

      if (parent_phone) {
        await supabase.from('profile_contacts').upsert({
          user_id: user.id,
          parent_phone,
          created_at: new Date().toISOString(),
        });
      }
      if (grade_level) {
        await saveGrade(user.id, grade_level);
      }

      return res.status(201).json({ ...data, parent_phone: parent_phone || '', grade_level: grade_level || '' });
    }

    if (req.method === 'PUT') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const body = req.body || {};
      const id = body.id;
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const me = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      const isAdmin =
        ['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support'].includes(me.data?.role) ||
        user.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL;

      if (!isAdmin && id !== user.id) {
        return res.status(403).json({ error: 'غير مصرح' });
      }

      const updates = {};
      if (body.full_name != null) updates.full_name = sanitizeText(body.full_name, 80);
      if (body.avatar_url != null) updates.avatar_url = sanitizeText(body.avatar_url, 500);

      // Role + points: full admin only (not content/exams/curriculum/support)
      const isFull =
        me.data?.role === 'admin' || user.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL;
      if (isFull) {
        const allowedRoles = new Set([
          'admin',
          'users',
          'reports',
          'content',
          'exams',
          'curriculum',
          'support',
          'student',
        ]);
        if (body.role != null && allowedRoles.has(String(body.role))) {
          updates.role = String(body.role);
        }
        if (body.total_points != null) {
          const pts = Number(body.total_points);
          if (Number.isFinite(pts) && pts >= 0 && pts < 1e9) updates.total_points = Math.floor(pts);
        }
      } else if (isAdmin && (body.role != null || body.total_points != null)) {
        return res.status(403).json({
          error: 'تغيير الأدوار أو النقاط متاح للمشرف الكامل فقط',
        });
      }

      let parentPhoneUpdated = null;
      if (body.parent_phone != null && (isAdmin || id === user.id)) {
        const phone = sanitizeParentPhone(body.parent_phone);
        if (body.parent_phone && !phone) {
          return res.status(400).json({ error: 'رقم ولي الأمر غير صالح' });
        }
        parentPhoneUpdated = phone;
        if (phone) {
          await supabase.from('profile_contacts').upsert({
            user_id: id,
            parent_phone: phone,
            created_at: new Date().toISOString(),
          });
        } else {
          await supabase.from('profile_contacts').delete().eq('user_id', id);
        }
      }

      let gradeUpdated = null;
      // Only staff/admin can set grade manually. Students unlock grade via access-code redeem only.
      if (body.grade_level != null) {
        if (!isAdmin) {
          return res.status(403).json({
            error: 'لا يمكن تحديد الصف يدوياً — استخدم كود الوصول من المدرس',
          });
        }
        const grade = sanitizeGradeLevel(body.grade_level);
        if (body.grade_level && !grade) {
          return res.status(400).json({ error: 'الصف الدراسي غير صالح' });
        }
        gradeUpdated = grade;
        await saveGrade(id, grade);
      }

      if (!Object.keys(updates).length && parentPhoneUpdated === null && gradeUpdated === null) {
        return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
      }

      let data;
      if (Object.keys(updates).length) {
        const result = await supabase.from('profiles').update(updates).eq('id', id).select().single();
        if (result.error) throw result.error;
        data = result.data;
      } else {
        const result = await supabase.from('profiles').select('*').eq('id', id).single();
        if (result.error) throw result.error;
        data = result.data;
      }

      const extras = await getExtras(id);
      return res.status(200).json({
        ...data,
        parent_phone: extras.parent_phone || parentPhoneUpdated || '',
        grade_level: extras.grade_level || gradeUpdated || '',
      });
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      if (id === admin.user.id) return res.status(400).json({ error: 'لا يمكن حذف حسابك الحالي' });
      await supabase.from('profile_contacts').delete().eq('user_id', id);
      await supabase.from('student_grades').delete().eq('user_id', id);
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'profiles');
  }
}
