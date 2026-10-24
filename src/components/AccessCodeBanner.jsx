import { useState } from 'react';
import { KeyRound, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { isStaffRole } from '../lib/roles';
import { gradeLabel } from '../lib/grades';

export default function AccessCodeBanner() {
  const { user, profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!user || isStaffRole(profile?.role)) return null;

  const hasGrade = Boolean(profile?.grade_level);
  const hasAccess = Boolean(profile?.has_access);

  const redeem = async (e) => {
    e?.preventDefault?.();
    setError('');
    setSuccess('');
    const value = code.trim();
    if (!value) {
      setError('أدخل الكود');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch('/api/access-codes', {
        method: 'POST',
        body: JSON.stringify({ action: 'redeem', code: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تفعيل الكود');
      setSuccess(data.message || 'تم التفعيل بنجاح');
      setCode('');
      await refreshProfile();
      try {
        window.dispatchEvent(new CustomEvent('em:data-changed', { detail: { source: 'access-code' } }));
      } catch { /* ignore */ }
      setTimeout(() => {
        setOpen(false);
        setSuccess('');
      }, 1800);
    } catch (err) {
      setError(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!hasAccess && (
        <div
          className="border-b"
          style={{ backgroundColor: '#fffbeb', borderColor: '#fcd34d', color: '#78350f' }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <KeyRound className="w-4 h-4 shrink-0" />
              <span>
                {hasGrade
                  ? `صفك ${gradeLabel(profile.grade_level)} — أدخل كود الوصول لفتح الكورسات والاختبارات`
                  : 'لا يمكن فتح أي كورس أو اختبار بدون كود الوصول — فعّل الكود الآن'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: '#b45309' }}
            >
              إدخال الكود
            </button>
          </div>
        </div>
      )}

      {/* Always available small entry after unlock (re-enter / another code) */}
      {hasAccess && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-40 shadow-lg rounded-full px-4 py-2.5 text-xs font-bold text-white flex items-center gap-1.5"
          style={{ backgroundColor: '#1c1917' }}
          title="تفعيل / تغيير كود الوصول"
        >
          <KeyRound className="w-3.5 h-3.5" />
          كود الوصول
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" dir="rtl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200" style={{ backgroundColor: '#1c1917' }}>
              <h3 className="font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                تفعيل كود الوصول
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded-lg text-stone-300 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={redeem} className="p-5 space-y-4">
              <p className="text-sm text-stone-600 leading-relaxed">
                أدخل الكود الذي حصلت عليه من المدرس لفتح كورسات واختبارات صفك.
                {hasGrade && (
                  <span className="block mt-1 text-stone-500">
                    صفك المسجّل: <strong>{gradeLabel(profile.grade_level)}</strong>
                    {hasAccess ? ' · تم تفعيل كود الوصول' : ' · بانتظار تفعيل الكود'}
                  </span>
                )}
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">الكود</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="EM-XXXX-XXXX"
                  className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm font-mono tracking-wider"
                  dir="ltr"
                  autoFocus
                />
              </div>
              {error && (
                <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
              )}
              {success && (
                <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {success}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: '#b45309' }}
              >
                {loading ? 'جاري التفعيل...' : 'تفعيل الكود'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
