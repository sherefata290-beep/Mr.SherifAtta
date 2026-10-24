import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy, Star, Award, Crown, GraduationCap, Sparkles, Users, ArrowLeft,
} from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import LeaderboardPodium, {
  StudentRow,
  personName,
} from './LeaderboardPodium';
import { GRADE_OPTIONS } from '../lib/grades';
import { onDataChanged } from '../lib/api';

/**
 * Shared leaderboard UI — used on the Leaderboard page and homepage.
 * @param {'page'|'home'} variant
 */
export default function LeaderboardView({ variant = 'page' }) {
  const isHome = variant === 'home';
  const [students, setStudents] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [topResults, setTopResults] = useState([]);
  const [podiumFromApi, setPodiumFromApi] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('points');
  const [gradeFilter, setGradeFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/leaderboard?t=${Date.now()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل تحميل منصة الأوائل');
        if (cancelled) return;

        const sortedStudents = (Array.isArray(data.students) ? data.students : [])
          .slice()
          .sort((a, b) => (Number(b.total_points) || 0) - (Number(a.total_points) || 0));
        const sortedFeatured = (Array.isArray(data.featured) ? data.featured : [])
          .slice()
          .sort((a, b) => {
            const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
            if (so !== 0) return so;
            return (Number(b.points) || 0) - (Number(a.points) || 0);
          });
        const sortedResults = (Array.isArray(data.topResults) ? data.topResults : [])
          .slice()
          .sort((a, b) => (Number(b.percentage) || 0) - (Number(a.percentage) || 0));
        const apiPodium = Array.isArray(data.podium) ? data.podium : [];

        setStudents(sortedStudents);
        setFeatured(sortedFeatured);
        setTopResults(sortedResults);
        setPodiumFromApi(apiPodium);
        setConfig(data.config || {
          title: 'منصة الأوائل',
          subtitle: 'أفضل طلاب English Mastery · Mr. Sherif Atta',
          enabled: true,
          show_auto_ranking: true,
          show_top_results: true,
          show_featured: true,
        });

        const cfg = data.config || {};
        if (cfg.show_auto_ranking !== false && sortedStudents.length) setTab('points');
        else if (cfg.show_featured !== false && sortedFeatured.length) setTab('featured');
        else if (cfg.show_top_results !== false && sortedResults.length) setTab('results');
        else if (apiPodium.length) setTab('points');
        else setTab('points');
      } catch (err) {
        if (!cancelled) setError(err.message || 'فشل تحميل منصة الأوائل');
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
  }, []);

  const filteredStudents = useMemo(() => {
    if (gradeFilter === 'all') return students;
    return students.filter((s) => s.grade_level === gradeFilter);
  }, [students, gradeFilter]);

  const title = config?.title || 'منصة الأوائل';
  const subtitle = config?.subtitle || 'أفضل طلاب English Mastery · Mr. Sherif Atta';

  const listForTab = useMemo(() => {
    let list;
    if (tab === 'featured') list = featured;
    else if (tab === 'results') {
      list = topResults.map((r) => ({
        ...r,
        full_name: r.user_name || r.full_name || 'طالب',
        display_name: r.user_name || r.full_name || 'طالب',
      }));
    } else {
      list = filteredStudents;
    }
    // Homepage: only the top 3 students (no full ranking list)
    if (isHome) return list.slice(0, 3);
    return list;
  }, [tab, featured, topResults, filteredStudents, isHome]);

  const podiumItems = useMemo(() => {
    if (tab === 'points') {
      if (filteredStudents.length) return filteredStudents.slice(0, 3);
      if (students.length) return students.slice(0, 3);
      if (podiumFromApi.length) return podiumFromApi.slice(0, 3);
      if (featured.length) return featured.slice(0, 3);
      return [];
    }
    if (tab === 'featured') {
      if (featured.length) return featured.slice(0, 3);
      if (podiumFromApi.length) return podiumFromApi.slice(0, 3);
      return [];
    }
    if (topResults.length) {
      return topResults.slice(0, 3).map((r) => ({
        ...r,
        full_name: r.user_name || 'طالب',
        display_name: r.user_name || 'طالب',
      }));
    }
    return podiumFromApi.slice(0, 3);
  }, [tab, filteredStudents, students, featured, topResults, podiumFromApi]);

  const tabs = [
    config?.show_auto_ranking !== false && { id: 'points', label: 'ترتيب النقاط', icon: Star },
    config?.show_featured !== false && { id: 'featured', label: 'المتفوقون المميزون', icon: Crown },
    config?.show_top_results !== false && { id: 'results', label: 'أعلى النتائج', icon: Award },
  ].filter(Boolean);

  const nameKey = tab === 'featured' ? 'display_name' : 'full_name';

  // Homepage: compact preview — only top 3 students + link to full page
  if (isHome) {
    const homeTop3 = (() => {
      if (filteredStudents.length) return filteredStudents.slice(0, 3);
      if (students.length) return students.slice(0, 3);
      if (podiumFromApi.length) return podiumFromApi.slice(0, 3);
      if (featured.length) return featured.slice(0, 3);
      return [];
    })();
    const homeNameKey = homeTop3[0]?.display_name != null && !homeTop3[0]?.full_name && !homeTop3[0]?.total_points
      ? 'display_name'
      : 'full_name';

    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 10px 30px rgba(180,83,9,0.35)' }}
          >
            <Trophy className="w-7 h-7" style={{ color: '#ffffff' }} />
          </div>
          <h2 className="text-2xl md:text-3xl font-black mb-2" style={{ color: '#1c1917' }}>
            {title}
          </h2>
          <p className="text-sm md:text-base max-w-lg mx-auto" style={{ color: '#78716c' }}>
            أفضل 3 طلاب حالياً — نافس وتصدّر القائمة
          </p>
        </div>

        {loading ? (
          <div className="bg-white rounded-3xl border border-stone-200 shadow-lg p-8">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-600 bg-white rounded-3xl border border-stone-200 shadow-lg">
            {error}
          </div>
        ) : config && config.enabled === false ? (
          <div className="text-center py-12 text-stone-500 bg-white rounded-3xl border border-stone-200 shadow-lg">
            منصة الأوائل غير متاحة حالياً
          </div>
        ) : homeTop3.length === 0 ? (
          <div
            className="text-center py-12 rounded-3xl"
            style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
          >
            <Trophy className="w-12 h-12 mx-auto mb-3" style={{ color: '#d6d3d1' }} />
            <p className="font-medium" style={{ color: '#78716c' }}>لا يوجد طلاب بعد — كن أول المتفوقين!</p>
          </div>
        ) : (
          <div className="space-y-5">
            <LeaderboardPodium items={homeTop3} nameKey={homeNameKey} title={title} />

            <div
              className="rounded-3xl p-4 sm:p-5 shadow-lg"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
            >
              <div className="space-y-2.5">
                {homeTop3.map((s, i) => (
                  <StudentRow
                    key={s.id || `${personName(s, homeNameKey)}-${i}`}
                    student={s}
                    index={i}
                    nameKey={homeNameKey}
                  />
                ))}
              </div>
              <div className="mt-5 text-center">
                <Link
                  to="/leaderboard"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
                  style={{ backgroundColor: '#b45309', color: '#ffffff' }}
                >
                  عرض منصة الأوائل كاملة
                  <ArrowLeft className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-[70vh]" style={{ backgroundColor: '#f5f5f4' }}>
      <section
        className="relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0c0a09 0%, #1c1917 40%, #292524 70%, #451a03 100%)',
          color: '#fafaf9',
        }}
      >
        <div className="absolute inset-0 pointer-events-none opacity-40">
          <div className="absolute top-0 right-1/4 w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle,rgba(251,191,36,0.35),transparent 70%)' }} />
          <div className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full" style={{ background: 'radial-gradient(circle,rgba(180,83,9,0.3),transparent 70%)' }} />
        </div>
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center py-12 md:py-16">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-5"
            style={{ backgroundColor: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', color: '#fde68a' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            تنافس · تميز · تصدر القائمة
          </div>
          <div
            className="inline-flex items-center justify-center w-16 h-16 md:w-20 md:h-20 rounded-2xl mb-5 shadow-xl"
            style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 12px 40px rgba(180,83,9,0.45)' }}
          >
            <Trophy className="w-8 h-8 md:w-10 md:h-10" style={{ color: '#ffffff' }} />
          </div>
          <h1 className="font-black mb-3 tracking-tight text-3xl md:text-5xl" style={{ color: '#ffffff' }}>
            {title}
          </h1>
          <p className="text-base md:text-lg max-w-xl mx-auto" style={{ color: '#d6d3d1' }}>
            {subtitle}
          </p>
          {!loading && !error && config?.enabled !== false && (
            <div className="flex flex-wrap justify-center gap-3 mt-8">
              {[
                { icon: Users, label: 'طلاب', value: students.length },
                { icon: Crown, label: 'مميزون', value: featured.length },
                { icon: Award, label: 'نتائج', value: topResults.length },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
                  style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <s.icon className="w-4 h-4" style={{ color: '#fbbf24' }} />
                  <span style={{ color: '#a8a29e' }}>{s.label}</span>
                  <span className="font-black" style={{ color: '#ffffff' }}>{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-6 relative z-10 pb-16">
        {loading ? (
          <div className="bg-white rounded-3xl border border-stone-200 shadow-lg p-8">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-600 bg-white rounded-3xl border border-stone-200 shadow-lg">
            {error}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-xl text-sm font-bold"
                style={{ backgroundColor: '#b45309', color: '#fff' }}
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        ) : config && config.enabled === false ? (
          <div className="text-center py-16 text-stone-500 bg-white rounded-3xl border border-stone-200 shadow-lg">
            منصة الأوائل غير متاحة حالياً
          </div>
        ) : (
          <div className="space-y-6">
            <div
              className="flex flex-wrap justify-center gap-2 p-2 rounded-2xl shadow-lg"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
            >
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={
                      active
                        ? { backgroundColor: '#b45309', color: '#ffffff', boxShadow: '0 4px 14px rgba(180,83,9,0.35)' }
                        : { backgroundColor: 'transparent', color: '#57534e' }
                    }
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {tab === 'points' && students.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-2 justify-center p-3 rounded-2xl"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
              >
                <span className="text-sm font-medium flex items-center gap-1" style={{ color: '#78716c' }}>
                  <GraduationCap className="w-4 h-4" />
                  الصف:
                </span>
                <button
                  type="button"
                  onClick={() => setGradeFilter('all')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                  style={
                    gradeFilter === 'all'
                      ? { backgroundColor: '#1c1917', color: '#ffffff' }
                      : { backgroundColor: '#f5f5f4', color: '#57534e', border: '1px solid #d6d3d1' }
                  }
                >
                  الكل
                </button>
                {GRADE_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGradeFilter(g.value)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                    style={
                      gradeFilter === g.value
                        ? { backgroundColor: '#b45309', color: '#ffffff' }
                        : { backgroundColor: '#f5f5f4', color: '#57534e', border: '1px solid #d6d3d1' }
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            )}

            {podiumItems.length > 0 && (
              <LeaderboardPodium items={podiumItems} nameKey={nameKey} title={title} />
            )}

            {listForTab.length === 0 && podiumItems.length === 0 ? (
              <div
                className="text-center py-16 rounded-3xl"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
              >
                <Trophy className="w-12 h-12 mx-auto mb-3" style={{ color: '#d6d3d1' }} />
                <p className="font-medium" style={{ color: '#78716c' }}>
                  {tab === 'points' && gradeFilter !== 'all'
                    ? 'لا يوجد متفوقون في هذا الصف حالياً'
                    : tab === 'featured'
                      ? 'لا يوجد متفوقون مميزون حالياً'
                      : tab === 'results'
                        ? 'لا توجد نتائج اختبارات بعد'
                        : 'لا يوجد طلاب بعد — كن أول المتفوقين!'}
                </p>
              </div>
            ) : listForTab.length > 0 ? (
              <div
                className="rounded-3xl p-4 sm:p-6 shadow-lg"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
              >
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 className="font-bold flex items-center gap-2" style={{ color: '#1c1917' }}>
                    <Star className="w-4 h-4" style={{ color: '#b45309' }} />
                    {tab === 'results' ? 'أعلى نتائج الاختبارات' : tab === 'featured' ? 'قائمة المميزين' : 'الترتيب الكامل'}
                  </h3>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#f5f5f4', color: '#78716c' }}>
                    {listForTab.length} {tab === 'results' ? 'نتيجة' : 'طالب'}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {listForTab.map((s, i) => (
                    <StudentRow
                      key={s.id || `${personName(s, nameKey)}-${i}`}
                      student={s}
                      index={i}
                      nameKey={nameKey}
                      extra={
                        tab === 'results' ? (
                          <span className="text-[11px]" style={{ color: '#78716c' }}>
                            اختبار #{s.quiz_id} · {s.score}/{s.total_questions}
                          </span>
                        ) : null
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
