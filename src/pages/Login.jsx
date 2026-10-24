import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GraduationCap, Mail, Lock, User, Phone, KeyRound, School } from 'lucide-react';
import supabase from '../lib/supabase';
import { signInWithGoogle, onGoogleAuthError } from '../lib/googleAuth';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { GRADE_OPTIONS } from '../lib/grades';

function isValidParentPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    return onGoogleAuthError((message) => {
      const msg =
        message ||
        'لا يمكن الدخول بحساب Google إلا بعد إنشاء حساب على المنصة بنفس البريد الإلكتروني أولاً.';
      setError(msg);
      // Unregistered Google email → open sign-up form
      if (/إنشاء حساب|غير مسجل|أولاً|not registered|sign.?up/i.test(msg)) {
        setIsSignUp(true);
      }
      setLoading(false);
    });
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center" style={{ backgroundColor: '#f5f5f4' }}>
        <div
          className="w-12 h-12 border-4 rounded-full animate-spin"
          style={{ borderColor: '#b45309', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (user) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        if (!fullName.trim()) {
          setError('الاسم مطلوب');
          setLoading(false);
          return;
        }
        if (!parentPhone.trim()) {
          setError('رقم ولي الأمر مطلوب');
          setLoading(false);
          return;
        }
        if (!isValidParentPhone(parentPhone)) {
          setError('أدخل رقم ولي أمر صالح (من 8 إلى 15 رقم)');
          setLoading(false);
          return;
        }
        if (!gradeLevel) {
          setError('اختر الصف الدراسي');
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
          setLoading(false);
          return;
        }
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          setError('كلمة المرور يجب أن تحتوي على حروف وأرقام');
          setLoading(false);
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              parent_phone: parentPhone.trim(),
              grade_level: gradeLevel,
            },
          },
        });
        if (signUpError) throw signUpError;
        if (data.user) {
          await apiFetch('/api/profiles', {
            method: 'POST',
            body: JSON.stringify({
              id: data.user.id,
              email,
              full_name: fullName,
              parent_phone: parentPhone.trim(),
              grade_level: gradeLevel,
            }),
          });
        }
        // After signup: go to courses where access-code gate is shown
        navigate('/courses');
      } else {
        const normalizedEmail = email.trim().toLowerCase();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) {
          // If email is not registered on the platform, switch to sign-up UI
          try {
            const checkRes = await fetch('/api/check-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: normalizedEmail }),
            });
            const checkData = await checkRes.json().catch(() => ({}));
            if (checkRes.ok && checkData.exists === false) {
              setIsSignUp(true);
              setPassword('');
              setError('هذا البريد غير مسجل على المنصة. أكمل إنشاء حساب جديد للمتابعة.');
              setLoading(false);
              return;
            }
          } catch {
            // fall through to normal error
          }
          throw signInError;
        }
        navigate('/');
      }
    } catch (err) {
      const msg = err.message || 'حدث خطأ';
      // Extra safety: common auth messages for missing users
      if (/invalid login credentials|user not found|email not confirmed/i.test(msg) && !isSignUp) {
        try {
          const checkRes = await fetch('/api/check-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
          const checkData = await checkRes.json().catch(() => ({}));
          if (checkRes.ok && checkData.exists === false) {
            setIsSignUp(true);
            setPassword('');
            setError('هذا البريد غير مسجل على المنصة. أكمل إنشاء حساب جديد للمتابعة.');
            return;
          }
        } catch {
          /* ignore */
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12" dir="rtl">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-700 to-stone-800 items-center justify-center mb-4 shadow-lg shadow-stone-400/40">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-stone-900">English Mastery</h1>
          <p className="text-stone-500 text-sm mt-1">Mr. Sherif Atta</p>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 shadow-lg p-6 md:p-8">
          <h2 className="text-xl font-bold text-stone-900 mb-1 text-center">
            {isSignUp ? 'إنشاء حساب جديد' : 'تسجيل الدخول'}
          </h2>
          <p className="text-stone-500 text-sm text-center mb-6">
            {isSignUp ? 'انضم لطلاب المنصة' : 'مرحباً بعودتك'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">الاسم الكامل</label>
                  <div className="relative">
                    <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      placeholder="اسمك"
                      required={isSignUp}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">رقم ولي الأمر</label>
                  <div className="relative">
                    <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input
                      type="tel"
                      value={parentPhone}
                      onChange={(e) => setParentPhone(e.target.value)}
                      className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      placeholder="01xxxxxxxxx"
                      required={isSignUp}
                      dir="ltr"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </div>
                  <p className="text-xs text-stone-400 mt-1">للتواصل مع ولي الأمر عند الحاجة</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">الصف الدراسي</label>
                  <div className="relative">
                    <School className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <select
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(e.target.value)}
                      className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm bg-white appearance-none"
                      required={isSignUp}
                    >
                      <option value="">اختر الصف</option>
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-stone-400 mt-1">يُحفظ صفك مع الحساب لعرض المحتوى المناسب بعد تفعيل الكود</p>
                </div>
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-950 text-xs leading-relaxed flex items-start gap-2">
                  <KeyRound className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                  <span>
                    اختيار الصف وحده لا يفتح المحتوى. بعد التسجيل أدخل
                    <strong> كود الوصول </strong>
                    من المدرس Mr. Sherif Atta (لنفس صفك) لفتح الكورسات والاختبارات.
                  </span>
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">البريد الإلكتروني</label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  placeholder="email@example.com"
                  required
                  dir="ltr"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  placeholder="••••••••"
                  required
                  minLength={8}
                  dir="ltr"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm text-center">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-amber-700 text-white font-bold hover:bg-amber-800 transition-colors disabled:opacity-60"
            >
              {loading ? 'جاري...' : isSignUp ? 'إنشاء الحساب' : 'دخول'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-stone-300" />
            <span className="text-xs text-stone-400">أو</span>
            <div className="flex-1 h-px bg-stone-300" />
          </div>

          <button
            type="button"
            onClick={() => {
              setError('');
              setLoading(true);
              signInWithGoogle('English Mastery');
              // loading stops on success via auth redirect, or on error via event
              setTimeout(() => setLoading(false), 15000);
            }}
            disabled={loading}
            className="w-full py-3 rounded-xl border border-stone-300 font-semibold text-stone-700 hover:bg-stone-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            الدخول بحساب Google
          </button>
          <p className="text-center text-xs text-stone-400 mt-2 leading-relaxed">
            الدخول بـ Google متاح فقط للبريد الذي أنشأ حساباً مسبقاً على المنصة
          </p>

          <p className="text-center text-sm text-stone-500 mt-6">
            {isSignUp ? 'لديك حساب؟' : 'ليس لديك حساب؟'}{' '}
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setParentPhone(''); setGradeLevel(''); }}
              className="text-amber-700 font-semibold hover:underline"
            >
              {isSignUp ? 'تسجيل الدخول' : 'إنشاء حساب'}
            </button>
          </p>
        </div>

        <p className="text-center mt-6">
          <Link to="/" className="text-sm text-stone-500 hover:text-amber-700">← العودة للرئيسية</Link>
        </p>
      </div>
    </div>
  );
}
