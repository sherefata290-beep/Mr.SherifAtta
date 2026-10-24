import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  CircleDot,
  Flame,
  PlayCircle,
  RefreshCw,
  Target,
  Trophy,
  User,
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import { apiFetch } from '../lib/api';
import { gradeLabel } from '../lib/grades';
import { sessionTypeLabel } from '../lib/sessionTypes';

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
    return '—';
  }
}

function formatSec(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const r = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function statusMeta(status) {
  const s = String(status || 'not_started');
  if (s === 'completed') {
    return { full: '🟢 مكتملة', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  }
  if (s === 'in_progress' || s === 'present') {
    return { full: '🟡 قيد المتابعة', cls: 'bg-amber-50 text-amber-900 border-amber-200' };
  }
  if (s === 'absent') {
    return { full: 'غائب', cls: 'bg-stone-100 text-stone-700 border-stone-200' };
  }
  if (s === 'excused') {
    return { full: 'بعذر', cls: 'bg-stone-100 text-stone-700 border-stone-200' };
  }
  return { full: '🔴 لم تبدأ', cls: 'bg-red-50 text-red-800 border-red-200' };
}

function quizMeta(row) {
  if (row.quiz_status === 'completed' || row.lesson_quiz_status === 'completed') {
    return { full: 'مكتمل', cls: 'bg-emerald-50 text-emerald-800' };
  }
  if (row.quiz_status === 'started' || row.lesson_quiz_status === 'started') {
    return { full: 'بدأ', cls: 'bg-amber-50 text-amber-900' };
  }
  if (row.linked_quiz_id) {
    return { full: 'لم يبدأ', cls: 'bg-stone-100 text-stone-600' };
  }
  return { full: '—', cls: 'text-stone-400' };
}

function StatCard({ icon: Icon, label, value, hint, tone = 'amber' }) {
  const tones = {
    amber: 'from-amber-700 to-stone-800',
    stone: 'from-stone-700 to-zinc-900',
    green: 'from-emerald-700 to-stone-800',
    gold: 'from-yellow-700 to-amber-900',
    fire: 'from-orange-600 to-amber-900',
    red: 'from-red-700 to-stone-900',
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

export default function AdminStudentAttendance() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [profile, setProfile] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const [bundleRes, profileRes] = await Promise.all([
        apiFetch(`/api/attendance?admin=true&summary=true&user_id=${encodeURIComponent(userId)}`),
        apiFetch(`/api/profiles?id=${encodeURIComponent(userId)}`),
      ]);

      const bundleText = await bundleRes.text();
      let bundle = null;
      try {
        bundle = bundleText ? JSON.parse(bundleText) : null;
      } catch {
        throw new Error('استجابة غير صالحة من الخادم');
      }
      if (!bundleRes.ok) throw new Error(bundle?.error || 'فشل تحميل تفاصيل الطالب');

      const profileJson = await profileRes.json().catch(() => null);
      if (profileRes.ok && profileJson && profileJson.id) {
        setProfile(profileJson);
      } else {
        setProfile(null);
      }
      setData(bundle);
    } catch (err) {
      setError(err.message || 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const stats = data?.stats || {};
  const lessons = useMemo(() => {
    if (Array.isArray(data?.lessons) && data.lessons.length) return data.lessons;
    if (Array.isArray(data?.attendance)) {
      return data.attendance.map((row) => ({
        ...row,
        lesson_id: row.lesson_id,
        lesson_title: row.lesson_title,
        session_status: row.session_status || row.status,
      }));
    }
    return [];
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lessons.filter((row) => {
      const st = row.session_status || row.status || 'not_started';
      if (filterStatus !== 'all' && st !== filterStatus) return false;
      if (!q) return true;
      const hay = `${row.lesson_title || ''} ${row.course_title || ''} ${sessionTypeLabel(row.session_type)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [lessons, filterStatus, search]);

  const studentName =
    profile?.full_name ||
    data?.attendance?.[0]?.student_name ||
    data?.user_name ||
    'طالب';
  const studentEmail = profile?.email || data?.attendance?.[0]?.student_email || '';
  const studentGrade = profile?.grade_level || stats.student_grade || '';

  const commitment = Number(stats.commitment_percent ?? 0) || 0;
  const completed = Number(stats.lessons_completed ?? 0) || 0;
  const inProgress = Number(stats.lessons_in_progress ?? 0) || 0;
  const notStarted = Number(stats.lessons_not_started ?? 0) || 0;
  const total = Number(stats.lessons_total ?? lessons.length) || 0;
  const points = Number(stats.attendance_points ?? stats.total_points ?? profile?.total_points ?? 0) || 0;
  const streak = Number(stats.attendance_streak ?? 0) || 0;

  if (loading) return <LoadingSpinner text="جاري تحميل تفاصيل حضور الطالب..." />;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin?tab=attendance')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 hover:text-amber-950 mb-3"
          >
            <ArrowRight className="w-4 h-4" />
            العودة للحضور والمتابعة
          </button>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold mb-3">
            <CalendarCheck2 className="w-3.5 h-3.5" />
            تفاصيل حضور الطالب
          </div>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-700 to-stone-800 text-white flex items-center justify-center shrink-0 shadow-lg">
              <User className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-stone-900 mb-1">{studentName}</h1>
              {studentEmail ? (
                <p className="text-stone-500 text-sm" dir="ltr">
                  {studentEmail}
                </p>
              ) : null}
              {studentGrade ? (
                <p className="mt-2 inline-flex px-2.5 py-1 rounded-lg bg-stone-100 text-stone-800 text-xs font-bold">
                  {gradeLabel(studentGrade)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 font-semibold hover:bg-stone-50"
        >
          <RefreshCw className="w-4 h-4" />
          تحديث
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      <div className="mb-6 rounded-3xl border border-stone-200 bg-white shadow-sm p-5 md:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-amber-700" />
              <h2 className="font-bold text-stone-900 text-lg">نسبة الالتزام</h2>
            </div>
            <p className="text-sm text-stone-500 mb-3">
              الحصص المكتملة من إجمالي الحصص المتاحة ({completed} من {total})
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

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4 mb-8">
        <StatCard icon={Target} label="نسبة الالتزام" value={`${commitment}%`} hint={`${completed}/${total} مكتملة`} tone="amber" />
        <StatCard icon={CheckCircle2} label="الحصص المكتملة" value={completed} hint={`🟡 ${inProgress} · 🔴 ${notStarted}`} tone="green" />
        <StatCard icon={Trophy} label="نقاط الحضور" value={points} hint="من إكمال الحصص" tone="stone" />
        <StatCard icon={Flame} label="سلسلة الحضور" value={streak} hint={streak > 0 ? 'أيام متتالية' : 'لا توجد سلسلة حالية'} tone="fire" />
        <StatCard icon={PlayCircle} label="قيد المتابعة" value={inProgress} hint="بدأت ولم تكتمل" tone="gold" />
      </div>

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

      <div className="mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم الحصة أو الكورس..."
          className="w-full md:max-w-md px-4 py-2.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
        />
      </div>

      <section className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-stone-900 text-lg">سجل الحصص</h2>
            <p className="text-xs text-stone-500 mt-1">
              اسم الحصة · النوع · وقت البدء · مدة المتابعة · المشاهدة · الحضور · الاختبار · النقاط
            </p>
          </div>
          <span className="text-sm text-stone-500 font-medium">{filtered.length} حصة</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">
            <CircleDot className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            لا توجد حصص مطابقة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1200px]">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  <th className="text-right font-semibold px-3 py-3">الحصة</th>
                  <th className="text-right font-semibold px-3 py-3">نوع الحصة</th>
                  <th className="text-right font-semibold px-3 py-3">وقت البدء</th>
                  <th className="text-right font-semibold px-3 py-3">مدة المتابعة</th>
                  <th className="text-right font-semibold px-3 py-3">نسبة المشاهدة</th>
                  <th className="text-right font-semibold px-3 py-3">حالة الحضور</th>
                  <th className="text-right font-semibold px-3 py-3">حالة الاختبار</th>
                  <th className="text-right font-semibold px-3 py-3">درجة الاختبار</th>
                  <th className="text-right font-semibold px-3 py-3">النقاط المكتسبة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const st = statusMeta(row.session_status || row.status);
                  const qz = quizMeta(row);
                  const isVideo = (row.session_type || 'recorded_video') === 'recorded_video';
                  const isExternal = row.session_type === 'external_link';
                  const startAt = row.session_started_at || row.attended_at || null;
                  const durationSec = isExternal
                    ? Number(row.active_seconds || row.external_seconds || row.watched_seconds || 0)
                    : Number(row.watched_seconds || row.active_seconds || 0);
                  const requiredSec = Number(row.required_seconds || row.external_required_seconds || 0);
                  const watchPct = isVideo
                    ? Math.round(Number(row.progress_percent ?? row.watch_percent ?? 0) * 10) / 10
                    : null;
                  const earned =
                    Number(row.points_earned || 0) > 0
                      ? Number(row.points_earned)
                      : row.session_status === 'completed' || row.status === 'completed'
                        ? Number(row.session_points || row.lesson_points || 0) || 0
                        : 0;
                  const quizPct = row.quiz_percentage ?? row.percentage;
                  const quizScore = row.quiz_score ?? row.score;
                  const quizTotal = row.quiz_total_questions ?? row.total_questions;
                  const quizCorrect = row.quiz_correct_answers ?? row.correct_answers;

                  return (
                    <tr
                      key={`${row.lesson_id || row.id}_${row.course_id || ''}`}
                      className="border-t border-stone-100 hover:bg-stone-50/60"
                    >
                      <td className="px-3 py-3">
                        <div className="font-semibold text-stone-900">{row.lesson_title || `درس #${row.lesson_id}`}</div>
                        <div className="text-[11px] text-stone-500 mt-0.5">{row.course_title || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-stone-700 whitespace-nowrap">
                        {sessionTypeLabel(row.session_type)}
                      </td>
                      <td className="px-3 py-3 text-stone-600 whitespace-nowrap text-xs">
                        {formatDate(startAt)}
                      </td>
                      <td className="px-3 py-3 font-semibold text-stone-800 whitespace-nowrap">
                        {durationSec > 0 || requiredSec > 0 ? (
                          <>
                            {formatSec(durationSec)}
                            {requiredSec > 0 ? (
                              <span className="text-stone-400 font-medium"> / {formatSec(requiredSec)}</span>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-3 font-semibold text-stone-800 whitespace-nowrap">
                        {isVideo ? (
                          <>
                            {watchPct ?? 0}%
                            {row.required_watch_percent ? (
                              <span className="block text-[10px] text-stone-400 font-medium">
                                المطلوب {row.required_watch_percent}%
                              </span>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-black border ${st.cls}`}>
                          {st.full}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-lg text-xs font-bold ${qz.cls}`}>
                          {qz.full}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-bold text-stone-900 whitespace-nowrap">
                        {quizPct != null
                          ? `${quizPct}%`
                          : quizScore != null
                            ? `${quizScore}${quizTotal != null ? `/${quizTotal}` : ''}`
                            : '—'}
                        {quizCorrect != null && quizTotal != null ? (
                          <span className="block text-[10px] text-stone-400 font-medium">
                            صحيحة {quizCorrect}/{quizTotal}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-black text-amber-900 tabular-nums">
                        {earned > 0 ? earned : Number(row.session_points || row.lesson_points || 0) > 0 ? `0/${row.session_points || row.lesson_points}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6">
        <Link
          to="/admin?tab=attendance"
          className="inline-flex items-center gap-2 text-sm font-semibold text-amber-800 hover:text-amber-950"
        >
          <ArrowRight className="w-4 h-4" />
          رجوع لتقرير الحضور
        </Link>
      </div>
    </div>
  );
}
