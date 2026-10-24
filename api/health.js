import supabase, { getSupabaseConfigStatus } from './db-client.js';
import { triggerRestore, pingDatabase } from './db-wake.js';
import { handleOptions, methodNotAllowed } from './security.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') return methodNotAllowed(res);

  const cfg = getSupabaseConfigStatus();
  triggerRestore();

  const started = Date.now();
  let dbOk = false;
  let courses = 0;
  let message = '';

  try {
    if (!cfg.hasUrl || !(cfg.hasServiceKey || cfg.hasAnonKey)) {
      message = 'متغيرات الاتصال بقاعدة البيانات غير مضبوطة على الخادم';
      return res.status(503).json({
        ok: false,
        db: false,
        config: cfg,
        message,
        ms: Date.now() - started,
      });
    }

    // Wake + query
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    pingDatabase(url, key);

    const { count, error } = await supabase
      .from('courses')
      .select('id', { count: 'exact', head: true });

    if (error) {
      // One more restore + retry for paused DB
      triggerRestore();
      await new Promise((r) => setTimeout(r, 1500));
      const retry = await supabase.from('courses').select('id', { count: 'exact', head: true });
      if (retry.error) throw retry.error;
      courses = retry.count || 0;
      dbOk = true;
      message = 'تم إعادة إيقاظ قاعدة البيانات بنجاح';
    } else {
      courses = count || 0;
      dbOk = true;
      message = 'قاعدة البيانات متصلة';
    }

    return res.status(200).json({
      ok: true,
      db: dbOk,
      courses,
      config: {
        hasUrl: cfg.hasUrl,
        hasServiceKey: cfg.hasServiceKey,
        hasAnonKey: cfg.hasAnonKey,
        urlHost: cfg.urlHost,
      },
      message,
      ms: Date.now() - started,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('health check failed:', err?.message || err);
    triggerRestore();
    return res.status(503).json({
      ok: false,
      db: false,
      config: {
        hasUrl: cfg.hasUrl,
        hasServiceKey: cfg.hasServiceKey,
        hasAnonKey: cfg.hasAnonKey,
        urlHost: cfg.urlHost,
      },
      message: err?.message || 'تعذر الاتصال بقاعدة البيانات',
      ms: Date.now() - started,
      ts: new Date().toISOString(),
    });
  }
}
