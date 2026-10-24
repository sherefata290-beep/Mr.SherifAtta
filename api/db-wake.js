const PROJECT_REF = (process.env.FULLSTACK_PROJECT_REF || '').replace(/^["']|["']$/g, '');
const RESTORE_URL = (process.env.FULLSTACK_RESTORE_API_URL || '').replace(/^["']|["']$/g, '');

let _restoreTriggered = false;

/**
 * Ask the Design Arena restore service to unpause the Supabase project.
 * Safe to call often — throttled to once per minute.
 */
export function triggerRestore() {
  if (_restoreTriggered || !PROJECT_REF || !RESTORE_URL) return;
  _restoreTriggered = true;
  fetch(RESTORE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_ref: PROJECT_REF }),
  }).catch(() => {});
  setTimeout(() => {
    _restoreTriggered = false;
  }, 60_000);
}

/**
 * Lightweight REST ping against Supabase to warm a paused project.
 */
export function pingDatabase(supabaseUrl, key) {
  if (!supabaseUrl || !key) return;
  const base = String(supabaseUrl).replace(/\/$/, '');
  // Prefer a cheap REST head-style select
  fetch(`${base}/rest/v1/courses?select=id&limit=1`, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  }).catch(() => {});
}
