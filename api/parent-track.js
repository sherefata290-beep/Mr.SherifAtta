import crypto from 'crypto';
import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  methodNotAllowed,
  serverError,
  sanitizeText,
  sanitizeGradeLevel,
} from './security.js';

function generateToken() {
  // 32 bytes → 64 hex chars, unguessable
  return crypto.randomBytes(32).toString('hex');
}

async function getActiveTokenForCode(accessCodeId) {
  const { data, error } = await supabase
    .from('parent_track_tokens')
    .select('*')
    .eq('access_code_id', Number(accessCodeId))
    .eq('is_active', true)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createTokenForCode(codeRow) {
  const token = generateToken();
  const now = new Date().toISOString();
  const row = {
    token,
    access_code_id: Number(codeRow.id),
    user_id: '',
    student_name: sanitizeText(codeRow.student_name || codeRow.label || '', 120),
    grade_level: sanitizeGradeLevel(codeRow.grade_level) || '',
    is_active: true,
    created_at: now,
    updated_at: now,
    revoked_at: null,
  };

  // Resolve redeemed user if any
  try {
    const { data: red } = await supabase
      .from('code_redemptions')
      .select('user_id, student_name')
      .eq('code_id', Number(codeRow.id))
      .order('redeemed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (red?.user_id) {
      row.user_id = String(red.user_id);
      if (red.student_name) row.student_name = sanitizeText(red.student_name, 120);
    }
  } catch {
    /* ignore */
  }

  const { data, error } = await supabase.from('parent_track_tokens').insert(row).select().single();
  if (error) throw error;
  return data;
}

async function revokeToken(tokenId) {
  const now = new Date().toISOString();
  await supabase
    .from('parent_track_tokens')
    .update({ is_active: false, revoked_at: now, updated_at: now })
    .eq('id', tokenId);
}

/**
 * Lightweight student summary for parents (read-only).
 * Reuses existing tables — does not modify attendance/quiz systems.
 */
async function loadParentSummary(userId, fallback = {}) {
  const uid = String(userId || '');
  if (!uid) {
    return {
      student_name: fallback.student_name || 'طالب',
      grade_level: fallback.grade_level || '',
      activated: false,
      stats: {
        commitment_percent: 0,
        lessons_completed: 0,
        lessons_in_progress: 0,
        lessons_not_started: 0,
        lessons_total: 0,
        attendance_points: 0,
        attendance_streak: 0,
        quizzes_taken: 0,
        quizzes_passed: 0,
        average_score: 0,
        best_score: 0,
      },
      lessons: [],
      quiz_results: [],
      message: 'لم يفعّل الطالب كود الوصول بعد',
    };
  }

  const [
    profileRes,
    gradeRes,
    attendanceRes,
    resultsRes,
    lessonsRes,
    coursesRes,
    settingsRes,
    videoRes,
    extRes,
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, total_points').eq('id', uid).maybeSingle(),
    supabase.from('student_grades').select('grade_level').eq('user_id', uid).maybeSingle(),
    supabase.from('lesson_attendance').select('*').eq('user_id', uid).order('attended_at', { ascending: false }),
    supabase
      .from('quiz_results')
      .select('id, quiz_id, user_name, score, total_questions, percentage, completed_at')
      .eq('user_id', uid)
      .order('completed_at', { ascending: false })
      .limit(100),
    supabase.from('lessons').select('id, course_id, title, title_ar, order_index'),
    supabase.from('courses').select('id, title, title_ar, is_published'),
    supabase.from('lesson_attendance_settings').select('*').limit(3000),
    supabase.from('lesson_video_tracking').select('*').eq('user_id', uid),
    supabase
      .from('lesson_external_sessions')
      .select('*')
      .eq('user_id', uid)
      .order('started_at', { ascending: false }),
  ]);

  const profile = profileRes.data || null;
  const grade_level =
    sanitizeGradeLevel(gradeRes.data?.grade_level || fallback.grade_level || '') || '';

  const courseMap = Object.fromEntries((coursesRes.data || []).map((c) => [Number(c.id), c]));
  const settingsMap = Object.fromEntries(
    (settingsRes.data || []).map((s) => [Number(s.lesson_id), s])
  );
  const attByLesson = {};
  (attendanceRes.data || []).forEach((a) => {
    const lid = Number(a.lesson_id);
    if (!attByLesson[lid]) attByLesson[lid] = a;
  });
  const videoByLesson = Object.fromEntries(
    (videoRes.data || []).map((v) => [Number(v.lesson_id), v])
  );
  const extByLesson = {};
  (extRes.data || []).forEach((e) => {
    const lid = Number(e.lesson_id);
    if (!extByLesson[lid]) extByLesson[lid] = e;
  });

  // Filter courses by student grade when possible
  let allowedCourses = new Set((coursesRes.data || []).filter((c) => c.is_published !== false).map((c) => Number(c.id)));
  if (grade_level) {
    const { data: cg } = await supabase
      .from('course_grades')
      .select('course_id')
      .eq('grade_level', grade_level);
    if (cg?.length) {
      allowedCourses = new Set(cg.map((r) => Number(r.course_id)));
    }
  }

  const lessons = (lessonsRes.data || [])
    .filter((l) => allowedCourses.has(Number(l.course_id)))
    .map((l) => {
      const lid = Number(l.id);
      const att = attByLesson[lid];
      const video = videoByLesson[lid];
      const ext = extByLesson[lid];
      const settings = settingsMap[lid] || {};
      const sessionType = settings.session_type === 'external_link' ? 'external_link' : 'recorded_video';
      const progress = Number(
        video?.progress_percent ??
          (sessionType === 'external_link' && ext?.required_seconds
            ? Math.min(100, Math.round((Number(ext.active_seconds || 0) / Number(ext.required_seconds)) * 1000) / 10)
            : att?.status === 'completed'
              ? 100
              : 0)
      );
      let session_status = 'not_started';
      if (att?.status === 'completed' || video?.completed || ext?.completed) session_status = 'completed';
      else if (progress > 0 || att?.status === 'present' || Number(ext?.active_seconds || 0) > 0) {
        session_status = 'in_progress';
      }
      const course = courseMap[Number(l.course_id)] || {};
      return {
        lesson_id: lid,
        lesson_title: l.title_ar || l.title || `حصة #${lid}`,
        course_title: course.title_ar || course.title || '',
        session_type: sessionType,
        session_status,
        progress_percent: progress,
        attended_at: att?.attended_at || null,
        session_started_at: ext?.started_at || null,
        active_seconds: Number(ext?.active_seconds || video?.watched_seconds || 0) || 0,
        session_points: Number(settings.session_points || 0) || 0,
      };
    })
    .sort((a, b) => String(a.course_title).localeCompare(String(b.course_title), 'ar'));

  const completed = lessons.filter((l) => l.session_status === 'completed').length;
  const inProg = lessons.filter((l) => l.session_status === 'in_progress').length;
  const notStart = lessons.filter((l) => l.session_status === 'not_started').length;
  const total = lessons.length;
  const commitment = total ? Math.round((completed / total) * 1000) / 10 : 0;

  // Streak
  const days = [
    ...new Set(
      lessons
        .filter((l) => l.session_status === 'completed')
        .map((l) => (l.attended_at || l.session_started_at || '').slice(0, 10))
        .filter(Boolean)
    ),
  ].sort((a, b) => (a < b ? 1 : -1));
  let streak = 0;
  if (days.length) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    const newest = new Date(days[0] + 'T12:00:00');
    if (newest.getTime() >= yest.getTime()) {
      streak = 1;
      for (let i = 1; i < days.length; i += 1) {
        const prev = new Date(days[i - 1] + 'T12:00:00');
        const cur = new Date(days[i] + 'T12:00:00');
        const diff = Math.round((prev - cur) / 86400000);
        if (diff === 1) streak += 1;
        else if (diff !== 0) break;
      }
    }
  }

  const quizRows = resultsRes.data || [];
  const avgScore = quizRows.length
    ? Math.round(quizRows.reduce((s, r) => s + Number(r.percentage || 0), 0) / quizRows.length)
    : 0;
  const bestScore = quizRows.length
    ? Math.max(...quizRows.map((r) => Number(r.percentage || 0)))
    : 0;

  // Attach quiz titles
  const quizIds = [...new Set(quizRows.map((r) => Number(r.quiz_id)).filter(Boolean))];
  let quizMap = {};
  if (quizIds.length) {
    const { data: quizzes } = await supabase.from('quizzes').select('id, title, title_ar').in('id', quizIds);
    quizMap = Object.fromEntries((quizzes || []).map((q) => [Number(q.id), q]));
  }
  const quiz_results = quizRows.map((r) => {
    const q = quizMap[Number(r.quiz_id)] || {};
    return {
      ...r,
      quiz_title: q.title_ar || q.title || `اختبار #${r.quiz_id}`,
      passed: Number(r.percentage || 0) >= 50,
    };
  });

  const student_name =
    profile?.full_name ||
    fallback.student_name ||
    quizRows[0]?.user_name ||
    'طالب';

  return {
    student_name,
    student_email: '', // privacy: never expose email to parent QR page
    grade_level,
    activated: true,
    level_label: grade_level || '',
    stats: {
      commitment_percent: commitment,
      lessons_completed: completed,
      lessons_in_progress: inProg,
      lessons_not_started: notStart,
      lessons_total: total,
      attendance_points: Number(profile?.total_points || 0) || 0,
      attendance_streak: streak,
      quizzes_taken: quizRows.length,
      quizzes_passed: quizRows.filter((r) => Number(r.percentage || 0) >= 50).length,
      average_score: avgScore,
      best_score: bestScore,
      total_points: Number(profile?.total_points || 0) || 0,
    },
    lessons,
    quiz_results,
    message: '',
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'parent-track', limit: 90, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    // ---------- Public parent view (no auth) ----------
    if (req.method === 'GET' && (req.query?.token || req.query?.t)) {
      const token = String(req.query.token || req.query.t || '').trim().toLowerCase();
      if (!token || token.length < 20 || token.length > 128 || !/^[a-f0-9]+$/.test(token)) {
        return res.status(400).json({ error: 'رمز المتابعة غير صالح' });
      }

      const { data: row, error } = await supabase
        .from('parent_track_tokens')
        .select('*')
        .eq('token', token)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      if (!row) return res.status(404).json({ error: 'رمز المتابعة غير موجود أو ملغى' });

      // Resolve user via redemption if not stored
      let userId = row.user_id || '';
      if (!userId && row.access_code_id) {
        const { data: red } = await supabase
          .from('code_redemptions')
          .select('user_id, student_name')
          .eq('code_id', Number(row.access_code_id))
          .order('redeemed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (red?.user_id) {
          userId = String(red.user_id);
          // Best-effort backfill (non-breaking)
          try {
            await supabase
              .from('parent_track_tokens')
              .update({
                user_id: userId,
                student_name: sanitizeText(red.student_name || row.student_name || '', 120),
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);
          } catch {
            /* ignore */
          }
        }
      }

      const summary = await loadParentSummary(userId, {
        student_name: row.student_name || '',
        grade_level: row.grade_level || '',
      });

      return res.status(200).json({
        ok: true,
        token_active: true,
        ...summary,
      });
    }

    // ---------- Admin: list tokens / ensure / regenerate ----------
    if (req.method === 'GET') {
      const a = await requireAdmin(req, res);
      if (!a) return;

      const codeId = req.query?.access_code_id ? Number(req.query.access_code_id) : null;
      if (codeId) {
        const { data, error } = await supabase
          .from('parent_track_tokens')
          .select('*')
          .eq('access_code_id', codeId)
          .order('id', { ascending: false });
        if (error) throw error;
        return res.status(200).json(data || []);
      }

      const { data, error } = await supabase
        .from('parent_track_tokens')
        .select('*')
        .eq('is_active', true)
        .order('id', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const action = String(body.action || 'ensure');

      // ensure tokens for one or many access codes
      if (action === 'ensure' || action === 'create') {
        const ids = Array.isArray(body.access_code_ids)
          ? body.access_code_ids.map(Number).filter(Boolean)
          : body.access_code_id
            ? [Number(body.access_code_id)]
            : [];
        if (!ids.length) return res.status(400).json({ error: 'معرّف كود الوصول مطلوب' });

        const created = [];
        for (const id of ids) {
          const existing = await getActiveTokenForCode(id);
          if (existing && action === 'ensure') {
            created.push(existing);
            continue;
          }
          const { data: codeRow, error: cErr } = await supabase
            .from('access_codes')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          if (cErr) throw cErr;
          if (!codeRow) continue;
          if (existing && action === 'create') {
            await revokeToken(existing.id);
          }
          const tok = await createTokenForCode(codeRow);
          created.push(tok);
        }
        return res.status(201).json({ ok: true, tokens: created });
      }

      if (action === 'regenerate') {
        const codeId = Number(body.access_code_id);
        if (!codeId) return res.status(400).json({ error: 'معرّف كود الوصول مطلوب' });
        const existing = await getActiveTokenForCode(codeId);
        if (existing) await revokeToken(existing.id);
        const { data: codeRow, error: cErr } = await supabase
          .from('access_codes')
          .select('*')
          .eq('id', codeId)
          .single();
        if (cErr) throw cErr;
        const tok = await createTokenForCode(codeRow);
        return res.status(201).json({ ok: true, token: tok });
      }

      if (action === 'revoke') {
        const codeId = Number(body.access_code_id);
        const tokenId = Number(body.token_id);
        if (tokenId) {
          await revokeToken(tokenId);
          return res.status(200).json({ ok: true });
        }
        if (codeId) {
          const existing = await getActiveTokenForCode(codeId);
          if (existing) await revokeToken(existing.id);
          return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'المعرف مطلوب' });
      }

      return res.status(400).json({ error: 'إجراء غير معروف' });
    }

    return methodNotAllowed(res);
  } catch (err) {
    console.error('parent-track API error:', err);
    return serverError(res, err, 'parent-track');
  }
}
