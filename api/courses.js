import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  getAuthUser,
  getProfile,
  sanitizeText,
  sanitizeUrl,
  asBool,
  asPositiveInt,
  methodNotAllowed,
  serverError,
  sanitizeGradeLevel,
  getUserGradeLevel,
  getUserHasAccess,
  getCourseGradeMap,
  setCourseGrade,
  filterByStudentGrade,
  ADMIN_BOOTSTRAP_EMAIL,
} from './security.js';

const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

async function getCourseMedia(courseId) {
  try {
    const { data, error } = await supabase
      .from('course_media')
      .select('*')
      .eq('course_id', courseId)
      .order('id', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('course media fetch failed:', err.message);
    return [];
  }
}

async function resolveAccess(req) {
  const authUser = await getAuthUser(req);
  if (!authUser) return { authUser: null, isAdmin: false, studentGrade: '', hasAccess: false };
  const profile = await getProfile(authUser.id);
  const isAdmin =
    profile?.role === 'admin' ||
    profile?.role === 'users' ||
    profile?.role === 'reports' ||
    profile?.role === 'content' ||
    profile?.role === 'exams' ||
    profile?.role === 'curriculum' ||
    profile?.role === 'support' ||
    (authUser.email && authUser.email.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL);
  if (isAdmin) return { authUser, isAdmin: true, studentGrade: '', hasAccess: true, profile };
  const [studentGrade, hasAccess] = await Promise.all([
    getUserGradeLevel(authUser.id),
    getUserHasAccess(authUser.id),
  ]);
  return { authUser, isAdmin: false, studentGrade, hasAccess, profile };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'courses', limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { id, admin } = req.query;
      const access = await resolveAccess(req);

      if (id) {
        const courseId = asPositiveInt(id) || id;
        const { data, error } = await supabase.from('courses').select('*').eq('id', courseId).single();
        if (error) throw error;

        const gradeMap = await getCourseGradeMap([data.id]);
        const grade_level = gradeMap[Number(data.id)] || '';

        if (admin === 'true') {
          const a = await requireAdmin(req, res);
          if (!a) return;
          const media = await getCourseMedia(data.id);
          return res.status(200).json({ ...data, grade_level, media });
        }

        if (!data.is_published) {
          return res.status(404).json({ error: 'الكورس غير متاح' });
        }

        // Students need: login + redeemed access code + matching grade
        if (!access.isAdmin) {
          if (!access.authUser) {
            return res.status(401).json({ error: 'يجب تسجيل الدخول لفتح الكورس' });
          }
          if (!access.hasAccess) {
            return res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً لفتح الكورس' });
          }
          if (!access.studentGrade) {
            return res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً لفتح الكورس' });
          }
          if (!grade_level || grade_level !== access.studentGrade) {
            return res.status(403).json({ error: 'هذا الكورس غير متاح لصفك الدراسي' });
          }
        }

        const media = await getCourseMedia(data.id);
        return res.status(200).json({ ...data, grade_level, media });
      }

      let query = supabase.from('courses').select('*').order('id', { ascending: false });
      if (admin === 'true') {
        const a = await requireAdmin(req, res);
        if (!a) return;
        const { data, error } = await query;
        if (error) throw error;
        const gradeMap = await getCourseGradeMap((data || []).map((c) => c.id));
        return res.status(200).json(filterByStudentGrade(data, gradeMap, { adminMode: true }));
      }

      query = query.eq('is_published', true);
      const { data, error } = await query;
      if (error) throw error;
      const gradeMap = await getCourseGradeMap((data || []).map((c) => c.id));

      // Public catalog: everyone sees all published courses (with grade labels).
      // Opening a course is restricted by grade on the detail endpoint.
      return res.status(200).json(filterByStudentGrade(data, gradeMap, { adminMode: true }));
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const title = sanitizeText(body.title, 200);
      if (!title) return res.status(400).json({ error: 'العنوان مطلوب' });
      const grade_level = sanitizeGradeLevel(body.grade_level);
      if (!grade_level) return res.status(400).json({ error: 'اختر الصف الدراسي للكورس' });
      const level = LEVELS.has(body.level) ? body.level : 'beginner';
      const { data, error } = await supabase
        .from('courses')
        .insert({
          title,
          title_ar: sanitizeText(body.title_ar || title, 200),
          description: sanitizeText(body.description, 5000),
          description_ar: sanitizeText(body.description_ar || body.description, 5000),
          level,
          image_url: sanitizeUrl(body.image_url) || sanitizeText(body.image_url, 1000),
          duration: sanitizeText(body.duration, 80),
          is_published: asBool(body.is_published, true),
        })
        .select()
        .single();
      if (error) throw error;
      await setCourseGrade(data.id, grade_level);
      return res.status(201).json({ ...data, grade_level });
    }

    if (req.method === 'PUT') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const id = body.id;
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const updates = {};
      if (body.title != null) updates.title = sanitizeText(body.title, 200);
      if (body.title_ar != null) updates.title_ar = sanitizeText(body.title_ar, 200);
      if (body.description != null) updates.description = sanitizeText(body.description, 5000);
      if (body.description_ar != null) updates.description_ar = sanitizeText(body.description_ar, 5000);
      if (body.level != null && LEVELS.has(body.level)) updates.level = body.level;
      // Allow explicit clear: empty string must wipe the cover image
      if (Object.prototype.hasOwnProperty.call(body, 'image_url')) {
        const raw = body.image_url;
        if (raw === null || raw === undefined || String(raw).trim() === '') {
          updates.image_url = '';
        } else {
          updates.image_url = sanitizeUrl(raw) || '';
        }
      }
      if (body.duration != null) updates.duration = sanitizeText(body.duration, 80);
      if (body.is_published != null) updates.is_published = asBool(body.is_published, true);

      let data;
      if (Object.keys(updates).length) {
        const result = await supabase.from('courses').update(updates).eq('id', id).select().single();
        if (result.error) throw result.error;
        data = result.data;
      } else {
        const result = await supabase.from('courses').select('*').eq('id', id).single();
        if (result.error) throw result.error;
        data = result.data;
      }

      let grade_level = '';
      if (body.grade_level !== undefined) {
        grade_level = sanitizeGradeLevel(body.grade_level);
        if (body.grade_level && !grade_level) {
          return res.status(400).json({ error: 'الصف الدراسي غير صالح' });
        }
        await setCourseGrade(id, grade_level);
      } else {
        const map = await getCourseGradeMap([id]);
        grade_level = map[Number(id)] || '';
      }

      return res.status(200).json({ ...data, grade_level });
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      try {
        await supabase.from('course_media').delete().eq('course_id', id);
      } catch {}
      try {
        await supabase.from('course_grades').delete().eq('course_id', id);
      } catch {}
      try {
        await supabase.from('lessons').delete().eq('course_id', id);
      } catch {}
      const { error } = await supabase.from('courses').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'courses');
  }
}
