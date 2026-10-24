/**
 * Backend job: parent WhatsApp alerts for attendance backlog.
 * Incomplete = lesson not completed for the student's grade catalog.
 * Threshold: >= 2 incomplete lessons.
 * Cooldown: 24h per student after a real send attempt (success/failed only).
 *
 * Auth: CRON_SECRET bearer / x-cron-secret / x-vercel-cron OR full-admin JWT
 * Export runParentNotifyJob for in-process calls (no HTTP).
 */
import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  getAuthUser,
  getProfile,
  methodNotAllowed,
  serverError,
  sanitizeText,
  sanitizeGradeLevel,
  isFullAdminRole,
  isStaffRole,
  ADMIN_BOOTSTRAP_EMAIL,
} from './security.js';
import {
  getWhatsAppConfig,
  loadWhatsAppConfig,
  isWhatsAppConfigured,
  normalizeWhatsAppTo,
  sendParentAlertMessage,
} from './wa-client.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function authorizeCron(req) {
  // Vercel Cron sends this header on scheduled invocations
  if (req.headers['x-vercel-cron'] === '1' || req.headers['x-vercel-cron'] === 'true') {
    return { ok: true, via: 'vercel_cron' };
  }
  const secret = String(process.env.CRON_SECRET || process.env.WHATSAPP_CRON_SECRET || '').trim();
  if (!secret) return { ok: false, reason: 'cron_secret_missing' };
  const header = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '';
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const bearer =
    typeof auth === 'string' ? auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() : '';
  const provided = String(header || bearer || '').trim();
  if (provided && provided === secret) return { ok: true, via: 'cron_secret' };
  return { ok: false, reason: 'unauthorized' };
}

async function authorizeRequest(req, res) {
  const cron = authorizeCron(req);
  if (cron.ok) return { type: 'cron', via: cron.via };

  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({
      error: 'غير مصرح — سجّل دخول المشرف أو استخدم CRON_SECRET',
    });
    return null;
  }
  const profile = await getProfile(user.id);
  const full =
    isFullAdminRole(profile?.role, user.email) ||
    user.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL;
  // Allow any staff to run dry_run; full admin for live send
  const dry =
    req.query?.dry_run === '1' ||
    req.query?.dry_run === 'true' ||
    req.body?.dry_run === true;
  if (!full && !(dry && isStaffRole(profile?.role))) {
    res.status(403).json({ error: 'للمشرف الكامل (أو فحص جاف لأي مشرف)' });
    return null;
  }
  return { type: 'admin', user, dryOnly: !full };
}

async function safeSelect(promise, label) {
  try {
    const res = await promise;
    if (res?.error) {
      console.error(`[cron-parent-notify] ${label}:`, res.error.message || res.error);
      return [];
    }
    if (Array.isArray(res?.data)) return res.data;
    if (res?.data && typeof res.data === 'object') return [res.data];
    return [];
  } catch (err) {
    console.error(`[cron-parent-notify] ${label} threw:`, err?.message || err);
    return [];
  }
}

function isLessonCompleted({ att, video, ext, progress }) {
  return Boolean(
    att?.status === 'completed' ||
      video?.completed ||
      video?.session_status === 'completed' ||
      ext?.completed ||
      ext?.session_status === 'completed' ||
      progress?.completed
  );
}

/**
 * Build backlog using real Supabase attendance data.
 * Catalog = published courses for student grade → their lessons.
 */
export async function buildIncompleteByStudent() {
  const [
    profiles,
    grades,
    courses,
    courseGrades,
    lessons,
    attendance,
    videos,
    externals,
    progressRows,
    contacts,
  ] = await Promise.all([
    safeSelect(
      supabase.from('profiles').select('id, full_name, email, role'),
      'profiles'
    ),
    safeSelect(supabase.from('student_grades').select('user_id, grade_level'), 'student_grades'),
    safeSelect(supabase.from('courses').select('id, is_published'), 'courses'),
    safeSelect(supabase.from('course_grades').select('course_id, grade_level'), 'course_grades'),
    safeSelect(supabase.from('lessons').select('id, course_id, title, title_ar'), 'lessons'),
    safeSelect(
      supabase.from('lesson_attendance').select('user_id, lesson_id, status'),
      'lesson_attendance'
    ),
    safeSelect(
      supabase
        .from('lesson_video_tracking')
        .select('user_id, lesson_id, completed, session_status'),
      'lesson_video_tracking'
    ),
    safeSelect(
      supabase
        .from('lesson_external_sessions')
        .select('user_id, lesson_id, completed, session_status'),
      'lesson_external_sessions'
    ),
    safeSelect(
      supabase
        .from('lesson_watch_progress')
        .select('user_id, lesson_id, completed'),
      'lesson_watch_progress'
    ),
    safeSelect(
      supabase.from('profile_contacts').select('user_id, parent_phone'),
      'profile_contacts'
    ),
  ]);

  const gradeMap = Object.fromEntries(
    (grades || []).map((g) => [String(g.user_id), sanitizeGradeLevel(g.grade_level) || ''])
  );
  const phoneMap = Object.fromEntries(
    (contacts || []).map((c) => [String(c.user_id), String(c.parent_phone || '').trim()])
  );

  const publishedCourses = new Set(
    (courses || []).filter((c) => c.is_published !== false).map((c) => Number(c.id))
  );

  const coursesByGrade = {};
  (courseGrades || []).forEach((row) => {
    const g = sanitizeGradeLevel(row.grade_level);
    if (!g || !publishedCourses.has(Number(row.course_id))) return;
    if (!coursesByGrade[g]) coursesByGrade[g] = new Set();
    coursesByGrade[g].add(Number(row.course_id));
  });

  const lessonsByCourse = {};
  (lessons || []).forEach((l) => {
    const cid = Number(l.course_id);
    if (!lessonsByCourse[cid]) lessonsByCourse[cid] = [];
    lessonsByCourse[cid].push(l);
  });

  const key = (uid, lid) => `${uid}:${lid}`;
  const attMap = {};
  (attendance || []).forEach((a) => {
    attMap[key(a.user_id, a.lesson_id)] = a;
  });
  const videoMap = {};
  (videos || []).forEach((v) => {
    videoMap[key(v.user_id, v.lesson_id)] = v;
  });
  const extMap = {};
  (externals || []).forEach((e) => {
    const k = key(e.user_id, e.lesson_id);
    if (!extMap[k]) extMap[k] = e;
  });
  const progressMap = {};
  (progressRows || []).forEach((p) => {
    progressMap[key(p.user_id, p.lesson_id)] = p;
  });

  const staffRoles = new Set([
    'admin',
    'users',
    'reports',
    'content',
    'exams',
    'curriculum',
    'support',
  ]);
  const students = (profiles || []).filter((p) => {
    const role = String(p.role || 'student').toLowerCase();
    return !staffRoles.has(role);
  });

  const out = [];
  for (const student of students) {
    const uid = String(student.id);
    const grade = gradeMap[uid] || '';
    if (!grade) continue;
    const courseSet = coursesByGrade[grade];
    if (!courseSet || !courseSet.size) continue;

    const catalog = [];
    courseSet.forEach((cid) => {
      (lessonsByCourse[cid] || []).forEach((l) => catalog.push(l));
    });
    if (!catalog.length) continue;

    let incomplete = 0;
    const incompleteLessons = [];
    for (const lesson of catalog) {
      const lid = Number(lesson.id);
      const k = key(uid, lid);
      const done = isLessonCompleted({
        att: attMap[k],
        video: videoMap[k],
        ext: extMap[k],
        progress: progressMap[k],
      });
      if (!done) {
        incomplete += 1;
        incompleteLessons.push(lid);
      }
    }

    if (incomplete > 0) {
      out.push({
        user_id: uid,
        student_name: student.full_name || student.email || 'طالب',
        grade_level: grade,
        parent_phone_raw: phoneMap[uid] || '',
        parent_phone: normalizeWhatsAppTo(phoneMap[uid] || ''),
        incomplete_count: incomplete,
        incomplete_lesson_ids: incompleteLessons,
        catalog_total: catalog.length,
      });
    }
  }

  return out;
}

async function recentlyNotified(userId) {
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  // Only SUCCESS blocks re-send for 24h.
  // Auth/config failures must NOT cool down — admin may fix token and retry immediately.
  const { data, error } = await supabase
    .from('parent_notify_logs')
    .select('id, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'success')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[cron-parent-notify] cooldown query:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

function isAuthFailure(result) {
  if (!result) return false;
  if (result.error_kind === 'auth') return true;
  const e = String(result.error || result.error_raw || '').toLowerCase();
  return e.includes('authentication') || e.includes('token') || e.includes('oauth');
}

async function writeLog(row) {
  try {
    const { error } = await supabase.from('parent_notify_logs').insert({
      user_id: row.user_id || '',
      student_name: sanitizeText(row.student_name || '', 120),
      parent_phone: sanitizeText(row.parent_phone || '', 30),
      incomplete_count: Number(row.incomplete_count) || 0,
      status: String(row.status || 'failed').slice(0, 40),
      error_message: sanitizeText(row.error_message || '', 500),
      message_id: sanitizeText(row.message_id || '', 120),
      channel: sanitizeText(row.channel || '', 40),
      created_at: new Date().toISOString(),
    });
    if (error) console.error('[cron-parent-notify] log insert:', error.message);
  } catch (err) {
    console.error('[cron-parent-notify] log threw:', err?.message || err);
  }
}

/** In-process entry (attendance hook + HTTP handler) */
export async function runParentNotifyJob({ dryRun = false, forceUserId = null } = {}) {
  const cfg = await loadWhatsAppConfig({ force: true });
  const threshold = Math.max(1, Math.min(20, Number(cfg.incompleteThreshold) || 2));
  const summary = {
    scanned: 0,
    eligible: 0,
    skipped_no_phone: 0,
    skipped_cooldown: 0,
    skipped_disabled: 0,
    sent: 0,
    failed: 0,
    dry_run: Boolean(dryRun),
    whatsapp_configured: isWhatsAppConfigured(cfg),
    parent_notify_enabled: cfg.parentNotifyEnabled,
    template_configured: Boolean(cfg.templateName),
    threshold,
    sample: [],
  };

  if (!cfg.parentNotifyEnabled && !dryRun) {
    summary.skipped_disabled = 1;
    summary.message = 'التنبيهات معطّلة (WHATSAPP_PARENT_NOTIFY=0)';
    return summary;
  }

  let backlog = await buildIncompleteByStudent();
  // Apply threshold from admin config
  backlog = backlog.filter((r) => Number(r.incomplete_count) >= threshold);
  if (forceUserId) {
    backlog = backlog.filter((r) => String(r.user_id) === String(forceUserId));
  }
  summary.scanned = backlog.length;
  summary.sample = backlog.slice(0, 8).map((r) => ({
    student_name: r.student_name,
    grade: r.grade_level,
    incomplete: r.incomplete_count,
    has_phone: Boolean(r.parent_phone),
  }));

  for (const row of backlog) {
    summary.eligible += 1;
    const phone = row.parent_phone || normalizeWhatsAppTo(row.parent_phone_raw);
    if (!phone) {
      summary.skipped_no_phone += 1;
      await writeLog({
        user_id: row.user_id,
        student_name: row.student_name,
        parent_phone: String(row.parent_phone_raw || '').slice(0, 30),
        incomplete_count: row.incomplete_count,
        status: 'skipped_no_phone',
        error_message: 'لا يوجد رقم ولي أمر صالح',
        channel: 'none',
      });
      continue;
    }

    if (!dryRun && (await recentlyNotified(row.user_id))) {
      summary.skipped_cooldown += 1;
      continue;
    }

    if (dryRun) {
      await writeLog({
        user_id: row.user_id,
        student_name: row.student_name,
        parent_phone: phone,
        incomplete_count: row.incomplete_count,
        status: 'dry_run',
        error_message: '',
        channel: 'none',
      });
      continue;
    }

    if (!isWhatsAppConfigured(cfg)) {
      summary.failed += 1;
      await writeLog({
        user_id: row.user_id,
        student_name: row.student_name,
        parent_phone: phone,
        incomplete_count: row.incomplete_count,
        status: 'failed',
        error_message:
          'لا يوجد Access Token صالح. الصق Token حقيقي من Meta في قسم التنبيهات واحفظ.',
        channel: 'none',
      });
      summary.message =
        'توقف الإرسال: لا يوجد Access Token. افتح التنبيهات → الصق Token → حفظ الإعدادات.';
      break;
    }

    const result = await sendParentAlertMessage({
      to: phone,
      studentName: row.student_name,
      incompleteCount: row.incomplete_count,
      cfg,
    });

    if (result.ok) {
      summary.sent += 1;
      await writeLog({
        user_id: row.user_id,
        student_name: row.student_name,
        parent_phone: phone,
        incomplete_count: row.incomplete_count,
        status: 'success',
        error_message: '',
        message_id: result.message_id || '',
        channel: result.channel || '',
      });
    } else {
      summary.failed += 1;
      await writeLog({
        user_id: row.user_id,
        student_name: row.student_name,
        parent_phone: phone,
        incomplete_count: row.incomplete_count,
        status: 'failed',
        error_message: result.error || result.error_raw || 'send_failed',
        message_id: '',
        channel: result.channel || '',
      });
      summary.last_error = result.error || result.error_raw || '';
      summary.last_error_kind = result.error_kind || '';

      // Stop the whole job on auth failure — fixing token is required first
      if (isAuthFailure(result)) {
        summary.message =
          result.error ||
          'توقف الإرسال: Access Token غير صالح. الصق Token جديد من Meta ثم احفظ وأعد التشغيل.';
        break;
      }
    }
  }

  if (!summary.message) {
    summary.message = dryRun
      ? `فحص جاف: ${summary.eligible} متراكم · بدون رقم ${summary.skipped_no_phone}`
      : `أُرسل ${summary.sent} · فشل ${summary.failed} · بدون رقم ${summary.skipped_no_phone} · تهدئة ${summary.skipped_cooldown}` +
        (summary.last_error ? ` · آخر خطأ: ${summary.last_error}` : '');
  }

  return summary;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'cron-parent-notify', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return methodNotAllowed(res);
    }

    const auth = await authorizeRequest(req, res);
    if (!auth) return;

    let dryRun =
      req.query?.dry_run === '1' ||
      req.query?.dry_run === 'true' ||
      req.body?.dry_run === true;
    if (auth.dryOnly) dryRun = true;

    const forceUserId = req.body?.user_id || req.query?.user_id || null;
    const summary = await runParentNotifyJob({ dryRun, forceUserId });

    return res.status(200).json({
      ok: true,
      job: 'parent_attendance_backlog_notify',
      ran_at: new Date().toISOString(),
      auth: auth.type,
      ...summary,
    });
  } catch (err) {
    console.error('[cron-parent-notify] fatal:', err?.message || err);
    return serverError(res, err, 'cron-parent-notify');
  }
}
