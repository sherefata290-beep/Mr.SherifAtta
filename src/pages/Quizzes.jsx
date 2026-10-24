import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Clock, Play, LogIn, Lock, CheckCircle2, KeyRound } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import AccessGate from '../components/AccessGate';
import { useAuth } from '../contexts/AuthContext';
import { useQuizLock } from '../contexts/QuizLockContext';
import { apiFetch, onDataChanged } from '../lib/api';
import { gradeLabel, GRADE_OPTIONS } from '../lib/grades';
import { isStaffRole } from '../lib/roles';

export default function Quizzes() {
  const [quizzes, setQuizzes] = useState([]);
  const [completedMap, setCompletedMap] = useState({}); // quizId -> { count, latest }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  const [pendingQuizId, setPendingQuizId] = useState(null);
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const { locked, quizId } = useQuizLock();
  const isAdmin = isStaffRole(profile?.role);
  const studentGrade = profile?.grade_level || '';
  // Grade at signup is not enough — must redeem access code
  const hasAccessCode = Boolean(profile?.has_access);

  useEffect(() => {
    // Wait for session + profile so staff don't hit student-only endpoints first
    if (authLoading) return;
    if (user && !profile) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      try {
        const res = await apiFetch(isAdmin ? '/api/quizzes?admin=true' : '/api/quizzes');
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'فشل تحميل الاختبارات');
        if (!cancelled) setQuizzes(Array.isArray(data) ? data : []);

        // Load student's attempts per quiz
        if (user && !isAdmin) {
          const rRes = await apiFetch('/api/results');
          const rData = await rRes.json();
          if (rRes.ok && Array.isArray(rData)) {
            const map = {};
            rData.forEach((row) => {
              if (row?.quiz_id == null) return;
              if (!map[row.quiz_id]) {
                map[row.quiz_id] = { count: 0, latest: row };
              }
              map[row.quiz_id].count += 1;
              // results are ordered newest first from API
              if (!map[row.quiz_id].latest) map[row.quiz_id].latest = row;
            });
            if (!cancelled) setCompletedMap(map);
          }
        } else if (!cancelled) {
          setCompletedMap({});
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'فشل تحميل الاختبارات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const unsubData = onDataChanged(() => { load(); });
    return () => {
      cancelled = true;
      unsubData();
    };
  }, [isAdmin, authLoading, user, profile]);

  const attemptsUsed = (quiz) => completedMap[quiz.id]?.count || 0;
  const maxAttempts = (quiz) => (Number(quiz.max_attempts) > 0 ? Number(quiz.max_attempts) : 1);
  const attemptsExhausted = (quiz) => !isAdmin && attemptsUsed(quiz) >= maxAttempts(quiz);
  const latestAttempt = (quiz) => completedMap[quiz.id]?.latest || null;

  const canOpenQuiz = (quiz) => {
    if (isAdmin) return true;
    if (!user) return false;
    if (attemptsExhausted(quiz)) return false;
    // Must redeem access code first, then match grade
    if (!hasAccessCode) return false;
    return !!quiz.grade_level && !!studentGrade && quiz.grade_level === studentGrade;
  };

  const requestOpenQuiz = (quiz) => {
    if (isAdmin) {
      navigate(`/quizzes/${quiz.id}`);
      return;
    }
    if (!user) {
      navigate('/login');
      return;
    }
    if (attemptsExhausted(quiz)) return;
    if (!hasAccessCode) {
      setPendingQuizId(quiz.id);
      setGateOpen(true);
      return;
    }
    if (canOpenQuiz(quiz)) {
      navigate(`/quizzes/${quiz.id}`);
      return;
    }
    setPendingQuizId(null);
    setGateOpen(true);
  };

  const handleGateSuccess = (data) => {
    setGateOpen(false);
    const grade = data?.grade_level || studentGrade || '';
    const unlocked = data?.has_access !== false;
    if (unlocked && pendingQuizId) {
      const quiz = quizzes.find((q) => String(q.id) === String(pendingQuizId));
      if (quiz && quiz.grade_level && grade && quiz.grade_level === grade && !attemptsExhausted(quiz)) {
        navigate(`/quizzes/${pendingQuizId}`);
        setPendingQuizId(null);
        return;
      }
    }
    setPendingQuizId(null);
  };

  // Order sections: student's grade first (if any), then the rest
  const gradeSections = [...GRADE_OPTIONS].sort((a, b) => {
    if (!studentGrade || isAdmin) return 0;
    if (a.value === studentGrade) return -1;
    if (b.value === studentGrade) return 1;
    return 0;
  });

  const renderQuizCard = (quiz) => {
    const openable = canOpenQuiz(quiz);
    return (
      <div
        key={quiz.id}
        className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow flex flex-col ${
          openable ? 'border-stone-200 hover:shadow-md' : 'border-stone-200'
        }`}
      >
        <div className="quiz-cover flex items-center justify-center">
          {quiz.image_url ? (
            <img
              src={quiz.image_url}
              alt={quiz.title_ar || quiz.title}
              className="z-[1]"
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <ClipboardList className="w-14 h-14 text-white/80 relative z-[1]" />
          )}
          {!openable && <div className="absolute inset-0 bg-black/35 z-[2]" />}
          {quiz.grade_level && (
            <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg text-xs font-bold z-[3] bg-white/95 text-amber-900">
              {gradeLabel(quiz.grade_level)}
            </span>
          )}
          {!openable && (
            <span className="absolute bottom-3 right-3 z-[3] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-stone-900/85 text-white">
              <Lock className="w-3.5 h-3.5" />
              مقفول
            </span>
          )}
        </div>
        <div className="p-6 flex flex-col flex-1">
          <h3 className="font-bold text-stone-900 text-lg mb-1">{quiz.title_ar || quiz.title}</h3>
          <p className="text-sm text-amber-700 mb-2">{quiz.title}</p>
          <p className="text-stone-600 text-sm mb-4 flex-1 line-clamp-3">{quiz.description}</p>
          <div className="flex items-center justify-between pt-4 border-t border-stone-200">
            <div className="flex flex-col gap-1 text-xs text-stone-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {quiz.duration_minutes || 20} دقيقة
              </span>
              <span>محاولات: {attemptsUsed(quiz)}/{maxAttempts(quiz)}</span>
              <span>نجاح من: {quiz.pass_percentage ?? 50}%</span>
            </div>
            {attemptsExhausted(quiz) ? (
              <span
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-800 text-sm font-semibold border border-emerald-200"
                title="استهلكت كل المحاولات المتاحة"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                اكتملت المحاولات{latestAttempt(quiz)?.percentage != null ? ` · ${latestAttempt(quiz).percentage}%` : ''}
              </span>
            ) : openable ? (
              <button
                type="button"
                onClick={() => requestOpenQuiz(quiz)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {attemptsUsed(quiz) > 0 ? 'إعادة المحاولة' : 'ابدأ'}
              </button>
            ) : !user ? (
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-200 text-stone-700 text-sm font-semibold hover:bg-stone-300 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                سجّل للفتح
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => requestOpenQuiz(quiz)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 transition-colors"
                title={!hasAccessCode ? 'أدخل كود الوصول أولاً' : 'هذا الاختبار لصف آخر'}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {!hasAccessCode ? 'أدخل الكود للفتح' : 'مقفول لصفك'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">الاختبارات</h1>
        <p className="text-stone-600">
          الاختبارات مقسمة حسب الصف — بدء أي اختبار يتطلب كود الوصول أولاً
          {user && !isAdmin && studentGrade ? ` · صفك: ${gradeLabel(studentGrade)}` : ''}
        </p>
      </div>

      {locked && quizId && (
        <div className="mb-6 p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="font-medium">لديك اختبار جارٍ — يجب تسليم الإجابات قبل فتح اختبارات أخرى.</p>
          <Link
            to={`/quizzes/${quizId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 shrink-0"
          >
            العودة للاختبار
          </Link>
        </div>
      )}

      {!user && (
        <div className="mb-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p>يمكنك مشاهدة الأقسام. سجّل الدخول ثم أدخل كود الوصول لبدء اختبارات صفك.</p>
          <Link to="/login" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 shrink-0">
            <LogIn className="w-4 h-4" />
            تسجيل الدخول
          </Link>
        </div>
      )}

      {user && !isAdmin && !hasAccessCode && (
        <div className="mb-6 p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="font-medium">الاختبارات مقفلة — أدخل كود الوصول من المدرس قبل بدء أي اختبار.</p>
          <button
            type="button"
            onClick={() => { setPendingQuizId(null); setGateOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 shrink-0"
          >
            <KeyRound className="w-4 h-4" />
            إدخال كود الوصول
          </button>
        </div>
      )}

      {loading || authLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="text-center py-16 text-red-600">{error}</div>
      ) : quizzes.length === 0 ? (
        <div className="text-center py-16 text-stone-500">لا توجد اختبارات حالياً</div>
      ) : (
        <div className="space-y-10">
          {gradeSections.map((grade) => {
            const sectionQuizzes = quizzes.filter((q) => q.grade_level === grade.value);
            if (!sectionQuizzes.length) return null;
            const isMyGrade = !isAdmin && studentGrade === grade.value;
            return (
              <section key={grade.value} id={`grade-${grade.value}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white shadow-sm"
                      style={{ backgroundColor: isMyGrade ? '#b45309' : '#292524' }}
                    >
                      {sectionQuizzes.length}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                        {grade.label}
                        {isMyGrade && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900">
                            صفك
                          </span>
                        )}
                      </h2>
                      <p className="text-sm text-stone-500">
                        {isMyGrade
                          ? 'يمكنك بدء اختبارات هذا القسم'
                          : isAdmin
                            ? 'قسم إدارة — جميع الاختبارات مرئية'
                            : 'مقفول لصفوف أخرى'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {sectionQuizzes.map(renderQuizCard)}
                </div>
              </section>
            );
          })}

          {quizzes.some((q) => !q.grade_level || !GRADE_OPTIONS.some((g) => g.value === q.grade_level)) && (
            <section>
              <h2 className="text-xl font-bold text-stone-900 mb-4">أقسام أخرى</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {quizzes
                  .filter((q) => !q.grade_level || !GRADE_OPTIONS.some((g) => g.value === q.grade_level))
                  .map(renderQuizCard)}
              </div>
            </section>
          )}
        </div>
      )}

      {gateOpen && (
        <AccessGate
          mode="modal"
          title="كود الوصول مطلوب"
          description="لا يمكن بدء الاختبار قبل تفعيل كود الوصول. أدخل الكود الذي حصلت عليه من المدرس."
          onClose={() => { setGateOpen(false); setPendingQuizId(null); }}
          onSuccess={handleGateSuccess}
        />
      )}
    </div>
  );
}
