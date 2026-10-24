import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Clock, Search, LogIn, Lock, Unlock, KeyRound } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import AccessGate from '../components/AccessGate';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, onDataChanged } from '../lib/api';
import { gradeLabel } from '../lib/grades';
import { isStaffRole } from '../lib/roles';

export default function Courses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  const [pendingCourseId, setPendingCourseId] = useState(null);
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const isAdmin = isStaffRole(profile?.role);
  const studentGrade = profile?.grade_level || '';
  // Grade at signup is not enough — must redeem access code
  const hasAccessCode = Boolean(profile?.has_access);

  useEffect(() => {
    // Wait for auth session AND profile (staff role) before choosing admin endpoint
    if (authLoading) return;
    if (user && !profile) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      try {
        // Everyone can browse the full catalog
        const res = await apiFetch(isAdmin ? '/api/courses?admin=true' : '/api/courses');
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'فشل تحميل الكورسات');
        if (!cancelled) setCourses(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e.message || 'فشل تحميل الكورسات');
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

  const canOpenCourse = (course) => {
    if (isAdmin) return true;
    if (!user) return false;
    // Must redeem access code first, then match grade
    if (!hasAccessCode) return false;
    return !!course.grade_level && !!studentGrade && course.grade_level === studentGrade;
  };

  const requestOpenCourse = (course) => {
    if (isAdmin) {
      navigate(`/courses/${course.id}`);
      return;
    }
    if (!user) {
      navigate('/login');
      return;
    }
    if (!hasAccessCode) {
      setPendingCourseId(course.id);
      setGateOpen(true);
      return;
    }
    if (canOpenCourse(course)) {
      navigate(`/courses/${course.id}`);
      return;
    }
    setPendingCourseId(null);
    setGateOpen(true);
  };

  const handleGateSuccess = (data) => {
    setGateOpen(false);
    const grade = data?.grade_level || studentGrade || '';
    const unlocked = data?.has_access !== false;
    if (unlocked && pendingCourseId) {
      const course = courses.find((c) => String(c.id) === String(pendingCourseId));
      if (course && course.grade_level && grade && course.grade_level === grade) {
        navigate(`/courses/${pendingCourseId}`);
        setPendingCourseId(null);
        return;
      }
    }
    setPendingCourseId(null);
  };

  const filtered = courses.filter((c) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      c.title?.toLowerCase().includes(q) ||
      c.title_ar?.includes(search) ||
      c.description?.toLowerCase().includes(q) ||
      gradeLabel(c.grade_level).includes(search)
    );
  });

  // Sort: unlocked first for logged-in students
  const sorted = [...filtered].sort((a, b) => {
    if (isAdmin || !user) return 0;
    const ao = canOpenCourse(a) ? 0 : 1;
    const bo = canOpenCourse(b) ? 0 : 1;
    return ao - bo;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">الكورسات</h1>
        <p className="text-stone-600">
          تصفح كل الكورسات — اختر صفك عند التسجيل ثم فعّل كود الوصول لفتح كورسات صفك
          {user && !isAdmin && studentGrade ? ` · صفك: ${gradeLabel(studentGrade)}` : ''}
          {user && !isAdmin && studentGrade && !hasAccessCode ? ' · بانتظار كود الوصول' : ''}
        </p>
      </div>

      {!user && (
        <div className="mb-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p>يمكنك مشاهدة قائمة الكورسات. سجّل الدخول ثم أدخل كود الوصول لفتح كورسات صفك.</p>
          <Link to="/login" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 shrink-0">
            <LogIn className="w-4 h-4" />
            تسجيل الدخول
          </Link>
        </div>
      )}

      {user && !isAdmin && !hasAccessCode && (
        <div className="mb-6 p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="font-medium">الكورسات مقفلة — أدخل كود الوصول الذي حصلت عليه من المدرس قبل فتح أي كورس.</p>
          <button
            type="button"
            onClick={() => { setPendingCourseId(null); setGateOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 shrink-0"
          >
            <KeyRound className="w-4 h-4" />
            إدخال كود الوصول
          </button>
        </div>
      )}

      <div className="relative mb-8 max-w-xl">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder="ابحث عن كورس أو صف..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
        />
      </div>

      {loading || authLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="text-center py-16 text-red-600">{error}</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-stone-500">لا توجد كورسات حالياً</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {sorted.map((course) => {
            const openable = canOpenCourse(course);
            return (
              <div
                key={course.id}
                className={`group bg-white rounded-2xl border shadow-sm overflow-hidden transition-all flex flex-col ${
                  openable
                    ? 'border-stone-200 hover:shadow-lg hover:-translate-y-0.5'
                    : 'border-stone-200 opacity-95'
                }`}
              >
                <div className="course-cover flex items-center justify-center">
                  {course.image_url ? (
                    <img src={course.image_url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <BookOpen className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 text-white/70 relative z-[1]" />
                  )}
                  {!openable && (
                    <div className="absolute inset-0 bg-black/35 z-[1]" />
                  )}
                  {course.grade_level && (
                    <span className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold bg-white/95 text-amber-900 z-10">
                      {gradeLabel(course.grade_level)}
                    </span>
                  )}
                  {!openable && (
                    <span className="absolute bottom-2 sm:bottom-3 right-2 sm:right-3 z-10 inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold bg-stone-900/85 text-white">
                      <Lock className="w-3.5 h-3.5" />
                      مقفول
                    </span>
                  )}
                </div>
                <div className="p-5 flex flex-col flex-1">
                  <h3 className="font-bold text-stone-900 text-lg mb-0.5">
                    {course.title_ar || course.title}
                  </h3>
                  <p className="text-sm text-amber-700/80 mb-2 font-medium">{course.title}</p>
                  <p className="text-stone-600 text-sm line-clamp-3 mb-4 flex-1">
                    {course.description_ar || course.description}
                  </p>
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-stone-100">
                    <span className="flex items-center gap-1 text-xs text-stone-500">
                      <Clock className="w-3.5 h-3.5" />
                      {course.duration || 'غير محدد'}
                    </span>
                    {openable ? (
                      <button
                        type="button"
                        onClick={() => requestOpenCourse(course)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-700 text-white hover:bg-amber-800 transition-colors"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        فتح الكورس
                      </button>
                    ) : !user ? (
                      <Link
                        to="/login"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-stone-200 text-stone-700 hover:bg-stone-300 transition-colors"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        سجّل للفتح
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => requestOpenCourse(course)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-stone-900 text-white hover:bg-stone-800 transition-colors"
                        title={!hasAccessCode ? 'أدخل كود الوصول أولاً' : 'هذا الكورس لصف آخر — يمكنك إدخال كود آخر'}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {!hasAccessCode ? 'أدخل الكود للفتح' : 'مقفول لصفك'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {gateOpen && (
        <AccessGate
          mode="modal"
          title="كود الوصول مطلوب"
          description="لا يمكن فتح الكورس قبل تفعيل كود الوصول. أدخل الكود الذي حصلت عليه من المدرس."
          onClose={() => { setGateOpen(false); setPendingCourseId(null); }}
          onSuccess={handleGateSuccess}
        />
      )}
    </div>
  );
}
