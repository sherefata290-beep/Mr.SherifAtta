import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  sanitizeText,
  methodNotAllowed,
  serverError,
} from './security.js';

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

const DEFAULT_CONFIG = {
  title: 'منصة الأوائل',
  subtitle: 'أفضل طلاب English Mastery · Mr. Sherif Atta',
  show_auto_ranking: true,
  show_top_results: true,
  show_featured: true,
  max_students: 50,
  max_results: 20,
  enabled: true,
};

const STAFF = new Set(['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support']);

async function getConfig() {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('key', 'leaderboard_config')
      .maybeSingle();
    if (error || !data?.value) return { ...DEFAULT_CONFIG };
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return { ...DEFAULT_CONFIG, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config) {
  const value = JSON.stringify({ ...DEFAULT_CONFIG, ...config });
  const { data: existing } = await supabase
    .from('settings')
    .select('key')
    .eq('key', 'leaderboard_config')
    .maybeSingle();
  if (existing) {
    const { data, error } = await supabase
      .from('settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', 'leaderboard_config')
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('settings')
    .insert({ key: 'leaderboard_config', value, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function parseConfigBody(body = {}) {
  const next = { ...DEFAULT_CONFIG };
  if (body.title != null) next.title = sanitizeText(body.title, 120) || DEFAULT_CONFIG.title;
  if (body.subtitle != null) next.subtitle = sanitizeText(body.subtitle, 240) || '';
  if (body.show_auto_ranking != null) next.show_auto_ranking = !!body.show_auto_ranking;
  if (body.show_top_results != null) next.show_top_results = !!body.show_top_results;
  if (body.show_featured != null) next.show_featured = !!body.show_featured;
  if (body.enabled != null) next.enabled = !!body.enabled;
  if (body.max_students != null) {
    const n = Number(body.max_students);
    if (Number.isFinite(n)) next.max_students = Math.min(200, Math.max(1, Math.floor(n)));
  }
  if (body.max_results != null) {
    const n = Number(body.max_results);
    if (Number.isFinite(n)) next.max_results = Math.min(100, Math.max(1, Math.floor(n)));
  }
  return next;
}

async function safeSelect(table, build) {
  try {
    let q = supabase.from(table).select('*');
    if (typeof build === 'function') q = build(q);
    const { data, error } = await q;
    if (error) {
      console.error(`[leaderboard] ${table}:`, error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error(`[leaderboard] ${table} exception:`, e?.message || e);
    return [];
  }
}

async function loadStudents(config, hidden) {
  const max = Math.min(200, Number(config.max_students) || 50);
  // Prefer students by points — avoid fragile query options
  let { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, total_points, avatar_url, role')
    .eq('role', 'student')
    .order('total_points', { ascending: false })
    .limit(Math.max(max * 2, 50));

  if (error) {
    console.error('[leaderboard] profiles student filter:', error.message);
    // fallback: all profiles, filter staff client-side
    const fallback = await supabase
      .from('profiles')
      .select('id, full_name, total_points, avatar_url, role')
      .order('total_points', { ascending: false })
      .limit(100);
    if (fallback.error) {
      console.error('[leaderboard] profiles fallback:', fallback.error.message);
      return [];
    }
    profiles = (fallback.data || []).filter((p) => !STAFF.has(String(p.role || '').toLowerCase()));
  }

  const list = (profiles || [])
    .filter((s) => s && s.id && !hidden.has(s.id))
    .map((s) => ({
      id: s.id,
      full_name: s.full_name || 'طالب',
      total_points: Number(s.total_points) || 0,
      avatar_url: s.avatar_url || '',
      role: s.role || 'student',
    }))
    .sort((a, b) => b.total_points - a.total_points)
    .slice(0, max);

  // Attach grades best-effort
  const ids = list.map((s) => s.id);
  let gradeMap = {};
  if (ids.length) {
    try {
      const { data: grades } = await supabase
        .from('student_grades')
        .select('user_id, grade_level')
        .in('user_id', ids);
      gradeMap = Object.fromEntries((grades || []).map((g) => [g.user_id, g.grade_level || '']));
    } catch (e) {
      console.error('[leaderboard] grades:', e?.message || e);
    }
  }

  return list.map((s) => ({ ...s, grade_level: gradeMap[s.id] || '' }));
}

async function loadFeatured() {
  const entries = await safeSelect('leaderboard_entries', (q) =>
    q.order('sort_order', { ascending: true })
  );
  return (entries || [])
    .filter((e) => e && e.is_published !== false)
    .map((e) => ({
      id: e.id,
      display_name: e.display_name || e.full_name || 'متفوق',
      full_name: e.display_name || e.full_name || 'متفوق',
      points: Number(e.points) || 0,
      total_points: Number(e.points) || 0,
      badge: e.badge || '',
      note: e.note || '',
      user_id: e.user_id || '',
      avatar_url: e.avatar_url || '',
      is_published: e.is_published !== false,
      sort_order: Number(e.sort_order) || 0,
    }))
    .sort((a, b) => {
      const so = a.sort_order - b.sort_order;
      if (so !== 0) return so;
      return b.points - a.points;
    });
}

async function loadTopResults(limit = 20) {
  // Fetch a wider pool then keep only the best attempt per student+quiz
  const fetchLimit = Math.min(500, Math.max(100, (Number(limit) || 20) * 10));
  const { data, error } = await supabase
    .from('quiz_results')
    .select('id, user_name, user_id, quiz_id, score, total_questions, percentage, completed_at')
    .order('percentage', { ascending: false })
    .limit(fetchLimit);
  if (error) {
    console.error('[leaderboard] results:', error.message);
    return [];
  }
  const bestByKey = new Map();
  for (const r of data || []) {
    const key = `${r.user_id || r.user_name || 'guest'}::${r.quiz_id}`;
    const pct = Number(r.percentage) || 0;
    const score = Number(r.score) || 0;
    const prev = bestByKey.get(key);
    if (!prev || pct > prev._pct || (pct === prev._pct && score > prev._score)) {
      bestByKey.set(key, {
        ...r,
        full_name: r.user_name || 'طالب',
        percentage: pct,
        _pct: pct,
        _score: score,
      });
    }
  }
  return Array.from(bestByKey.values())
    .map(({ _pct, _score, ...rest }) => rest)
    .sort((a, b) => (Number(b.percentage) || 0) - (Number(a.percentage) || 0))
    .slice(0, Math.min(100, Number(limit) || 20));
}

/** Build a guaranteed top-3 podium list for the public UI */
function buildPodium(students, featured, topResults) {
  if (students?.length) {
    return students.slice(0, 3).map((s, i) => ({
      id: s.id || `s-${i}`,
      full_name: s.full_name || 'طالب',
      display_name: s.full_name || 'طالب',
      total_points: Number(s.total_points) || 0,
      points: Number(s.total_points) || 0,
      avatar_url: s.avatar_url || '',
      grade_level: s.grade_level || '',
      source: 'students',
    }));
  }
  if (featured?.length) {
    return featured.slice(0, 3).map((s, i) => ({
      id: s.id || `f-${i}`,
      full_name: s.display_name || s.full_name || 'متفوق',
      display_name: s.display_name || s.full_name || 'متفوق',
      total_points: Number(s.points) || 0,
      points: Number(s.points) || 0,
      avatar_url: s.avatar_url || '',
      badge: s.badge || '',
      note: s.note || '',
      source: 'featured',
    }));
  }
  if (topResults?.length) {
    return topResults.slice(0, 3).map((r, i) => ({
      id: r.id || `r-${i}`,
      full_name: r.user_name || r.full_name || 'طالب',
      display_name: r.user_name || r.full_name || 'طالب',
      total_points: Number(r.percentage) || 0,
      points: Number(r.percentage) || 0,
      percentage: Number(r.percentage) || 0,
      avatar_url: '',
      source: 'results',
    }));
  }
  return [];
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'leaderboard', limit: 180, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    const query = req.query || {};
    const isAdminQuery = String(query.admin || '') === 'true';

    // ── Public board ─────────────────────────────────────────────
    if (req.method === 'GET' && !isAdminQuery) {
      const config = await getConfig();

      if (config.enabled === false) {
        return res.status(200).json({
          config: {
            title: config.title || DEFAULT_CONFIG.title,
            subtitle: config.subtitle || DEFAULT_CONFIG.subtitle,
            enabled: false,
            show_auto_ranking: false,
            show_top_results: false,
            show_featured: false,
          },
          students: [],
          featured: [],
          topResults: [],
          podium: [],
        });
      }

      const hiddenRows = await safeSelect('leaderboard_hidden');
      const hidden = new Set((hiddenRows || []).map((h) => h.user_id).filter(Boolean));

      let students = [];
      let featured = [];
      let topResults = [];

      // Load in parallel; each path is resilient
      const tasks = [];
      if (config.show_auto_ranking !== false) {
        tasks.push(
          loadStudents(config, hidden)
            .then((v) => { students = v; })
            .catch((e) => console.error('[leaderboard] students fail', e?.message || e))
        );
      }
      if (config.show_featured !== false) {
        tasks.push(
          loadFeatured()
            .then((v) => { featured = v; })
            .catch((e) => console.error('[leaderboard] featured fail', e?.message || e))
        );
      }
      if (config.show_top_results !== false) {
        tasks.push(
          loadTopResults(config.max_results)
            .then((v) => { topResults = v; })
            .catch((e) => console.error('[leaderboard] results fail', e?.message || e))
        );
      }
      await Promise.all(tasks);

      // If auto ranking empty, still try a plain profiles pull once
      if (!students.length && config.show_auto_ranking !== false) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('id, full_name, total_points, avatar_url, role')
            .order('total_points', { ascending: false })
            .limit(50);
          students = (data || [])
            .filter((p) => p && !STAFF.has(String(p.role || '').toLowerCase()) && !hidden.has(p.id))
            .map((s) => ({
              id: s.id,
              full_name: s.full_name || 'طالب',
              total_points: Number(s.total_points) || 0,
              avatar_url: s.avatar_url || '',
              grade_level: '',
            }));
        } catch (e) {
          console.error('[leaderboard] emergency students:', e?.message || e);
        }
      }

      const podium = buildPodium(students, featured, topResults);

      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).json({
        config: {
          title: config.title || DEFAULT_CONFIG.title,
          subtitle: config.subtitle || DEFAULT_CONFIG.subtitle,
          enabled: true,
          show_auto_ranking: config.show_auto_ranking !== false,
          show_top_results: config.show_top_results !== false,
          show_featured: config.show_featured !== false,
        },
        students,
        featured,
        topResults,
        podium,
      });
    }

    // ── Admin endpoints ──────────────────────────────────────────
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (req.method === 'GET' && isAdminQuery) {
      const config = await getConfig();
      const [entries, hidden, profiles, topResults] = await Promise.all([
        safeSelect('leaderboard_entries', (q) => q.order('sort_order', { ascending: true })),
        safeSelect('leaderboard_hidden'),
        supabase
          .from('profiles')
          .select('id, full_name, email, total_points, avatar_url, role')
          .order('total_points', { ascending: false })
          .limit(200)
          .then(({ data, error }) => {
            if (error) {
              console.error(error);
              return [];
            }
            return (data || []).filter((p) => String(p.role || '') === 'student');
          }),
        supabase
          .from('quiz_results')
          .select('id, user_name, user_id, quiz_id, score, total_questions, percentage, completed_at')
          .order('percentage', { ascending: false })
          .limit(100)
          .then(({ data, error }) => {
            if (error) {
              console.error(error);
              return [];
            }
            return data || [];
          }),
      ]);

      const profileIds = (profiles || []).map((p) => p.id);
      let gradeMap = {};
      if (profileIds.length) {
        try {
          const { data: grades } = await supabase
            .from('student_grades')
            .select('user_id, grade_level')
            .in('user_id', profileIds);
          gradeMap = Object.fromEntries((grades || []).map((g) => [g.user_id, g.grade_level || '']));
        } catch {}
      }
      const studentsWithGrade = (profiles || []).map((p) => ({
        ...p,
        total_points: Number(p.total_points) || 0,
        grade_level: gradeMap[p.id] || '',
      }));

      return res.status(200).json({
        config,
        entries: entries || [],
        hidden: (hidden || []).map((h) => h.user_id).filter(Boolean),
        students: studentsWithGrade,
        topResults: topResults || [],
      });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action || 'create_entry';

      if (action === 'save_config') {
        const config = parseConfigBody(body.config || body);
        await saveConfig(config);
        return res.status(200).json({ ok: true, config });
      }

      if (action === 'hide_student') {
        const user_id = sanitizeText(body.user_id, 80);
        if (!user_id) return badRequest(res, 'معرف الطالب مطلوب');
        await supabase.from('leaderboard_hidden').delete().eq('user_id', user_id);
        const { error } = await supabase
          .from('leaderboard_hidden')
          .insert({ user_id, created_at: new Date().toISOString() });
        if (error && !String(error.message || '').toLowerCase().includes('duplicate')) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'unhide_student') {
        const user_id = sanitizeText(body.user_id, 80);
        if (!user_id) return badRequest(res, 'معرف الطالب مطلوب');
        const { error } = await supabase.from('leaderboard_hidden').delete().eq('user_id', user_id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'set_points') {
        const user_id = sanitizeText(body.user_id, 80);
        const pts = Number(body.total_points);
        if (!user_id) return badRequest(res, 'معرف الطالب مطلوب');
        if (!Number.isFinite(pts) || pts < 0 || pts >= 1e9) return badRequest(res, 'النقاط غير صالحة');
        const { data, error } = await supabase
          .from('profiles')
          .update({ total_points: Math.floor(pts) })
          .eq('id', user_id)
          .select('id, full_name, total_points')
          .single();
        if (error) throw error;
        return res.status(200).json(data);
      }

      if (action === 'reset_all_points') {
        const { error } = await supabase
          .from('profiles')
          .update({ total_points: 0 })
          .eq('role', 'student');
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'delete_result') {
        const id = Number(body.id);
        if (!id) return badRequest(res, 'معرف النتيجة مطلوب');
        const { error } = await supabase.from('quiz_results').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'create_entry') {
        const display_name = sanitizeText(body.display_name, 80);
        if (!display_name) return badRequest(res, 'اسم المتفوق مطلوب');
        const points = Number(body.points);
        const sort_order = Number(body.sort_order);
        const row = {
          display_name,
          points: Number.isFinite(points) ? Math.floor(points) : 0,
          badge: sanitizeText(body.badge, 60) || '',
          note: sanitizeText(body.note, 300) || '',
          user_id: sanitizeText(body.user_id, 80) || '',
          avatar_url: sanitizeText(body.avatar_url, 500) || '',
          is_published: body.is_published !== false,
          sort_order: Number.isFinite(sort_order) ? Math.floor(sort_order) : 0,
          created_at: new Date().toISOString(),
        };
        const { data, error } = await supabase.from('leaderboard_entries').insert(row).select().single();
        if (error) throw error;
        return res.status(201).json(data);
      }

      return badRequest(res, 'إجراء غير معروف');
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const id = Number(body.id);
      if (!id) return badRequest(res, 'المعرف مطلوب');

      const updates = {};
      if (body.display_name != null) updates.display_name = sanitizeText(body.display_name, 80);
      if (body.points != null) {
        const pts = Number(body.points);
        if (Number.isFinite(pts) && pts >= 0) updates.points = Math.floor(pts);
      }
      if (body.badge != null) updates.badge = sanitizeText(body.badge, 60);
      if (body.note != null) updates.note = sanitizeText(body.note, 300);
      if (body.user_id != null) updates.user_id = sanitizeText(body.user_id, 80);
      if (body.avatar_url != null) updates.avatar_url = sanitizeText(body.avatar_url, 500);
      if (body.is_published != null) updates.is_published = !!body.is_published;
      if (body.sort_order != null) {
        const so = Number(body.sort_order);
        if (Number.isFinite(so)) updates.sort_order = Math.floor(so);
      }
      if (!Object.keys(updates).length) return badRequest(res, 'لا توجد حقول للتحديث');

      const { data, error } = await supabase
        .from('leaderboard_entries')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const body = req.body || {};
      if (body.type === 'result') {
        const id = Number(body.id);
        if (!id) return badRequest(res, 'معرف النتيجة مطلوب');
        const { error } = await supabase.from('quiz_results').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      const id = Number(body.id);
      if (!id) return badRequest(res, 'المعرف مطلوب');
      const { error } = await supabase.from('leaderboard_entries').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'leaderboard');
  }
}
