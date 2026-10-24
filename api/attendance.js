import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAuth,
  requireAdmin,
  getAuthUser,
  getProfile,
  isStaffRole,
  sanitizeText,
  asPositiveInt,
  methodNotAllowed,
  serverError,
} from './security.js';

const STATUSES = new Set(['present', 'completed', 'absent', 'excused']);
const SESSION_TYPES = new Set(['recorded_video', 'external_link']);

function normalizeStatus(value, fallback = 'present') {
  const s = String(value || '').toLowerCase().trim();
  return STATUSES.has(s) ? s : fallback;
}

function normalizeSessionType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'external_link' || v === 'external' || v === 'link') return 'external_link';
  if (v === 'recorded_video' || v === 'video' || v === 'recorded') return 'recorded_video';
  return '';
}

async function isStaffUser(authUser) {
  if (!authUser) return false;
  const profile = await getProfile(authUser.id);
  return isStaffRole(profile?.role);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function getAttendanceSettingsMap(lessonIds = []) {
  const ids = (lessonIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};
  const map = {};

  try {
    const { data } = await supabase
      .from('lesson_session_meta')
      .select('lesson_id, session_type')
      .in('lesson_id', ids);
    (data || []).forEach((row) => {
      map[Number(row.lesson_id)] = {
        session_type: normalizeSessionType(row.session_type) || 'recorded_video',
        video_duration_minutes: 0,
        required_watch_percent: 85,
        external_required_seconds: 1800,
        linked_quiz_id: null,
        session_points: 0,
      };
    });
  } catch {
    /* ignore */
  }

  try {
    const { data } = await supabase
      .from('lesson_attendance_settings')
      .select('*')
      .in('lesson_id', ids);
    (data || []).forEach((row) => {
      const lid = Number(row.lesson_id);
      const prev = map[lid] || {
        session_type: 'recorded_video',
        video_duration_minutes: 0,
        required_watch_percent: 85,
        external_required_seconds: 1800,
        linked_quiz_id: null,
        session_points: 0,
      };
      map[lid] = {
        session_type:
          normalizeSessionType(row.session_type) || prev.session_type || 'recorded_video',
        video_duration_minutes: clampInt(row.video_duration_minutes, 0, 24 * 60, prev.video_duration_minutes || 0),
        required_watch_percent: clampInt(row.required_watch_percent, 1, 100, prev.required_watch_percent || 85),
        external_required_seconds: clampInt(
          row.external_required_seconds,
          0,
          24 * 60 * 60,
          prev.external_required_seconds || 1800
        ),
        linked_quiz_id: row.linked_quiz_id ? Number(row.linked_quiz_id) : null,
        session_points: clampInt(row.session_points, 0, 100000, prev.session_points || 0),
      };
    });
  } catch {
    /* ignore */
  }

  return map;
}

async function getSessionTypeMap(lessonIds = []) {
  const map = await getAttendanceSettingsMap(lessonIds);
  const out = {};
  Object.entries(map).forEach(([k, v]) => {
    out[Number(k)] = v.session_type || 'recorded_video';
  });
  return out;
}

async function awardSessionPointsOnce({ userId, lessonId, points, alreadyCompleted }) {
  const pts = clampInt(points, 0, 100000, 0);
  if (!pts || alreadyCompleted || !userId || !lessonId) return { awarded: 0 };

  try {
    // Idempotent ledger: never award twice for same user+lesson
    const { data: existingAward } = await supabase
      .from('lesson_session_points')
      .select('id, points')
      .eq('user_id', userId)
      .eq('lesson_id', Number(lessonId))
      .maybeSingle();
    if (existingAward?.id) {
      return { awarded: 0, already: true, total_awarded: Number(existingAward.points || 0) };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, total_points')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.id) return { awarded: 0 };

    const { error: insErr } = await supabase.from('lesson_session_points').insert({
      user_id: userId,
      lesson_id: Number(lessonId),
      points: pts,
      created_at: new Date().toISOString(),
    });
    if (insErr) {
      // Unique race or missing table — do not double-credit profile
      console.error('lesson_session_points insert failed:', insErr.message);
      // If duplicate, treat as already awarded
      if (String(insErr.message || '').toLowerCase().includes('duplicate')) {
        return { awarded: 0, already: true };
      }
      // Fallback: still try profile credit only if ledger unavailable
    }

    const next = Number(profile.total_points || 0) + pts;
    await supabase.from('profiles').update({ total_points: next }).eq('id', userId);
    return { awarded: pts, total_points: next };
  } catch (err) {
    console.error('award session points failed:', err.message);
    return { awarded: 0 };
  }
}

function normalizeWatchedRanges(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((r) => ({
      start: Number(r?.start),
      end: Number(r?.end),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .slice(0, 500);
}

function resolveSessionStatus({ progressPercent, requiredPercent, completed }) {
  if (completed) return 'completed';
  if (progressPercent >= requiredPercent) return 'eligible';
  if (progressPercent > 0) return 'in_progress';
  return 'not_started';
}

async function upsertWatchProgress({
  userId,
  lessonId,
  courseId,
  sessionType,
  progressPercent,
  lastPosition,
  maxPosition,
  duration,
  openedExternal,
  completed,
  requiredWatchPercent = 85,
}) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('lesson_watch_progress')
    .select('id, progress_percent, max_position, completed, opened_external')
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  const prevPct = Number(existing?.progress_percent || 0);
  const nextPct = Math.max(prevPct, Math.min(100, Number(progressPercent) || 0));
  const prevMax = Number(existing?.max_position || 0);
  const nextMax = Math.max(prevMax, Number(maxPosition || lastPosition || 0) || 0);
  const eligible = nextPct >= (requiredWatchPercent || 85);
  // completed only when explicitly requested (student pressed complete) or already completed
  const isCompleted = Boolean(completed || existing?.completed);
  const opened = Boolean(openedExternal || existing?.opened_external);

  const payload = {
    user_id: userId,
    lesson_id: lessonId,
    course_id: courseId || null,
    session_type: sessionType || null,
    progress_percent: Math.round(nextPct * 10) / 10,
    last_position: Number(lastPosition || 0) || 0,
    max_position: nextMax,
    duration: Number(duration || 0) || 0,
    opened_external: opened,
    completed: isCompleted,
    updated_at: now,
  };

  let row;
  if (existing?.id) {
    const { data, error } = await supabase
      .from('lesson_watch_progress')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    row = data;
  } else {
    const { data, error } = await supabase
      .from('lesson_watch_progress')
      .insert({ ...payload, created_at: now })
      .select()
      .single();
    if (error) throw error;
    row = data;
  }

  return { ...row, eligible, session_status: resolveSessionStatus({
    progressPercent: nextPct,
    requiredPercent: requiredWatchPercent || 85,
    completed: isCompleted,
  }) };
}

/** External follow-up session (presence-based — NOT YouTube/Drive watch %) */
async function upsertExternalSession({
  userId,
  lessonId,
  courseId,
  externalUrl,
  startedAt,
  lastActivityAt,
  endedAt,
  activeSeconds,
  eligibleSeconds,
  requiredSeconds,
  isActive,
  isIdle,
  completed,
  note,
  sessionId,
}) {
  const now = new Date().toISOString();
  const required = clampInt(requiredSeconds, 0, 24 * 60 * 60, 1800);
  const active = clampInt(activeSeconds, 0, 24 * 60 * 60, 0);
  const eligible = clampInt(
    eligibleSeconds != null ? eligibleSeconds : Math.min(active, required),
    0,
    24 * 60 * 60,
    0
  );
  // External session becomes "eligible" by duration, but completed only on explicit complete
  const isCompleted = Boolean(completed);
  const isEligible = !isCompleted && required > 0 && active >= required;
  const status = isCompleted
    ? 'completed'
    : isEligible
      ? 'eligible'
      : isActive
        ? isIdle
          ? 'idle'
          : 'in_progress'
        : active > 0
          ? 'paused'
          : 'not_started';

  const payload = {
    user_id: userId,
    lesson_id: lessonId,
    course_id: courseId || null,
    external_url: externalUrl ? String(externalUrl).slice(0, 2000) : '',
    started_at: startedAt || now,
    last_activity_at: lastActivityAt || now,
    ended_at: endedAt || null,
    active_seconds: active,
    eligible_seconds: eligible,
    required_seconds: required,
    is_active: Boolean(isActive) && !isCompleted,
    is_idle: Boolean(isIdle),
    completed: isCompleted,
    session_status: status,
    note: sanitizeText(note || '', 500),
    updated_at: now,
  };

  // Prefer updating a specific open session, else latest open session for user+lesson
  let existing = null;
  if (sessionId) {
    const { data } = await supabase
      .from('lesson_external_sessions')
      .select('*')
      .eq('id', Number(sessionId))
      .eq('user_id', userId)
      .maybeSingle();
    existing = data;
  }
  if (!existing) {
    const { data } = await supabase
      .from('lesson_external_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('lesson_id', lessonId)
      .eq('completed', false)
      .order('started_at', { ascending: false })
      .limit(1);
    existing = Array.isArray(data) ? data[0] : data;
  }

  if (existing?.id) {
    // Never decrease active/eligible seconds
    payload.active_seconds = Math.max(Number(existing.active_seconds || 0), payload.active_seconds);
    payload.eligible_seconds = Math.max(Number(existing.eligible_seconds || 0), payload.eligible_seconds);
    payload.completed = Boolean(existing.completed || payload.completed);
    if (payload.completed) {
      payload.is_active = false;
      payload.session_status = 'completed';
      payload.ended_at = payload.ended_at || now;
    }
    if (!existing.started_at) payload.started_at = payload.started_at;
    else payload.started_at = existing.started_at;

    const { data, error } = await supabase
      .from('lesson_external_sessions')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('lesson_external_sessions')
    .insert({ ...payload, created_at: now })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Detailed anti-seek video tracking (ranges + honest watched seconds) */
async function upsertVideoTracking({
  userId,
  lessonId,
  courseId,
  progressPercent,
  watchedSeconds,
  lastPosition,
  maxPosition,
  duration,
  watchedRanges,
  requiredWatchPercent,
  completed,
}) {
  const now = new Date().toISOString();
  const pct = Math.max(0, Math.min(100, Number(progressPercent) || 0));
  const required = clampInt(requiredWatchPercent, 1, 100, 85);
  const eligible = pct >= required;
  // completed only when student confirms; eligible is separate
  const isCompleted = Boolean(completed);
  const status = isCompleted
    ? 'completed'
    : eligible
      ? 'eligible'
      : resolveSessionStatus({
          progressPercent: pct,
          requiredPercent: required,
          completed: false,
        });

  const { data: existing } = await supabase
    .from('lesson_video_tracking')
    .select('id, progress_percent, watched_seconds, completed, watched_ranges')
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  const prevPct = Number(existing?.progress_percent || 0);
  const prevWatched = Number(existing?.watched_seconds || 0);
  const nextPct = Math.max(prevPct, pct);
  const nextWatched = Math.max(prevWatched, Number(watchedSeconds) || 0);

  // Prefer incoming ranges if they cover more watched time; else keep existing
  let ranges = normalizeWatchedRanges(watchedRanges);
  if (existing?.watched_ranges) {
    const prevRanges = normalizeWatchedRanges(existing.watched_ranges);
    const prevLen = prevRanges.reduce((s, r) => s + (r.end - r.start), 0);
    const nextLen = ranges.reduce((s, r) => s + (r.end - r.start), 0);
    if (nextLen + 0.25 < prevLen) ranges = prevRanges;
    else {
      // merge both
      ranges = normalizeWatchedRanges([...prevRanges, ...ranges]);
    }
  }

  const payload = {
    user_id: userId,
    lesson_id: lessonId,
    course_id: courseId || null,
    progress_percent: Math.round(nextPct * 10) / 10,
    watched_seconds: Math.round(nextWatched * 10) / 10,
    last_position: Number(lastPosition || 0) || 0,
    max_position: Number(maxPosition || 0) || 0,
    duration: Number(duration || 0) || 0,
    watched_ranges: ranges,
    session_status: status,
    eligible: eligible || nextPct >= required,
    completed: isCompleted || Boolean(existing?.completed),
    required_watch_percent: required,
    updated_at: now,
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('lesson_video_tracking')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('lesson_video_tracking')
    .insert({ ...payload, created_at: now })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function safeSelect(promise, label = 'query') {
  try {
    const res = await promise;
    if (res?.error) {
      console.error(`[attendance] ${label}:`, res.error.message || res.error);
      return [];
    }
    if (Array.isArray(res?.data)) return res.data;
    // maybeSingle / single → wrap object
    if (res?.data && typeof res.data === 'object') return [res.data];
    return [];
  } catch (err) {
    console.error(`[attendance] ${label} threw:`, err?.message || err);
    return [];
  }
}

function dayKey(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function computeAttendanceStreak(completedDates = []) {
  const days = [
    ...new Set(
      (completedDates || [])
        .map((v) => dayKey(v))
        .filter(Boolean)
    ),
  ].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first

  if (!days.length) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const newest = new Date(`${days[0]}T00:00:00.000Z`);
  // Allow streak if last completion was today or yesterday
  const newestLocal = new Date(days[0] + 'T12:00:00');
  const newestTime = newestLocal.getTime();
  if (newestTime < yesterday.getTime()) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i += 1) {
    const prev = new Date(days[i - 1] + 'T12:00:00');
    const cur = new Date(days[i] + 'T12:00:00');
    const diffDays = Math.round((prev.getTime() - cur.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) streak += 1;
    else if (diffDays === 0) continue;
    else break;
  }
  return streak;
}

async function loadStudentBundle(userId) {
  const [
    attendance,
    results,
    lessons,
    courses,
    quizzes,
    progressRows,
    videoTracks,
    externalSessions,
    settingsRows,
    profileRow,
    gradeRow,
    pointsRows,
    lessonQuizRows,
  ] = await Promise.all([
    safeSelect(
      supabase
        .from('lesson_attendance')
        .select('*')
        .eq('user_id', userId)
        .order('attended_at', { ascending: false }),
      'lesson_attendance'
    ),
    safeSelect(
      supabase
        .from('quiz_results')
        .select('id, quiz_id, user_name, score, total_questions, percentage, completed_at')
        .eq('user_id', userId)
        .order('completed_at', { ascending: false })
        .limit(100),
      'quiz_results'
    ),
    safeSelect(
      supabase.from('lessons').select('id, course_id, title, title_ar, order_index, duration_minutes'),
      'lessons'
    ),
    safeSelect(supabase.from('courses').select('id, title, title_ar, is_published'), 'courses'),
    safeSelect(supabase.from('quizzes').select('id, title, title_ar, is_published'), 'quizzes'),
    safeSelect(
      supabase
        .from('lesson_watch_progress')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      'lesson_watch_progress'
    ),
    safeSelect(
      supabase
        .from('lesson_video_tracking')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      'lesson_video_tracking'
    ),
    safeSelect(
      supabase
        .from('lesson_external_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false }),
      'lesson_external_sessions'
    ),
    safeSelect(
      supabase.from('lesson_attendance_settings').select('*').limit(3000),
      'lesson_attendance_settings'
    ),
    safeSelect(
      supabase.from('profiles').select('id, full_name, email, total_points').eq('id', userId).maybeSingle(),
      'profiles'
    ),
    safeSelect(
      supabase.from('student_grades').select('grade_level').eq('user_id', userId).maybeSingle(),
      'student_grades'
    ),
    safeSelect(
      supabase
        .from('lesson_session_points')
        .select('*')
        .eq('user_id', userId)
        .limit(2000),
      'lesson_session_points'
    ),
    safeSelect(
      supabase
        .from('lesson_quiz_records')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(2000),
      'lesson_quiz_records'
    ),
  ]);

  // profile/grade may come as object from maybeSingle via safeSelect
  const profile = Array.isArray(profileRow) ? profileRow[0] : profileRow;
  const gradeInfo = Array.isArray(gradeRow) ? gradeRow[0] : gradeRow;
  const studentGrade = gradeInfo?.grade_level || '';

  // Optional: filter courses by student grade when available
  let allowedCourseIds = null;
  if (studentGrade) {
    const gradeLinks = await safeSelect(
      supabase.from('course_grades').select('course_id, grade_level').eq('grade_level', studentGrade),
      'course_grades'
    );
    if (Array.isArray(gradeLinks) && gradeLinks.length) {
      allowedCourseIds = new Set(gradeLinks.map((g) => Number(g.course_id)));
    }
  }

  const publishedCourseIds = new Set(
    (courses || [])
      .filter((c) => c.is_published !== false)
      .filter((c) => (allowedCourseIds ? allowedCourseIds.has(Number(c.id)) : true))
      .map((c) => Number(c.id))
  );

  const lessonMap = Object.fromEntries((lessons || []).map((l) => [Number(l.id), l]));
  const courseMap = Object.fromEntries((courses || []).map((c) => [Number(c.id), c]));
  const quizMap = Object.fromEntries((quizzes || []).map((q) => [Number(q.id), q]));
  const settingsMap = Object.fromEntries(
    (settingsRows || []).map((s) => [Number(s.lesson_id), s])
  );
  const typeMap = await getSessionTypeMap((lessons || []).map((l) => l.id));
  const progressMap = Object.fromEntries(
    (progressRows || []).map((p) => [Number(p.lesson_id), p])
  );
  const videoMap = Object.fromEntries(
    (videoTracks || []).map((v) => [Number(v.lesson_id), v])
  );
  // latest external session per lesson
  const externalMap = {};
  (externalSessions || []).forEach((s) => {
    const lid = Number(s.lesson_id);
    if (!externalMap[lid]) externalMap[lid] = s;
  });

  // Best lesson quiz record per lesson (prefer completed)
  const lessonQuizMap = {};
  (lessonQuizRows || []).forEach((r) => {
    const lid = Number(r.lesson_id);
    const prev = lessonQuizMap[lid];
    if (!prev) {
      lessonQuizMap[lid] = r;
      return;
    }
    if (prev.status !== 'completed' && r.status === 'completed') {
      lessonQuizMap[lid] = r;
      return;
    }
    if (
      prev.status === r.status &&
      new Date(r.updated_at || r.completed_at || 0) > new Date(prev.updated_at || prev.completed_at || 0)
    ) {
      lessonQuizMap[lid] = r;
    }
  });

  const attendanceByLesson = {};
  (attendance || []).forEach((row) => {
    const lid = Number(row.lesson_id);
    if (!attendanceByLesson[lid]) attendanceByLesson[lid] = row;
  });

  const pointsByLesson = {};
  let attendancePoints = 0;
  (pointsRows || []).forEach((p) => {
    const lid = Number(p.lesson_id);
    const pts = Number(p.points || p.session_points || p.awarded || 0) || 0;
    pointsByLesson[lid] = (pointsByLesson[lid] || 0) + pts;
    attendancePoints += pts;
  });
  // Fallback: sum session_points from settings for completed lessons if no points table rows
  if (!attendancePoints) {
    Object.values(attendanceByLesson).forEach((row) => {
      if (row.status === 'completed' || row.status === 'present') {
        const s = settingsMap[Number(row.lesson_id)];
        attendancePoints += Number(s?.session_points || 0) || 0;
      }
    });
  }

  function resolveLessonStatus(lessonId) {
    const lid = Number(lessonId);
    const att = attendanceByLesson[lid] || null;
    const progress = progressMap[lid] || null;
    const video = videoMap[lid] || null;
    const ext = externalMap[lid] || null;
    const settings = settingsMap[lid] || null;
    const quizRec = lessonQuizMap[lid] || null;
    const sessionType =
      normalizeSessionType(settings?.session_type) ||
      normalizeSessionType(progress?.session_type) ||
      normalizeSessionType(typeMap[lid]) ||
      'recorded_video';

    const extRequired = Number(ext?.required_seconds || settings?.external_required_seconds || 0);
    const extActive = Number(ext?.active_seconds || 0);
    const extPct =
      extRequired > 0 ? Math.min(100, Math.round((extActive / extRequired) * 1000) / 10) : Number(ext?.progress_percent || 0) || 0;

    const progressPercent = Number(
      video?.progress_percent ??
        (sessionType === 'external_link' ? extPct : null) ??
        progress?.progress_percent ??
        (att?.status === 'completed' ? 100 : att?.status === 'present' ? 40 : 0)
    ) || 0;

    const trackingCompleted = Boolean(
      video?.completed ||
        video?.session_status === 'completed' ||
        ext?.completed ||
        ext?.session_status === 'completed' ||
        progress?.completed ||
        att?.status === 'completed'
    );

    let session_status = 'not_started';
    if (trackingCompleted || att?.status === 'completed') {
      session_status = 'completed';
    } else if (
      att?.status === 'present' ||
      progressPercent > 0 ||
      Number(video?.watched_seconds || 0) > 0 ||
      Number(ext?.active_seconds || 0) > 0 ||
      video?.session_status === 'in_progress' ||
      ext?.session_status === 'in_progress' ||
      progress?.session_status === 'in_progress' ||
      quizRec?.status === 'started'
    ) {
      session_status = 'in_progress';
    } else {
      session_status = 'not_started';
    }

    const quiz_status =
      quizRec?.status === 'completed'
        ? 'completed'
        : quizRec?.status === 'started'
          ? 'started'
          : settings?.linked_quiz_id
            ? 'none'
            : 'none';

    // Prefer explicit earned points; else session points when completed
    let points_earned = Number(pointsByLesson[lid] || 0) || 0;
    if (!points_earned && session_status === 'completed') {
      points_earned = Number(settings?.session_points || 0) || 0;
    }

    return {
      session_type: sessionType,
      session_status,
      progress_percent: Math.round(progressPercent * 10) / 10,
      watched_seconds: Number(video?.watched_seconds ?? extActive ?? 0) || 0,
      active_seconds: Number(ext?.active_seconds ?? 0) || 0,
      required_seconds: Number(ext?.required_seconds ?? settings?.external_required_seconds ?? 0) || 0,
      required_watch_percent: Number(settings?.required_watch_percent || 85) || 85,
      session_points: Number(settings?.session_points || 0) || 0,
      points_earned,
      attendance_status: att?.status || null,
      attendance_id: att?.id || null,
      attended_at: att?.attended_at || null,
      note: att?.note || '',
      session_started_at: ext?.started_at || video?.created_at || video?.updated_at || progress?.updated_at || att?.attended_at || null,
      tracking_completed: trackingCompleted,
      linked_quiz_id: settings?.linked_quiz_id || quizRec?.quiz_id || null,
      quiz_status,
      quiz_score: quizRec?.score != null ? Number(quizRec.score) : null,
      quiz_total_questions: quizRec?.total_questions != null ? Number(quizRec.total_questions) : null,
      quiz_correct_answers: quizRec?.correct_answers != null ? Number(quizRec.correct_answers) : null,
      quiz_percentage: quizRec?.percentage != null ? Number(quizRec.percentage) : null,
      quiz_started_at: quizRec?.started_at || null,
      quiz_completed_at: quizRec?.completed_at || null,
    };
  }

  const attendanceRows = (attendance || []).map((row) => {
    const lesson = lessonMap[Number(row.lesson_id)] || null;
    const course = courseMap[Number(row.course_id || lesson?.course_id)] || null;
    const resolved = resolveLessonStatus(row.lesson_id);
    return {
      ...row,
      lesson_title: lesson?.title_ar || lesson?.title || `درس #${row.lesson_id}`,
      course_title: course?.title_ar || course?.title || `كورس #${row.course_id || lesson?.course_id || ''}`,
      ...resolved,
      // keep attendance status label separate but prefer resolved session_status
      session_status: resolved.session_status,
    };
  });

  const catalogLessons = (lessons || [])
    .filter((l) => publishedCourseIds.has(Number(l.course_id)))
    .map((l) => {
      const course = courseMap[Number(l.course_id)] || null;
      const resolved = resolveLessonStatus(l.id);
      return {
        id: l.id,
        lesson_id: l.id,
        course_id: l.course_id,
        order_index: l.order_index || 0,
        duration_minutes: l.duration_minutes || 30,
        lesson_title: l.title_ar || l.title || `درس #${l.id}`,
        course_title: course?.title_ar || course?.title || `كورس #${l.course_id}`,
        ...resolved,
      };
    })
    .sort((a, b) => {
      const ca = String(a.course_title || '');
      const cb = String(b.course_title || '');
      if (ca !== cb) return ca.localeCompare(cb, 'ar');
      return Number(a.order_index || 0) - Number(b.order_index || 0);
    });

  const quizRows = (results || []).map((r) => {
    const quiz = quizMap[Number(r.quiz_id)] || null;
    return {
      ...r,
      quiz_title: quiz?.title_ar || quiz?.title || `اختبار #${r.quiz_id}`,
      passed: Number(r.percentage || 0) >= 50,
    };
  });

  const lessonsByCourse = {};
  catalogLessons.forEach((l) => {
    const cid = Number(l.course_id);
    if (!lessonsByCourse[cid]) lessonsByCourse[cid] = [];
    lessonsByCourse[cid].push(l);
  });

  const courseProgress = Object.entries(lessonsByCourse)
    .map(([cid, list]) => {
      const course = courseMap[Number(cid)];
      const total = list.length;
      const done = list.filter((l) => l.session_status === 'completed').length;
      const inProg = list.filter((l) => l.session_status === 'in_progress').length;
      return {
        course_id: Number(cid),
        course_title: course?.title_ar || course?.title || `كورس #${cid}`,
        total_lessons: total,
        attended_lessons: done,
        in_progress_lessons: inProg,
        percent: total ? Math.round((done / total) * 100) : 0,
      };
    })
    .filter((c) => c.total_lessons > 0)
    .sort((a, b) => b.percent - a.percent);

  const completedLessons = catalogLessons.filter((l) => l.session_status === 'completed');
  const inProgressLessons = catalogLessons.filter((l) => l.session_status === 'in_progress');
  const notStartedLessons = catalogLessons.filter((l) => l.session_status === 'not_started');
  const totalLessons = catalogLessons.length;
  const commitmentPercent = totalLessons
    ? Math.round((completedLessons.length / totalLessons) * 1000) / 10
    : 0;

  const completedDates = completedLessons
    .map((l) => l.attended_at || l.session_started_at)
    .filter(Boolean);
  const streak = computeAttendanceStreak(completedDates);

  const presentCount = attendanceRows.filter((a) => a.status === 'present' || a.status === 'completed').length;
  const absentCount = attendanceRows.filter((a) => a.status === 'absent').length;
  const avgScore = quizRows.length
    ? Math.round(quizRows.reduce((s, r) => s + Number(r.percentage || 0), 0) / quizRows.length)
    : 0;
  const bestScore = quizRows.length
    ? Math.max(...quizRows.map((r) => Number(r.percentage || 0)))
    : 0;

  const videoSessionCount = catalogLessons.filter((a) => a.session_type === 'recorded_video').length;
  const externalSessionCount = catalogLessons.filter((a) => a.session_type === 'external_link').length;

  // Prefer profile total_points if attendance points table empty
  const totalPoints = Number(profile?.total_points || 0) || 0;
  const pointsDisplay = attendancePoints > 0 ? attendancePoints : totalPoints;

  return {
    user_id: userId,
    student_name: profile?.full_name || 'طالب',
    student_email: profile?.email || '',
    attendance: attendanceRows,
    lessons: catalogLessons,
    quiz_results: quizRows,
    course_progress: courseProgress,
    watch_progress: progressRows || [],
    video_tracking: videoTracks || [],
    external_sessions: externalSessions || [],
    lesson_quizzes: lessonQuizRows || [],
    stats: {
      // Primary student dashboard metrics
      commitment_percent: commitmentPercent,
      lessons_completed: completedLessons.length,
      lessons_in_progress: inProgressLessons.length,
      lessons_not_started: notStartedLessons.length,
      lessons_total: totalLessons,
      attendance_points: pointsDisplay,
      attendance_streak: streak,
      // legacy keys kept for compatibility
      lessons_attended: presentCount || completedLessons.length,
      lessons_absent: absentCount,
      quizzes_taken: quizRows.length,
      quizzes_passed: quizRows.filter((r) => r.passed).length,
      average_score: avgScore,
      best_score: bestScore,
      courses_in_progress: courseProgress.filter((c) => c.percent > 0 && c.percent < 100).length,
      courses_completed: courseProgress.filter((c) => c.percent === 100).length,
      video_sessions: videoSessionCount,
      external_sessions: externalSessionCount,
      total_points: totalPoints,
      student_grade: studentGrade || '',
    },
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'attendance', limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const authUser = await getAuthUser(req);
      if (!authUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

      const staff = await isStaffUser(authUser);
      const { user_id, lesson_id, course_id, admin, summary } = req.query || {};

      // Students always get only their own bundle (ignore spoofed user_id)
      if (!staff) {
        const bundle = await loadStudentBundle(authUser.id);
        return res.status(200).json({ ...bundle, user_id: authUser.id });
      }

      // Staff summary for a specific student
      if (summary === 'true' && user_id) {
        const bundle = await loadStudentBundle(String(user_id));
        return res.status(200).json({ ...bundle, user_id: String(user_id) });
      }

      // Staff without admin/matrix and without user_id → own bundle (safe default)
      if (!admin && !user_id && req.query?.matrix !== 'true' && req.query?.report !== 'true') {
        const bundle = await loadStudentBundle(authUser.id);
        return res.status(200).json({ ...bundle, user_id: authUser.id });
      }

      // Full admin matrix: all students × all lessons with tracking + quiz + points
      if (admin === 'true' || req.query?.matrix === 'true' || req.query?.report === 'true') {
        const [
          students,
          allLessons,
          allCourses,
          attendanceRows,
          videoTracks,
          externalSessions,
          quizRecords,
          settingsRows,
          sessionMetaRows,
          studentGradeRows,
          courseGradeRows,
        ] = await Promise.all([
          safeSelect(
            supabase
              .from('profiles')
              .select('id, full_name, email, role, total_points')
              .order('full_name', { ascending: true }),
            'profiles'
          ),
          safeSelect(
            supabase
              .from('lessons')
              .select('id, title, title_ar, course_id, order_index')
              .order('order_index', { ascending: true }),
            'lessons'
          ),
          safeSelect(
            supabase.from('courses').select('id, title, title_ar').order('id', { ascending: true }),
            'courses'
          ),
          safeSelect(supabase.from('lesson_attendance').select('*').limit(5000), 'lesson_attendance'),
          safeSelect(supabase.from('lesson_video_tracking').select('*').limit(5000), 'lesson_video_tracking'),
          safeSelect(
            supabase
              .from('lesson_external_sessions')
              .select('*')
              .order('started_at', { ascending: false })
              .limit(5000),
            'lesson_external_sessions'
          ),
          safeSelect(
            supabase
              .from('lesson_quiz_records')
              .select('*')
              .order('updated_at', { ascending: false })
              .limit(5000),
            'lesson_quiz_records'
          ),
          safeSelect(
            supabase.from('lesson_attendance_settings').select('*').limit(2000),
            'lesson_attendance_settings'
          ),
          safeSelect(
            supabase.from('lesson_session_meta').select('lesson_id, session_type').limit(2000),
            'lesson_session_meta'
          ),
          safeSelect(
            supabase.from('student_grades').select('user_id, grade_level').limit(5000),
            'student_grades'
          ),
          safeSelect(
            supabase.from('course_grades').select('course_id, grade_level').limit(5000),
            'course_grades'
          ),
        ]);

        const studentGradeMap = Object.fromEntries(
          (studentGradeRows || []).map((g) => [String(g.user_id), String(g.grade_level || '')])
        );
        const courseGradeMap = Object.fromEntries(
          (courseGradeRows || []).map((g) => [Number(g.course_id), String(g.grade_level || '')])
        );

        const studentList = (students || [])
          .filter((s) => {
            const role = String(s.role || 'student').toLowerCase();
            return role === 'student' || !role;
          })
          .map((s) => ({
            ...s,
            grade_level: studentGradeMap[String(s.id)] || '',
          }));

        const courseMap = Object.fromEntries((allCourses || []).map((c) => [Number(c.id), c]));
        const settingsMap = {};
        (sessionMetaRows || []).forEach((r) => {
          settingsMap[Number(r.lesson_id)] = {
            session_type: normalizeSessionType(r.session_type) || 'recorded_video',
            linked_quiz_id: null,
            required_watch_percent: 85,
            external_required_seconds: 1800,
            session_points: 0,
          };
        });
        (settingsRows || []).forEach((r) => {
          const lid = Number(r.lesson_id);
          const prev = settingsMap[lid] || {};
          settingsMap[lid] = {
            session_type:
              normalizeSessionType(r.session_type) || prev.session_type || 'recorded_video',
            linked_quiz_id: r.linked_quiz_id ? Number(r.linked_quiz_id) : null,
            required_watch_percent: clampInt(r.required_watch_percent, 1, 100, 85),
            external_required_seconds: clampInt(r.external_required_seconds, 0, 24 * 60 * 60, 1800),
            session_points: clampInt(r.session_points, 0, 100000, 0),
            video_duration_minutes: clampInt(r.video_duration_minutes, 0, 24 * 60, 0),
          };
        });

        const lessonList = (allLessons || []).map((l) => {
          const course = courseMap[Number(l.course_id)] || {};
          const st = settingsMap[Number(l.id)] || {
            session_type: 'recorded_video',
            linked_quiz_id: null,
            required_watch_percent: 85,
            external_required_seconds: 1800,
            session_points: 0,
          };
          const grade_level = courseGradeMap[Number(l.course_id)] || '';
          return {
            id: l.id,
            title: l.title_ar || l.title || `درس #${l.id}`,
            title_en: l.title || '',
            course_id: l.course_id,
            course_title: course.title_ar || course.title || '',
            grade_level,
            order_index: l.order_index,
            session_type: st.session_type,
            linked_quiz_id: st.linked_quiz_id,
            required_watch_percent: st.required_watch_percent,
            external_required_seconds: st.external_required_seconds,
            session_points: st.session_points,
          };
        });

        const keyOf = (uid, lid) => `${uid}:${lid}`;
        const attMap = {};
        (attendanceRows || []).forEach((r) => {
          attMap[keyOf(r.user_id, r.lesson_id)] = r;
        });
        const videoMap = {};
        (videoTracks || []).forEach((r) => {
          const k = keyOf(r.user_id, r.lesson_id);
          const prev = videoMap[k];
          if (!prev || Number(r.progress_percent || 0) >= Number(prev.progress_percent || 0)) {
            videoMap[k] = r;
          }
        });
        const extMap = {};
        (externalSessions || []).forEach((r) => {
          const k = keyOf(r.user_id, r.lesson_id);
          if (!extMap[k]) extMap[k] = r; // already ordered desc by started_at
        });
        const quizMap = {};
        (quizRecords || []).forEach((r) => {
          const k = keyOf(r.user_id, r.lesson_id);
          // prefer completed, else latest
          const prev = quizMap[k];
          if (!prev) {
            quizMap[k] = r;
          } else if (prev.status !== 'completed' && r.status === 'completed') {
            quizMap[k] = r;
          } else if (
            prev.status === r.status &&
            new Date(r.updated_at || r.completed_at || 0) > new Date(prev.updated_at || prev.completed_at || 0)
          ) {
            quizMap[k] = r;
          }
        });

        // Optional filters from query
        const filterUser = user_id ? String(user_id) : '';
        const filterLesson = lesson_id ? Number(lesson_id) : null;
        const filterCourse = course_id ? Number(course_id) : null;
        const filterGrade = String(
          req.query?.grade_level || req.query?.grade || ''
        ).trim();
        const q = String(req.query?.q || '').trim().toLowerCase();

        const filteredStudents = studentList.filter((s) => {
          if (filterUser && s.id !== filterUser) return false;
          if (filterGrade) {
            // When filtering by grade: keep students of that grade (or unknown if no grades set)
            if (s.grade_level && s.grade_level !== filterGrade) return false;
          }
          if (!q) return true;
          const hay = `${s.full_name || ''} ${s.email || ''} ${s.grade_level || ''}`.toLowerCase();
          return hay.includes(q);
        });
        const filteredLessons = lessonList.filter((l) => {
          if (filterLesson && Number(l.id) !== filterLesson) return false;
          if (filterCourse && Number(l.course_id) !== filterCourse) return false;
          if (filterGrade) {
            // Prefer matching course grade; if lesson has no grade, keep it only when
            // student filter alone is enough — still include ungraded lessons for visibility
            if (l.grade_level && l.grade_level !== filterGrade) return false;
          }
          return true;
        });

        const rows = [];
        for (const student of filteredStudents) {
          for (const lesson of filteredLessons) {
            // When grade filter is active, only pair student with matching-grade lessons
            // (or ungraded lessons if student matches grade)
            if (filterGrade) {
              const studentGrade = student.grade_level || '';
              const lessonGrade = lesson.grade_level || '';
              if (studentGrade && studentGrade !== filterGrade) continue;
              if (lessonGrade && lessonGrade !== filterGrade) continue;
              // If both empty, skip when filtering by a specific grade
              if (!studentGrade && !lessonGrade) continue;
            }

            const k = keyOf(student.id, lesson.id);
            const att = attMap[k] || null;
            const video = videoMap[k] || null;
            const ext = extMap[k] || null;
            const quiz = quizMap[k] || null;

            const sessionType = lesson.session_type || 'recorded_video';
            const watchPercent =
              sessionType === 'recorded_video'
                ? Number(
                    video?.progress_percent ??
                      (att?.status === 'completed' ? 100 : att ? 0 : 0)
                  )
                : null;
            const externalSeconds =
              sessionType === 'external_link'
                ? Number(ext?.active_seconds ?? ext?.eligible_seconds ?? 0)
                : null;
            const externalRequired = Number(lesson.external_required_seconds || 1800);

            let statusKey = 'not_started';
            if (att?.status === 'completed' || video?.completed || ext?.completed) {
              statusKey = 'completed';
            } else if (att?.status === 'absent') {
              statusKey = 'absent';
            } else if (att?.status === 'excused') {
              statusKey = 'excused';
            } else if (
              (sessionType === 'recorded_video' && Number(watchPercent || 0) > 0) ||
              (sessionType === 'external_link' && Number(externalSeconds || 0) > 0) ||
              att?.status === 'present' ||
              quiz?.status === 'started'
            ) {
              statusKey = 'in_progress';
            }

            const quizStatus = quiz?.status === 'completed' ? 'completed' : quiz?.status === 'started' ? 'started' : 'none';

            // Text filter: if q provided, match student or lesson or grade
            if (q) {
              const hay = `${student.full_name || ''} ${student.email || ''} ${student.grade_level || ''} ${lesson.title || ''} ${lesson.course_title || ''} ${lesson.grade_level || ''}`.toLowerCase();
              if (!hay.includes(q)) continue;
            }

            const rowGrade = student.grade_level || lesson.grade_level || '';

            rows.push({
              id: att?.id || `${student.id}_${lesson.id}`,
              attendance_id: att?.id || null,
              user_id: student.id,
              student_name: student.full_name || 'طالب',
              student_email: student.email || '',
              student_points: Number(student.total_points || 0),
              grade_level: rowGrade,
              student_grade_level: student.grade_level || '',
              lesson_grade_level: lesson.grade_level || '',
              lesson_id: lesson.id,
              lesson_title: lesson.title,
              course_id: lesson.course_id,
              course_title: lesson.course_title,
              session_type: sessionType,
              status: statusKey,
              attendance_status: att?.status || null,
              // video internal
              watch_percent: watchPercent,
              watched_seconds: video?.watched_seconds != null ? Number(video.watched_seconds) : null,
              last_position: video?.last_position != null ? Number(video.last_position) : null,
              required_watch_percent: lesson.required_watch_percent || 85,
              // external link
              external_seconds: externalSeconds,
              external_required_seconds: externalRequired,
              session_started_at: ext?.started_at || null,
              // quiz
              linked_quiz_id: lesson.linked_quiz_id,
              quiz_status: quizStatus,
              quiz_score: quiz?.score != null ? Number(quiz.score) : null,
              quiz_total_questions: quiz?.total_questions != null ? Number(quiz.total_questions) : null,
              quiz_correct_answers: quiz?.correct_answers != null ? Number(quiz.correct_answers) : null,
              quiz_percentage: quiz?.percentage != null ? Number(quiz.percentage) : null,
              quiz_started_at: quiz?.started_at || null,
              quiz_completed_at: quiz?.completed_at || null,
              // session points configured on lesson
              lesson_points: lesson.session_points || 0,
              attended_at: att?.attended_at || null,
              note: att?.note || '',
            });
          }
        }

        return res.status(200).json({
          students: filteredStudents.map((s) => ({
            id: s.id,
            full_name: s.full_name || 'طالب',
            email: s.email || '',
            total_points: Number(s.total_points || 0),
            grade_level: s.grade_level || '',
          })),
          lessons: filteredLessons,
          rows,
          stats: {
            students: filteredStudents.length,
            lessons: filteredLessons.length,
            completed: rows.filter((r) => r.status === 'completed').length,
            in_progress: rows.filter((r) => r.status === 'in_progress').length,
            not_started: rows.filter((r) => r.status === 'not_started').length,
            grade_level: filterGrade || '',
          },
        });
      }

      // Legacy list (attendance rows only)
      let query = supabase
        .from('lesson_attendance')
        .select('*')
        .order('attended_at', { ascending: false })
        .limit(500);

      if (user_id) query = query.eq('user_id', String(user_id));
      if (lesson_id) query = query.eq('lesson_id', Number(lesson_id));
      if (course_id) query = query.eq('course_id', Number(course_id));

      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      const lessonIds = [...new Set(rows.map((r) => Number(r.lesson_id)).filter(Boolean))];
      const courseIds = [...new Set(rows.map((r) => Number(r.course_id)).filter(Boolean))];

      const [{ data: profiles }, { data: lessons }, { data: courses }, { data: progressRows }] =
        await Promise.all([
          userIds.length
            ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
            : Promise.resolve({ data: [] }),
          lessonIds.length
            ? supabase.from('lessons').select('id, title, title_ar, course_id').in('id', lessonIds)
            : Promise.resolve({ data: [] }),
          courseIds.length
            ? supabase.from('courses').select('id, title, title_ar').in('id', courseIds)
            : Promise.resolve({ data: [] }),
          lessonIds.length
            ? supabase.from('lesson_watch_progress').select('*').in('lesson_id', lessonIds)
            : Promise.resolve({ data: [] }),
        ]);

      const typeMap = await getSessionTypeMap(lessonIds);
      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
      const lessonMap = Object.fromEntries((lessons || []).map((l) => [Number(l.id), l]));
      const courseMap = Object.fromEntries((courses || []).map((c) => [Number(c.id), c]));
      const progressKey = (uid, lid) => `${uid}:${lid}`;
      const progressMap = Object.fromEntries(
        (progressRows || []).map((p) => [progressKey(p.user_id, p.lesson_id), p])
      );

      const enriched = rows.map((row) => {
        const profile = profileMap[row.user_id] || {};
        const lesson = lessonMap[Number(row.lesson_id)] || {};
        const course = courseMap[Number(row.course_id || lesson.course_id)] || {};
        const progress = progressMap[progressKey(row.user_id, row.lesson_id)] || null;
        const sessionType =
          normalizeSessionType(progress?.session_type) ||
          typeMap[Number(row.lesson_id)] ||
          'recorded_video';
        return {
          ...row,
          student_name: profile.full_name || 'طالب',
          student_email: profile.email || '',
          lesson_title: lesson.title_ar || lesson.title || `درس #${row.lesson_id}`,
          course_title: course.title_ar || course.title || `كورس #${row.course_id || ''}`,
          session_type: sessionType,
          progress_percent:
            progress?.progress_percent ??
            (row.status === 'completed' ? 100 : row.status === 'present' ? 40 : 0),
        };
      });

      return res.status(200).json(enriched);
    }

    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const body = req.body || {};
      const lessonId = asPositiveInt(body.lesson_id);
      if (!lessonId) return res.status(400).json({ error: 'معرّف الدرس مطلوب' });

      const { data: lesson, error: lessonErr } = await supabase
        .from('lessons')
        .select('id, course_id, title, title_ar')
        .eq('id', lessonId)
        .maybeSingle();
      if (lessonErr) throw lessonErr;
      if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });

      const staff = await isStaffUser(user);
      let targetUserId = user.id;
      if (staff && body.user_id) {
        targetUserId = String(body.user_id);
      }

      const settingsMap = await getAttendanceSettingsMap([lessonId]);
      const lessonSettings = settingsMap[lessonId] || {
        session_type: 'recorded_video',
        required_watch_percent: 85,
        external_required_seconds: 1800,
        session_points: 0,
        linked_quiz_id: null,
        video_duration_minutes: 0,
      };
      const sessionType =
        normalizeSessionType(body.session_type) ||
        lessonSettings.session_type ||
        'recorded_video';
      const requiredWatchPercent = clampInt(
        body.required_watch_percent ?? lessonSettings.required_watch_percent,
        1,
        100,
        85
      );
      const externalRequiredSeconds = clampInt(
        body.external_required_seconds ?? lessonSettings.external_required_seconds,
        0,
        24 * 60 * 60,
        1800
      );

      // Students cannot set attendance status manually — only automatic tracking may complete a lesson.
      // Staff/admin may still mark present/completed/absent/excused explicitly.
      let status = 'present';
      if (staff) {
        status = normalizeStatus(body.status, 'present');
      }

      // Tracking-driven completion rules (per-lesson settings)
      // Video progress must come from honest watched ranges (anti-seek client tracker)
      const progressPercent = Math.max(0, Math.min(100, Number(body.progress_percent) || 0));
      const watchedSeconds = Math.max(
        0,
        Number(body.active_seconds ?? body.watched_seconds ?? body.external_elapsed_seconds ?? 0) || 0
      );
      const trackingMode = String(body.tracking_mode || '').toLowerCase();
      const videoEligible = trackingMode === 'video' && progressPercent >= requiredWatchPercent;
      const externalEligible =
        trackingMode === 'external_link' &&
        externalRequiredSeconds > 0 &&
        watchedSeconds >= externalRequiredSeconds;

      if (!staff) {
        // Progress heartbeats stay "present". Completion only when student presses «إكمال الحصة»
        // (body.completed === true) AND the required threshold is actually met.
        if (trackingMode === 'video' || trackingMode === 'external_link' || body.opened_external) {
          const wantsComplete = body.completed === true || body.force_complete === true;
          if (wantsComplete) {
            if (videoEligible || externalEligible) {
              status = 'completed';
            } else {
              return res.status(400).json({
                error:
                  trackingMode === 'external_link'
                    ? `يجب إكمال مدة جلسة المتابعة المطلوبة (${Math.round(externalRequiredSeconds / 60)} دقيقة) قبل إكمال الحصة`
                    : `يجب مشاهدة ${requiredWatchPercent}% فعليًا على الأقل قبل إكمال الحصة`,
                required_watch_percent: requiredWatchPercent,
                external_required_seconds: externalRequiredSeconds,
                progress_percent: progressPercent,
                active_seconds: watchedSeconds,
              });
            }
          } else {
            status = 'present';
          }
        } else {
          // No tracking payload from student → reject manual attendance changes
          return res.status(403).json({
            error: 'لا يمكن للطالب تغيير حالة الحضور يدويًا — تُحدَّث تلقائيًا حسب المتابعة',
          });
        }
      }

      const note = sanitizeText(body.note || '', 500);
      const now = new Date().toISOString();

      // Save detailed watch/link progress (students + admin tracking posts)
      let watch = null;
      let videoTrack = null;
      try {
        watch = await upsertWatchProgress({
          userId: targetUserId,
          lessonId,
          courseId: lesson.course_id,
          sessionType,
          progressPercent:
            progressPercent ||
            (status === 'completed' ? 100 : status === 'present' ? 40 : 0),
          lastPosition: body.last_position,
          maxPosition: body.max_position,
          duration: body.duration,
          openedExternal: body.opened_external,
          completed: status === 'completed',
          requiredWatchPercent,
        });
        if (watch?.completed) status = 'completed';
      } catch (err) {
        console.error('watch progress upsert failed:', err.message);
      }

      if (trackingMode === 'video' || sessionType === 'recorded_video') {
        try {
          videoTrack = await upsertVideoTracking({
            userId: targetUserId,
            lessonId,
            courseId: lesson.course_id,
            progressPercent,
            watchedSeconds,
            lastPosition: body.last_position,
            maxPosition: body.max_position,
            duration: body.duration,
            watchedRanges: body.watched_ranges,
            requiredWatchPercent,
            completed: status === 'completed',
          });
          // Do not auto-flip attendance to completed from tracking alone
        } catch (err) {
          console.error('video tracking upsert failed:', err.message);
        }
      }

      let externalSession = null;
      if (trackingMode === 'external_link' || sessionType === 'external_link') {
        try {
          const activeSecs = Math.max(
            0,
            Number(body.active_seconds ?? body.external_elapsed_seconds ?? body.watched_seconds ?? 0) || 0
          );
          const studentPressedComplete = status === 'completed';
          externalSession = await upsertExternalSession({
            userId: targetUserId,
            lessonId,
            courseId: lesson.course_id,
            externalUrl: body.external_url || '',
            startedAt: body.session_started_at || body.started_at || null,
            lastActivityAt: body.last_activity_at || null,
            endedAt: body.session_ended_at || body.ended_at || null,
            activeSeconds: activeSecs,
            eligibleSeconds: Math.min(activeSecs, externalRequiredSeconds || activeSecs),
            requiredSeconds: externalRequiredSeconds,
            isActive: body.session_is_active !== false && !studentPressedComplete,
            isIdle: Boolean(body.session_is_idle),
            completed: studentPressedComplete,
            note: body.session_note || note,
            sessionId: body.external_session_id,
          });
        } catch (err) {
          console.error('external session upsert failed:', err.message);
        }
      }

      const { data: existing } = await supabase
        .from('lesson_attendance')
        .select('id, status')
        .eq('user_id', targetUserId)
        .eq('lesson_id', lessonId)
        .maybeSingle();

      const wasCompleted = existing?.status === 'completed';

      // Never downgrade completed -> present for student self-tracking
      if (existing && !staff && existing.status === 'completed' && status === 'present') {
        status = 'completed';
      }

      let row;
      if (existing?.id) {
        const { data, error } = await supabase
          .from('lesson_attendance')
          .update({
            status,
            note: note || undefined,
            course_id: lesson.course_id,
            attended_at: now,
            marked_by: user.id,
          })
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        row = data;
      } else {
        const { data, error } = await supabase
          .from('lesson_attendance')
          .insert({
            user_id: targetUserId,
            lesson_id: lessonId,
            course_id: lesson.course_id,
            status,
            note: note || '',
            attended_at: now,
            marked_by: user.id,
            created_at: now,
          })
          .select()
          .single();
        if (error) throw error;
        row = data;
      }

      // Award session points only the first time the lesson is completed
      let pointsAward = { awarded: 0 };
      if (status === 'completed' && !wasCompleted) {
        pointsAward = await awardSessionPointsOnce({
          userId: targetUserId,
          lessonId,
          points: lessonSettings.session_points,
          alreadyCompleted: wasCompleted,
        });
      }

      // Fire-and-forget: parent backlog WhatsApp check (in-process)
      try {
        import('./wa-client.js')
          .then((wa) => wa.loadWhatsAppConfig({ force: false }))
          .then((cfg) => {
            if (!cfg?.parentNotifyEnabled) return null;
            return import('./cron-parent-notify.js').then((mod) => {
              if (typeof mod.runParentNotifyJob === 'function') {
                return mod.runParentNotifyJob({ dryRun: false });
              }
              return null;
            });
          })
          .catch((err) => {
            console.error('[attendance] parent notify hook:', err?.message || err);
          });
      } catch {
        /* ignore */
      }

      return res.status(existing?.id ? 200 : 201).json({
        ...row,
        lesson_title: lesson.title_ar || lesson.title,
        session_type: sessionType,
        progress_percent:
          videoTrack?.progress_percent ??
          (externalSession
            ? externalRequiredSeconds > 0
              ? Math.min(100, Math.round((Number(externalSession.active_seconds || 0) / externalRequiredSeconds) * 1000) / 10)
              : progressPercent
            : null) ??
          watch?.progress_percent ??
          progressPercent,
        watched_seconds: videoTrack?.watched_seconds ?? externalSession?.active_seconds ?? watchedSeconds,
        last_position: videoTrack?.last_position ?? body.last_position ?? 0,
        max_position: videoTrack?.max_position ?? body.max_position ?? 0,
        duration: videoTrack?.duration ?? body.duration ?? 0,
        watched_ranges: videoTrack?.watched_ranges || body.watched_ranges || [],
        session_status:
          videoTrack?.session_status ||
          externalSession?.session_status ||
          watch?.session_status ||
          (status === 'completed' ? 'completed' : progressPercent > 0 ? 'in_progress' : 'not_started'),
        eligible: Boolean(
          videoTrack?.eligible ||
            externalSession?.completed ||
            (sessionType === 'recorded_video' && progressPercent >= requiredWatchPercent) ||
            (sessionType === 'external_link' &&
              externalRequiredSeconds > 0 &&
              Number(externalSession?.active_seconds || watchedSeconds || 0) >= externalRequiredSeconds)
        ),
        watch_progress: watch,
        video_tracking: videoTrack,
        external_session: externalSession,
        external_session_id: externalSession?.id || null,
        session_started_at: externalSession?.started_at || body.session_started_at || null,
        active_seconds: externalSession?.active_seconds ?? body.active_seconds ?? null,
        eligible_seconds: externalSession?.eligible_seconds ?? null,
        required_watch_percent: requiredWatchPercent,
        external_required_seconds: externalRequiredSeconds,
        session_points: lessonSettings.session_points || 0,
        linked_quiz_id: lessonSettings.linked_quiz_id || null,
        points_awarded: pointsAward.awarded || 0,
        // Explicit limitation for clients/UI
        external_watch_note:
          sessionType === 'external_link'
            ? 'لا يمكن للمنصة معرفة نسبة مشاهدة فيديو YouTube أو Google Drive — يُحتسب وقت جلسة المتابعة على المنصة فقط'
            : undefined,
      });
    }

    if (req.method === 'PUT') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const body = req.body || {};
      const id = asPositiveInt(body.id);
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const updates = {};
      if (body.status != null) updates.status = normalizeStatus(body.status, 'present');
      if (body.note != null) updates.note = sanitizeText(body.note, 500);
      if (body.attended_at) updates.attended_at = body.attended_at;
      updates.marked_by = admin.user.id;

      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
      }

      const { data, error } = await supabase
        .from('lesson_attendance')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const id = asPositiveInt(req.body?.id || req.query?.id);
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const { error } = await supabase.from('lesson_attendance').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'attendance');
  }
}
