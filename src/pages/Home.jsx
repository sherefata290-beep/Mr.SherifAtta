import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, ClipboardList, Trophy, Star, ArrowLeft,
  Award, Target, Sparkles, CheckCircle2, Clock, Play, Lock
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import LeaderboardView from '../components/LeaderboardView';
import { useAuth } from '../contexts/AuthContext';
import { gradeLabel } from '../lib/grades';
import { isStaffRole } from '../lib/roles';
import {
  preloadImage,
  readCachedHomepageImage,
  writeCachedHomepageImage,
} from '../lib/imageOptimize';
import { apiFetch, onDataChanged } from '../lib/api';

const features = [
  {
    icon: BookOpen,
    title: 'كورسات متكاملة',
    desc: 'مناهج منظمة من المبتدئ حتى المتقدم مع دروس واضحة وتدريبات عملية.',
    bg: '#b45309',
  },
  {
    icon: ClipboardList,
    title: 'اختبارات تفاعلية',
    desc: 'قيّم مستواك باختبارات متعددة المستويات واحصل على نتائج فورية.',
    bg: '#44403c',
  },
  {
    icon: Trophy,
    title: 'منصة الأوائل',
    desc: 'نافس زملاءك وتصدّر قائمة الأوائل بنقاطك ونتائجك المميزة.',
    bg: '#92400e',
  },
  {
    icon: Target,
    title: 'متابعة التقدم',
    desc: 'تابع أداءك ونقاطك وتطورك في اللغة الإنجليزية خطوة بخطوة.',
    bg: '#292524',
  },
];

const levels = [
  { name: 'Beginner', nameAr: 'مبتدئ', bg: '#fef3c7', color: '#78350f' },
  { name: 'Intermediate', nameAr: 'متوسط', bg: '#e7e5e4', color: '#292524' },
  { name: 'Advanced', nameAr: 'متقدم', bg: '#d6d3d1', color: '#1c1917' },
];

export default function Home() {
  const [courses, setCourses] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [stats, setStats] = useState(null);
  // Show cached URL instantly on first paint (no blank wait)
  const [homeImage, setHomeImage] = useState(() => readCachedHomepageImage());
  const [loading, setLoading] = useState(true);
  const { user, profile } = useAuth();
  const isAdmin = isStaffRole(profile?.role);
  const studentGrade = profile?.grade_level || '';
  const hasAccessCode = Boolean(profile?.has_access);

  const canOpenItem = (item) => {
    if (isAdmin) return true;
    if (!user) return false;
    // Need both: grade (from signup) + redeemed access code
    if (!hasAccessCode || !studentGrade) return false;
    return !!item?.grade_level && item.grade_level === studentGrade;
  };

  // Sync URL from early bootstrap (main.tsx) — do NOT hide the image while loading
  useEffect(() => {
    let cancelled = false;
    const applyUrl = (url) => {
      if (cancelled) return;
      const next = url || '';
      setHomeImage((prev) => {
        if (prev === next) return prev;
        if (next) preloadImage(next);
        return next;
      });
      writeCachedHomepageImage(next);
    };

    const onReady = (e) => {
      if (e?.detail?.url != null) applyUrl(e.detail.url);
    };
    window.addEventListener('em:homepage-image', onReady);

    const fetchHomeImage = () => {
      apiFetch('/api/settings?key=homepage_image')
        .then((r) => (r.ok ? r.json() : { value: '' }))
        .then((setting) => applyUrl(setting?.value || ''))
        .catch(() => {});
    };

    // Prefer cached/preloaded path; always refresh in background for latest admin edits
    const cached = readCachedHomepageImage();
    if (cached) {
      applyUrl(cached);
    }
    fetchHomeImage();

    const unsubData = onDataChanged(() => { fetchHomeImage(); });

    return () => {
      cancelled = true;
      window.removeEventListener('em:homepage-image', onReady);
      unsubData();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const CACHE_KEY = 'em_home_catalog_v3';

    const newestFirst = (list) =>
      [...list].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

    /** For logged-in students: only their grade. Admin/guest: full catalog. */
    const filterForViewer = (list) => {
      if (!Array.isArray(list)) return [];
      const sorted = newestFirst(list);
      if (isAdmin || !user) return sorted;
      if (!studentGrade) return [];
      return sorted.filter((item) => item?.grade_level && item.grade_level === studentGrade);
    };

    const takeLatestForViewer = (payload, limit = 3) => filterForViewer(payload).slice(0, limit);

    // Instant paint from cache (re-filtered by current student grade)
    try {
      sessionStorage.removeItem('em_home_catalog_v1');
      sessionStorage.removeItem('em_home_catalog_v2');
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.courses)) {
          setCourses(takeLatestForViewer(parsed.courses, 3));
        }
        if (Array.isArray(parsed.quizzes)) {
          setQuizzes(takeLatestForViewer(parsed.quizzes, 3));
        }
        if (parsed.stats) setStats(parsed.stats);
        if (parsed.courses?.length || parsed.quizzes?.length) setLoading(false);
      }
    } catch { /* ignore */ }

    const load = async () => {
      try {
        const [cRes, qRes, sRes] = await Promise.all([
          apiFetch('/api/courses'),
          apiFetch('/api/quizzes'),
          apiFetch('/api/stats'),
        ]);

        const c = await cRes.json().catch(() => null);
        const q = await qRes.json().catch(() => null);
        const s = await sRes.json().catch(() => null);
        if (cancelled) return;

        if (Array.isArray(c)) setCourses(takeLatestForViewer(c, 3));
        if (Array.isArray(q)) setQuizzes(takeLatestForViewer(q, 3));
        if (s && !s.error) setStats(s);

        if (Array.isArray(c) || Array.isArray(q)) {
          try {
            sessionStorage.setItem(
              CACHE_KEY,
              JSON.stringify({
                courses: Array.isArray(c) ? newestFirst(c) : [],
                quizzes: Array.isArray(q) ? newestFirst(q) : [],
                stats: s && !s.error ? s : null,
                t: Date.now(),
              })
            );
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const unsubData = onDataChanged(() => {
      try {
        sessionStorage.removeItem(CACHE_KEY);
      } catch { /* ignore */ }
      load();
    });
    return () => {
      cancelled = true;
      unsubData();
    };
  }, [user, isAdmin, studentGrade]);

  return (
    <div style={{ backgroundColor: '#f5f5f4', color: '#1c1917' }}>
      {/* Hero */}
      <section className="relative overflow-hidden hero-gradient">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 right-10 w-72 h-72 hero-glow-amber rounded-full" />
          <div className="absolute bottom-10 left-10 w-96 h-96 hero-glow-charcoal rounded-full" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm mb-6"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fafaf9' }}
              >
                <Sparkles className="w-4 h-4" style={{ color: '#fcd34d' }} />
                <span>منصة تعليمية متخصصة في الإنجليزية</span>
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight mb-4" style={{ color: '#ffffff' }}>
                English Mastery
              </h1>
              <p className="text-xl md:text-2xl font-medium mb-3" style={{ color: '#fde68a' }}>
                مع المدرس Mr. Sherif Atta
              </p>
              <p className="text-lg leading-relaxed mb-8 max-w-lg" style={{ color: '#d6d3d1' }}>
                اتقن اللغة الإنجليزية بخطوات واضحة: كورسات منظمة، اختبارات تفاعلية، ومتابعة مستمرة لتقدمك.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/courses"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-colors shadow-lg"
                  style={{ backgroundColor: '#ffffff', color: '#92400e' }}
                >
                  استكشف الكورسات
                  <ArrowLeft className="w-4 h-4" />
                </Link>
                <Link
                  to="/quizzes"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-colors"
                  style={{ backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#ffffff' }}
                >
                  ابدأ اختباراً
                </Link>
              </div>
            </div>

            <div className="hidden md:block">
              <div
                className="relative rounded-3xl p-8 shadow-2xl"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <div className="flex items-center gap-4 mb-6">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black shadow-lg"
                    style={{ backgroundColor: '#b45309', color: '#ffffff' }}
                  >
                    SA
                  </div>
                  <div>
                    <div className="text-xl font-bold" style={{ color: '#ffffff' }}>Mr. Sherif Atta</div>
                    <div className="text-sm" style={{ color: '#fde68a' }}>مدرس اللغة الإنجليزية</div>
                  </div>
                </div>
                <ul className="space-y-3">
                  {['شرح مبسط ومنظم', 'تدريبات واختبارات عملية', 'متابعة مستوى الطلاب', 'منهج من المبتدئ للمتقدم'].map((item) => (
                    <li key={item} className="flex items-center gap-2" style={{ color: '#e7e5e4' }}>
                      <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: '#fbbf24' }} />
                      {item}
                    </li>
                  ))}
                </ul>
                {stats && (
                  <div className="grid grid-cols-3 gap-3 mt-8 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                    <div className="text-center">
                      <div className="text-2xl font-bold" style={{ color: '#ffffff' }}>{stats.courses}</div>
                      <div className="text-xs" style={{ color: '#fde68a' }}>كورسات</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold" style={{ color: '#ffffff' }}>{stats.quizzes}</div>
                      <div className="text-xs" style={{ color: '#fde68a' }}>اختبارات</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold" style={{ color: '#ffffff' }}>{stats.students}</div>
                      <div className="text-xs" style={{ color: '#fde68a' }}>طلاب</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Homepage featured image — full picture on phone, tablet & desktop */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 md:pt-16">
        <div
          className="home-feature-image"
          style={homeImage ? undefined : { minHeight: 220, lineHeight: 'normal' }}
        >
          {homeImage ? (
            <img
              src={homeImage}
              alt="English Mastery"
              decoding="async"
              loading="eager"
              fetchPriority="high"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1280px"
            />
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center w-full min-h-[220px]"
              style={{ color: '#d6d3d1' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: '#b45309' }}
              >
                <BookOpen className="w-8 h-8" style={{ color: '#ffffff' }} />
              </div>
              <p className="font-bold text-lg" style={{ color: '#ffffff' }}>مساحة صورة الواجهة الرئيسية</p>
              <p className="text-sm max-w-md" style={{ color: '#a8a29e' }}>
                يمكن للمشرف رفع صورة هنا من لوحة التحكم · تظهر فوق قسم «لماذا English Mastery؟»
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3" style={{ color: '#1c1917' }}>لماذا English Mastery؟</h2>
          <p className="max-w-2xl mx-auto" style={{ color: '#57534e' }}>تجربة تعليمية متكاملة تجمع بين الشرح المنظم والتقييم المستمر والتحفيز</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-lg"
                style={{ backgroundColor: f.bg }}
              >
                <f.icon className="w-6 h-6" style={{ color: '#ffffff' }} />
              </div>
              <h3 className="font-bold text-lg mb-2" style={{ color: '#1c1917' }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#57534e' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Levels */}
      <section className="py-14" style={{ backgroundColor: '#ffffff', borderTop: '1px solid #e7e5e4', borderBottom: '1px solid #e7e5e4' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3" style={{ color: '#1c1917' }}>مستويات التعلم</h2>
            <p style={{ color: '#57534e' }}>مسارات واضحة تناسب كل مستوى</p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {levels.map((l) => (
              <div
                key={l.name}
                className="px-8 py-4 rounded-2xl font-bold text-lg"
                style={{ backgroundColor: l.bg, color: l.color, border: '1px solid rgba(0,0,0,0.06)' }}
              >
                <span className="block text-center">{l.nameAr}</span>
                <span className="block text-center text-sm font-medium opacity-80">{l.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Courses */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold mb-1" style={{ color: '#1c1917' }}>أحدث الكورسات</h2>
            <p style={{ color: '#57534e' }}>
              {user && !isAdmin && studentGrade && hasAccessCode
                ? `كورسات صفك الدراسي: ${gradeLabel(studentGrade)}`
                : user && !isAdmin && studentGrade && !hasAccessCode
                  ? `صفك: ${gradeLabel(studentGrade)} — أدخل كود الوصول لفتح الكورسات`
                  : user && !isAdmin && !studentGrade
                    ? 'حدّد صفك الدراسي عند التسجيل ثم فعّل كود الوصول'
                    : 'ابدأ رحلتك مع أفضل الكورسات'}
            </p>
          </div>
          <Link to="/courses" className="font-semibold flex items-center gap-1" style={{ color: '#b45309' }}>
            عرض الكل
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </div>

        {user && !isAdmin && (!studentGrade || !hasAccessCode) && (
          <div
            className="mb-6 rounded-2xl px-4 py-3 text-sm font-medium"
            style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
          >
            {!studentGrade
              ? 'أكمل بيانات حسابك واختر الصف الدراسي، ثم أدخل كود الوصول من المدرس لفتح المحتوى.'
              : `صفك ${gradeLabel(studentGrade)} محفوظ — أدخل كود الوصول من المدرس لفتح الكورسات والاختبارات.`}
          </div>
        )}

        {loading ? (
          <LoadingSpinner />
        ) : courses.length === 0 ? (
          <div className="text-center py-12" style={{ color: '#78716c' }}>
            {user && !isAdmin && studentGrade
              ? `لا توجد كورسات منشورة حالياً لصف ${gradeLabel(studentGrade)}`
              : 'لا توجد كورسات حالياً'}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => {
              const openable = canOpenItem(course);
              const Wrapper = openable ? Link : 'div';
              const wrapperProps = openable
                ? { to: `/courses/${course.id}` }
                : {};
              return (
                <Wrapper
                  key={course.id}
                  {...wrapperProps}
                  className="group rounded-2xl shadow-sm overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all block"
                  style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
                >
                  <div className="course-cover flex items-center justify-center">
                    {course.image_url ? (
                      <img src={course.image_url} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <BookOpen className="w-12 h-12 sm:w-14 sm:h-14 relative z-[1]" style={{ color: 'rgba(255,255,255,0.85)' }} />
                    )}
                    {!openable && <div className="absolute inset-0 bg-black/35 z-[1]" />}
                    <span
                      className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-bold z-10"
                      style={{ backgroundColor: 'rgba(255,255,255,0.95)', color: '#92400e' }}
                    >
                      {course.grade_level ? gradeLabel(course.grade_level) : course.level}
                    </span>
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-lg mb-1 transition-colors" style={{ color: '#1c1917' }}>
                      {course.title_ar || course.title}
                    </h3>
                    <p className="text-sm mb-2" style={{ color: '#78716c' }}>{course.title}</p>
                    <p className="text-sm line-clamp-2 mb-3" style={{ color: '#57534e' }}>
                      {course.description_ar || course.description}
                    </p>
                    <div className="flex items-center justify-between text-xs" style={{ color: '#78716c' }}>
                      <span>{course.duration || '—'}</span>
                      {openable ? (
                        <span className="font-semibold" style={{ color: '#b45309' }}>عرض التفاصيل ←</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: '#78716c' }}>
                          <Lock className="w-3.5 h-3.5" />
                          {!user ? 'سجّل للفتح' : 'غير متاح لصفك'}
                        </span>
                      )}
                    </div>
                  </div>
                </Wrapper>
              );
            })}
          </div>
        )}
      </section>

      {/* Latest Quizzes */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
        <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold mb-1" style={{ color: '#1c1917' }}>أحدث الاختبارات</h2>
            <p style={{ color: '#57534e' }}>
              {user && !isAdmin && studentGrade && hasAccessCode
                ? `اختبارات صفك الدراسي: ${gradeLabel(studentGrade)}`
                : user && !isAdmin && studentGrade && !hasAccessCode
                  ? `صفك: ${gradeLabel(studentGrade)} — أدخل كود الوصول لفتح الاختبارات`
                  : user && !isAdmin && !studentGrade
                    ? 'حدّد صفك الدراسي عند التسجيل ثم فعّل كود الوصول'
                    : 'اختبر مستواك واحصل على نتائج فورية'}
            </p>
          </div>
          <Link to="/quizzes" className="font-semibold flex items-center gap-1" style={{ color: '#b45309' }}>
            عرض الكل
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : quizzes.length === 0 ? (
          <div className="text-center py-12" style={{ color: '#78716c' }}>
            {user && !isAdmin && studentGrade
              ? `لا توجد اختبارات منشورة حالياً لصف ${gradeLabel(studentGrade)}`
              : 'لا توجد اختبارات حالياً'}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.map((quiz) => {
              const openable = canOpenItem(quiz);
              return (
              <div
                key={quiz.id}
                className="rounded-2xl shadow-sm overflow-hidden flex flex-col hover:shadow-lg transition-shadow"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
              >
                <div className="quiz-cover flex items-center justify-center">
                  {quiz.image_url ? (
                    <img
                      src={quiz.image_url}
                      alt={quiz.title_ar || quiz.title}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <ClipboardList className="w-14 h-14 relative z-[1]" style={{ color: 'rgba(255,255,255,0.85)' }} />
                  )}
                  {!openable && <div className="absolute inset-0 bg-black/35 z-[1]" />}
                  <span
                    className="absolute top-3 left-3 px-2.5 py-1 rounded-lg text-xs font-bold z-10"
                    style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                  >
                    {quiz.grade_level ? gradeLabel(quiz.grade_level) : quiz.level}
                  </span>
                </div>
                <div className="p-5 flex flex-col flex-1">
                  <h3 className="font-bold text-lg mb-1" style={{ color: '#1c1917' }}>
                    {quiz.title_ar || quiz.title}
                  </h3>
                  <p className="text-sm mb-2 font-medium" style={{ color: '#b45309' }}>{quiz.title}</p>
                  <p className="text-sm line-clamp-3 mb-4 flex-1" style={{ color: '#57534e' }}>
                    {quiz.description || 'اختبار تفاعلي لقياس مستواك في اللغة الإنجليزية'}
                  </p>
                  <div
                    className="flex items-center justify-between pt-4"
                    style={{ borderTop: '1px solid #e7e5e4' }}
                  >
                    <span className="flex items-center gap-1 text-xs" style={{ color: '#78716c' }}>
                      <Clock className="w-3.5 h-3.5" />
                      {quiz.duration_minutes || 20} دقيقة
                    </span>
                    {openable ? (
                      <Link
                        to={`/quizzes/${quiz.id}`}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                        style={{ backgroundColor: '#b45309', color: '#ffffff' }}
                      >
                        <Play className="w-3.5 h-3.5" />
                        ابدأ
                      </Link>
                    ) : (
                      <Link
                        to={!user ? '/login' : '/quizzes'}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                        style={{ backgroundColor: '#e7e5e4', color: '#44403c' }}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        {!user ? 'سجّل للفتح' : 'غير متاح لصفك'}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-10">
        <div className="rounded-3xl banner-gradient p-8 md:p-12 text-center shadow-xl">
          <Award className="w-12 h-12 mx-auto mb-4" style={{ color: '#fcd34d' }} />
          <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: '#ffffff' }}>هل أنت مستعد للتميز؟</h2>
          <p className="mb-6 max-w-xl mx-auto" style={{ color: '#fef3c7' }}>
            {user
              ? 'تابع رحلتك في English Mastery مع Mr. Sherif Atta واستكشف الكورسات والاختبارات'
              : 'انضم لطلاب English Mastery وابدأ رحلتك مع Mr. Sherif Atta اليوم'}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {!user && (
              <Link
                to="/login"
                className="px-6 py-3 rounded-xl font-bold transition-colors"
                style={{ backgroundColor: '#ffffff', color: '#92400e' }}
              >
                إنشاء حساب
              </Link>
            )}
            {user && (
              <Link
                to="/courses"
                className="px-6 py-3 rounded-xl font-bold transition-colors"
                style={{ backgroundColor: '#ffffff', color: '#92400e' }}
              >
                استكشف الكورسات
              </Link>
            )}
            <Link
              to="/leaderboard"
              className="px-6 py-3 rounded-xl font-semibold transition-colors flex items-center gap-2"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.35)', color: '#ffffff' }}
            >
              <Star className="w-4 h-4" />
              منصة الأوائل
            </Link>
          </div>
        </div>
      </section>

      {/* منصة الأوائل — نفس الشكل والمظهر كما في صفحة منصة الأوائل */}
      <section className="pb-16">
        <LeaderboardView variant="home" />
      </section>
    </div>
  );
}
