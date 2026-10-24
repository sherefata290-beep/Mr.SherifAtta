import supabase from './supabase';

const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const GOOGLE_ERROR_EVENT = 'english-mastery-google-auth-error';

export function emitGoogleAuthError(message) {
  const detail = {
    message:
      message ||
      'لا يمكن الدخول بحساب Google إلا بعد إنشاء حساب على المنصة بنفس البريد أولاً.',
  };
  window.dispatchEvent(new CustomEvent(GOOGLE_ERROR_EVENT, { detail }));
}

export function onGoogleAuthError(handler) {
  const listener = (event) => handler(event.detail?.message || '');
  window.addEventListener(GOOGLE_ERROR_EVENT, listener);
  return () => window.removeEventListener(GOOGLE_ERROR_EVENT, listener);
}

function buildGoogleUrl(appName) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_GOOGLE_AUTH_PROXY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!clientId || !redirectUri) return null;
  const state = btoa(
    JSON.stringify({ origin: window.location.origin, appName, supabaseUrl, supabaseAnonKey })
  );
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&prompt=select_account&state=${encodeURIComponent(state)}`;
}

/**
 * After Google session is set, ensure the email already has a platform account.
 * If not, sign out (and server may delete the auth user).
 */
export async function enforceRegisteredGoogleUser() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session?.access_token) {
    return { ok: false, error: 'فشل تسجيل الدخول عبر Google' };
  }

  try {
    const res = await fetch('/api/google-gate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok || payload?.ok === false) {
      await supabase.auth.signOut();
      const message =
        payload?.error ||
        'لا يمكن الدخول بحساب Google إلا بعد إنشاء حساب على المنصة بنفس البريد الإلكتروني أولاً.';
      emitGoogleAuthError(message);
      return { ok: false, error: message };
    }

    return { ok: true, profile: payload?.profile || null };
  } catch (err) {
    await supabase.auth.signOut();
    const message = err?.message || 'تعذر التحقق من حساب Google';
    emitGoogleAuthError(message);
    return { ok: false, error: message };
  }
}

async function completeGoogleSession(eventData) {
  if (eventData.access_token && eventData.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: eventData.access_token,
      refresh_token: eventData.refresh_token,
    });
    if (error) {
      emitGoogleAuthError(error.message || 'فشل تسجيل الدخول عبر Google');
      return { ok: false };
    }
  } else if (eventData.id_token) {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: eventData.id_token,
    });
    if (error) {
      emitGoogleAuthError(error.message || 'فشل تسجيل الدخول عبر Google');
      return { ok: false };
    }
  } else {
    emitGoogleAuthError('استجابة Google غير مكتملة');
    return { ok: false };
  }

  return enforceRegisteredGoogleUser();
}

export function signInWithGoogle(appName = 'English Mastery') {
  const url = buildGoogleUrl(appName);
  if (!url) {
    console.warn('[google-auth] Missing VITE_GOOGLE_CLIENT_ID or VITE_GOOGLE_AUTH_PROXY');
    emitGoogleAuthError('إعدادات Google غير مكتملة');
    return;
  }

  window.open(url, 'google-auth', isMobile() ? '' : 'width=500,height=600');

  const handler = async (event) => {
    if (event.data?.type === 'google-auth-denied') {
      window.removeEventListener('message', handler);
      emitGoogleAuthError('تم إلغاء تسجيل الدخول عبر Google');
      return;
    }
    if (event.data?.type !== 'google-auth-success') return;
    window.removeEventListener('message', handler);
    await completeGoogleSession(event.data);
  };
  window.addEventListener('message', handler);
}

export async function handleGoogleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('google_id_token');
  if (!token) return;
  window.history.replaceState({}, '', window.location.pathname);

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
  if (error) {
    console.error('[google-auth] signInWithIdToken failed:', error.message);
    emitGoogleAuthError(error.message || 'فشل تسجيل الدخول عبر Google');
    return;
  }

  const result = await enforceRegisteredGoogleUser();
  if (!result.ok) return;

  try {
    window.close();
  } catch {}
}
