import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  requireAuth,
  getAuthUser,
  getProfile,
  sanitizeText,
  sanitizeGradeLevel,
  methodNotAllowed,
  serverError,
  isStaffRole,
  ADMIN_BOOTSTRAP_EMAIL,
} from './security.js';

function generateCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `EM-${out.slice(0, 4)}-${out.slice(4)}`;
}

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

async function isAdminUser(authUser) {
  if (!authUser) return false;
  const profile = await getProfile(authUser.id);
  if (isStaffRole(profile?.role)) return true;
  if (authUser.email && authUser.email.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL) return true;
  return false;
}

async function setStudentGrade(userId, grade_level) {
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

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'access-codes', limit: 80, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    // Student redeems a code
    if (req.method === 'POST' && (req.body?.action === 'redeem' || req.query?.action === 'redeem')) {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const codeValue = normalizeCode(req.body?.code);
      if (!codeValue || codeValue.length < 4) {
        return res.status(400).json({ error: 'أدخل كوداً صالحاً' });
      }

      if (await isAdminUser(auth)) {
        return res.status(400).json({ error: 'حسابات المشرفين لا تحتاج أكواد الطلاب' });
      }

      const { data: codeRow, error: codeErr } = await supabase
        .from('access_codes')
        .select('*')
        .eq('code', codeValue)
        .maybeSingle();
      if (codeErr) throw codeErr;
      if (!codeRow) return res.status(404).json({ error: 'الكود غير موجود' });
      if (!codeRow.is_active) return res.status(400).json({ error: 'هذا الكود غير مفعّل' });

      if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'انتهت صلاحية هذا الكود' });
      }

      const maxUses = Number(codeRow.max_uses || 1);
      const usedCount = Number(codeRow.used_count || 0);
      if (maxUses > 0 && usedCount >= maxUses) {
        return res.status(400).json({ error: 'تم استخدام هذا الكود بالكامل' });
      }

      // If student already chose a grade at signup, the code must match that grade
      const { data: currentGradeRow } = await supabase
        .from('student_grades')
        .select('grade_level')
        .eq('user_id', auth.id)
        .maybeSingle();
      const currentGrade = sanitizeGradeLevel(currentGradeRow?.grade_level || '');
      const codeGrade = sanitizeGradeLevel(codeRow.grade_level);
      if (currentGrade && codeGrade && currentGrade !== codeGrade) {
        return res.status(400).json({
          error: 'هذا الكود لصف مختلف عن الصف الذي اخترته عند التسجيل. استخدم كود صفك أو تواصل مع المدرس.',
        });
      }

      const { data: existing } = await supabase
        .from('code_redemptions')
        .select('id')
        .eq('code_id', codeRow.id)
        .eq('user_id', auth.id)
        .maybeSingle();
      if (existing) {
        await setStudentGrade(auth.id, codeRow.grade_level);
        try {
          const profile = await getProfile(auth.id);
          await supabase
            .from('parent_track_tokens')
            .update({
              user_id: auth.id,
              student_name: sanitizeText(profile?.full_name || codeRow.student_name || '', 120),
              grade_level: sanitizeGradeLevel(codeRow.grade_level) || '',
              updated_at: new Date().toISOString(),
            })
            .eq('access_code_id', codeRow.id)
            .eq('is_active', true);
        } catch {
          /* ignore */
        }
        return res.status(200).json({
          ok: true,
          already: true,
          has_access: true,
          grade_level: codeRow.grade_level,
          message: 'لقد فعّلت هذا الكود مسبقاً',
        });
      }

      const { error: redErr } = await supabase.from('code_redemptions').insert({
        code_id: codeRow.id,
        user_id: auth.id,
        grade_level: codeRow.grade_level,
        student_name: codeRow.student_name || '',
        redeemed_at: new Date().toISOString(),
      });
      if (redErr) throw redErr;

      await supabase
        .from('access_codes')
        .update({ used_count: usedCount + 1 })
        .eq('id', codeRow.id);

      await setStudentGrade(auth.id, codeRow.grade_level);

      // Link parent-track QR token to this student (if QR exists) — non-fatal
      try {
        const profile = await getProfile(auth.id);
        await supabase
          .from('parent_track_tokens')
          .update({
            user_id: auth.id,
            student_name: sanitizeText(
              profile?.full_name || codeRow.student_name || '',
              120
            ),
            grade_level: sanitizeGradeLevel(codeRow.grade_level) || '',
            updated_at: new Date().toISOString(),
          })
          .eq('access_code_id', codeRow.id)
          .eq('is_active', true);
      } catch (linkErr) {
        console.error('link parent track token failed:', linkErr?.message || linkErr);
      }

      return res.status(200).json({
        ok: true,
        has_access: true,
        grade_level: codeRow.grade_level,
        student_name: codeRow.student_name || '',
        label: codeRow.label || '',
        message: 'تم تفعيل كود الوصول بنجاح — يمكنك الآن فتح كورسات واختبارات صفك',
      });
    }

    if (req.method === 'GET') {
      // Student status
      if (req.query?.mine === 'true') {
        const authUser = await getAuthUser(req);
        if (!authUser) return res.status(401).json({ error: 'Unauthorized' });
        const { data: redemptions } = await supabase
          .from('code_redemptions')
          .select('*')
          .eq('user_id', authUser.id)
          .order('redeemed_at', { ascending: false });
        const { data: grade } = await supabase
          .from('student_grades')
          .select('grade_level')
          .eq('user_id', authUser.id)
          .maybeSingle();
        return res.status(200).json({
          grade_level: grade?.grade_level || '',
          redemptions: redemptions || [],
          has_access: Array.isArray(redemptions) && redemptions.length > 0,
        });
      }

      const a = await requireAdmin(req, res);
      if (!a) return;

      const { id } = req.query;
      if (id) {
        const { data, error } = await supabase.from('access_codes').select('*').eq('id', id).single();
        if (error) throw error;
        const { data: redemptions } = await supabase
          .from('code_redemptions')
          .select('*')
          .eq('code_id', id)
          .order('redeemed_at', { ascending: false });
        return res.status(200).json({ ...data, redemptions: redemptions || [] });
      }

      const { data, error } = await supabase
        .from('access_codes')
        .select('*')
        .order('id', { ascending: false });
      if (error) throw error;

      // Attach active parent-track QR token (if any) — admin list only
      // Backfill missing tokens for older codes (non-destructive)
      try {
        const ids = (data || []).map((r) => Number(r.id)).filter(Boolean);
        if (ids.length) {
          let { data: tokens } = await supabase
            .from('parent_track_tokens')
            .select('*')
            .in('access_code_id', ids)
            .eq('is_active', true)
            .order('id', { ascending: false });

          const map = {};
          (tokens || []).forEach((t) => {
            const cid = Number(t.access_code_id);
            if (!map[cid]) map[cid] = t;
          });

          const missing = (data || []).filter((row) => !map[Number(row.id)]);
          if (missing.length) {
            const crypto = await import('crypto');
            const now = new Date().toISOString();
            const tokenRows = missing.map((codeRow) => ({
              token: crypto.randomBytes(32).toString('hex'),
              access_code_id: Number(codeRow.id),
              user_id: '',
              student_name: sanitizeText(codeRow.student_name || codeRow.label || '', 120),
              grade_level: sanitizeGradeLevel(codeRow.grade_level) || '',
              is_active: true,
              created_at: now,
              updated_at: now,
              revoked_at: null,
            }));
            const { data: created } = await supabase
              .from('parent_track_tokens')
              .insert(tokenRows)
              .select();
            (created || []).forEach((t) => {
              map[Number(t.access_code_id)] = t;
            });
          }

          return res.status(200).json(
            (data || []).map((row) => ({
              ...row,
              track_token: map[Number(row.id)]?.token || '',
              track_token_id: map[Number(row.id)]?.id || null,
            }))
          );
        }
      } catch (attachErr) {
        console.error('attach track tokens failed:', attachErr?.message || attachErr);
      }

      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;

      const body = req.body || {};
      const count = Math.min(Math.max(Number(body.count) || 1, 1), 50);
      const grade_level = sanitizeGradeLevel(body.grade_level);
      if (!grade_level) return res.status(400).json({ error: 'اختر الصف الدراسي للكود' });

      const label = sanitizeText(body.label || '', 120);
      const student_name = sanitizeText(body.student_name || '', 120);
      const note = sanitizeText(body.note || '', 300);
      const max_uses = Math.min(Math.max(Number(body.max_uses) || 1, 1), 1000);
      const is_active = body.is_active !== false;
      let expires_at = null;
      if (body.expires_at) {
        const d = new Date(body.expires_at);
        if (!Number.isNaN(d.getTime())) expires_at = d.toISOString();
      }

      const customCode = body.code ? normalizeCode(body.code) : '';
      const rows = [];
      const creator = a?.user?.id || a?.user?.email || '';

      if (customCode && count === 1) {
        rows.push({
          code: customCode,
          label: label || student_name || 'كود وصول',
          student_name,
          grade_level,
          max_uses,
          used_count: 0,
          is_active,
          expires_at,
          note,
          created_by: creator,
          created_at: new Date().toISOString(),
        });
      } else {
        for (let i = 0; i < count; i += 1) {
          let code = generateCode();
          for (let t = 0; t < 5; t += 1) {
            const { data: exists } = await supabase
              .from('access_codes')
              .select('id')
              .eq('code', code)
              .maybeSingle();
            if (!exists) break;
            code = generateCode();
          }
          rows.push({
            code,
            label: label || (count > 1 ? `دفعة ${grade_level}` : student_name || 'كود وصول'),
            student_name: count === 1 ? student_name : '',
            grade_level,
            max_uses,
            used_count: 0,
            is_active,
            expires_at,
            note,
            created_by: creator,
            created_at: new Date().toISOString(),
          });
        }
      }

      const { data, error } = await supabase.from('access_codes').insert(rows).select();
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) {
          return res.status(400).json({ error: 'الكود مستخدم مسبقاً — اختر كوداً آخر' });
        }
        throw error;
      }

      // Auto-create secure parent-track QR tokens (opaque random tokens — no student data in QR)
      try {
        const crypto = await import('crypto');
        const now = new Date().toISOString();
        const tokenRows = (data || []).map((codeRow) => ({
          token: crypto.randomBytes(32).toString('hex'),
          access_code_id: Number(codeRow.id),
          user_id: '',
          student_name: sanitizeText(codeRow.student_name || codeRow.label || '', 120),
          grade_level: sanitizeGradeLevel(codeRow.grade_level) || '',
          is_active: true,
          created_at: now,
          updated_at: now,
          revoked_at: null,
        }));
        if (tokenRows.length) {
          await supabase.from('parent_track_tokens').insert(tokenRows);
        }
      } catch (tokErr) {
        console.error('auto QR token create failed (non-fatal):', tokErr?.message || tokErr);
      }

      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id, ...raw } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const updates = {};
      if (raw.label !== undefined) updates.label = sanitizeText(raw.label, 120);
      if (raw.student_name !== undefined) updates.student_name = sanitizeText(raw.student_name, 120);
      if (raw.note !== undefined) updates.note = sanitizeText(raw.note, 300);
      if (raw.grade_level !== undefined) {
        const g = sanitizeGradeLevel(raw.grade_level);
        if (!g) return res.status(400).json({ error: 'صف دراسي غير صالح' });
        updates.grade_level = g;
      }
      if (raw.max_uses !== undefined) {
        updates.max_uses = Math.min(Math.max(Number(raw.max_uses) || 1, 1), 1000);
      }
      if (raw.is_active !== undefined) updates.is_active = Boolean(raw.is_active);
      if (raw.expires_at !== undefined) {
        if (!raw.expires_at) updates.expires_at = null;
        else {
          const d = new Date(raw.expires_at);
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'تاريخ انتهاء غير صالح' });
          updates.expires_at = d.toISOString();
        }
      }
      if (raw.code !== undefined) {
        const c = normalizeCode(raw.code);
        if (c.length < 4) return res.status(400).json({ error: 'الكود قصير جداً' });
        updates.code = c;
      }

      const { data, error } = await supabase
        .from('access_codes')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      await supabase.from('code_redemptions').delete().eq('code_id', id);
      try {
        await supabase.from('parent_track_tokens').delete().eq('access_code_id', id);
      } catch {
        /* non-fatal */
      }
      const { error } = await supabase.from('access_codes').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    console.error('access-codes API error:', err);
    return serverError(res, err);
  }
}
