import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarCheck2,
  BookOpen,
  Trophy,
  Target,
  CheckCircle2,
  Clock3,
  LogIn,
  RefreshCw,
  Award,
  Flame,
  CircleDot,
  PlayCircle,
  ClipboardList,
  Search,
  Play,
  Eye,
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, onDataChanged } from '../lib/api';
import { isStaffRole } from '../lib/roles';
import { sessionTypeLabel } from '../lib/sessionTypes';
import { gradeLabel } from '../lib/grades';
import { AttendanceStatusChart, QuizLevelChart } from '../components/StudentProgressCharts';

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function statusMeta(status) {
  const s = String(status || 'not_started');
  if (s === 'completed') {
    return {
      key: 'completed',
      emoji: '🟢',
      label: 'مكتملة',
      full: '🟢 مكتملة',
      className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      bar: 'bg-emerald-500',
    };
  }
  if (s === 'in_progress') {
    return {
      key: 'in_progress',
      emoji: '🟡',
      label: 'قيد المتابعة',
      full: '🟡 قيد المتابعة',
      className: 'bg-amber-50 text-amber-900 border-amber-200',
      bar: 'bg-amber-500',
    };
  }
  return {
    key: 'not_started',
    emoji: '🔴',
    label: 'لم تبدأ',
    full: '🔴 لم تبدأ',
    className: 'bg-red-50 text-red-800 border-red-200',
    bar: 'bg-red-400',
  };
}

function StatCard({ icon: Icon, label, value, hint, tone = 'amber' }) {
  const tones = {
    amber: 'from-amber-700 to-stone-800',
    stone: 'from-stone-700 to-zinc-900',
    green: 'from-emerald-700 to-stone-800',
    gold: 'from-yellow-700 to-amber-900',
    red: 'from-red-700 to-stone-900',
    fire: 'from-orange-600 to-amber-900',
  };
  return (
    <div className={`rounded-2xl p-5 text-white shadow-lg bg-gradient-to-br ${tones[tone] || tones.amber}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white/80 text-sm mb-1">{label}</p>
          <p className="text-3xl font-black tabular-nums">{value}</p>
          {hint ? <p className="text-white/70 text-xs mt-2">{hint}</p> : null}
        </div>
        <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

const NEW_QUIZ_DAYS = 14;

function quizStatusMeta(status) {
  if (status === 'completed') {
    return { full: '🟢 مكتمل', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  }
  if (status === 'in_progress') {
    return { full: '🟡 قيد المحاولة', className: 'bg-amber-50 text-amber-900 border-amber-200' };
  }
  return { full: '🔴 لم يبدأ', className: 'bg-red-50 text-red-800 border-red-200' };
}

export default function Progress() {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = isStaffRole(profile?.role);
  const studentGrade = profile?.grade_level || '';
  const hasAccessCode = Boolean(profile?.has_access);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCourse, setFilterCourse] = useState('');
  const [search, setSearch] = useState('');

  // Student quizzes panel (uses existing quizzes/results/lesson-quizzes APIs only)
  const [quizzes, setQuizzes] = useState([]);
  const [quizResults, setQuizResults] = useState([]);
  const [lessonQuizRecords, setLessonQuizRecords] = useState([]);
  const [lessonsCatalog, setLessonsCatalog] = useState([]);
  const [quizSearch, setQuizSearch] = useState('');
  const [quizFilterStatus, setQuizFilterStatus] = useState('all');
  const [quizzesLoading, setQuizzesLoading] = useState(false);

  const load = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setError('');
    try {
      const res = await apiFetch('/api/attendance');
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          res.ok
            ? 'استجابة غير صالحة من الخادم'
            : `خطأ في الخادم (${res.status}). حاول مرة أخرى.`
        );
      }
      if (!res.ok) throw new Error(json?.error || `فشل تحميل بيانات المتابعة (${res.status})`);
      setData(
        json && typeof json === 'object'
          ? json
          : { attendance: [], lessons: [], quiz_results: [], course_progress: [], stats: {} }
      );
    } catch (err) {
      setError(err.message || 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  };

  const loadQuizzesPanel = async () => {
    if (!user) return;
    setQuizzesLoading(true);
    try {
      const [qRes, rRes, lqRes, lessonsRes] = await Promise.all([
        apiFetch(isAdmin ? '/api/quizzes?admin=true' : '/api/quizzes'),
        apiFetch('/api/results'),
        apiFetch('/api/lesson-quizzes'),
        // lessons list for linked-lesson titles (admin path or via attendance catalog)
        apiFetch(isAdmin ? '/api/lessons?admin=true' : '/api/attendance'),
      ]);

      const qData = await qRes.json().catch(() => []);
      const rData = await rRes.json().catch(() => []);
      const lqData = await lqRes.json().catch(() => []);
      const lessonsData = await lessonsRes.json().catch(() => null);

      setQuizzes(Array.isArray(qData) ? qData : []);
      setQuizResults(Array.isArray(rData) ? rData : []);
      setLessonQuizRecords(Array.isArray(lqData) ? lqData : []);

      if (Array.isArray(lessonsData)) {
        setLessonsCatalog(lessonsData);
      } else if (Array.isArray(lessonsData?.lessons)) {
        setLessonsCatalog(lessonsData.lessons);
      } else if (Array.isArray(data?.lessons)) {
        setLessonsCatalog(data.lessons);
      }
    } catch (err) {
      console.error('quizzes panel load failed:', err);
    } finally {
      setQuizzesLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    load();
    const unsub = onDataChanged(() => {
      load();
      loadQuizzesPanel();
    });
    return unsub;
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading || !user) return;
    // Wait for profile so grade/access flags are ready
    if (user && !profile && !isAdmin) return;
    loadQuizzesPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, profile?.grade_level, profile?.has_access, isAdmin]);

  const stats = data?.stats || {};
  const lessons = Array.isArray(data?.lessons) && data.lessons.length
    ? data.lessons
    : Array.isArray(data?.attendance)
      ? data.attendance
      : [];

  const courseOptions = useMemo(() => {
    const map = new Map();
    lessons.forEach((l) => {
      const id = String(l.course_id || l.course_title || '');
      if (!id) return;
      if (!map.has(id)) map.set(id, l.course_title || `كورس #${id}`);
    });
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [lessons]);

  const filteredLessons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lessons.filter((row) => {
      if (filterStatus !== 'all' && row.session_status !== filterStatus) return false;
      if (filterCourse) {
        const cid = String(row.course_id || row.course_title || '');
        if (cid !== filterCourse) return false;
      }
      if (q) {
        const hay = `${row.lesson_title || ''} ${row.course_title || ''} ${sessionTypeLabel(row.session_type)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lessons, filterStatus, filterCourse, search]);

  const commitment = Number(stats.commitment_percent ?? 0) || 0;
  const completed = Number(stats.lessons_completed ?? 0) || 0;
  const inProgress = Number(stats.lessons_in_progress ?? 0) || 0;
  const notStarted = Number(stats.lessons_not_started ?? 0) || 0;
  const total = Number(stats.lessons_total ?? lessons.length) || 0;
  const points = Number(stats.attendance_points ?? stats.total_points ?? profile?.total_points ?? 0) || 0;
  const streak = Number(stats.attendance_streak ?? 0) || 0;

  // Map linked lessons from attendance settings / lesson quiz records
  const linkedLessonByQuizId = useMemo(() => {
    const map = {};
    // From attendance catalog lessons (linked_quiz_id on lesson settings)
    (Array.isArray(data?.lessons) ? data.lessons : []).forEach((l) => {
      const qid = Number(l.linked_quiz_id);
      if (!qid) return;
      if (!map[qid]) {
        map[qid] = {
          lesson_id: l.lesson_id || l.id,
          lesson_title: l.lesson_title || l.title_ar || l.title,
          course_title: l.course_title || '',
        };
      }
    });
    // From lessons catalog if loaded as admin list
    (lessonsCatalog || []).forEach((l) => {
      const qid = Number(l.linked_quiz_id);
      if (!qid) return;
      if (!map[qid]) {
        map[qid] = {
          lesson_id: l.id || l.lesson_id,
          lesson_title: l.title_ar || l.title || l.lesson_title,
          course_title: l.course_title || '',
        };
      }
    });
    // From lesson-quiz records (started/completed optional quiz)
    (lessonQuizRecords || []).forEach((r) => {
      const qid = Number(r.quiz_id);
      if (!qid || map[qid]) return;
      map[qid] = {
        lesson_id: r.lesson_id,
        lesson_title: r.lesson_title || `حصة #${r.lesson_id}`,
        course_title: r.course_title || '',
      };
    });
    return map;
  }, [data?.lessons, lessonsCatalog, lessonQuizRecords]);

  const resultsByQuizId = useMemo(() => {
    const map = {};
    (quizResults || []).forEach((row) => {
      if (row?.quiz_id == null) return;
      const qid = Number(row.quiz_id);
      if (!map[qid]) map[qid] = { count: 0, latest: row, best: row };
      map[qid].count += 1;
      // API returns newest first — keep first as latest
      if (!map[qid].latest) map[qid].latest = row;
      if (Number(row.percentage || 0) >= Number(map[qid].best?.percentage || 0)) {
        map[qid].best = row;
      }
    });
    return map;
  }, [quizResults]);

  const startedLessonQuizByQuizId = useMemo(() => {
    const map = {};
    (lessonQuizRecords || []).forEach((r) => {
      const qid = Number(r.quiz_id);
      if (!qid) return;
      const prev = map[qid];
      if (!prev) {
        map[qid] = r;
        return;
      }
      // Prefer completed, else latest started
      if (prev.status !== 'completed' && r.status === 'completed') map[qid] = r;
    });
    return map;
  }, [lessonQuizRecords]);

  const accessibleQuizzes = useMemo(() => {
    const list = Array.isArray(quizzes) ? [...quizzes] : [];
    // Only quizzes the student may access (grade + access code). Staff see all.
    const filtered = list.filter((q) => {
      if (isAdmin) return true;
      if (!hasAccessCode) return false;
      if (!studentGrade) return false;
      return !!q.grade_level && q.grade_level === studentGrade;
    });

    // newest first
    filtered.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

    return filtered.map((q) => {
      const qid = Number(q.id);
      const attempts = resultsByQuizId[qid] || { count: 0, latest: null, best: null };
      const maxAttempts = Number(q.max_attempts) > 0 ? Number(q.max_attempts) : 1;
      const used = Number(attempts.count || 0);
      const remaining = Math.max(maxAttempts - used, 0);
      const latest = attempts.latest;
      const best = attempts.best;
      const lessonLink = linkedLessonByQuizId[qid] || null;
      const lessonQuiz = startedLessonQuizByQuizId[qid] || null;

      let status = 'not_started';
      if (used > 0 || lessonQuiz?.status === 'completed') {
        status = 'completed';
      } else if (lessonQuiz?.status === 'started') {
        // Optional lesson-quiz start marker — treat as in progress without changing quiz engine
        status = 'in_progress';
      } else {
        status = 'not_started';
      }

      const createdAt = q.created_at || null;
      let isNew = false;
      if (createdAt) {
        const age = Date.now() - new Date(createdAt).getTime();
        isNew = Number.isFinite(age) && age >= 0 && age <= NEW_QUIZ_DAYS * 24 * 60 * 60 * 1000;
      } else {
        // Fallback: treat higher IDs in top slice as new-ish is unreliable; skip unless created_at
        isNew = false;
      }
      // Also mark brand-new if among the 3 newest and no attempts yet
      if (!isNew && status === 'not_started') {
        const idx = filtered.findIndex((x) => Number(x.id) === qid);
        if (idx >= 0 && idx < 3) isNew = true;
      }

      const percentage =
        latest?.percentage != null
          ? Number(latest.percentage)
          : lessonQuiz?.percentage != null
            ? Number(lessonQuiz.percentage)
            : null;
      const score = latest?.score != null ? Number(latest.score) : lessonQuiz?.score != null ? Number(lessonQuiz.score) : null;
      const totalQ =
        latest?.total_questions != null
          ? Number(latest.total_questions)
          : lessonQuiz?.total_questions != null
            ? Number(lessonQuiz.total_questions)
            : Number(q.question_count || 0);

      return {
        ...q,
        _status: status,
        _max_attempts: maxAttempts,
        _attempts_used: used,
        _attempts_remaining: remaining,
        _latest: latest,
        _best: best,
        _percentage: percentage,
        _score: score,
        _total_questions: totalQ,
        _question_count: Number(q.question_count || totalQ || 0),
        _linked_lesson: lessonLink,
        _is_new: isNew,
        _exhausted: !isAdmin && remaining <= 0 && used > 0,
      };
    });
  }, [
    quizzes,
    isAdmin,
    hasAccessCode,
    studentGrade,
    resultsByQuizId,
    linkedLessonByQuizId,
    startedLessonQuizByQuizId,
  ]);

  const quizSummary = useMemo(() => {
    const all = accessibleQuizzes;
    const completedN = all.filter((q) => q._status === 'completed').length;
    const inProgN = all.filter((q) => q._status === 'in_progress').length;
    const notStartN = all.filter((q) => q._status === 'not_started').length;
    const scored = all.filter((q) => q._percentage != null);
    const avg = scored.length
      ? Math.round(scored.reduce((s, q) => s + Number(q._percentage || 0), 0) / scored.length)
      : 0;
    return {
      total: all.length,
      completed: completedN,
      in_progress: inProgN,
      not_started: notStartN,
      average: avg,
    };
  }, [accessibleQuizzes]);

  const filteredQuizzes = useMemo(() => {
    const q = quizSearch.trim().toLowerCase();
    return accessibleQuizzes.filter((row) => {
      if (quizFilterStatus !== 'all' && row._status !== quizFilterStatus) return false;
      if (!q) return true;
      const lessonTitle = row._linked_lesson?.lesson_title || '';
      const hay = `${row.title_ar || ''} ${row.title || ''} ${row.description || ''} ${lessonTitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [accessibleQuizzes, quizFilterStatus, quizSearch]);

  const openQuizAction = (quiz) => {
    if (!quiz?.id) return;
    // Never bypass attempt limits — TakeQuiz also enforces this
    if (quiz._exhausted && quiz._status === 'completed') {
      navigate(`/quizzes/${quiz.id}`);
      return;
    }
    if (!isAdmin && quiz._exhausted) return;
    navigate(`/quizzes/${quiz.id}`);
  };

  if (authLoading || loading) return <LoadingSpinner text="جاري تحميل الحضور والمتابعة..." />;

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm">
          <CalendarCheck2 className="w-12 h-12 text-amber-700 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-stone-900 mb-2">الحضور والمتابعة</h1>
          <p className="text-stone-600 mb-6">سجّل الدخول لمتابعة حضورك ونسبة التزامك بالحصص.</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800"
          >
            <LogIn className="w-4 h-4" />
            تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold mb-3">
            <CalendarCheck2 className="w-3.5 h-3.5" />
            قسم الحضور والمتابعة
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-stone-900 mb-2">حضوري ومتابعتي</h1>
          <p className="text-stone-600">
            أهلاً {profile?.full_name || 'طالبنا'} — تابع التزامك بالحصص وحالة كل درس من مكان واحد.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 font-semibold hover:bg-stone-50"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
          <Link
            to="/courses"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800"
          >
            <BookOpen className="w-4 h-4" />
            الذهاب للكورسات
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* Commitment hero */}
      <div className="mb-6 rounded-3xl border border-stone-200 bg-white shadow-sm p-5 md:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-amber-700" />
              <h2 className="font-bold text-stone-900 text-lg">نسبة الالتزام</h2>
            </div>
            <p className="text-sm text-stone-500 mb-3">
              نسبة الحصص المكتملة من إجمالي حصصك المتاحة ({completed} من {total})
            </p>
            <div className="h-4 rounded-full bg-stone-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-l from-emerald-500 via-amber-500 to-amber-700 transition-all duration-500"
                style={{ width: `${Math.min(100, commitment)}%` }}
              />
            </div>
          </div>
          <div className="shrink-0 text-center lg:text-left px-4">
            <p className="text-5xl font-black text-stone-900 tabular-nums">{commitment}%</p>
            <p className="text-xs text-stone-500 mt-1">مستوى الالتزام</p>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 mb-8">
        <StatCard
          icon={Target}
          label="نسبة الالتزام"
          value={`${commitment}%`}
          hint={`${completed}/${total || 0} حصة مكتملة`}
          tone="amber"
        />
        <StatCard
          icon={CheckCircle2}
          label="الحصص المكتملة"
          value={completed}
          hint="🟢 مكتملة"
          tone="green"
        />
        <StatCard
          icon={PlayCircle}
          label="قيد المتابعة"
          value={inProgress}
          hint="🟡 بدأت ولم تكتمل"
          tone="gold"
        />
        <StatCard
          icon={CircleDot}
          label="لم تبدأ"
          value={notStarted}
          hint="🔴 بانتظارك"
          tone="red"
        />
        <StatCard
          icon={Trophy}
          label="نقاط الحضور"
          value={points}
          hint="نقاط من إكمال الحصص"
          tone="stone"
        />
        <StatCard
          icon={Flame}
          label="سلسلة الحضور"
          value={streak}
          hint={streak > 0 ? 'أيام متتالية' : 'ابدأ اليوم لبناء سلسلتك'}
          tone="fire"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { id: 'all', label: `الكل (${total})` },
          { id: 'completed', label: `🟢 مكتملة (${completed})` },
          { id: 'in_progress', label: `🟡 قيد المتابعة (${inProgress})` },
          { id: 'not_started', label: `🔴 لم تبدأ (${notStarted})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilterStatus(t.id)}
            className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              filterStatus === t.id
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم الحصة أو الكورس..."
          className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
        />
        <select
          value={filterCourse}
          onChange={(e) => setFilterCourse(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600 bg-white"
        >
          <option value="">كل الكورسات</option>
          {courseOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Lessons list */}
      <section className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-stone-900 text-lg">قائمة الحصص</h2>
            <p className="text-xs text-stone-500 mt-1">
              حالة كل حصة: 🔴 لم تبدأ · 🟡 قيد المتابعة · 🟢 مكتملة
            </p>
          </div>
          <span className="text-sm text-stone-500 font-medium">{filteredLessons.length} حصة</span>
        </div>

        {filteredLessons.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarCheck2 className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <p className="text-stone-500 text-sm mb-4">
              {lessons.length === 0
                ? 'لا توجد حصص متاحة بعد. تصفّح الكورسات وابدأ أول حصة.'
                : 'لا توجد حصص مطابقة للبحث أو التصفية.'}
            </p>
            <Link to="/courses" className="text-amber-800 font-semibold text-sm">
              فتح الكورسات
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  <th className="text-right font-semibold px-4 py-3">الحصة</th>
                  <th className="text-right font-semibold px-4 py-3">الكورس</th>
                  <th className="text-right font-semibold px-4 py-3">النوع</th>
                  <th className="text-right font-semibold px-4 py-3">التقدم</th>
                  <th className="text-right font-semibold px-4 py-3">الحالة</th>
                  <th className="text-right font-semibold px-4 py-3">النقاط</th>
                  <th className="text-right font-semibold px-4 py-3">آخر نشاط</th>
                  <th className="text-right font-semibold px-4 py-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredLessons.map((row) => {
                  const meta = statusMeta(row.session_status);
                  const pct = Math.min(100, Number(row.progress_percent || 0) || 0);
                  const courseId = row.course_id;
                  return (
                    <tr key={`${row.lesson_id || row.id}-${row.course_id || ''}`} className="border-t border-stone-100 hover:bg-stone-50/60">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-stone-900">{row.lesson_title}</div>
                        {row.duration_minutes ? (
                          <div className="text-[11px] text-stone-400 mt-0.5 flex items-center gap-1">
                            <Clock3 className="w-3 h-3" />
                            {row.duration_minutes} د
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-stone-600">{row.course_title}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-stone-700">
                        {sessionTypeLabel(row.session_type)}
                      </td>
                      <td className="px-4 py-3 min-w-[140px]">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-stone-800 tabular-nums">{pct}%</span>
                          {row.session_type === 'external_link' && Number(row.active_seconds || 0) > 0 && (
                            <span className="text-stone-400">
                              {Math.floor(Number(row.active_seconds) / 60)}:{String(Math.floor(Number(row.active_seconds) % 60)).padStart(2, '0')}
                            </span>
                          )}
                        </div>
                        <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${meta.bar}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black border ${meta.className}`}>
                          {meta.full}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-stone-800 tabular-nums">
                        {Number(row.points_earned || 0) > 0
                          ? row.points_earned
                          : row.session_status === 'completed' && Number(row.session_points || 0) > 0
                            ? row.session_points
                            : Number(row.session_points || 0) > 0
                              ? `0/${row.session_points}`
                              : '—'}
                      </td>
                      <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-xs">
                        {formatDate(row.attended_at || row.session_started_at)}
                      </td>
                      <td className="px-4 py-3">
                        {courseId ? (
                          <Link
                            to={`/courses/${courseId}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-900 text-white hover:bg-stone-800"
                          >
                            {row.session_status === 'completed' ? 'مراجعة' : row.session_status === 'in_progress' ? 'متابعة' : 'ابدأ'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Attendance chart — lessons only (below lessons list) */}
      <div className="mt-5">
        <AttendanceStatusChart lessons={lessons} />
      </div>

      {/* ========== Student quizzes panel (existing quiz system) ========== */}
      <section className="mt-10 space-y-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-stone-900 text-white text-xs font-bold mb-2">
              <ClipboardList className="w-3.5 h-3.5" />
              قائمة الاختبارات
            </div>
            <h2 className="text-2xl font-black text-stone-900">اختباراتي</h2>
            <p className="text-sm text-stone-500 mt-1">
              اختبارات صفك الدراسي فقط — نفس نظام الاختبارات الحالي (المحاولات والنتائج محفوظة)
              {studentGrade ? ` · صفك: ${gradeLabel(studentGrade)}` : ''}
            </p>
          </div>
          <Link
            to="/quizzes"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            صفحة الاختبارات الكاملة
          </Link>
        </div>

        {/* Quiz summary */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <StatCard icon={ClipboardList} label="إجمالي الاختبارات" value={quizSummary.total} hint="المتاح لصفك" tone="stone" />
          <StatCard icon={CheckCircle2} label="المكتملة" value={quizSummary.completed} hint="🟢 مكتمل" tone="green" />
          <StatCard icon={PlayCircle} label="قيد المحاولة" value={quizSummary.in_progress} hint="🟡 جارية" tone="gold" />
          <StatCard icon={CircleDot} label="لم تبدأ" value={quizSummary.not_started} hint="🔴 بانتظارك" tone="red" />
          <StatCard icon={Target} label="متوسط الدرجات" value={`${quizSummary.average}%`} hint="من الاختبارات المكتملة" tone="amber" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: `الكل (${quizSummary.total})` },
            { id: 'completed', label: `🟢 مكتمل (${quizSummary.completed})` },
            { id: 'in_progress', label: `🟡 قيد المحاولة (${quizSummary.in_progress})` },
            { id: 'not_started', label: `🔴 لم يبدأ (${quizSummary.not_started})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setQuizFilterStatus(t.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                quizFilterStatus === t.id
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={quizSearch}
            onChange={(e) => setQuizSearch(e.target.value)}
            placeholder="بحث باسم الاختبار أو الحصة المرتبطة..."
            className="w-full pr-9 pl-3 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
          />
        </div>

        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-stone-900">الاختبارات المتاحة</h3>
              <p className="text-xs text-stone-500 mt-1">
                مرتبة حسب الأحدث · 🆕 للاختبارات الجديدة · الحصة المرتبطة للعرض فقط ولا تمنع الدخول
              </p>
            </div>
            <span className="text-sm text-stone-500 font-medium">{filteredQuizzes.length} اختبار</span>
          </div>

          {quizzesLoading ? (
            <div className="p-10">
              <LoadingSpinner text="جاري تحميل الاختبارات..." />
            </div>
          ) : !hasAccessCode && !isAdmin ? (
            <div className="p-10 text-center text-sm text-stone-600">
              أدخل <strong>كود الوصول</strong> أولاً لعرض اختبارات صفك.
              <div className="mt-3">
                <Link to="/profile" className="text-amber-800 font-semibold">
                  الملف الشخصي / كود الوصول
                </Link>
              </div>
            </div>
          ) : filteredQuizzes.length === 0 ? (
            <div className="p-12 text-center text-stone-500 text-sm">
              <ClipboardList className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              {accessibleQuizzes.length === 0
                ? 'لا توجد اختبارات متاحة لصفك حالياً.'
                : 'لا توجد اختبارات مطابقة للبحث أو التصفية.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-stone-50 text-stone-600">
                  <tr>
                    <th className="text-right font-semibold px-4 py-3">الاختبار</th>
                    <th className="text-right font-semibold px-4 py-3">الحصة المرتبطة</th>
                    <th className="text-right font-semibold px-4 py-3">عدد الأسئلة</th>
                    <th className="text-right font-semibold px-4 py-3">الحالة</th>
                    <th className="text-right font-semibold px-4 py-3">الدرجة / النسبة</th>
                    <th className="text-right font-semibold px-4 py-3">المحاولات</th>
                    <th className="text-right font-semibold px-4 py-3">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuizzes.map((quiz) => {
                    const st = quizStatusMeta(quiz._status);
                    const canStart = isAdmin || quiz._attempts_remaining > 0;
                    const actionLabel =
                      quiz._status === 'completed' && !canStart
                        ? 'عرض النتيجة'
                        : quiz._status === 'completed' && canStart
                          ? 'محاولة جديدة'
                          : quiz._status === 'in_progress'
                            ? 'استكمال الاختبار'
                            : 'ابدأ الاختبار';
                    const ActionIcon =
                      quiz._status === 'completed' && !canStart ? Eye : Play;

                    return (
                      <tr key={quiz.id} className="border-t border-stone-100 hover:bg-stone-50/70">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-stone-900 flex flex-wrap items-center gap-2">
                                <span>{quiz.title_ar || quiz.title}</span>
                                {quiz._is_new ? (
                                  <span className="inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-200">
                                    🆕 جديد
                                  </span>
                                ) : null}
                              </div>
                              {quiz.title_ar && quiz.title && quiz.title_ar !== quiz.title ? (
                                <div className="text-xs text-amber-800 mt-0.5">{quiz.title}</div>
                              ) : null}
                              <div className="text-[11px] text-stone-400 mt-1 flex items-center gap-1">
                                <Clock3 className="w-3 h-3" />
                                {quiz.duration_minutes || 20} دقيقة
                                {quiz.pass_percentage != null ? ` · نجاح من ${quiz.pass_percentage}%` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-stone-700">
                          {quiz._linked_lesson ? (
                            <div>
                              <div className="font-medium text-sm">{quiz._linked_lesson.lesson_title}</div>
                              {quiz._linked_lesson.course_title ? (
                                <div className="text-[11px] text-stone-400">{quiz._linked_lesson.course_title}</div>
                              ) : null}
                              <div className="text-[10px] text-stone-400 mt-0.5">للعرض فقط — لا يمنع الدخول</div>
                            </div>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-stone-800 tabular-nums">
                          {quiz._question_count || quiz._total_questions || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-black border ${st.className}`}>
                            {st.full}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {quiz._percentage != null ? (
                            <div>
                              <div className="font-black text-stone-900 tabular-nums">{quiz._percentage}%</div>
                              {quiz._score != null && quiz._total_questions != null ? (
                                <div className="text-[11px] text-stone-500">
                                  {quiz._score}/{quiz._total_questions}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-600 whitespace-nowrap">
                          {quiz._attempts_used}/{quiz._max_attempts}
                          {quiz._exhausted ? (
                            <span className="block text-[10px] text-emerald-700 font-semibold mt-0.5">اكتملت المحاولات</span>
                          ) : quiz._attempts_remaining > 0 && quiz._attempts_used > 0 ? (
                            <span className="block text-[10px] text-amber-800 font-semibold mt-0.5">
                              متبقي {quiz._attempts_remaining}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openQuizAction(quiz)}
                            disabled={!canStart && quiz._status !== 'completed'}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              quiz._status === 'completed' && !canStart
                                ? 'bg-stone-900 text-white hover:bg-stone-800'
                                : canStart
                                  ? 'bg-amber-700 text-white hover:bg-amber-800'
                                  : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                            }`}
                          >
                            <ActionIcon className="w-3.5 h-3.5" />
                            {actionLabel}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quiz level chart — quiz results only (below quizzes list) */}
        <QuizLevelChart
          results={
            // Prefer API quiz_results from attendance bundle + loaded results panel
            (Array.isArray(quizResults) && quizResults.length
              ? quizResults
              : Array.isArray(data?.quiz_results)
                ? data.quiz_results
                : []
            ).map((r) => ({
              ...r,
              quiz_title:
                r.quiz_title ||
                accessibleQuizzes.find((q) => Number(q.id) === Number(r.quiz_id))?.title_ar ||
                accessibleQuizzes.find((q) => Number(q.id) === Number(r.quiz_id))?.title ||
                `اختبار #${r.quiz_id}`,
            }))
          }
        />
      </section>

      {/* Course progress mini cards */}
      {Array.isArray(data?.course_progress) && data.course_progress.length > 0 && (
        <section className="mt-8">
          <h2 className="font-bold text-stone-900 text-lg mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-700" />
            تقدم الكورسات
          </h2>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.course_progress.map((course) => (
              <div key={course.course_id} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-bold text-stone-900">{course.course_title}</h3>
                    <p className="text-xs text-stone-500 mt-1">
                      🟢 {course.attended_lessons || 0}
                      {course.in_progress_lessons != null ? ` · 🟡 ${course.in_progress_lessons}` : ''}
                      {' · '}
                      من {course.total_lessons}
                    </p>
                  </div>
                  <span className="text-lg font-black text-stone-900 tabular-nums">{course.percent}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden mb-3">
                  <div
                    className="h-full rounded-full bg-gradient-to-l from-amber-600 to-stone-800"
                    style={{ width: `${course.percent}%` }}
                  />
                </div>
                <Link to={`/courses/${course.course_id}`} className="text-sm font-semibold text-amber-800">
                  فتح الكورس
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {isStaffRole(profile?.role) && (
        <div className="mt-8 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="flex items-center gap-2">
            <Award className="w-4 h-4" />
            كمشرف يمكنك إدارة حضور الطلاب من لوحة التحكم → الحضور والمتابعة.
          </p>
          <Link to="/admin" className="font-semibold underline underline-offset-2">
            فتح لوحة التحكم
          </Link>
        </div>
      )}
    </div>
  );
}
