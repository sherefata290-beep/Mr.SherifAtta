import { useState } from 'react';
import { KeyRound, CheckCircle2, X, Lock } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { gradeLabel } from '../lib/grades';

/**
 * Full-page or modal gate: student must redeem an access code before opening content.
 */
export default function AccessGate({
  mode = 'page', // 'page' | 'modal'
  title = 'مطلوب كود الوصول',
  description = 'أدخل كود الوصول الذي حصلت عليه من المدرس لفتح الكورسات والاختبارات الخاصة بصفك.',
  onClose,
  onSuccess,
}) {
  const { profile, refreshProfile } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const redeem = async (e) => {
    e?.preventDefault?.();
    setError('');
    setSuccess('');
    const value = code.trim();
    if (!value) {
      setError('أدخل كود الوصول');
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
      setSuccess(data.message || 'تم تفعيل الكود بنجاح');
      setCode('');
      await refreshProfile();
      try {
        window.dispatchEvent(new CustomEvent('em:data-changed', { detail: { source: 'access-code' } }));
      } catch { /* ignore */ }
      setTimeout(() => {
        onSuccess?.(data);
      }, 700);
    } catch (err) {
      setError(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  const body = (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" dir="rtl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200" style={{ backgroundColor: '#1c1917' }}>
        <h3 className="font-bold text-white flex items-center gap-2">
          <Lock className="w-5 h-5 text-amber-400" />
          {title}
        </h3>
        {onClose && (
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-stone-300 hover:text-white" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <form onSubmit={redeem} className="p-5 space-y-4">
        <p className="text-sm text-stone-600 leading-relaxed">{description}</p>
        {profile?.grade_level ? (
          <p className="text-xs text-stone-500">
            صفك المسجّل: <strong className="text-stone-800">{gradeLabel(profile.grade_level)}</strong>
            {profile?.has_access
              ? ' · تم تفعيل كود الوصول مسبقاً'
              : ' — أدخل كود الوصول المطابق لصفك لإكمال الفتح'}
          </p>
        ) : (
          <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            لم يتم تفعيل كود بعد — لن تتمكن من فتح أي كورس أو اختبار بدون الكود.
          </p>
        )}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">كود الوصول</label>
          <div className="relative">
            <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="EM-XXXX-XXXX"
              className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm font-mono tracking-wider"
              dir="ltr"
              autoFocus
              autoComplete="off"
            />
          </div>
        </div>
        {error && <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
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
          {loading ? 'جاري التحقق...' : 'تفعيل الكود والفتح'}
        </button>
      </form>
    </div>
  );

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
        {body}
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12" style={{ backgroundColor: '#f5f5f4' }}>
      {body}
    </div>
  );
}
