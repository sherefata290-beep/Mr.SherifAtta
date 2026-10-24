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
  getQuizGradeMap,
  setQuizGrade,
  filterByStudentGrade,
  ADMIN_BOOTSTRAP_EMAIL,
} from './security.js';

const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

async function getQuizImageMap(quizIds = []) {
  const ids = (quizIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};
  const { data, error } = await supabase.from('quiz_images').select('*').in('quiz_id', ids);
  if (error) {
    console.error('quiz_images fetch error:', error.message);
    return {};
  }
  const map = {};
  (data || []).forEach((row) => {
    map[Number(row.quiz_id)] = row.image_url || '';
  });
  return map;
}

async function setQuizImage(quizId, imageUrl) {
  await supabase.from('quiz_images').delete().eq('quiz_id', quizId);
  if (imageUrl) {
    await supabase.from('quiz_images').insert({
      quiz_id: Number(quizId),
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
    });
  }
}

function normalizeMaxAttempts(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 50);
}

function normalizePassPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.min(Math.max(Math.floor(n), 0), 100);
}

async function getQuizSettingsMap(quizIds = []) {
  const ids = (quizIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase.from('quiz_settings').select('*').in('quiz_id', ids);
    if (error) {
      console.error('quiz_settings fetch error:', error.message);
      return {};
    }
    const map = {};
    (data || []).forEach((row) => {
      map[Number(row.quiz_id)] = {
        max_attempts: normalizeMaxAttempts(row.max_attempts ?? 1),
        pass_percentage: normalizePassPercentage(row.pass_percentage ?? 50),
      };
    });
    return map;
  } catch (err) {
    console.error('quiz_settings map error:', err.message);
    return {};
  }
}

async function setQuizSettings(quizId, { max_attempts, pass_percentage }) {
  const payload = {
    quiz_id: Number(quizId),
    max_attempts: normalizeMaxAttempts(max_attempts),
    pass_percentage: normalizePassPercentage(pass_percentage),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('quiz_settings').upsert(payload, { onConflict: 'quiz_id' });
  if (error) throw error;
  return {
    max_attempts: payload.max_attempts,
    pass_percentage: payload.pass_percentage,
  };
}

function withSettings(quiz, settingsMap = {}) {
  const s = settingsMap[Number(quiz.id)] || {};
  return {
    ...quiz,
    max_attempts: s.max_attempts ?? 1,
    pass_percentage: s.pass_percentage ?? 50,
  };
}

/** Additive helper: question counts only (does not alter quiz rows) */
async function getQuestionCountMap(quizIds = []) {
  const ids = (quizIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('id, quiz_id')
      .in('quiz_id', ids);
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      const qid = Number(row.quiz_id);
      map[qid] = (map[qid] || 0) + 1;
    });
    return map;
  } catch (err) {
    console.error('question count map failed:', err.message);
    return {};
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

  const rl = rateLimit(req, { key: 'quizzes', limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { id, admin } = req.query;
      const access = await resolveAccess(req);

      if (id) {
        const { data, error } = await supabase.from('quizzes').select('*').eq('id', id).single();
        if (error) throw error;

        const gradeMap = await getQuizGradeMap([Number(id)]);
        const grade_level = gradeMap[Number(id)] || '';
        const imageMap = await getQuizImageMap([Number(id)]);
        const image_url = imageMap[Number(id)] || '';
        const settingsMap = await getQuizSettingsMap([Number(id)]);

        if (admin === 'true') {
          const a = await requireAdmin(req, res);
          if (!a) return;
          return res.status(200).json(withSettings({ ...data, grade_level, image_url }, settingsMap));
        }

        if (!data.is_published) {
          return res.status(404).json({ error: 'الاختبار غير متاح' });
        }

        if (!access.isAdmin) {
          if (!access.authUser) {
            return res.status(401).json({ error: 'يجب تسجيل الدخول لفتح الاختبار' });
          }
          if (!access.hasAccess) {
            return res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً لفتح الاختبار' });
          }
          if (!access.studentGrade) {
            return res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً لفتح الاختبار' });
          }
          if (!grade_level || grade_level !== access.studentGrade) {
            return res.status(403).json({ error: 'هذا الاختبار غير متاح لصفك الدراسي' });
          }
        }

        return res.status(200).json(withSettings({ ...data, grade_level, image_url }, settingsMap));
      }

      let query = supabase.from('quizzes').select('*').order('id', { ascending: false });
      if (admin === 'true') {
        const a = await requireAdmin(req, res);
        if (!a) return;
        const { data, error } = await query;
        if (error) throw error;
        const gradeMap = await getQuizGradeMap((data || []).map((q) => q.id));
        const imageMap = await getQuizImageMap((data || []).map((q) => q.id));
        const settingsMap = await getQuizSettingsMap((data || []).map((q) => q.id));
        const listedAdmin = filterByStudentGrade(data, gradeMap, { adminMode: true });
        const countMapAdmin = await getQuestionCountMap(listedAdmin.map((q) => q.id));
        return res.status(200).json(
          listedAdmin.map((q) =>
            withSettings(
              {
                ...q,
                image_url: imageMap[Number(q.id)] || '',
                question_count: countMapAdmin[Number(q.id)] || 0,
              },
              settingsMap
            )
          )
        );
      }

      query = query.eq('is_published', true);
      const { data, error } = await query;
      if (error) throw error;
      const gradeMap = await getQuizGradeMap((data || []).map((q) => q.id));
      const imageMap = await getQuizImageMap((data || []).map((q) => q.id));
      const settingsMap = await getQuizSettingsMap((data || []).map((q) => q.id));
      // Public catalog: everyone sees all published quizzes; opening is grade-locked.
      const listed = filterByStudentGrade(data, gradeMap, { adminMode: true });
      const countMap = await getQuestionCountMap(listed.map((q) => q.id));

      return res.status(200).json(
        listed.map((q) =>
          withSettings(
            {
              ...q,
              image_url: imageMap[Number(q.id)] || '',
              question_count: countMap[Number(q.id)] || 0,
            },
            settingsMap
          )
        )
      );
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const title = sanitizeText(body.title, 200);
      if (!title) return res.status(400).json({ error: 'العنوان مطلوب' });
      const grade_level = sanitizeGradeLevel(body.grade_level);
      if (!grade_level) return res.status(400).json({ error: 'اختر الصف الدراسي للاختبار' });
      const image_url = sanitizeUrl(body.image_url) || sanitizeText(body.image_url, 1000);
      const { data, error } = await supabase
        .from('quizzes')
        .insert({
          title,
          title_ar: sanitizeText(body.title_ar || title, 200),
          description: sanitizeText(body.description, 3000),
          course_id: body.course_id ? Number(body.course_id) : null,
          level: LEVELS.has(body.level) ? body.level : 'beginner',
          duration_minutes: asPositiveInt(body.duration_minutes) || 20,
          is_published: asBool(body.is_published, true),
        })
        .select()
        .single();
      if (error) throw error;
      if (image_url) await setQuizImage(data.id, image_url);
      await setQuizGrade(data.id, grade_level);
      const settings = await setQuizSettings(data.id, {
        max_attempts: body.max_attempts,
        pass_percentage: body.pass_percentage,
      });
      return res.status(201).json({
        ...data,
        image_url: image_url || '',
        grade_level,
        ...settings,
      });
    }

    if (req.method === 'PUT') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      const updates = {};
      if (body.title != null) updates.title = sanitizeText(body.title, 200);
      if (body.title_ar != null) updates.title_ar = sanitizeText(body.title_ar, 200);
      if (body.description != null) updates.description = sanitizeText(body.description, 3000);
      if (body.course_id !== undefined) updates.course_id = body.course_id ? Number(body.course_id) : null;
      if (body.level != null && LEVELS.has(body.level)) updates.level = body.level;
      if (body.duration_minutes != null) updates.duration_minutes = Number(body.duration_minutes) || 20;
      if (body.is_published != null) updates.is_published = asBool(body.is_published, true);

      let data;
      if (Object.keys(updates).length) {
        const result = await supabase.from('quizzes').update(updates).eq('id', id).select().single();
        if (result.error) throw result.error;
        data = result.data;
      } else {
        const result = await supabase.from('quizzes').select('*').eq('id', id).single();
        if (result.error) throw result.error;
        data = result.data;
      }

      if (body.image_url !== undefined) {
        const image_url = sanitizeUrl(body.image_url) || sanitizeText(body.image_url, 1000);
        await setQuizImage(id, image_url || '');
      }

      let grade_level = '';
      if (body.grade_level !== undefined) {
        grade_level = sanitizeGradeLevel(body.grade_level);
        if (body.grade_level && !grade_level) {
          return res.status(400).json({ error: 'الصف الدراسي غير صالح' });
        }
        await setQuizGrade(id, grade_level);
      } else {
        const map = await getQuizGradeMap([id]);
        grade_level = map[Number(id)] || '';
      }

      let settings = { max_attempts: 1, pass_percentage: 50 };
      if (body.max_attempts !== undefined || body.pass_percentage !== undefined) {
        const currentMap = await getQuizSettingsMap([Number(id)]);
        const current = currentMap[Number(id)] || settings;
        settings = await setQuizSettings(id, {
          max_attempts: body.max_attempts !== undefined ? body.max_attempts : current.max_attempts,
          pass_percentage: body.pass_percentage !== undefined ? body.pass_percentage : current.pass_percentage,
        });
      } else {
        const mapSettings = await getQuizSettingsMap([Number(id)]);
        settings = mapSettings[Number(id)] || settings;
      }

      const map = await getQuizImageMap([Number(id)]);
      return res.status(200).json({
        ...data,
        image_url: map[Number(id)] || '',
        grade_level,
        ...settings,
      });
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      await supabase.from('questions').delete().eq('quiz_id', id);
      await supabase.from('quiz_results').delete().eq('quiz_id', id);
      await supabase.from('quiz_images').delete().eq('quiz_id', id);
      try {
        await supabase.from('quiz_grades').delete().eq('quiz_id', id);
      } catch {}
      try {
        await supabase.from('quiz_settings').delete().eq('quiz_id', id);
      } catch {}
      const { error } = await supabase.from('quizzes').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'quizzes');
  }
}
