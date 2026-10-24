import supabase from './supabase';

async function getAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DATA_CHANGED_STORAGE_KEY = 'em:data-changed-at';

/** Notify the whole SPA (and other tabs) that backend data changed */
export function notifyDataChanged(detail = {}) {
  const payload = { at: Date.now(), ...detail };

  try {
    // Bust client-side catalog caches used by Home
    sessionStorage.removeItem('em_home_catalog_v1');
    sessionStorage.removeItem('em_home_catalog_v2');
    sessionStorage.removeItem('em_home_catalog_v3');
    sessionStorage.removeItem('em_home_catalog_v4');
  } catch { /* ignore */ }

  try {
    window.dispatchEvent(new CustomEvent('em:data-changed', { detail: payload }));
  } catch { /* ignore */ }

  // Cross-tab sync (storage events fire in other tabs only)
  try {
    localStorage.setItem(DATA_CHANGED_STORAGE_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

/** Subscribe to same-tab + cross-tab data change notifications */
export function onDataChanged(handler) {
  const onCustom = (e) => handler(e?.detail || {});
  const onStorage = (e) => {
    if (e.key !== DATA_CHANGED_STORAGE_KEY || !e.newValue) return;
    try {
      handler(JSON.parse(e.newValue));
    } catch {
      handler({ at: Date.now() });
    }
  };
  window.addEventListener('em:data-changed', onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('em:data-changed', onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Authenticated fetch helper — always attaches Bearer token when available.
 * Always bypasses browser HTTP cache so admin edits appear without full reload.
 * Retries on 502/503/504 (common when DB is waking up).
 */
export async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  // Never serve stale API JSON from the browser/CDN cache
  headers['Cache-Control'] = 'no-cache';
  headers.Pragma = 'no-cache';

  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = await getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Cache-bust GET/HEAD URLs (some proxies ignore Cache-Control)
  let finalPath = path;
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    const join = path.includes('?') ? '&' : '?';
    finalPath = `${path}${join}_ts=${Date.now()}`;
  }

  const maxAttempts = options.retries === 0 ? 1 : 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(finalPath, {
        ...options,
        headers,
        cache: 'no-store',
      });

      // Wake DB path: retry transient gateway / server errors
      if ([502, 503, 504].includes(res.status) && attempt < maxAttempts) {
        fetch('/api/health', { cache: 'no-store' }).catch(() => {});
        await sleep(700 * attempt);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        fetch('/api/health', { cache: 'no-store' }).catch(() => {});
        await sleep(700 * attempt);
        continue;
      }
    }
  }

  throw lastError || new Error('تعذر الاتصال بالخادم');
}

export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Check API + database connectivity */
export async function checkDatabaseHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return {
      ok: Boolean(res.ok && data?.ok && data?.db),
      ...data,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      db: false,
      message: err?.message || 'تعذر فحص الاتصال',
    };
  }
}

export default apiFetch;
