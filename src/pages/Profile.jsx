import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  User, Mail, Phone, School, Star, Calendar, Shield, Save, RefreshCw, KeyRound, Trophy,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { gradeLabel } from '../lib/grades';
import LoadingSpinner from '../components/LoadingSpinner';

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function roleLabel(role) {
  const map = {
    student: 'طالب',
    admin: 'مشرف',
    users: 'إدارة مستخدمين',
    reports: 'تقارير',
    content: 'محتوى',
    exams: 'اختبارات',
    curriculum: 'منهج',
    support: 'دعم',
  };
  return map[role] || role || 'طالب';
}

export default function Profile() {
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fullName, setFullName] = useState('');
  const [parentPhone, setParentPhone] = useState('');

  const loadProfile = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/profiles?id=${encodeURIComponent(user.id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تحميل الملف الشخصي');
      setData(json);
      setFullName(json.full_name || '');
      setParentPhone(json.parent_phone || '');
    } catch (err) {
      setError(err.message || 'فشل التحميل');
      // Fallback to context profile
      if (profile) {
        setData(profile);
        setFullName(profile.full_name || '');
        setParentPhone(profile.parent_phone || '');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) loadProfile();
  }, [authLoading, user?.id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      if (!fullName.trim()) throw new Error('الاسم مطلوب');
      const res = await apiFetch('/api/profiles', {
        method: 'PUT',
        body: JSON.stringify({
          id: user.id,
          full_name: fullName.trim(),
          parent_phone: parentPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل الحفظ');
      setData((prev) => ({ ...prev, ...json }));
      setSuccess('تم حفظ التعديلات بنجاح');
      await refreshProfile();
    } catch (err) {
      setError(err.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <LoadingSpinner text="جاري تحميل الملف الشخصي..." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div
          className="rounded-3xl p-8 shadow-sm"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
        >
          <User className="w-12 h-12 mx-auto mb-4" style={{ color: '#b45309' }} />
          <h1 className="text-2xl font-bold mb-2" style={{ color: '#1c1917' }}>الملف الشخصي</h1>
          <p className="mb-6" style={{ color: '#57534e' }}>
            سجّل الدخول لعرض بيانات حسابك التي أدخلتها عند إنشاء الحساب.
          </p>
          <Link
            to="/login"
            className="inline-flex px-6 py-3 rounded-xl font-bold text-white"
            style={{ backgroundColor: '#b45309' }}
          >
            تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  const p = data || profile || {};

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10" dir="rtl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: '#1c1917' }}>الملف الشخصي</h1>
        <p style={{ color: '#57534e' }}>
          جميع البيانات التي أدخلتها عند إنشاء حسابك على منصة English Mastery
        </p>
      </div>

      {/* Header card */}
      <div
        className="rounded-3xl p-6 md:p-8 mb-6 shadow-sm"
        style={{
          background: 'linear-gradient(135deg, #b45309 0%, #78350f 45%, #1c1917 100%)',
          color: '#fff',
        }}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-black shrink-0"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}
          >
            {(p.full_name || user.email || 'ط')[0]}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold truncate">{p.full_name || 'بدون اسم'}</h2>
            <p className="text-sm mt-1 opacity-90 truncate" dir="ltr">{p.email || user.email}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
              >
                <Shield className="w-3.5 h-3.5" />
                {roleLabel(p.role)}
              </span>
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
              >
                <Star className="w-3.5 h-3.5" />
                {p.total_points ?? 0} نقطة
              </span>
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {p.has_access ? 'تم تفعيل الوصول' : 'بانتظار كود الوصول'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={loadProfile}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)' }}
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: '#f0fdf4', color: '#166534' }}>
          {success}
        </div>
      )}

      {/* Read-only registration summary */}
      <div
        className="rounded-2xl p-5 md:p-6 mb-6 shadow-sm"
        style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
      >
        <h3 className="font-bold text-lg mb-4" style={{ color: '#1c1917' }}>بيانات الحساب</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <InfoRow icon={User} label="الاسم الكامل" value={p.full_name || '—'} />
          <InfoRow icon={Mail} label="البريد الإلكتروني" value={p.email || user.email || '—'} ltr />
          <InfoRow icon={Phone} label="رقم ولي الأمر" value={p.parent_phone || '—'} ltr />
          <InfoRow icon={School} label="الصف الدراسي" value={gradeLabel(p.grade_level)} />
          <InfoRow icon={Star} label="إجمالي النقاط" value={String(p.total_points ?? 0)} />
          <InfoRow icon={Shield} label="نوع الحساب" value={roleLabel(p.role)} />
          <InfoRow icon={Calendar} label="تاريخ إنشاء الحساب" value={formatDate(p.created_at)} />
          <InfoRow
            icon={KeyRound}
            label="حالة الوصول للمحتوى"
            value={p.has_access ? 'مفعّل بكود الوصول' : 'غير مفعّل بعد'}
          />
        </div>

        <div className="mt-5 pt-4 flex flex-wrap gap-2" style={{ borderTop: '1px solid #e7e5e4' }}>
          <Link
            to="/leaderboard"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
          >
            <Trophy className="w-4 h-4" />
            منصة الأوائل
          </Link>
          <Link
            to="/courses"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#e7e5e4', color: '#1c1917' }}
          >
            الكورسات
          </Link>
        </div>
      </div>

      {/* Editable fields */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl p-5 md:p-6 shadow-sm space-y-4"
        style={{ backgroundColor: '#ffffff', border: '1px solid #e7e5e4' }}
      >
        <h3 className="font-bold text-lg" style={{ color: '#1c1917' }}>تعديل البيانات</h3>
        <p className="text-sm" style={{ color: '#78716c' }}>
          يمكنك تحديث الاسم ورقم ولي الأمر. الصف الدراسي يُحدَّد عبر كود الوصول من المدرس.
        </p>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#44403c' }}>الاسم الكامل</label>
          <div className="relative">
            <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#a8a29e' }} />
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d6d3d1', color: '#1c1917' }}
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#44403c' }}>رقم ولي الأمر</label>
          <div className="relative">
            <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#a8a29e' }} />
            <input
              type="tel"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d6d3d1', color: '#1c1917' }}
              dir="ltr"
              placeholder="01xxxxxxxxx"
            />
          </div>
        </div>

        <div
          className="rounded-xl p-3 text-sm"
          style={{ backgroundColor: '#f5f5f4', color: '#57534e' }}
        >
          <div className="flex items-center gap-2 mb-1 font-medium" style={{ color: '#1c1917' }}>
            <Mail className="w-4 h-4" />
            البريد الإلكتروني
          </div>
          <div dir="ltr">{p.email || user.email}</div>
          <div className="text-xs mt-1">لا يمكن تغيير البريد من هنا.</div>
        </div>

        <div
          className="rounded-xl p-3 text-sm"
          style={{ backgroundColor: '#f5f5f4', color: '#57534e' }}
        >
          <div className="flex items-center gap-2 mb-1 font-medium" style={{ color: '#1c1917' }}>
            <School className="w-4 h-4" />
            الصف الدراسي
          </div>
          <div>{gradeLabel(p.grade_level)}</div>
          <div className="text-xs mt-1">يُحدَّث عند استخدام كود الوصول من المدرس.</div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-white disabled:opacity-60"
          style={{ backgroundColor: '#b45309' }}
        >
          <Save className="w-4 h-4" />
          {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
        </button>
      </form>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, ltr }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: '#fafaf9', border: '1px solid #e7e5e4' }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium mb-1" style={{ color: '#78716c' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: '#b45309' }} />
        {label}
      </div>
      <div
        className="font-semibold text-sm break-words"
        style={{ color: '#1c1917' }}
        dir={ltr ? 'ltr' : undefined}
      >
        {value || '—'}
      </div>
    </div>
  );
}
