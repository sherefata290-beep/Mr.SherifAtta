import { createClient } from '@supabase/supabase-js';
import { triggerRestore, pingDatabase } from './db-wake.js';

function cleanEnv(value) {
  if (value == null) return '';
  let v = String(value).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

const supabaseUrl = cleanEnv(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL
);
const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonKey = cleanEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Prefer service role on the server; fall back to anon so public reads still work
const supabaseKey = serviceKey || anonKey;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[db-client] Missing Supabase env. URL:',
    !!supabaseUrl,
    'KEY:',
    !!supabaseKey
  );
}

let wakeStarted = false;
function ensureAwake() {
  if (wakeStarted) return;
  wakeStarted = true;
  // Fire-and-forget: unpause project + lightweight ping
  try {
    triggerRestore();
    pingDatabase(supabaseUrl, supabaseKey);
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    wakeStarted = false;
  }, 30_000);
}

const supabase = createClient(supabaseUrl || 'https://invalid.supabase.co', supabaseKey || 'invalid', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: async (url, options) => {
      ensureAwake();
      let res;
      try {
        res = await fetch(url, options);
      } catch (err) {
        // Network failure — try restore then one retry
        triggerRestore();
        await new Promise((r) => setTimeout(r, 800));
        try {
          res = await fetch(url, options);
        } catch (err2) {
          throw err2;
        }
      }

      if (res && !res.ok && res.status >= 500) {
        triggerRestore();
        // single retry after brief wait for paused projects
        await new Promise((r) => setTimeout(r, 1200));
        try {
          const retry = await fetch(url, options);
          return retry;
        } catch {
          return res;
        }
      }
      return res;
    },
  },
});

export function getSupabaseConfigStatus() {
  return {
    hasUrl: Boolean(supabaseUrl),
    hasServiceKey: Boolean(serviceKey),
    hasAnonKey: Boolean(anonKey),
    urlHost: supabaseUrl ? (() => {
      try {
        return new URL(supabaseUrl).host;
      } catch {
        return 'invalid-url';
      }
    })() : null,
  };
}

export default supabase;
