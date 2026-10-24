import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, X, BookOpen, Home, ClipboardList, Trophy, LogOut, User, Shield, GraduationCap, Mail, Phone, MapPin, RefreshCw, WifiOff, CalendarCheck2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useQuizLock } from '../contexts/QuizLockContext';
import { isStaffRole } from '../lib/roles';
import supabase from '../lib/supabase';
import { apiFetch, checkDatabaseHealth, onDataChanged } from '../lib/api';
import AccessCodeBanner from './AccessCodeBanner';

const navItems = [
  { to: '/', label: 'الرئيسية', icon: Home },
  { to: '/courses', label: 'الكورسات', icon: BookOpen },
  { to: '/quizzes', label: 'الاختبارات', icon: ClipboardList },
  { to: '/leaderboard', label: 'منصة الأوائل', icon: Trophy },
  { to: '/progress', label: 'الحضور والمتابعة', icon: CalendarCheck2 },
  { to: '/profile', label: 'الملف الشخصي', icon: User },
];

const DEFAULT_FOOTER = {
  about: {
    title: 'English Mastery',
    subtitle: 'Mr. Sherif Atta',
    description:
      'منصة تعليمية متخصصة في اللغة الإنجليزية تقدم كورسات منظمة واختبارات تفاعلية ومتابعة مستمرة لمستوى الطلاب، بإشراف المدرس Mr. Sherif Atta.',
  },
  links: {
    title: 'روابط سريعة',
    items: [
      { label: 'الرئيسية', to: '/' },
      { label: 'الكورسات', to: '/courses' },
      { label: 'الاختبارات', to: '/quizzes' },
      { label: 'منصة الأوائل', to: '/leaderboard' },
      { label: 'الحضور والمتابعة', to: '/progress' },
      { label: 'الملف الشخصي', to: '/profile' },
      { label: 'تسجيل الدخول', to: '/login' },
    ],
  },
  contact: {
    title: 'تواصل معنا',
    email: 'info@englishmastery.com',
    phone: '+20 100 000 0000',
    address: 'مصر · دروس أونلاين وحضورية',
  },
  copyright: 'جميع الحقوق محفوظة © {year} English Mastery · Mr. Sherif Atta',
};

function isExternalHref(to = '') {
  return /^https?:\/\//i.test(to);
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const [footer, setFooter] = useState(DEFAULT_FOOTER);
  const [dbStatus, setDbStatus] = useState({ checking: true, ok: true, message: '' });
  const [retryingDb, setRetryingDb] = useState(false);
  const { user, profile } = useAuth();
  const { locked, quizId, confirmLeave } = useQuizLock();
  const navigate = useNavigate();

  const refreshDbStatus = async () => {
    setRetryingDb(true);
    setDbStatus((s) => ({ ...s, checking: true }));
    try {
      const health = await checkDatabaseHealth();
      setDbStatus({
        checking: false,
        ok: Boolean(health.ok),
        message: health.message || (health.ok ? 'قاعدة البيانات متصلة' : 'تعذر الاتصال بقاعدة البيانات'),
      });
    } catch {
      setDbStatus({
        checking: false,
        ok: false,
        message: 'تعذر الاتصال بقاعدة البيانات',
      });
    } finally {
      setRetryingDb(false);
    }
  };

  useEffect(() => {
    let alive = true;

    const loadFooter = () => {
      apiFetch('/api/footer')
        .then((r) => r.json())
        .then((data) => {
          if (!alive || !data || data.error) return;
          setFooter({
            about: { ...DEFAULT_FOOTER.about, ...(data.about || {}) },
            links: {
              title: data.links?.title || DEFAULT_FOOTER.links.title,
              items: Array.isArray(data.links?.items) && data.links.items.length
                ? data.links.items
                : DEFAULT_FOOTER.links.items,
            },
            contact: { ...DEFAULT_FOOTER.contact, ...(data.contact || {}) },
            copyright: data.copyright || DEFAULT_FOOTER.copyright,
          });
        })
        .catch(() => {});
    };

    loadFooter();
    const unsubData = onDataChanged(() => { loadFooter(); });

    // Verify DB connectivity on boot (and wake paused projects)
    checkDatabaseHealth()
      .then((health) => {
        if (!alive) return;
        setDbStatus({
          checking: false,
          ok: Boolean(health.ok),
          message: health.message || '',
        });
        // If still down, retry a couple times while restore runs
        if (!health.ok) {
          setTimeout(() => { if (alive) refreshDbStatus(); }, 2500);
          setTimeout(() => { if (alive) refreshDbStatus(); }, 6000);
        }
      })
      .catch(() => {
        if (!alive) return;
        setDbStatus({ checking: false, ok: false, message: 'تعذر الاتصال بقاعدة البيانات' });
      });

    return () => {
      alive = false;
      unsubData();
    };
  }, []);

  const guardNav = (e) => {
    if (!locked) return;
    e.preventDefault();
    e.stopPropagation();
    confirmLeave();
    if (quizId) navigate(`/quizzes/${quizId}`, { replace: true });
  };

  const handleLogout = async () => {
    if (locked) {
      confirmLeave();
      return;
    }
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-page" dir="rtl" style={{ backgroundColor: '#f5f5f4', color: '#1c1917' }}>
      <header
        className="sticky top-0 z-50 shadow-sm"
        style={{ backgroundColor: 'rgba(255,255,255,0.96)', borderBottom: '1px solid #d6d3d1', backdropFilter: 'blur(8px)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <Link to={locked && quizId ? `/quizzes/${quizId}` : '/'} className="flex items-center gap-2 group" onClick={guardNav}>
              <div className="w-10 h-10 rounded-xl icon-gradient flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <GraduationCap className="w-5 h-5" style={{ color: '#ffffff' }} />
              </div>
              <div>
                <div className="font-bold text-lg leading-tight" style={{ color: '#1c1917' }}>English Mastery</div>
                <div className="text-[11px] font-medium" style={{ color: '#b45309' }}>Mr. Sherif Atta</div>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={locked && quizId ? `/quizzes/${quizId}` : to}
                  end={to === '/'}
                  onClick={guardNav}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive ? 'nav-active' : 'nav-idle'
                    }`
                  }
                >
                  <Icon
                    className="w-4 h-4 shrink-0"
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="hidden md:flex items-center gap-2">
              {locked && (
                <span
                  className="px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                >
                  اختبار جارٍ — سلّم الإجابات للمغادرة
                </span>
              )}
              {user ? (
                <>
                  {isStaffRole(profile?.role) && (
                    <Link
                      to={locked && quizId ? `/quizzes/${quizId}` : '/admin'}
                      onClick={guardNav}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{ backgroundColor: '#fef3c7', color: '#b45309' }}
                    >
                      <Shield className="w-4 h-4 icon-brand" strokeWidth={2.25} aria-hidden="true" />
                      لوحة المشرف
                    </Link>
                  )}
                  <Link
                    to={locked && quizId ? `/quizzes/${quizId}` : '/profile'}
                    onClick={guardNav}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: '#e7e5e4', color: '#44403c' }}
                    title="الملف الشخصي"
                  >
                    <User className="w-4 h-4 icon-soft" strokeWidth={2.25} aria-hidden="true" />
                    <span className="text-sm max-w-[120px] truncate" style={{ color: '#44403c' }}>
                      {profile?.full_name || user.email}
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="p-2 rounded-lg transition-colors icon-soft"
                    style={{ color: '#78716c' }}
                    title="تسجيل الخروج"
                  >
                    <LogOut className="w-4 h-4" strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  onClick={guardNav}
                  className="px-4 py-2 rounded-lg text-sm font-medium btn-primary shadow-sm"
                >
                  تسجيل الدخول
                </Link>
              )}
            </div>

            <button
              className="md:hidden p-2 rounded-lg icon-muted"
              style={{ color: '#57534e' }}
              onClick={() => setOpen(!open)}
              aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            >
              {open ? (
                <X className="w-6 h-6" strokeWidth={2.25} aria-hidden="true" />
              ) : (
                <Menu className="w-6 h-6" strokeWidth={2.25} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {open && (
          <div className="md:hidden px-4 py-3 space-y-1" style={{ borderTop: '1px solid #e7e5e4', backgroundColor: '#ffffff' }}>
            {locked && (
              <div className="mb-2 px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                اختبار جارٍ — سلّم الإجابات للمغادرة
              </div>
            )}
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={locked && quizId ? `/quizzes/${quizId}` : to}
                end={to === '/'}
                onClick={(e) => {
                  guardNav(e);
                  if (!locked) setOpen(false);
                }}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive ? 'nav-active' : 'nav-idle'
                  }`
                }
              >
                <Icon
                  className="w-4 h-4 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
                {label}
              </NavLink>
            ))}
            {user ? (
              <>
                {isStaffRole(profile?.role) && (
                  <Link
                    to={locked && quizId ? `/quizzes/${quizId}` : '/admin'}
                    onClick={(e) => {
                      guardNav(e);
                      if (!locked) setOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium"
                    style={{ color: '#b45309', backgroundColor: '#fef3c7' }}
                  >
                    <Shield className="w-4 h-4" />
                    لوحة المشرف
                  </Link>
                )}
                <button
                  onClick={() => {
                    if (locked) {
                      confirmLeave();
                      return;
                    }
                    handleLogout();
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium w-full"
                  style={{ color: '#dc2626' }}
                >
                  <LogOut className="w-4 h-4" />
                  تسجيل الخروج
                </button>
              </>
            ) : (
              <Link
                to="/login"
                onClick={(e) => {
                  guardNav(e);
                  if (!locked) setOpen(false);
                }}
                className="flex items-center justify-center px-3 py-2.5 rounded-lg text-sm font-medium btn-primary"
              >
                تسجيل الدخول
              </Link>
            )}
          </div>
        )}
      </header>

      {!dbStatus.ok && !dbStatus.checking && (
        <div
          className="px-4 py-3 text-sm flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4"
          style={{ backgroundColor: '#451a03', color: '#fef3c7', borderBottom: '1px solid #78350f' }}
        >
          <span className="inline-flex items-center gap-2 text-center">
            <WifiOff className="w-4 h-4 shrink-0" />
            {dbStatus.message || 'يبدو أن الاتصال بقاعدة البيانات غير متاح حالياً. قد تكون قاعدة البيانات في وضع السكون.'}
          </span>
          <button
            type="button"
            onClick={refreshDbStatus}
            disabled={retryingDb}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ backgroundColor: '#b45309', color: '#fff' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retryingDb ? 'animate-spin' : ''}`} />
            {retryingDb ? 'جاري إعادة الاتصال...' : 'إعادة الاتصال'}
          </button>
        </div>
      )}

      <AccessCodeBanner />
      <main style={{ backgroundColor: '#f5f5f4', color: '#1c1917' }}>{children}</main>

      <footer className="mt-16" style={{ backgroundColor: '#1c1917', color: '#d6d3d1' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
            {/* القسم 1: عن المنصة */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl icon-gradient flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5" style={{ color: '#ffffff' }} />
                </div>
                <div>
                  <div className="font-bold text-lg" style={{ color: '#ffffff' }}>
                    {footer.about?.title || 'English Mastery'}
                  </div>
                  {footer.about?.subtitle ? (
                    <div className="text-sm" style={{ color: '#fbbf24' }}>{footer.about.subtitle}</div>
                  ) : null}
                </div>
              </div>
              {footer.about?.description ? (
                <p className="text-sm leading-relaxed" style={{ color: '#a8a29e' }}>
                  {footer.about.description}
                </p>
              ) : null}
            </div>

            {/* القسم 2: روابط سريعة */}
            <div>
              <h3 className="font-bold text-base mb-4" style={{ color: '#ffffff' }}>
                {footer.links?.title || 'روابط سريعة'}
              </h3>
              <ul className="space-y-2.5">
                {(footer.links?.items || []).map((item, idx) => (
                  <li key={`${item.to}-${idx}`}>
                    {isExternalHref(item.to) ? (
                      <a
                        href={item.to}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm transition-colors hover:text-amber-400"
                        style={{ color: '#a8a29e' }}
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        to={locked && quizId ? `/quizzes/${quizId}` : (item.to || '/')}
                        onClick={guardNav}
                        className="text-sm transition-colors hover:text-amber-400"
                        style={{ color: '#a8a29e' }}
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* القسم 3: تواصل معنا */}
            <div>
              <h3 className="font-bold text-base mb-4" style={{ color: '#ffffff' }}>
                {footer.contact?.title || 'تواصل معنا'}
              </h3>
              <ul className="space-y-3">
                {footer.contact?.email ? (
                  <li className="flex items-start gap-3 text-sm" style={{ color: '#a8a29e' }}>
                    <Mail className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#fbbf24' }} />
                    <a
                      href={`mailto:${footer.contact.email}`}
                      className="hover:text-amber-400 transition-colors"
                      dir="ltr"
                    >
                      {footer.contact.email}
                    </a>
                  </li>
                ) : null}
                {footer.contact?.phone ? (
                  <li className="flex items-start gap-3 text-sm" style={{ color: '#a8a29e' }}>
                    <Phone className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#fbbf24' }} />
                    <a
                      href={`tel:${String(footer.contact.phone).replace(/\s+/g, '')}`}
                      className="hover:text-amber-400 transition-colors"
                      dir="ltr"
                    >
                      {footer.contact.phone}
                    </a>
                  </li>
                ) : null}
                {footer.contact?.address ? (
                  <li className="flex items-start gap-3 text-sm" style={{ color: '#a8a29e' }}>
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#fbbf24' }} />
                    <span>{footer.contact.address}</span>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          <div
            className="mt-10 pt-6 text-center text-sm"
            style={{ borderTop: '1px solid #44403c', color: '#78716c' }}
          >
            {(footer.copyright || DEFAULT_FOOTER.copyright).replace('{year}', String(new Date().getFullYear()))}
          </div>
        </div>
      </footer>
    </div>
  );
}
