import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CalendarCheck2,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Flame,
  PlayCircle,
  Target,
  Trophy,
  User,
  BookOpen,
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
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

function statusMeta(status) {
  const s = String(status || 'not_started');
  if (s === 'completed') {
    return { full: '🟢 مكتملة', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  }
  if (s === 'in_progress' || s === 'present') {
    return { full: '🟡 قيد المتابعة', cls: 'bg-amber-50 text-amber-900 border-amber-200' };
  }
  return { full: '🔴 لم تبدأ', cls: 'bg-red-50 text-red-800 border-red-200' };
}

function Stat({ label, value, hint, icon: Icon, tone = 'amber' }) {
  const tones = {
    amber: 'from-amber-700 to-stone-800',
    green: 'from-emerald-700 to-stone-800',
    gold: 'from-yellow-700 to-amber-900',
    red: 'from-red-700 to-stone-900',
    stone: 'from-stone-700 to-zinc-900',
    fire: 'from-orange-600 to-amber-900',
  };
  return (
    <div className={`rounded-2xl p-4 text-white bg-gradient-to-br ${tones[tone] || tones.amber} shadow-md`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white/80 text-xs mb-1">{label}</p>
          <p className="text-2xl font-black tabular-nums">{value}</p>
          {hint ? <p className="text-white/70 text-[11px] mt-1">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ParentTrack() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/parent-track?token=${encodeURIComponent(token || '')}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          throw new Error('استجابة غير صالحة');
        }
        if (!res.ok) throw new Error(json?.error || 'تعذر فتح صفحة المتابعة');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message || 'فشل التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (token) load();
    else {
      setError('رمز المتابعة مفقود');
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  const stats = data?.stats || {};
  const lessons = Array.isArray(data?.lessons) ? data.lessons : [];
  const quizzes = Array.isArray(data?.quiz_results) ? data.quiz_results : [];

  const counts = useMemo(() => {
    return {
      completed: Number(stats.lessons_completed ?? lessons.filter((l) => l.session_status === 'completed').length) || 0,
      in_progress: Number(stats.lessons_in_progress ?? lessons.filter((l) => l.session_status === 'in_progress').length) || 0,
      not_started: Number(stats.lessons_not_started ?? lessons.filter((l) => l.session_status === 'not_started').length) || 0,
      total: Number(stats.lessons_total ?? lessons.length) || 0,
    };
  }, [stats, lessons]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <LoadingSpinner text="جاري تحميل متابعة الطالب..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="bg-white border border-red-200 rounded-3xl p-8 shadow-sm">
          <CalendarCheck2 className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-stone-900 mb-2">تعذر فتح المتابعة</h1>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const name = data?.student_name || 'طالب';
  const grade = data?.grade_level || '';
  const commitment = Number(stats.commitment_percent || 0) || 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8" dir="rtl">
      <div className="mb-6 text-center sm:text-right">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold mb-3">
          <CalendarCheck2 className="w-3.5 h-3.5" />
          متابعة ولي الأمر · بدون تسجيل دخول
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-700 to-stone-800 text-white flex items-center justify-center shadow-lg mx-auto sm:mx-0">
            <User className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-stone-900">{name}</h1>
            {grade ? (
              <p className="mt-1 inline-flex px-2.5 py-1 rounded-lg bg-stone-100 text-stone-800 text-xs font-bold">
                المستوى / الصف: {gradeLabel(grade)}
              </p>
            ) : null}
            {!data?.activated ? (
              <p className="text-sm text-amber-800 mt-2 font-medium">
                {data?.message || 'لم يفعّل الطالب كود الوصول بعد — ستظهر البيانات بعد التفعيل'}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-bold text-stone-900 mb-2 flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-700" />
              نسبة الالتزام
            </p>
            <div className="h-3 rounded-full bg-stone-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-amber-700"
                style={{ width: `${Math.min(100, commitment)}%` }}
              />
            </div>
          </div>
          <div className="text-4xl font-black text-stone-900 tabular-nums">{commitment}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        <Stat icon={CheckCircle2} label="الحصص المكتملة" value={counts.completed} tone="green" />
        <Stat icon={PlayCircle} label="قيد المتابعة" value={counts.in_progress} tone="gold" />
        <Stat icon={CircleDot} label="لم تبدأ" value={counts.not_started} tone="red" />
        <Stat icon={Trophy} label="نقاط الحضور" value={stats.attendance_points ?? stats.total_points ?? 0} tone="stone" />
        <Stat icon={Flame} label="سلسلة الحضور" value={stats.attendance_streak ?? 0} hint="أيام متتالية" tone="fire" />
        <Stat
          icon={ClipboardList}
          label="متوسط الاختبارات"
          value={`${stats.average_score ?? 0}%`}
          hint={`${stats.quizzes_taken || 0} اختبار`}
          tone="amber"
        />
      </div>

      <section className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden mb-8">
        <div className="p-4 border-b border-stone-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-amber-700" />
          <h2 className="font-bold text-stone-900">الحصص والحضور</h2>
          <span className="text-xs text-stone-500 mr-auto">{counts.total} حصة</span>
        </div>
        {lessons.length === 0 ? (
          <div className="p-10 text-center text-stone-500 text-sm">لا توجد حصص مسجّلة بعد</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  <th className="text-right font-semibold px-3 py-3">الحصة</th>
                  <th className="text-right font-semibold px-3 py-3">النوع</th>
                  <th className="text-right font-semibold px-3 py-3">التقدم</th>
                  <th className="text-right font-semibold px-3 py-3">الحالة</th>
                  <th className="text-right font-semibold px-3 py-3">آخر نشاط</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((row) => {
                  const st = statusMeta(row.session_status);
                  return (
                    <tr key={row.lesson_id} className="border-t border-stone-100">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-stone-900">{row.lesson_title}</div>
                        <div className="text-[11px] text-stone-500">{row.course_title}</div>
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold">{sessionTypeLabel(row.session_type)}</td>
                      <td className="px-3 py-3 font-bold tabular-nums">{Math.round(Number(row.progress_percent || 0))}%</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-lg text-xs font-black border ${st.cls}`}>
                          {st.full}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-stone-500 whitespace-nowrap">
                        {formatDate(row.attended_at || row.session_started_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden mb-8">
        <div className="p-4 border-b border-stone-100 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-amber-700" />
          <h2 className="font-bold text-stone-900">الاختبارات والنتائج</h2>
        </div>
        {quizzes.length === 0 ? (
          <div className="p-10 text-center text-stone-500 text-sm">لا توجد نتائج اختبارات بعد</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  <th className="text-right font-semibold px-3 py-3">الاختبار</th>
                  <th className="text-right font-semibold px-3 py-3">الدرجة</th>
                  <th className="text-right font-semibold px-3 py-3">النسبة</th>
                  <th className="text-right font-semibold px-3 py-3">الحالة</th>
                  <th className="text-right font-semibold px-3 py-3">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {quizzes.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100">
                    <td className="px-3 py-3 font-semibold text-stone-900">{row.quiz_title}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.score}/{row.total_questions}
                    </td>
                    <td className="px-3 py-3 font-black tabular-nums">{row.percentage}%</td>
                    <td className="px-3 py-3">
                      {row.passed ? (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">ناجح</span>
                      ) : (
                        <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-md">يحتاج تحسين</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-stone-500 whitespace-nowrap">{formatDate(row.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-xs text-stone-400 pb-8">
        English Mastery · Mr. Sherif Atta · رابط آمن لمتابعة ولي الأمر
      </p>
    </div>
  );
}
