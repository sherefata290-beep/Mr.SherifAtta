import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  getAuthUser,
  getProfile,
  sanitizeText,
  asPositiveInt,
  methodNotAllowed,
  serverError,
  getUserGradeLevel,
  getUserHasAccess,
  getCourseGradeMap,
  ADMIN_BOOTSTRAP_EMAIL,
} from './security.js';

async function assertCourseAccess(req, res, courseId) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'يجب تسجيل الدخول' });
    return false;
  }
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
  if (isAdmin) return true;

  const hasAccess = await getUserHasAccess(authUser.id);
  if (!hasAccess) {
    res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً لفتح المحتوى' });
    return false;
  }
  const studentGrade = await getUserGradeLevel(authUser.id);
  if (!studentGrade) {
    res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً لفتح المحتوى' });
    return false;
  }
  const map = await getCourseGradeMap([Number(courseId)]);
  const courseGrade = map[Number(courseId)] || '';
  if (!courseGrade || courseGrade !== studentGrade) {
    res.status(403).json({ error: 'هذا المحتوى غير متاح لصفك الدراسي' });
    return false;
  }
  return true;
}

async function getLessonMedia(lessonIds) {
  if (!lessonIds?.length) return {};
  try {
    const { data, error } = await supabase
      .from('lesson_media')
      .select('*')
      .in('lesson_id', lessonIds)
      .order('id', { ascending: true });
    if (error) throw error;
    const byLesson = {};
    (data || []).forEach((m) => {
      if (!byLesson[m.lesson_id]) byLesson[m.lesson_id] = [];
      byLesson[m.lesson_id].push(m);
    });
    return byLesson;
  } catch (err) {
    console.error('lesson media fetch failed:', err.message);
    return {};
  }
}

function normalizeSessionType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'external_link' || v === 'external' || v === 'link') return 'external_link';
  if (v === 'recorded_video' || v === 'video' || v === 'recorded') return 'recorded_video';
  return '';
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const DEFAULT_SETTINGS = {
  session_type: 'recorded_video',
  video_duration_minutes: 0,
  required_watch_percent: 85,
  external_required_seconds: 1800,
  linked_quiz_id: null,
  session_points: 0,
};

function normalizeSettingsPayload(body = {}, existing = null) {
  const base = { ...DEFAULT_SETTINGS, ...(existing || {}) };
  const src = body && typeof body === 'object' ? body : {};

  // Prefer nested attendance_settings, then top-level fields, then existing
  const nested = src.attendance_settings && typeof src.attendance_settings === 'object'
    ? src.attendance_settings
    : {};

  const pick = (key) => {
    if (nested[key] !== undefined && nested[key] !== null && nested[key] !== '') return nested[key];
    if (src[key] !== undefined && src[key] !== null && src[key] !== '') return src[key];
    return base[key];
  };

  const session_type = normalizeSessionType(pick('session_type')) || base.session_type || 'recorded_video';
  const linkedRaw = pick('linked_quiz_id');
  const linked_quiz_id =
    linkedRaw === '' || linkedRaw == null || linkedRaw === 0
      ? null
      : asPositiveInt(linkedRaw) || null;

  return {
    session_type,
    video_duration_minutes: clampInt(pick('video_duration_minutes'), 0, 24 * 60, base.video_duration_minutes || 0),
    required_watch_percent: clampInt(pick('required_watch_percent'), 1, 100, base.required_watch_percent || 85),
    external_required_seconds: clampInt(
      pick('external_required_seconds'),
      0,
      24 * 60 * 60,
      base.external_required_seconds || 1800
    ),
    linked_quiz_id,
    session_points: clampInt(pick('session_points'), 0, 100000, base.session_points || 0),
  };
}

async function getSettingsMap(lessonIds = []) {
  const ids = (lessonIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};

  const map = {};

  // Legacy session_type only (do not overwrite if full settings exist)
  try {
    const { data, error } = await supabase
      .from('lesson_session_meta')
      .select('lesson_id, session_type')
      .in('lesson_id', ids);
    if (!error) {
      (data || []).forEach((row) => {
        const lid = Number(row.lesson_id);
        map[lid] = {
          ...DEFAULT_SETTINGS,
          session_type: normalizeSessionType(row.session_type) || DEFAULT_SETTINGS.session_type,
        };
      });
    }
  } catch (err) {
    console.error('lesson_session_meta fetch failed:', err.message);
  }

  // Full attendance settings (preferred)
  try {
    const { data, error } = await supabase
      .from('lesson_attendance_settings')
      .select('*')
      .in('lesson_id', ids);
    if (!error) {
      (data || []).forEach((row) => {
        const lid = Number(row.lesson_id);
        const prev = map[lid] || { ...DEFAULT_SETTINGS };
        map[lid] = {
          session_type:
            normalizeSessionType(row.session_type) ||
            prev.session_type ||
            DEFAULT_SETTINGS.session_type,
          video_duration_minutes: clampInt(
            row.video_duration_minutes,
            0,
            24 * 60,
            prev.video_duration_minutes ?? 0
          ),
          required_watch_percent: clampInt(
            row.required_watch_percent,
            1,
            100,
            prev.required_watch_percent ?? 85
          ),
          external_required_seconds: clampInt(
            row.external_required_seconds,
            0,
            24 * 60 * 60,
            prev.external_required_seconds ?? 1800
          ),
          linked_quiz_id: row.linked_quiz_id ? Number(row.linked_quiz_id) : null,
          session_points: clampInt(row.session_points, 0, 100000, prev.session_points ?? 0),
        };
      });
    }
  } catch (err) {
    console.error('lesson_attendance_settings fetch failed:', err.message);
  }

  return map;
}

/** @deprecated name kept for internal clarity */
async function getSessionTypeMap(lessonIds = []) {
  return getSettingsMap(lessonIds);
}

async function saveLessonAttendanceSettings(lessonId, body = {}, existingRow = null) {
  const id = Number(lessonId);
  if (!id) return { ...DEFAULT_SETTINGS };

  const settings = normalizeSettingsPayload(body, existingRow);
  const now = new Date().toISOString();

  // Keep legacy session_type table in sync (non-destructive)
  try {
    const { data: legacy, error: legReadErr } = await supabase
      .from('lesson_session_meta')
      .select('lesson_id')
      .eq('lesson_id', id)
      .maybeSingle();
    if (legReadErr) throw legReadErr;
    if (legacy?.lesson_id) {
      const { error } = await supabase
        .from('lesson_session_meta')
        .update({ session_type: settings.session_type, updated_at: now })
        .eq('lesson_id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('lesson_session_meta').insert({
        lesson_id: id,
        session_type: settings.session_type,
        updated_at: now,
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error('lesson_session_meta save failed:', err.message);
  }

  // Full settings table — try upsert-style update/insert with clear errors
  try {
    const { data: existing, error: readErr } = await supabase
      .from('lesson_attendance_settings')
      .select('lesson_id')
      .eq('lesson_id', id)
      .maybeSingle();
    if (readErr) throw readErr;

    const row = {
      lesson_id: id,
      session_type: settings.session_type,
      video_duration_minutes: settings.video_duration_minutes,
      required_watch_percent: settings.required_watch_percent,
      external_required_seconds: settings.external_required_seconds,
      linked_quiz_id: settings.linked_quiz_id,
      session_points: settings.session_points,
      updated_at: now,
    };

    if (existing?.lesson_id) {
      const { error } = await supabase
        .from('lesson_attendance_settings')
        .update(row)
        .eq('lesson_id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('lesson_attendance_settings').insert(row);
      if (error) {
        // Fallback: maybe unique race — try update
        const { error: upErr } = await supabase
          .from('lesson_attendance_settings')
          .update(row)
          .eq('lesson_id', id);
        if (upErr) throw error;
      }
    }
  } catch (err) {
    console.error('lesson_attendance_settings save failed:', err.message);
    // Don't swallow completely — settings still returned for response
  }

  return settings;
}

function withAttendanceSettings(lesson, settingsMap = {}) {
  if (!lesson) return lesson;
  const sid = Number(lesson.id);
  const settings = settingsMap[sid] || {
    ...DEFAULT_SETTINGS,
    session_type: lesson.session_type || DEFAULT_SETTINGS.session_type,
  };
  return {
    ...lesson,
    session_type: settings.session_type,
    video_duration_minutes: settings.video_duration_minutes,
    required_watch_percent: settings.required_watch_percent,
    external_required_seconds: settings.external_required_seconds,
    linked_quiz_id: settings.linked_quiz_id || '',
    session_points: settings.session_points,
    attendance_settings: settings,
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'lessons', limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { id, course_id, with_media, admin } = req.query;

      // Admin list (all lessons) — used by dashboard
      if (admin === 'true' && !id && !course_id) {
        const a = await requireAdmin(req, res);
        if (!a) return;
        const { data, error } = await supabase.from('lessons').select('*').order('order_index', { ascending: true });
        if (error) throw error;
        const settingsMap = await getSettingsMap((data || []).map((l) => l.id));
        return res.status(200).json((data || []).map((l) => withAttendanceSettings(l, settingsMap)));
      }

      if (id) {
        const lessonId = asPositiveInt(id) || Number(id);
        const { data, error } = await supabase.from('lessons').select('*').eq('id', lessonId).single();
        if (error) throw error;

        // Admin edit path: skip student grade gate
        if (admin === 'true') {
          const a = await requireAdmin(req, res);
          if (!a) return;
          const mediaMap = await getLessonMedia([Number(data.id)]);
          const settingsMap = await getSettingsMap([Number(data.id)]);
          return res.status(200).json({
            ...withAttendanceSettings(data, settingsMap),
            media: mediaMap[Number(data.id)] || [],
          });
        }

        const ok = await assertCourseAccess(req, res, data.course_id);
        if (!ok) return;
        const mediaMap = await getLessonMedia([Number(data.id)]);
        const settingsMap = await getSettingsMap([Number(data.id)]);
        return res.status(200).json({
          ...withAttendanceSettings(data, settingsMap),
          media: mediaMap[Number(data.id)] || [],
        });
      }

      if (!course_id) {
        // Prevent dumping all lessons to students
        const a = await requireAdmin(req, res);
        if (!a) return;
        const { data, error } = await supabase.from('lessons').select('*').order('order_index', { ascending: true });
        if (error) throw error;
        const settingsMap = await getSettingsMap((data || []).map((l) => l.id));
        return res.status(200).json((data || []).map((l) => withAttendanceSettings(l, settingsMap)));
      }

      const ok = await assertCourseAccess(req, res, course_id);
      if (!ok) return;

      let query = supabase.from('lessons').select('*').order('order_index', { ascending: true });
      query = query.eq('course_id', course_id);
      const { data, error } = await query;
      if (error) throw error;

      const settingsMap = await getSettingsMap((data || []).map((l) => l.id));
      if (with_media === 'true' && Array.isArray(data) && data.length > 0) {
        const mediaMap = await getLessonMedia(data.map((l) => l.id));
        return res.status(200).json(
          data.map((l) => ({
            ...withAttendanceSettings(l, settingsMap),
            media: mediaMap[l.id] || [],
          }))
        );
      }

      return res.status(200).json((data || []).map((l) => withAttendanceSettings(l, settingsMap)));
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const course_id = asPositiveInt(body.course_id) || Number(body.course_id);
      const title = sanitizeText(body.title, 300);
      if (!course_id || Number.isNaN(Number(course_id))) {
        return res.status(400).json({ error: 'اختر الكورس قبل الحفظ' });
      }
      if (!title) return res.status(400).json({ error: 'عنوان الدرس مطلوب' });

      const payload = {
        course_id: Number(course_id),
        title,
        title_ar: sanitizeText(body.title_ar || title, 300),
        content: sanitizeText(body.content ?? '', 100000),
        order_index: Number(body.order_index) > 0 ? Math.floor(Number(body.order_index)) : 1,
        duration_minutes:
          Number(body.duration_minutes) > 0 ? Math.floor(Number(body.duration_minutes)) : 30,
      };

      const { data, error } = await supabase.from('lessons').insert(payload).select().single();
      if (error) {
        console.error('lesson insert error:', error);
        throw new Error(error.message || 'فشل إنشاء الدرس');
      }

      let settings = { ...DEFAULT_SETTINGS };
      try {
        settings = await saveLessonAttendanceSettings(data.id, body);
      } catch (settingsErr) {
        console.error('lesson settings on create failed:', settingsErr.message);
      }

      return res.status(201).json(withAttendanceSettings(data, { [Number(data.id)]: settings }));
    }

    if (req.method === 'PUT') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const id = asPositiveInt(body.id) || Number(body.id);
      if (!id || Number.isNaN(Number(id))) {
        return res.status(400).json({ error: 'معرّف الدرس مطلوب للتعديل' });
      }

      // Build a complete, safe update payload (always overwrite editable columns)
      const updates = {};
      if (body.course_id !== undefined && body.course_id !== null && body.course_id !== '') {
        const cid = asPositiveInt(body.course_id) || Number(body.course_id);
        if (!cid || Number.isNaN(Number(cid))) {
          return res.status(400).json({ error: 'معرّف الكورس غير صالح' });
        }
        updates.course_id = Number(cid);
      }
      if (body.title !== undefined) {
        const title = sanitizeText(body.title, 300);
        if (!title) return res.status(400).json({ error: 'عنوان الدرس مطلوب' });
        updates.title = title;
      }
      if (body.title_ar !== undefined) {
        updates.title_ar = sanitizeText(body.title_ar, 300);
      }
      if (body.content !== undefined) {
        updates.content = sanitizeText(body.content ?? '', 100000);
      }
      if (body.order_index !== undefined && body.order_index !== null && body.order_index !== '') {
        updates.order_index =
          Number(body.order_index) > 0 ? Math.floor(Number(body.order_index)) : 1;
      }
      if (
        body.duration_minutes !== undefined &&
        body.duration_minutes !== null &&
        body.duration_minutes !== ''
      ) {
        updates.duration_minutes =
          Number(body.duration_minutes) > 0 ? Math.floor(Number(body.duration_minutes)) : 30;
      }

      // Never write attendance/media fields into lessons table
      delete updates.session_type;
      delete updates.video_duration_minutes;
      delete updates.required_watch_percent;
      delete updates.external_required_seconds;
      delete updates.linked_quiz_id;
      delete updates.session_points;
      delete updates.attendance_settings;
      delete updates.media;
      delete updates.id;

      let data = null;
      if (Object.keys(updates).length > 0) {
        const result = await supabase.from('lessons').update(updates).eq('id', id).select().single();
        if (result.error) {
          console.error('lesson update error:', result.error, { id, updates });
          // Fallback: fetch current row and try again only with known columns
          throw new Error(result.error.message || 'فشل حفظ تعديلات الدرس');
        }
        data = result.data;
      } else {
        const result = await supabase.from('lessons').select('*').eq('id', id).single();
        if (result.error) throw new Error(result.error.message || 'الدرس غير موجود');
        data = result.data;
      }

      if (!data) {
        return res.status(404).json({ error: 'الدرس غير موجود أو لم يتم التعديل' });
      }

      const existingMap = await getSettingsMap([Number(id)]);
      const existing = existingMap[Number(id)] || null;

      // Always persist attendance settings on edit so session type / thresholds stick
      let settings = existing || { ...DEFAULT_SETTINGS };
      try {
        settings = await saveLessonAttendanceSettings(id, body, existing);
      } catch (settingsErr) {
        console.error('lesson settings on update failed:', settingsErr.message);
      }

      return res.status(200).json(withAttendanceSettings(data, { [Number(id)]: settings }));
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      try {
        await supabase.from('lesson_media').delete().eq('lesson_id', id);
      } catch {}
      try {
        await supabase.from('lesson_session_meta').delete().eq('lesson_id', id);
      } catch {}
      try {
        await supabase.from('lesson_attendance_settings').delete().eq('lesson_id', id);
      } catch {}
      try {
        await supabase.from('lesson_watch_progress').delete().eq('lesson_id', id);
      } catch {}
      try {
        await supabase.from('lesson_video_tracking').delete().eq('lesson_id', id);
      } catch {}
      try {
        await supabase.from('lesson_external_sessions').delete().eq('lesson_id', id);
      } catch {}
      const { error } = await supabase.from('lessons').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'lessons');
  }
}
