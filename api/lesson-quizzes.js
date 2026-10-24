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
  asPositiveInt,
  methodNotAllowed,
  serverError,
} from './security.js';

function clampInt(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function getLinkedQuizId(lessonId) {
  try {
    const { data } = await supabase
      .from('lesson_attendance_settings')
      .select('linked_quiz_id')
      .eq('lesson_id', lessonId)
      .maybeSingle();
    return data?.linked_quiz_id ? Number(data.linked_quiz_id) : null;
  } catch {
    return null;
  }
}

async function enrichRows(rows = []) {
  if (!rows.length) return [];
  const lessonIds = [...new Set(rows.map((r) => Number(r.lesson_id)).filter(Boolean))];
  const quizIds = [...new Set(rows.map((r) => Number(r.quiz_id)).filter(Boolean))];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

  const [{ data: lessons }, { data: quizzes }, { data: profiles }] = await Promise.all([
    lessonIds.length
      ? supabase.from('lessons').select('id, title, title_ar, course_id').in('id', lessonIds)
      : Promise.resolve({ data: [] }),
    quizIds.length
      ? supabase.from('quizzes').select('id, title, title_ar').in('id', quizIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const lessonMap = Object.fromEntries((lessons || []).map((l) => [Number(l.id), l]));
  const quizMap = Object.fromEntries((quizzes || []).map((q) => [Number(q.id), q]));
  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  return rows.map((row) => {
    const lesson = lessonMap[Number(row.lesson_id)] || {};
    const quiz = quizMap[Number(row.quiz_id)] || {};
    const profile = profileMap[row.user_id] || {};
    return {
      ...row,
      lesson_title: lesson.title_ar || lesson.title || `درس #${row.lesson_id}`,
      quiz_title: quiz.title_ar || quiz.title || `اختبار #${row.quiz_id}`,
      student_name: profile.full_name || '',
      student_email: profile.email || '',
      course_id: lesson.course_id || null,
    };
  });
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'lesson-quizzes', limit: 90, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const authUser = await getAuthUser(req);
      if (!authUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

      const profile = await getProfile(authUser.id);
      const staff = isStaffRole(profile?.role);
      const { lesson_id, quiz_id, user_id, admin } = req.query || {};

      let query = supabase
        .from('lesson_quiz_records')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(300);

      if (staff && admin === 'true') {
        if (user_id) query = query.eq('user_id', String(user_id));
      } else {
        query = query.eq('user_id', authUser.id);
      }
      if (lesson_id) query = query.eq('lesson_id', Number(lesson_id));
      if (quiz_id) query = query.eq('quiz_id', Number(quiz_id));

      const { data, error } = await query;
      if (error) throw error;
      const rows = await enrichRows(data || []);
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const body = req.body || {};
      const action = String(body.action || 'start').toLowerCase();
      const lessonId = asPositiveInt(body.lesson_id);
      let quizId = asPositiveInt(body.quiz_id);

      if (!lessonId) return res.status(400).json({ error: 'معرّف الحصة مطلوب' });

      if (!quizId) {
        quizId = await getLinkedQuizId(lessonId);
      }
      if (!quizId) {
        return res.status(400).json({ error: 'لا يوجد اختبار مرتبط بهذه الحصة' });
      }

      // Verify quiz exists (do not change quiz system)
      const { data: quiz, error: quizErr } = await supabase
        .from('quizzes')
        .select('id, title, title_ar')
        .eq('id', quizId)
        .maybeSingle();
      if (quizErr) throw quizErr;
      if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود' });

      const now = new Date().toISOString();

      if (action === 'start') {
        // Prefer open attempt; else create new
        const { data: openRows } = await supabase
          .from('lesson_quiz_records')
          .select('*')
          .eq('user_id', user.id)
          .eq('lesson_id', lessonId)
          .eq('quiz_id', quizId)
          .eq('status', 'started')
          .order('started_at', { ascending: false })
          .limit(1);

        const open = Array.isArray(openRows) ? openRows[0] : openRows;
        if (open?.id) {
          const { data, error } = await supabase
            .from('lesson_quiz_records')
            .update({ updated_at: now, started_at: open.started_at || now })
            .eq('id', open.id)
            .select()
            .single();
          if (error) throw error;
          return res.status(200).json({
            ...data,
            quiz_title: quiz.title_ar || quiz.title,
            action: 'start',
          });
        }

        const { data, error } = await supabase
          .from('lesson_quiz_records')
          .insert({
            user_id: user.id,
            lesson_id: lessonId,
            quiz_id: quizId,
            started_at: now,
            status: 'started',
            score: null,
            total_questions: null,
            correct_answers: null,
            percentage: null,
            result_id: null,
            completed_at: null,
            created_at: now,
            updated_at: now,
          })
          .select()
          .single();
        if (error) throw error;
        return res.status(201).json({
          ...data,
          quiz_title: quiz.title_ar || quiz.title,
          action: 'start',
        });
      }

      if (action === 'complete') {
        // Prefer authoritative quiz_results row owned by this user (anti-tamper).
        // Falls back to client fields only when no result_id (legacy / optional flow).
        let score = clampInt(body.score, 0, 100000, 0);
        let totalQuestions = clampInt(body.total_questions, 0, 100000, 0);
        let correctAnswers = clampInt(
          body.correct_answers != null ? body.correct_answers : score,
          0,
          100000,
          score
        );
        let percentage =
          body.percentage != null && Number.isFinite(Number(body.percentage))
            ? Math.min(100, Math.max(0, Number(body.percentage)))
            : totalQuestions > 0
              ? Math.round((score / totalQuestions) * 1000) / 10
              : 0;
        let resultId = body.result_id != null ? asPositiveInt(body.result_id) : null;

        if (resultId) {
          const { data: resultRow } = await supabase
            .from('quiz_results')
            .select('id, user_id, quiz_id, score, total_questions, percentage')
            .eq('id', resultId)
            .maybeSingle();
          if (
            resultRow &&
            String(resultRow.user_id) === String(user.id) &&
            Number(resultRow.quiz_id) === Number(quizId)
          ) {
            score = Number(resultRow.score) || 0;
            totalQuestions = Number(resultRow.total_questions) || totalQuestions;
            percentage = Number(resultRow.percentage) || 0;
            correctAnswers = score;
          } else {
            // Ignore spoofed result_id
            resultId = null;
          }
        }

        // Update latest started row, else insert completed row
        const { data: openRows } = await supabase
          .from('lesson_quiz_records')
          .select('*')
          .eq('user_id', user.id)
          .eq('lesson_id', lessonId)
          .eq('quiz_id', quizId)
          .order('started_at', { ascending: false })
          .limit(1);

        const open = Array.isArray(openRows) ? openRows[0] : openRows;
        const payload = {
          user_id: user.id,
          lesson_id: lessonId,
          quiz_id: quizId,
          status: 'completed',
          score,
          total_questions: totalQuestions,
          correct_answers: correctAnswers,
          percentage,
          result_id: resultId,
          completed_at: now,
          updated_at: now,
          started_at: open?.started_at || body.started_at || now,
        };

        let record;
        if (open?.id && open.status !== 'completed') {
          const { data, error } = await supabase
            .from('lesson_quiz_records')
            .update(payload)
            .eq('id', open.id)
            .select()
            .single();
          if (error) throw error;
          record = data;
        } else {
          // Already completed latest — still record a new completion snapshot
          const { data, error } = await supabase
            .from('lesson_quiz_records')
            .insert({ ...payload, created_at: now })
            .select()
            .single();
          if (error) throw error;
          record = data;
        }

        // Mark lesson attendance completed after quiz finish (any score).
        // Does not require a passing grade. Does not modify the quiz engine.
        let attendanceMarked = false;
        try {
          const { data: lesson } = await supabase
            .from('lessons')
            .select('id, course_id')
            .eq('id', lessonId)
            .maybeSingle();

          const { data: existingAtt } = await supabase
            .from('lesson_attendance')
            .select('id, status')
            .eq('user_id', user.id)
            .eq('lesson_id', lessonId)
            .maybeSingle();

          const attPayload = {
            user_id: user.id,
            lesson_id: lessonId,
            course_id: lesson?.course_id || null,
            status: 'completed',
            note: `حضور بعد إنهاء اختبار الحصة (درجة ${percentage}% · صحيحة ${correctAnswers}/${totalQuestions})`,
            attended_at: now,
            marked_by: user.id,
          };

          if (existingAtt?.id) {
            if (existingAtt.status !== 'completed') {
              await supabase.from('lesson_attendance').update(attPayload).eq('id', existingAtt.id);
              attendanceMarked = true;
            }
          } else {
            await supabase.from('lesson_attendance').insert({
              ...attPayload,
              created_at: now,
            });
            attendanceMarked = true;
          }

          // Close external session if any
          await supabase
            .from('lesson_external_sessions')
            .update({
              completed: true,
              is_active: false,
              session_status: 'completed',
              ended_at: now,
              updated_at: now,
              note: 'اكتملت بعد إنهاء اختبار الحصة',
            })
            .eq('user_id', user.id)
            .eq('lesson_id', lessonId)
            .eq('completed', false);
        } catch (attErr) {
          console.error('mark attendance after lesson quiz failed:', attErr?.message || attErr);
        }

        return res.status(open?.id && open.status !== 'completed' ? 200 : 201).json({
          ...record,
          quiz_title: quiz.title_ar || quiz.title,
          action: 'complete',
          attendance_marked: attendanceMarked,
        });
      }

      return res.status(400).json({ error: 'إجراء غير معروف (start | complete)' });
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const id = asPositiveInt(req.body?.id || req.query?.id);
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      const { error } = await supabase.from('lesson_quiz_records').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'lesson-quizzes');
  }
}
