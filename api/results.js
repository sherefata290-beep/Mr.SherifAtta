import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAuth,
  requireAdmin,
  getAuthUser,
  sanitizeText,
  methodNotAllowed,
  serverError,
  getQuizGradeMap,
  getUserGradeLevel,
  getUserHasAccess,
  isStaffRole,
  getProfile,
} from './security.js';

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '');
}

function normalizePunctuationText(value) {
  return String(value || '')
    .trim()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .toLowerCase();
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((v) => normalizeText(v)).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split('|')
      .map((v) => normalizeText(v))
      .filter(Boolean);
  }
  return [];
}

function listsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

function matchBlankAnswer(expectedRaw, givenRaw) {
  const given = normalizeText(givenRaw);
  if (!given) return false;
  const alternatives = String(expectedRaw || '')
    .split('/')
    .map((s) => normalizeText(s))
    .filter(Boolean);
  return alternatives.includes(given);
}

function countWords(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

async function loadQuestionsWithType(quizId) {
  const { data: questions, error } = await supabase.from('questions').select('*').eq('quiz_id', quizId);
  if (error) throw error;
  if (!questions?.length) return [];

  const { data: extras } = await supabase
    .from('question_extras')
    .select('*')
    .in(
      'question_id',
      questions.map((q) => q.id)
    );

  const map = Object.fromEntries((extras || []).map((e) => [e.question_id, e]));
  return questions.map((q) => {
    const extra = map[q.id];
    return {
      ...q,
      question_type: extra?.question_type || 'multiple_choice',
      passage_text: extra?.passage_text || '',
      word_bank: parseJsonField(extra?.word_bank, []),
      answer_data: parseJsonField(extra?.answer_data, null),
    };
  });
}

function isAnswerCorrect(question, userAnswer) {
  const type = question.question_type || 'multiple_choice';

  if (type === 'complete_text') {
    let expectedSource = question.answer_data;
    if (!Array.isArray(expectedSource) || !expectedSource.length) {
      expectedSource = question.correct_answer;
    } else if (
      expectedSource.length === 1 &&
      /^[a-d]$/i.test(String(expectedSource[0] || '').trim()) &&
      question.correct_answer &&
      !/^[a-d]$/i.test(String(question.correct_answer).trim())
    ) {
      // Recover from older bad saves where answer_data was leftover MCQ letter
      expectedSource = question.correct_answer;
    }
    const expected = normalizeList(expectedSource);
    const given = normalizeList(userAnswer);
    return listsEqual(expected, given);
  }

  if (type === 'word_form') {
    const expectedList = Array.isArray(question.answer_data?.blanks)
      ? question.answer_data.blanks
      : String(question.correct_answer || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
    const givenList = Array.isArray(userAnswer)
      ? userAnswer
      : String(userAnswer || '')
          .split('|')
          .map((s) => s.trim());
    if (!expectedList.length) return false;
    if (givenList.length !== expectedList.length) return false;
    return expectedList.every((exp, i) => matchBlankAnswer(exp, givenList[i]));
  }

  if (type === 'rewrite_brackets') {
    const expectedList = Array.isArray(question.answer_data?.model_answers)
      ? question.answer_data.model_answers
      : String(question.correct_answer || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
    const givenList = Array.isArray(userAnswer)
      ? userAnswer.map((s) => String(s || '').trim())
      : String(userAnswer || '')
          .split('|')
          .map((s) => s.trim());
    if (!expectedList.length) return false;
    if (givenList.length !== expectedList.length) return false;
    // Allow slash alternatives and flexible punctuation/case via normalizeText
    return expectedList.every((exp, i) => {
      const alternatives = String(exp || '')
        .split('/')
        .map((s) => normalizeText(s))
        .filter(Boolean);
      const given = normalizeText(givenList[i]);
      return !!given && alternatives.includes(given);
    });
  }

  if (type === 'word_order') {
    const rawSentence = [question.answer_data?.correct_sentence, question.correct_answer]
      .map((s) => String(s ?? '').trim())
      .find((s) => s && !/^[a-d]$/i.test(s)) || '';
    const expected = normalizeText(rawSentence);
    const given = normalizeText(
      Array.isArray(userAnswer) ? userAnswer.join(' ') : userAnswer
    );
    return !!expected && expected === given;
  }

  if (type === 'punctuate') {
    const expected = normalizePunctuationText(
      question.answer_data?.model_answer || question.correct_answer
    );
    const given = normalizePunctuationText(userAnswer);
    return !!expected && expected === given;
  }

  if (type === 'paragraph') {
    const min = Number(question.answer_data?.min_words || 50);
    const max = Number(question.answer_data?.max_words || 60);
    const words = countWords(userAnswer);
    return words >= min && words <= max;
  }

  if (type === 'reading_comprehension') {
    const mode = question.answer_data?.answer_mode === 'essay' ? 'essay' : 'multiple_choice';
    if (mode === 'essay') {
      const model = normalizeText(question.answer_data?.model_answer || question.correct_answer);
      const given = normalizeText(userAnswer);
      if (model && given && model === given) return true;
      // If no exact model, accept any non-empty essay within word range
      const min = Number(question.answer_data?.min_words || 20);
      const max = Number(question.answer_data?.max_words || 150);
      const words = countWords(userAnswer);
      if (!model) return words >= Math.min(min, 5) && words <= max;
      return false;
    }
    return String(userAnswer) === String(question.correct_answer);
  }

  if (type === 'listening') {
    const tfExpected = Array.isArray(question.answer_data?.true_false)
      ? question.answer_data.true_false
      : [];
    const blanksExpected = Array.isArray(question.answer_data?.complete_blanks)
      ? question.answer_data.complete_blanks
      : [];
    const tfGiven = Array.isArray(userAnswer?.true_false) ? userAnswer.true_false : [];
    const blanksGiven = Array.isArray(userAnswer?.complete_blanks) ? userAnswer.complete_blanks : [];

    if (tfExpected.length < 2 || blanksExpected.length < 3) return false;

    const tfOk = tfExpected.every((row, i) => {
      const exp = String(row?.answer || 'T').trim().toUpperCase().startsWith('F') ? 'F' : 'T';
      const got = String(tfGiven[i] || '').trim().toUpperCase().startsWith('F') ? 'F' : String(tfGiven[i] || '').trim().toUpperCase().startsWith('T') ? 'T' : '';
      return exp === got;
    });
    if (!tfOk) return false;

    return blanksExpected.every((row, i) => matchBlankAnswer(row?.answer || '', blanksGiven[i]));
  }

  // multiple_choice
  return String(userAnswer) === String(question.correct_answer);
}

function formatCorrectAnswer(question) {
  const type = question.question_type || 'multiple_choice';
  if (type === 'complete_text') {
    if (Array.isArray(question.answer_data)) return question.answer_data.join(' | ');
    return String(question.correct_answer || '').replace(/\|/g, ' | ');
  }
  if (type === 'word_form') {
    if (Array.isArray(question.answer_data?.blanks)) return question.answer_data.blanks.join(' | ');
    return String(question.correct_answer || '').replace(/\|/g, ' | ');
  }
  if (type === 'rewrite_brackets') {
    if (Array.isArray(question.answer_data?.model_answers)) return question.answer_data.model_answers.join(' | ');
    return String(question.correct_answer || '').replace(/\|/g, ' | ');
  }
  if (type === 'word_order') {
    return (
      [question.answer_data?.correct_sentence, question.correct_answer]
        .map((s) => String(s ?? '').trim())
        .find((s) => s && !/^[a-d]$/i.test(s)) ||
      question.correct_answer ||
      ''
    );
  }
  if (type === 'punctuate') {
    return question.answer_data?.model_answer || question.correct_answer || '—';
  }
  if (type === 'paragraph') {
    const min = question.answer_data?.min_words || 50;
    const max = question.answer_data?.max_words || 60;
    return `Paragraph between ${min}-${max} words`;
  }
  if (type === 'reading_comprehension') {
    if (question.answer_data?.answer_mode === 'essay') {
      return question.answer_data?.model_answer || question.correct_answer || 'Essay answer (open response)';
    }
    const key = question.correct_answer;
    return question[`option_${key}`] || key;
  }
  if (type === 'multiple_choice') {
    const key = question.correct_answer;
    return question[`option_${key}`] || key;
  }
  if (type === 'listening') {
    const tf = Array.isArray(question.answer_data?.true_false)
      ? question.answer_data.true_false.map((r, i) => `${i + 1}) ${r.answer || '?'}`).join(' · ')
      : '';
    const blanks = Array.isArray(question.answer_data?.complete_blanks)
      ? question.answer_data.complete_blanks.map((r, i) => `${i + 1}) ${r.answer || '?'}`).join(' · ')
      : '';
    return `A: ${tf} | B: ${blanks}`;
  }
  return question.correct_answer;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'results', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { user_id, quiz_id, id } = req.query;
      const authUser = await getAuthUser(req);
      let isAdmin = false;
      if (authUser) {
        const { data: me } = await supabase.from('profiles').select('role').eq('id', authUser.id).maybeSingle();
        isAdmin = ['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support'].includes(me?.role);
      }

      if (id) {
        const { data, error } = await supabase.from('quiz_results').select('*').eq('id', id).single();
        if (error) throw error;
        if (!isAdmin && data.user_id !== authUser?.id) {
          return res.status(403).json({ error: 'غير مصرح' });
        }
        return res.status(200).json(data);
      }

      // list: admin can see all; student only own
      if (isAdmin) {
        let query = supabase.from('quiz_results').select('*').order('completed_at', { ascending: false });
        if (user_id) query = query.eq('user_id', user_id);
        if (quiz_id) query = query.eq('quiz_id', quiz_id);
        const { data, error } = await query.limit(500);
        if (error) throw error;
        return res.status(200).json(data);
      }

      if (!authUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
      let query = supabase
        .from('quiz_results')
        .select('id, user_id, quiz_id, user_name, score, total_questions, percentage, completed_at')
        .eq('user_id', authUser.id)
        .order('completed_at', { ascending: false });
      if (quiz_id) query = query.eq('quiz_id', quiz_id);
      const { data, error } = await query.limit(100);
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const submitRl = rateLimit(req, { key: 'results-submit', limit: 15, windowMs: 60_000 });
      if (!submitRl.ok) return rejectRateLimit(res, submitRl.retryAfter);

      const { quiz_id, user_name, answers } = req.body || {};
      if (!quiz_id || !answers || typeof answers !== 'object') {
        return res.status(400).json({ error: 'بيانات غير مكتملة' });
      }

      // Students must redeem access code and match quiz grade before submitting
      const profile = await getProfile(user.id);
      const staff = isStaffRole(profile?.role);
      if (!staff) {
        const hasAccess = await getUserHasAccess(user.id);
        if (!hasAccess) {
          return res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً قبل تسليم الاختبار' });
        }
        const studentGrade = await getUserGradeLevel(user.id);
        if (!studentGrade) {
          return res.status(403).json({ error: 'يجب إدخال كود الوصول أولاً قبل تسليم الاختبار' });
        }
        const gradeMap = await getQuizGradeMap([Number(quiz_id)]);
        const quizGrade = gradeMap[Number(quiz_id)] || '';
        if (!quizGrade || quizGrade !== studentGrade) {
          return res.status(403).json({ error: 'هذا الاختبار غير متاح لصفك الدراسي' });
        }
      }

      // Attempts limit from quiz_settings (default 1)
      let maxAttempts = 1;
      let passPercentage = 50;
      try {
        const { data: settings } = await supabase
          .from('quiz_settings')
          .select('max_attempts, pass_percentage')
          .eq('quiz_id', Number(quiz_id))
          .maybeSingle();
        if (settings) {
          const ma = Number(settings.max_attempts);
          const pp = Number(settings.pass_percentage);
          if (Number.isFinite(ma) && ma >= 1) maxAttempts = Math.min(Math.floor(ma), 50);
          if (Number.isFinite(pp)) passPercentage = Math.min(Math.max(Math.floor(pp), 0), 100);
        }
      } catch {}

      const { data: existingAttempts, error: existingErr } = await supabase
        .from('quiz_results')
        .select('id, percentage, score, total_questions, completed_at')
        .eq('user_id', user.id)
        .eq('quiz_id', Number(quiz_id))
        .order('completed_at', { ascending: false });
      if (existingErr) throw existingErr;
      const attemptsUsed = existingAttempts?.length || 0;
      if (attemptsUsed >= maxAttempts) {
        return res.status(409).json({
          error: `لقد استهلكت الحد الأقصى من المحاولات (${maxAttempts}) لهذا الاختبار`,
          already_completed: true,
          max_attempts: maxAttempts,
          attempts_used: attemptsUsed,
          previous: existingAttempts?.[0] || null,
        });
      }

      // Anti-tamper: score is ALWAYS computed server-side from DB answers
      const questions = await loadQuestionsWithType(quiz_id);
      if (!questions.length) return res.status(400).json({ error: 'لا توجد أسئلة لهذا الاختبار' });

      let score = 0;
      let totalPoints = 0;
      const correctMap = {};
      const detailMap = {};

      questions.forEach((q) => {
        const pts = q.points || 1;
        totalPoints += pts;
        const userAns = answers[q.id] ?? answers[String(q.id)];
        const ok = isAnswerCorrect(q, userAns);
        if (ok) score += pts;
        correctMap[q.id] = q.correct_answer;
        detailMap[q.id] = {
          correct: ok,
          correct_display: formatCorrectAnswer(q),
          question_type: q.question_type || 'multiple_choice',
        };
      });

      const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
      const safeName = sanitizeText(user_name || user.email?.split('@')[0] || 'طالب', 80);

      const { data, error } = await supabase
        .from('quiz_results')
        .insert({
          user_id: user.id, // force authenticated user id — ignore client spoofing
          quiz_id: Number(quiz_id),
          user_name: safeName,
          score,
          total_questions: questions.length,
          percentage,
          answers,
          completed_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;

      // Points: only credit the improvement over previous best score for this quiz.
      // Prevents multi-attempt quizzes from inflating total_points repeatedly.
      const previousBest = (existingAttempts || []).reduce(
        (best, row) => Math.max(best, Number(row.score) || 0),
        0
      );
      const pointsDelta = Math.max(0, score - previousBest);
      if (pointsDelta > 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('total_points')
          .eq('id', user.id)
          .maybeSingle();
        if (profile) {
          await supabase
            .from('profiles')
            .update({ total_points: (profile.total_points || 0) + pointsDelta })
            .eq('id', user.id);
        }
      }

      const passed = percentage >= passPercentage;

      // Highest score/percentage across all attempts (including this one)
      const bestScore = Math.max(
        score,
        ...(existingAttempts || []).map((row) => Number(row.score) || 0)
      );
      const bestPercentage = Math.max(
        percentage,
        ...(existingAttempts || []).map((row) => Number(row.percentage) || 0)
      );

      return res.status(201).json({
        ...data,
        correct_answers: correctMap,
        answer_details: detailMap,
        passed,
        pass_percentage: passPercentage,
        max_attempts: maxAttempts,
        attempts_used: attemptsUsed + 1,
        attempts_remaining: Math.max(maxAttempts - (attemptsUsed + 1), 0),
        best_score: bestScore,
        best_percentage: bestPercentage,
      });
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      // Load row first so we can recompute points contribution (no silent orphan delete)
      const { data: row, error: fetchErr } = await supabase
        .from('quiz_results')
        .select('id, user_id, quiz_id, score')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!row) return res.status(404).json({ error: 'النتيجة غير موجودة' });

      const { error } = await supabase.from('quiz_results').delete().eq('id', id);
      if (error) throw error;

      // Recompute quiz contribution: total_points keeps attendance awards;
      // adjust only the delta this attempt added vs remaining best for same quiz.
      try {
        if (row.user_id && row.quiz_id != null) {
          const { data: remaining } = await supabase
            .from('quiz_results')
            .select('score')
            .eq('user_id', row.user_id)
            .eq('quiz_id', row.quiz_id);
          const bestRemaining = (remaining || []).reduce(
            (b, r) => Math.max(b, Number(r.score) || 0),
            0
          );
          const removedScore = Number(row.score) || 0;
          // Points originally credited = max(0, score - previousBest).
          // After delete, credit should be bestRemaining. If removed was the unique best,
          // subtract (removedScore - bestRemaining).
          const retract = Math.max(0, removedScore - bestRemaining);
          if (retract > 0) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('total_points')
              .eq('id', row.user_id)
              .maybeSingle();
            if (profile) {
              const next = Math.max(0, Number(profile.total_points || 0) - retract);
              await supabase.from('profiles').update({ total_points: next }).eq('id', row.user_id);
            }
          }
        }
      } catch (ptsErr) {
        console.error('points adjust on result delete failed:', ptsErr?.message || ptsErr);
      }

      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'results');
  }
}
