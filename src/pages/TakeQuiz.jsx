import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, XCircle, Trophy, RotateCcw, GripVertical, Lock, FileText, Download } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import AccessGate from '../components/AccessGate';
import WinampPlayer from '../components/WinampPlayer';
import { useAuth } from '../contexts/AuthContext';
import { useQuizLock } from '../contexts/QuizLockContext';
import { apiFetch, notifyDataChanged } from '../lib/api';
import { isStaffRole } from '../lib/roles';

const TYPE_LABELS = {
  multiple_choice: 'Multiple Choice',
  complete_text: 'Read and complete the text with the words in the box',
  reading_comprehension: 'Read the text and answer the questions',
  word_order: 'Put the words in the correct order to make sentences',
  word_form: 'Read and write the correct form of the word[s] between brackets',
  rewrite_brackets: 'Rewrite the following sentences using the word(s) in brackets',
  punctuate: 'Punctuate the following sentences',
  paragraph: 'Write a paragraph of (50-60) words using guiding elements',
  listening: 'Listening — True/False + Complete',
};

function formatUserAnswer(q, userAns) {
  if (userAns == null || userAns === '') return '—';
  const type = q.question_type || 'multiple_choice';
  if (type === 'multiple_choice') {
    return q[`option_${userAns}`] || String(userAns);
  }
  if (type === 'reading_comprehension') {
    if (q.answer_data?.answer_mode === 'essay') {
      const words = String(userAns || '').trim().split(/\s+/).filter(Boolean).length;
      return `${String(userAns).slice(0, 120)}${String(userAns).length > 120 ? '…' : ''} (${words} words)`;
    }
    return q[`option_${userAns}`] || String(userAns);
  }
  if (type === 'complete_text' || type === 'word_form' || type === 'rewrite_brackets') {
    return Array.isArray(userAns) ? userAns.join(' | ') : String(userAns);
  }
  if (type === 'word_order') {
    return Array.isArray(userAns) ? userAns.join(' ') : String(userAns);
  }
  if (type === 'paragraph') {
    const words = String(userAns || '').trim().split(/\s+/).filter(Boolean).length;
    return `${String(userAns).slice(0, 120)}${String(userAns).length > 120 ? '…' : ''} (${words} words)`;
  }
  if (type === 'listening') {
    const tf = Array.isArray(userAns?.true_false) ? userAns.true_false.join(' · ') : '—';
    const blanks = Array.isArray(userAns?.complete_blanks) ? userAns.complete_blanks.join(' · ') : '—';
    return `A: ${tf} | B: ${blanks}`;
  }
  return String(userAns);
}

function splitPassageBlanks(passage = '') {
  // Split by ___ patterns
  const parts = String(passage).split(/_{2,}/);
  const blankCount = Math.max(parts.length - 1, 0);
  return { parts, blankCount };
}

function countBracketBlanks(passage = '') {
  const matches = String(passage).match(/\([^)]+\)/g);
  return matches ? matches.length : 0;
}

function countWords(text = '') {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export default function TakeQuiz() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const lessonIdParam = searchParams.get('lesson_id');
  const { user, profile, refreshProfile } = useAuth();
  const { lockQuiz, unlockQuiz } = useQuizLock();
  const navigate = useNavigate();
  const lessonStartLoggedRef = useRef(false);
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [alreadyDone, setAlreadyDone] = useState(null);
  const [attemptInfo, setAttemptInfo] = useState({ used: 0, max: 1, bestPercentage: null, bestScore: null });
  const [sessionActive, setSessionActive] = useState(false);
  // Prevents auto-starting the next attempt after submit when profile refreshes
  const completedRef = useRef(false);
  const loadedQuizIdRef = useRef(null);
  const profileReadyRef = useRef(false);

  const startFreshAttempt = () => {
    completedRef.current = false;
    setResult(null);
    setAlreadyDone(null);
    setAnswers({});
    setCurrent(0);
    setError('');
    setSessionActive(false);
    setLoading(true);
    // Force reload for the same quiz id
    loadedQuizIdRef.current = null;
    profileReadyRef.current = false;
    // Trigger effect by toggling a dummy via re-run path below
    void loadQuizSession({ force: true });
  };

  const loadQuizSession = async ({ force = false } = {}) => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!profile) return;

    const isStaff = isStaffRole(profile?.role);

    // Do not reload / clear result screen after a finished attempt
    // unless the student explicitly starts a new attempt.
    if (!force && completedRef.current) return;
    if (!force && result) return;

    // Block students without redeemed access code
    if (!isStaff && !profile?.has_access) {
      setLoading(false);
      setError('يجب إدخال كود الوصول أولاً لفتح الاختبار');
      unlockQuiz();
      return;
    }

    // Avoid reloading the same quiz just because profile object identity changed
    if (!force && loadedQuizIdRef.current === String(id) && profileReadyRef.current) {
      return;
    }

    setLoading(true);
    setError('');
    if (force) {
      setAlreadyDone(null);
      setResult(null);
      setSessionActive(false);
    }

    try {
      const adminQ = isStaff ? '&admin=true' : '';
      const [qRes, qsRes, prevRes] = await Promise.all([
        apiFetch(`/api/quizzes?id=${encodeURIComponent(id)}${adminQ}`),
        apiFetch(`/api/questions?quiz_id=${encodeURIComponent(id)}&hide_answers=true`),
        isStaff
          ? Promise.resolve(null)
          : apiFetch(`/api/results?quiz_id=${encodeURIComponent(id)}`),
      ]);
      const q = await qRes.json();
      const qs = await qsRes.json();
      if (!qRes.ok) throw new Error(q?.error || 'فشل تحميل الاختبار');
      if (!qsRes.ok) throw new Error(qs?.error || 'فشل تحميل الأسئلة');

      const maxAttempts = Number(q.max_attempts) > 0 ? Number(q.max_attempts) : 1;
      let used = 0;
      let latest = null;
      let bestPercentage = null;
      let bestScore = null;
      let prevAttempts = [];
      if (prevRes) {
        const prevData = await prevRes.json();
        if (prevRes.ok && Array.isArray(prevData)) {
          prevAttempts = prevData;
          used = prevData.length;
          latest = prevData[0] || null;
          if (prevData.length) {
            bestPercentage = prevData.reduce(
              (best, row) => Math.max(best, Number(row.percentage) || 0),
              0
            );
            bestScore = prevData.reduce(
              (best, row) => Math.max(best, Number(row.score) || 0),
              0
            );
          }
        }
      }

      setAttemptInfo({ used, max: maxAttempts, bestPercentage, bestScore, attempts: prevAttempts });
      setQuiz(q);
      loadedQuizIdRef.current = String(id);
      profileReadyRef.current = true;

      // Block if student used all allowed attempts — show summary, not a new quiz
      if (!isStaff && used >= maxAttempts) {
        setAlreadyDone({
          ...(latest || {}),
          percentage: bestPercentage != null ? bestPercentage : latest?.percentage ?? null,
          score: bestScore != null ? bestScore : latest?.score ?? null,
          best_percentage: bestPercentage,
          best_score: bestScore,
          attempts_used: used,
          max_attempts: maxAttempts,
        });
        unlockQuiz();
        setSessionActive(false);
        setLoading(false);
        return;
      }

      setQuestions(Array.isArray(qs) ? qs : []);
      setAnswers({});
      setCurrent(0);

      // Lock navigation only while an active attempt is running (students only)
      if (!isStaff) {
        lockQuiz(id);
        setSessionActive(true);
      }
    } catch (e) {
      setError(e.message || 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!profile) return;
    // Initial load or quiz id change only — profile refresh must NOT restart the attempt
    if (loadedQuizIdRef.current !== String(id)) {
      completedRef.current = false;
      lessonStartLoggedRef.current = false;
      setResult(null);
      setAlreadyDone(null);
      loadQuizSession({ force: true });
    } else if (!profileReadyRef.current) {
      loadQuizSession({ force: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, profile?.id, profile?.has_access, profile?.role]);

  // Log lesson-quiz start (optional linked quiz) — does not change quiz engine
  useEffect(() => {
    if (!user || !id || !lessonIdParam) return;
    if (lessonStartLoggedRef.current) return;
    if (!quiz || loading) return;
    lessonStartLoggedRef.current = true;
    apiFetch('/api/lesson-quizzes', {
      method: 'POST',
      body: JSON.stringify({
        action: 'start',
        lesson_id: Number(lessonIdParam),
        quiz_id: Number(id),
      }),
    }).catch(() => {
      /* non-blocking */
    });
  }, [user, id, lessonIdParam, quiz, loading]);

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      if (!confirm('لم تجب على كل الأسئلة. هل تريد التسليم الآن؟')) return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/api/results', {
        method: 'POST',
        body: JSON.stringify({
          quiz_id: Number(id),
          user_name: profile?.full_name || user.email,
          answers,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.already_completed) {
          unlockQuiz();
          setSessionActive(false);
          completedRef.current = true;
          setAlreadyDone(data.previous || true);
          throw new Error(data.error || 'لقد أنهيت هذا الاختبار مسبقاً');
        }
        throw new Error(data.error || 'فشل حفظ النتيجة');
      }
      unlockQuiz();
      setSessionActive(false);
      // Mark completed BEFORE refreshProfile so effect cannot start next attempt
      completedRef.current = true;
      const usedNow = Number(data.attempts_used) || ((attemptInfo.used || 0) + 1);
      const maxNow = Number(data.max_attempts) || attemptInfo.max || 1;
      const bestPct = Math.max(
        Number(data.best_percentage) || 0,
        Number(data.percentage) || 0,
        Number(attemptInfo.bestPercentage) || 0
      );
      const bestScr = Math.max(
        Number(data.best_score) || 0,
        Number(data.score) || 0,
        Number(attemptInfo.bestScore) || 0
      );
      setAttemptInfo((prev) => ({
        ...prev,
        used: usedNow,
        max: maxNow,
        bestPercentage: bestPct,
        bestScore: bestScr,
      }));
      setResult({
        ...data,
        best_percentage: bestPct,
        best_score: bestScr,
        attempts_used: usedNow,
        max_attempts: maxNow,
        attempts_remaining: Math.max(maxNow - usedNow, 0),
      });

      // Record lesson-linked quiz completion + mark attendance (any score)
      if (lessonIdParam) {
        const totalQ = Number(data.total_questions) || questions.length || 0;
        const scoreVal = Number(data.score) || 0;
        try {
          await apiFetch('/api/lesson-quizzes', {
            method: 'POST',
            body: JSON.stringify({
              action: 'complete',
              lesson_id: Number(lessonIdParam),
              quiz_id: Number(id),
              result_id: data.id || data.result_id || null,
              score: scoreVal,
              total_questions: totalQ,
              correct_answers: scoreVal,
              percentage: Number(data.percentage) || bestPct || 0,
            }),
          });
        } catch {
          /* non-blocking for quiz result display */
        }
      }

      // Soft refresh — must not restart quiz session
      refreshProfile();
      notifyDataChanged({ source: 'quiz-result', lesson_id: lessonIdParam || null });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  if (alreadyDone) {
    const maxA = attemptInfo.max || alreadyDone.max_attempts || 1;
    const usedA = attemptInfo.used || alreadyDone.attempts_used || 0;
    const bestPct = alreadyDone.best_percentage ?? attemptInfo.bestPercentage ?? alreadyDone.percentage;
    const bestScr = alreadyDone.best_score ?? attemptInfo.bestScore ?? alreadyDone.score;
    const passMark = Number(quiz?.pass_percentage ?? 50);
    const passed = bestPct != null && Number(bestPct) >= passMark;
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl border border-stone-200 shadow-lg p-8">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-amber-100">
            <Lock className="w-8 h-8 text-amber-700" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">انتهت محاولاتك لهذا الاختبار</h1>
          <p className="text-stone-600 mb-2">
            استهلكت {usedA} من {maxA} محاولة متاحة.
          </p>
          <p className="text-stone-500 text-sm mb-4">لا يمكن بدء محاولة جديدة بعد الوصول للحد الأقصى. يُحتسب أعلى درجة فقط.</p>
          {bestPct != null && (
            <p className="text-lg font-bold text-amber-800 mb-2">
              أعلى درجة: {bestPct}%
              {bestScr != null ? ` (${bestScr}/${alreadyDone.total_questions || quiz?.total_questions || '—'})` : ''}
            </p>
          )}
          {bestPct != null && (
            <p className={`text-sm font-semibold mb-6 ${passed ? 'text-emerald-700' : 'text-red-600'}`}>
              {passed ? `ناجح (المطلوب ${passMark}%)` : `راسب (المطلوب ${passMark}%)`}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/leaderboard" className="px-5 py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800">
              منصة الأوائل
            </Link>
            <Link to="/quizzes" className="px-5 py-2.5 rounded-xl bg-stone-200 text-stone-700 font-semibold hover:bg-stone-300">
              اختبارات أخرى
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error && !quiz) {
    const isStaffUser = isStaffRole(profile?.role);
    const needsCode = /كود|حدد صفك|صفك الدراسي/.test(error || '');
    if (user && !isStaffUser && (!profile?.has_access || needsCode)) {
      return (
        <AccessGate
          mode="page"
          title="كود الوصول مطلوب لفتح الاختبار"
          description={error || 'أدخل كود الوصول الذي حصلت عليه من المدرس قبل بدء الاختبار.'}
          onSuccess={() => { window.location.reload(); }}
        />
      );
    }
    const lockedGrade = /صفك|تسجيل الدخول|حدد صفك|كود/.test(error || '');
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className={`mb-4 p-6 rounded-2xl border ${lockedGrade ? 'bg-amber-50 border-amber-200 text-amber-950' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <p className="font-medium mb-1">{error}</p>
          {lockedGrade && (
            <p className="text-sm opacity-80">يجب إدخال كود الوصول، والبدء متاح فقط لصفك الدراسي.</p>
          )}
        </div>
        <Link to="/quizzes" className="text-amber-700 font-medium">العودة للاختبارات</Link>
      </div>
    );
  }

  if (result) {
    const pct = result.percentage;
    const passMark = Number(result.pass_percentage ?? quiz?.pass_percentage ?? 50);
    const bestPct = Number(result.best_percentage ?? attemptInfo.bestPercentage ?? pct);
    const bestPassed = bestPct >= passMark;
    const thisPassed = result.passed != null ? !!result.passed : pct >= passMark;
    const remaining = result.attempts_remaining != null
      ? Number(result.attempts_remaining)
      : Math.max((attemptInfo.max || 1) - (attemptInfo.used || 0), 0);
    const usedNow = result.attempts_used ?? attemptInfo.used ?? 1;
    const maxNow = result.max_attempts ?? attemptInfo.max ?? 1;
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl border border-stone-200 shadow-lg p-8 text-center">
          <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${
            thisPassed ? 'bg-yellow-100' : 'bg-amber-100'
          }`}>
            <Trophy className={`w-10 h-10 ${thisPassed ? 'text-emerald-600' : 'text-amber-600'}`} />
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">تم تسليم المحاولة!</h1>
          <p className="text-stone-600 mb-2">{quiz?.title_ar || quiz?.title}</p>
          <div className={`inline-flex px-3 py-1 rounded-full text-sm font-bold mb-3 ${
            thisPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
          }`}>
            {thisPassed ? `ناجح في هذه المحاولة · المطلوب ${passMark}%` : `راسب في هذه المحاولة · المطلوب ${passMark}%`}
          </div>
          <div className="text-6xl font-black text-amber-700 mb-2">{pct}%</div>
          <p className="text-stone-600 mb-1">
            أحرزت {result.score} من {result.total_questions} في هذه المحاولة
          </p>
          <p className="text-sm font-semibold text-stone-800 mb-1">
            أعلى درجة حتى الآن: {bestPct}%
            {bestPassed ? ' · ناجح' : ' · راسب'}
          </p>
          <p className="text-sm text-stone-500 mb-2">
            المحاولة {usedNow} من {maxNow}
            {remaining > 0 ? ` · متبقي ${remaining}` : ' · لا محاولات متبقية'}
          </p>
          <p className="text-xs text-stone-500 mb-6">
            يُحتسب أعلى درجة فقط في الترتيب والنقاط. راجع إجاباتك بالأسفل قبل بدء محاولة جديدة.
          </p>
          <div className="space-y-3 text-right mb-8 max-h-80 overflow-y-auto">
            {questions.map((q, i) => {
              const userAns = answers[q.id] ?? answers[String(q.id)];
              const detail = result.answer_details?.[q.id] || result.answer_details?.[String(q.id)];
              const isCorrect = detail ? detail.correct : false;
              return (
                <div key={q.id} className={`p-3 rounded-xl border text-sm ${
                  isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
                }`}>
                  <div className="flex items-start gap-2">
                    {isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-stone-500 mb-1">
                        {TYPE_LABELS[q.question_type] || TYPE_LABELS.multiple_choice}
                      </div>
                      <div className="font-medium text-stone-800">{i + 1}. {q.question_text}</div>
                      <div className="text-stone-600 mt-1">إجابتك: {formatUserAnswer(q, userAns)}</div>
                      <div className="text-yellow-900 mt-0.5">
                        الصحيحة: {detail?.correct_display || result.correct_answers?.[q.id] || result.correct_answers?.[String(q.id)] || '—'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {remaining > 0 && !isStaffRole(profile?.role) && (
              <button
                type="button"
                onClick={startFreshAttempt}
                className="px-5 py-2.5 rounded-xl bg-emerald-700 text-white font-semibold hover:bg-emerald-800 flex items-center gap-1"
              >
                <RotateCcw className="w-4 h-4" />
                بدء محاولة جديدة ({remaining} متبقية)
              </button>
            )}
            <Link to="/leaderboard" className="px-5 py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800">
              منصة الأوائل
            </Link>
            <Link to="/quizzes" className="px-5 py-2.5 rounded-xl bg-stone-200 text-stone-700 font-semibold hover:bg-stone-300 flex items-center gap-1">
              اختبارات أخرى
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center text-stone-500">
        لا توجد أسئلة في هذا الاختبار بعد
        <div className="mt-4"><Link to="/quizzes" className="text-amber-700">العودة</Link></div>
      </div>
    );
  }

  const q = questions[current];
  const qType = q.question_type || 'multiple_choice';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {sessionActive ? (
        <div className="mb-6 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 text-sm flex items-start gap-2">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold">المحاولة قيد التنفيذ</div>
            <div className="text-xs mt-0.5 opacity-90">
              لا يمكنك مغادرة الاختبار قبل تسليم هذه المحاولة. بعد التسليم ستظهر لك الإجابات والنتيجة، ولن تبدأ محاولة جديدة تلقائياً.
            </div>
          </div>
        </div>
      ) : (
        <Link to="/quizzes" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-amber-700 mb-6">
          <ArrowRight className="w-4 h-4" />
          العودة للاختبارات
        </Link>
      )}

      <div className="mb-6">
        {quiz?.image_url && (
          <div className="mb-4 rounded-2xl overflow-hidden border border-stone-200 h-40 md:h-48">
            <img src={quiz.image_url} alt={quiz.title_ar || quiz.title} className="w-full h-full object-cover" />
          </div>
        )}
        <h1 className="text-2xl font-bold text-stone-900">{quiz?.title_ar || quiz?.title}</h1>
        <p className="text-sm text-stone-500 mt-1">
          المحاولة {Math.min((attemptInfo.used || 0) + 1, attemptInfo.max || 1)} من {attemptInfo.max || 1}
          {' · '}
          نسبة النجاح المطلوبة: {quiz?.pass_percentage ?? 50}%
          {attemptInfo.bestPercentage != null ? ` · أعلى درجة سابقة: ${attemptInfo.bestPercentage}%` : ''}
        </p>
        <div className="mt-3 h-2 bg-stone-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-700 rounded-full transition-all"
            style={{ width: `${((current + 1) / questions.length) * 100}%` }}
          />
        </div>
        <p className="text-sm text-stone-500 mt-2">سؤال {current + 1} من {questions.length}</p>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 md:p-8 mb-6">
        <div className="inline-flex mb-4 px-3 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
          {TYPE_LABELS[qType] || TYPE_LABELS.multiple_choice}
        </div>
        <h2 className="text-xl font-bold text-stone-900 mb-4 leading-relaxed" dir="auto">{q.question_text}</h2>

        {Array.isArray(q.media) && q.media.length > 0 && (
          <div className="mb-5 space-y-3">
            {q.media.map((item) => {
              if (item.media_type === 'image') {
                return (
                  <div key={item.id} className="rounded-xl overflow-hidden border border-stone-200">
                    <img src={item.url} alt={item.title || ''} className="w-full max-h-80 object-contain bg-stone-50" />
                  </div>
                );
              }
              return (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center border border-amber-100">
                    <FileText className="w-5 h-5 text-amber-800" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-stone-900 truncate">{item.title || 'مرفق'}</div>
                    <div className="text-xs text-amber-800 flex items-center gap-1">
                      <Download className="w-3.5 h-3.5" />
                      فتح / تحميل الملف
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {qType === 'multiple_choice' && (
          <MultipleChoiceOptions
            question={q}
            value={answers[q.id]}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'reading_comprehension' && (
          <div className="space-y-5">
            {q.passage_text && (
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-stone-800 leading-relaxed whitespace-pre-wrap" dir="auto">
                {q.passage_text}
              </div>
            )}
            {q.answer_data?.answer_mode === 'essay' ? (
              <ReadingEssayAnswer
                question={q}
                value={typeof answers[q.id] === 'string' ? answers[q.id] : ''}
                onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
              />
            ) : (
              <MultipleChoiceOptions
                question={q}
                value={answers[q.id]}
                onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
              />
            )}
          </div>
        )}

        {qType === 'complete_text' && (
          <CompleteTextQuestion
            question={q}
            value={Array.isArray(answers[q.id]) ? answers[q.id] : []}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'word_order' && (
          <WordOrderQuestion
            question={q}
            value={Array.isArray(answers[q.id]) ? answers[q.id] : []}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'word_form' && (
          <WordFormQuestion
            question={q}
            value={Array.isArray(answers[q.id]) ? answers[q.id] : []}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'rewrite_brackets' && (
          <RewriteBracketsQuestion
            question={q}
            value={Array.isArray(answers[q.id]) ? answers[q.id] : []}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'punctuate' && (
          <PunctuateQuestion
            question={q}
            value={typeof answers[q.id] === 'string' ? answers[q.id] : ''}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'paragraph' && (
          <ParagraphQuestion
            question={q}
            value={typeof answers[q.id] === 'string' ? answers[q.id] : ''}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}

        {qType === 'listening' && (
          <ListeningQuestion
            question={q}
            value={
              answers[q.id] && typeof answers[q.id] === 'object'
                ? answers[q.id]
                : { true_false: ['', ''], complete_blanks: ['', '', ''] }
            }
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4 text-center">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <button
          disabled={current === 0}
          onClick={() => setCurrent((c) => c - 1)}
          className="px-5 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-medium disabled:opacity-40 hover:bg-stone-100"
        >
          السابق
        </button>
        {current < questions.length - 1 ? (
          <button
            onClick={() => setCurrent((c) => c + 1)}
            className="px-5 py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800"
          >
            التالي
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'جاري التسليم...' : 'تسليم الإجابات'}
          </button>
        )}
      </div>
    </div>
  );
}

function MultipleChoiceOptions({ question, value, onChange }) {
  const options = [
    { key: 'a', text: question.option_a },
    { key: 'b', text: question.option_b },
    { key: 'c', text: question.option_c },
    { key: 'd', text: question.option_d },
  ].filter((o) => o.text);

  return (
    <div className="space-y-3">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`w-full text-right p-4 rounded-xl border-2 transition-all ${
            value === opt.key
              ? 'border-amber-600 bg-amber-50 text-amber-950'
              : 'border-stone-200 hover:border-stone-300 text-stone-700'
          }`}
        >
          <span className="inline-flex items-center gap-3">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
              value === opt.key ? 'bg-amber-700 text-white' : 'bg-stone-200 text-stone-600'
            }`}>
              {opt.key.toUpperCase()}
            </span>
            <span dir="auto">{opt.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function CompleteTextQuestion({ question, value, onChange }) {
  const { parts, blankCount } = useMemo(
    () => splitPassageBlanks(question.passage_text || ''),
    [question.passage_text]
  );
  const bank = Array.isArray(question.word_bank) ? question.word_bank : [];
  const blanks = Array.from({ length: blankCount }, (_, i) => value[i] || '');

  const setBlank = (index, word) => {
    const next = [...blanks];
    next[index] = word;
    onChange(next);
  };

  const used = blanks.filter(Boolean);
  const remaining = bank.filter((w) => {
    const usedCount = used.filter((u) => u === w).length;
    const total = bank.filter((b) => b === w).length;
    return usedCount < total;
  });

  return (
    <div className="space-y-5" dir="auto">
      {bank.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-stone-700 mb-2">Words in the box</div>
          <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            {bank.map((word, i) => {
              const disabled = !remaining.includes(word) && used.includes(word);
              // allow selecting unused copies
              const stillAvailable = remaining.filter((r) => r === word).length > 0;
              return (
                <span
                  key={`${word}-${i}`}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                    stillAvailable
                      ? 'bg-white border-amber-300 text-amber-900'
                      : 'bg-stone-100 border-stone-200 text-stone-400 line-through'
                  }`}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 leading-loose text-stone-800 text-lg">
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < blankCount && (
              <select
                value={blanks[i] || ''}
                onChange={(e) => setBlank(i, e.target.value)}
                className="mx-1 inline-block min-w-[110px] px-2 py-1 rounded-lg border-2 border-amber-500 bg-white text-amber-950 font-semibold focus:outline-none"
              >
                <option value="">___</option>
                {[...new Set([...remaining, blanks[i]].filter(Boolean))].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            )}
          </span>
        ))}
      </div>
      {!question.passage_text && (
        <p className="text-sm text-red-600">لا يوجد نص لهذا السؤال. أضف نصاً من لوحة المشرف.</p>
      )}
    </div>
  );
}

function WordOrderQuestion({ question, value, onChange }) {
  const bank = Array.isArray(question.word_bank) ? question.word_bank : [];
  const selected = Array.isArray(value) ? value : [];

  const remaining = (() => {
    const pool = [...bank];
    selected.forEach((w) => {
      const idx = pool.findIndex((p) => p === w);
      if (idx >= 0) pool.splice(idx, 1);
    });
    return pool;
  })();

  const addWord = (word, fromIndex) => {
    const pool = [...remaining];
    // use exact occurrence
    const next = [...selected, word];
    onChange(next);
  };

  const removeWord = (index) => {
    const next = selected.filter((_, i) => i !== index);
    onChange(next);
  };

  const moveWord = (from, to) => {
    if (to < 0 || to >= selected.length) return;
    const next = [...selected];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-5" dir="auto">
      <div>
        <div className="text-sm font-semibold text-stone-700 mb-2">Available words</div>
        <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200 min-h-[56px]">
          {remaining.length === 0 && (
            <span className="text-sm text-stone-400">All words used</span>
          )}
          {remaining.map((word, i) => (
            <button
              key={`${word}-${i}`}
              type="button"
              onClick={() => addWord(word, i)}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-semibold hover:bg-amber-50"
            >
              {word}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-stone-700 mb-2">Your sentence</div>
        <div className="flex flex-wrap gap-2 p-4 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50/40 min-h-[72px]">
          {selected.length === 0 && (
            <span className="text-sm text-stone-400">Click words above to build the sentence</span>
          )}
          {selected.map((word, i) => (
            <div key={`${word}-${i}`} className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => removeWord(i)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm font-semibold"
                title="Remove"
              >
                <GripVertical className="w-3.5 h-3.5 opacity-70" />
                {word}
              </button>
              <div className="flex flex-col">
                <button type="button" className="text-[10px] text-stone-500 px-1" onClick={() => moveWord(i, i - 1)}>▲</button>
                <button type="button" className="text-[10px] text-stone-500 px-1" onClick={() => moveWord(i, i + 1)}>▼</button>
              </div>
            </div>
          ))}
        </div>
        {selected.length > 0 && (
          <p className="mt-2 text-sm text-stone-600">
            Preview: <span className="font-semibold text-stone-900">{selected.join(' ')}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function WordFormQuestion({ question, value, onChange }) {
  const passage = question.passage_text || '';
  const blankCount = Math.max(countBracketBlanks(passage), 1);
  const answers = Array.from({ length: blankCount }, (_, i) => value[i] || '');

  const setAnswer = (index, text) => {
    const next = [...answers];
    next[index] = text;
    onChange(next);
  };

  // Render passage with numbered blanks after each (word)
  const rendered = [];
  let blankIndex = 0;
  const regex = /\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  const src = passage || '';
  while ((match = regex.exec(src)) !== null) {
    rendered.push(src.slice(lastIndex, match.index));
    const word = match[1];
    const idx = blankIndex;
    rendered.push(
      <span key={`b-${idx}`} className="inline-flex items-center gap-1 mx-1 my-1">
        <span className="font-semibold text-amber-800">({word})</span>
        <input
          type="text"
          value={answers[idx] || ''}
          onChange={(e) => setAnswer(idx, e.target.value)}
          placeholder="____"
          className="w-28 md:w-36 px-2 py-1 rounded-lg border-2 border-amber-500 bg-white text-amber-950 font-semibold focus:outline-none"
          dir="ltr"
        />
      </span>
    );
    blankIndex += 1;
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < src.length) rendered.push(src.slice(lastIndex));

  return (
    <div className="space-y-4" dir="auto">
      {passage ? (
        <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 leading-loose text-stone-800 text-lg whitespace-pre-wrap">
          {rendered}
        </div>
      ) : (
        <div className="space-y-3">
          {answers.map((ans, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm font-semibold text-stone-600 w-8">{i + 1}.</span>
              <input
                type="text"
                value={ans}
                onChange={(e) => setAnswer(i, e.target.value)}
                placeholder="Write the correct form"
                className="flex-1 px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600"
                dir="ltr"
              />
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-stone-500">Write the correct form of each word between brackets.</p>
    </div>
  );
}

function RewriteBracketsQuestion({ question, value, onChange }) {
  const sentences = useMemo(() => {
    const lines = String(question.passage_text || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length) return lines;
    // fallback: single block
    const t = String(question.passage_text || '').trim();
    return t ? [t] : [''];
  }, [question.passage_text]);

  const answers = Array.from({ length: sentences.length }, (_, i) => value[i] || '');

  const setAnswer = (index, text) => {
    const next = [...answers];
    next[index] = text;
    onChange(next);
  };

  return (
    <div className="space-y-4" dir="auto">
      <p className="text-sm text-stone-600">
        Rewrite each sentence using the word(s) in brackets. Write the full rewritten sentence.
      </p>
      <div className="space-y-4">
        {sentences.map((sentence, i) => (
          <div key={i} className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
            <div className="flex items-start gap-2">
              <span className="w-7 h-7 rounded-lg bg-amber-700 text-white text-sm font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="text-stone-800 leading-relaxed font-medium pt-0.5" dir="ltr">
                {sentence || `Sentence ${i + 1}`}
              </div>
            </div>
            <input
              type="text"
              value={answers[i] || ''}
              onChange={(e) => setAnswer(i, e.target.value)}
              placeholder="Rewrite the sentence here..."
              className="w-full px-3 py-2.5 rounded-xl border-2 border-amber-500 bg-white text-stone-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-600"
              dir="ltr"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PunctuateQuestion({ question, value, onChange }) {
  return (
    <div className="space-y-4" dir="auto">
      {question.passage_text && (
        <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 text-stone-800 leading-relaxed whitespace-pre-wrap">
          <div className="text-xs font-bold text-stone-500 mb-2 uppercase tracking-wide">Sentences</div>
          {question.passage_text}
        </div>
      )}
      <div>
        <label className="block text-sm font-semibold text-stone-700 mb-2">Your punctuated answer</label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder="Rewrite the sentences with correct punctuation and capitalization..."
          className="w-full px-3 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-stone-800 leading-relaxed"
          dir="ltr"
        />
      </div>
    </div>
  );
}

function ParagraphQuestion({ question, value, onChange }) {
  const min = Number(question.answer_data?.min_words || 50);
  const max = Number(question.answer_data?.max_words || 60);
  const guiding = question.passage_text || question.answer_data?.guiding_elements || '';
  const words = countWords(value);
  const inRange = words >= min && words <= max;

  return (
    <div className="space-y-4" dir="auto">
      {guiding && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
          <div className="text-xs font-bold text-amber-800 mb-2">Guiding elements</div>
          <div className="text-stone-800 leading-relaxed whitespace-pre-wrap">{guiding}</div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-2 gap-3">
          <label className="text-sm font-semibold text-stone-700">Your paragraph</label>
          <span className={`text-xs font-bold px-2 py-1 rounded-lg ${inRange ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
            {words} words · target {min}-{max}
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          placeholder="Write your paragraph here..."
          className="w-full px-3 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-stone-800 leading-relaxed"
          dir="ltr"
        />
      </div>
    </div>
  );
}

function ReadingEssayAnswer({ question, value, onChange }) {
  const min = Number(question.answer_data?.min_words || 20);
  const max = Number(question.answer_data?.max_words || 150);
  const words = countWords(value);
  const inRange = words >= min && words <= max;

  return (
    <div className="space-y-3" dir="auto">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-stone-700">Write your answer</label>
        <span className={`text-xs font-bold px-2 py-1 rounded-lg ${inRange ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
          {words} words · target {min}-{max}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        placeholder="Read the text carefully, then write your answer here..."
        className="w-full px-3 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-stone-800 leading-relaxed"
        dir="ltr"
      />
      <p className="text-xs text-stone-500">
        Open essay answer based on the reading passage above.
      </p>
    </div>
  );
}

function ListeningQuestion({ question, value, onChange }) {
  const audioUrl = question.answer_data?.audio_url || '';
  const tfItems = Array.isArray(question.answer_data?.true_false)
    ? question.answer_data.true_false
    : [{ statement: '' }, { statement: '' }];
  const blankItems = Array.isArray(question.answer_data?.complete_blanks)
    ? question.answer_data.complete_blanks
    : [{ sentence: '' }, { sentence: '' }, { sentence: '' }];

  const trueFalse = Array.isArray(value?.true_false) ? [...value.true_false] : ['', ''];
  while (trueFalse.length < 2) trueFalse.push('');
  const completeBlanks = Array.isArray(value?.complete_blanks) ? [...value.complete_blanks] : ['', '', ''];
  while (completeBlanks.length < 3) completeBlanks.push('');

  const setTf = (index, ans) => {
    const next = [...trueFalse];
    next[index] = ans;
    onChange({ true_false: next, complete_blanks: completeBlanks });
  };

  const setBlank = (index, ans) => {
    const next = [...completeBlanks];
    next[index] = ans;
    onChange({ true_false: trueFalse, complete_blanks: next });
  };

  return (
    <div className="space-y-6" dir="auto">
      {audioUrl ? (
        <div className="space-y-2">
          <div className="text-sm font-bold text-stone-900">Listen carefully — Winamp Player</div>
          <WinampPlayer
            key={audioUrl}
            src={audioUrl}
            title={question.question_text?.slice?.(0, 80) || 'Listening Track'}
          />
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          لا يوجد ملف صوتي مرفوع لهذا السؤال بعد.
        </div>
      )}

      <div className="space-y-3">
        <div className="font-bold text-stone-900">A. Write True (T) or False (F)</div>
        <p className="text-xs text-stone-500">Create 2 statements based on the lesson.</p>
        {tfItems.slice(0, 2).map((item, i) => (
          <div key={i} className="p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
            <div className="text-sm font-medium text-stone-800">
              {i + 1}. {item.statement || `Statement ${i + 1}`}
            </div>
            <div className="flex gap-2">
              {['T', 'F'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTf(i, opt)}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                    trueFalse[i] === opt
                      ? 'border-amber-600 bg-amber-50 text-amber-950'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  {opt === 'T' ? 'True (T)' : 'False (F)'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="font-bold text-stone-900">B. Listen again and Complete</div>
        <p className="text-xs text-stone-500">Create 3 fill-in-the-blank sentences.</p>
        {blankItems.slice(0, 3).map((item, i) => (
          <div key={i} className="p-4 rounded-xl border border-stone-200 space-y-2">
            <div className="text-sm font-medium text-stone-800">
              {i + 1}. {item.sentence || `Sentence ${i + 1}`}
            </div>
            <input
              type="text"
              value={completeBlanks[i] || ''}
              onChange={(e) => setBlank(i, e.target.value)}
              placeholder="Write the missing word(s)..."
              className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
              dir="ltr"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
