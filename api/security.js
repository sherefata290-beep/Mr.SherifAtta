import supabase from './db-client.js';

/** In-memory rate limiter (per serverless instance) */
const buckets = new Map();

const ADMIN_BOOTSTRAP_EMAIL = 'admin@englishmastery.com';

/** Secret PIN to unlock admin account settings section */
export const ACCOUNTS_SECTION_PIN = '01557428580';

/** Staff roles that can open the admin panel (with different permissions) */
export const STAFF_ROLES = new Set(['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support']);

export const ROLE_META = {
  admin: {
    label: 'الإدارة الكاملة',
    description: 'صلاحية كاملة على المنصة وإعداد الحسابات',
  },
  curriculum: {
    label: 'إدارة المناهج',
    description: 'إدارة أقسام الكورسات والدروس والاختبارات والأسئلة معًا',
  },
  users: {
    label: 'إدارة المستخدمين',
    description: 'إدارة الطلاب ومتابعة بياناتهم ونتائجهم',
  },
  // legacy alias kept for existing rows
  support: {
    label: 'إدارة المستخدمين',
    description: 'إدارة الطلاب ومتابعة بياناتهم ونتائجهم',
  },
  reports: {
    label: 'عرض التقارير فقط',
    description: 'عرض الإحصائيات ونتائج الاختبارات فقط',
  },
  content: {
    label: 'إدارة المحتوى',
    description: 'إدارة الكورسات والدروس والوسائط وذيل الموقع',
  },
  exams: {
    label: 'إدارة الاختبارات',
    description: 'إدارة الاختبارات والأسئلة والنتائج',
  },
};

export function isStaffRole(role) {
  return STAFF_ROLES.has(String(role || '').toLowerCase());
}

export function isFullAdminRole(role, email) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return true;
  if (email && String(email).toLowerCase() === ADMIN_BOOTSTRAP_EMAIL) return true;
  return false;
}

export function verifyAccountsPin(pin) {
  return String(pin || '').trim() === ACCOUNTS_SECTION_PIN;
}

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Do not set X-Frame-Options DENY — the app must load inside the Design Arena preview iframe.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleOptions(req, res) {
  applySecurityHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || req.headers['x-real-ip'] || 'unknown';
}

/**
 * Simple sliding window rate limit.
 * @returns {{ ok: true } | { ok: false, retryAfter: number }}
 */
export function rateLimit(req, { key = 'global', limit = 60, windowMs = 60_000 } = {}) {
  const ip = getClientIp(req);
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  let bucket = buckets.get(bucketKey);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(bucketKey, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.ceil((windowMs - (now - bucket.start)) / 1000);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  // opportunistic cleanup
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.start > windowMs * 2) buckets.delete(k);
    }
  }
  return { ok: true };
}

export function rejectRateLimit(res, retryAfter = 60) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'عدد الطلبات كبير جداً. حاول لاحقاً.' });
}

export function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Verify Supabase JWT and return auth user */
export async function getAuthUser(req) {
  const token = getBearerToken(req);
  if (!token || token.length < 20 || token.length > 4096) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    // reject clearly disabled/deleted patterns
    if (data.user.banned_until) return null;
    return data.user;
  } catch {
    return null;
  }
}

export async function getProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return null;
  return data || null;
}

export async function requireAuth(req, res) {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'يجب تسجيل الدخول' });
    return null;
  }
  return user;
}

export async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  let profile = await getProfile(user.id);

  // ensure bootstrap admin has admin role in DB
  if (profile && profile.role !== 'admin' && user.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL) {
    await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id);
    profile = { ...profile, role: 'admin' };
  }

  const role = profile?.role || (user.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ? 'admin' : '');
  if (!isStaffRole(role) && user.email?.toLowerCase() !== ADMIN_BOOTSTRAP_EMAIL) {
    res.status(403).json({ error: 'غير مصرح — صلاحيات المشرف فقط' });
    return null;
  }
  return { user, profile: profile || { role: 'admin' } };
}

/** Full admin only (not content/exams/support) */
export async function requireFullAdmin(req, res) {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return null;
  if (!isFullAdminRole(ctx.profile?.role, ctx.user?.email)) {
    res.status(403).json({ error: 'غير مصرح — هذه العملية للمشرف الكامل فقط' });
    return null;
  }
  return ctx;
}

export function sanitizeText(value, maxLen = 5000) {
  if (value == null) return '';
  let s = String(value);
  // strip null bytes and control chars except newline/tab
  s = s.replace(/\0/g, '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // neutralize obvious HTML injection for stored text
  s = s.replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'));
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

export function sanitizeEmail(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) || s.length > 254) return null;
  return s;
}

export function sanitizeUrl(value, maxLen = 2000) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length > maxLen) return '';
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function asPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

export function asBool(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === true || value === 1 || value === '1') return true;
  if (value === 'false' || value === false || value === 0 || value === '0') return false;
  return defaultValue;
}

/** Max decoded file size for base64 API uploads (~4MB keeps under serverless body limits) */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Max file size for direct-to-storage signed uploads (video / audio / image).
 * 5 GB is the highest practical per-file limit we enforce in-app
 * (Supabase plan limits still apply at the project level).
 */
export const MAX_DIRECT_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

/** Human-readable label for UI messages */
export const MAX_DIRECT_UPLOAD_LABEL = '5 جيجابايت';

/** Allowed MIME types for uploads (images, video, audio) */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'audio/opus',
  'audio/x-aac',
  'audio/3gpp',
  'audio/3gpp2',
  'application/ogg',
  'application/octet-stream',
  // Winamp / playlist files
  'audio/x-mpegurl',
  'audio/mpegurl',
  'application/vnd.apple.mpegurl',
  'application/x-mpegURL',
  'audio/x-scpls',
  'application/pls+xml',
  'text/plain',
  // Documents / general files for lessons & questions
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/csv',
  'text/rtf',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
];

export function isAllowedUploadMime(contentType) {
  if (!contentType) return true;
  const t = String(contentType).toLowerCase().split(';')[0].trim();
  if (ALLOWED_UPLOAD_MIME_TYPES.includes(t)) return true;
  // Allow any audio/* / image/* / common video/* as browsers vary
  if (t.startsWith('audio/')) return true;
  if (t.startsWith('image/')) return true;
  if (t.startsWith('video/')) return true;
  // Common document families
  if (t.startsWith('text/')) return true;
  if (t.startsWith('application/pdf')) return true;
  if (t.includes('officedocument') || t.includes('msword') || t.includes('ms-excel') || t.includes('ms-powerpoint')) return true;
  if (t.includes('opendocument')) return true;
  if (t.includes('zip') || t.includes('rar') || t.includes('compressed')) return true;
  return false;
}

export function validateUploadPayload({ fileName, fileBase64, contentType }) {
  if (!fileName || !fileBase64) return { ok: false, error: 'الملف مطلوب' };
  const name = String(fileName);
  if (name.length > 180) return { ok: false, error: 'اسم الملف طويل جداً' };
  if (/[\\/]|\.\./.test(name)) return { ok: false, error: 'اسم ملف غير صالح' };

  if (contentType && !isAllowedUploadMime(contentType)) {
    return { ok: false, error: 'نوع الملف غير مدعوم. استخدم صورة أو فيديو أو ملف صوتي.' };
  }

  // rough base64 size check before Buffer allocation
  const b64 = String(fileBase64).replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64.slice(0, 200)) && b64.length > 0) {
    // still allow; some clients send without strict padding checks
  }
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'حجم الملف كبير عبر الرفع العادي. سيتم استخدام الرفع المباشر للفيديوهات حتى 5 جيجابايت.' };
  }
  if (approxBytes < 10) return { ok: false, error: 'ملف فارغ أو تالف' };

  return { ok: true, safeName: name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) };
}

export function methodNotAllowed(res) {
  return res.status(405).json({ error: 'Method not allowed' });
}

export function serverError(res, err, logLabel = 'API error') {
  console.error(logLabel + ':', err?.message || err);
  // never leak stack traces
  return res.status(500).json({ error: 'حدث خطأ في الخادم' });
}

export const ALLOWED_GRADE_LEVELS = new Set([
  'primary_3',
  'primary_4',
  'primary_5',
  'primary_6',
  'prep_1',
  'prep_2',
  'prep_3',
]);

export function sanitizeGradeLevel(value) {
  if (value == null) return '';
  const g = String(value).trim();
  return ALLOWED_GRADE_LEVELS.has(g) ? g : '';
}

/** Resolve student grade for the authenticated user (empty if guest/admin path). */
export async function getUserGradeLevel(userId) {
  if (!userId) return '';
  try {
    const { data } = await supabase
      .from('student_grades')
      .select('grade_level')
      .eq('user_id', userId)
      .maybeSingle();
    return sanitizeGradeLevel(data?.grade_level || '');
  } catch {
    return '';
  }
}

/**
 * True only after the student has redeemed at least one access code.
 * Grade selection at signup does NOT unlock content by itself.
 */
export async function getUserHasAccess(userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('code_redemptions')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  } catch (err) {
    console.error('getUserHasAccess failed:', err?.message || err);
    return false;
  }
}

/** Student may open graded content only with redeemed access code + matching grade. */
export async function assertStudentContentAccess({
  userId,
  itemGrade = '',
  lockedMessage = 'يجب إدخال كود الوصول أولاً لفتح المحتوى',
  gradeMessage = 'هذا المحتوى غير متاح لصفك الدراسي',
} = {}) {
  if (!userId) {
    return { ok: false, status: 401, error: 'يجب تسجيل الدخول' };
  }
  const hasAccess = await getUserHasAccess(userId);
  if (!hasAccess) {
    return { ok: false, status: 403, error: lockedMessage };
  }
  const studentGrade = await getUserGradeLevel(userId);
  if (!studentGrade) {
    return { ok: false, status: 403, error: lockedMessage };
  }
  const grade = sanitizeGradeLevel(itemGrade);
  if (!grade || grade !== studentGrade) {
    return { ok: false, status: 403, error: gradeMessage };
  }
  return { ok: true, studentGrade, hasAccess: true };
}

export async function getCourseGradeMap(courseIds = []) {
  const ids = (courseIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase.from('course_grades').select('*').in('course_id', ids);
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      map[Number(row.course_id)] = sanitizeGradeLevel(row.grade_level) || '';
    });
    return map;
  } catch (err) {
    console.error('course_grades fetch failed:', err.message);
    return {};
  }
}

export async function getQuizGradeMap(quizIds = []) {
  const ids = (quizIds || []).map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase.from('quiz_grades').select('*').in('quiz_id', ids);
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      map[Number(row.quiz_id)] = sanitizeGradeLevel(row.grade_level) || '';
    });
    return map;
  } catch (err) {
    console.error('quiz_grades fetch failed:', err.message);
    return {};
  }
}

export async function setCourseGrade(courseId, gradeLevel) {
  const id = Number(courseId);
  if (!id) return;
  const grade = sanitizeGradeLevel(gradeLevel);
  await supabase.from('course_grades').delete().eq('course_id', id);
  if (grade) {
    await supabase.from('course_grades').insert({
      course_id: id,
      grade_level: grade,
      updated_at: new Date().toISOString(),
    });
  }
}

export async function setQuizGrade(quizId, gradeLevel) {
  const id = Number(quizId);
  if (!id) return;
  const grade = sanitizeGradeLevel(gradeLevel);
  await supabase.from('quiz_grades').delete().eq('quiz_id', id);
  if (grade) {
    await supabase.from('quiz_grades').insert({
      quiz_id: id,
      grade_level: grade,
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Attach grade_level to items.
 * Catalog lists show everything; opening is restricted separately by grade.
 * If filterToStudent is true, keep only matching student grade (legacy).
 */
export function filterByStudentGrade(
  items,
  gradeMap,
  { adminMode = false, studentGrade = '', filterToStudent = false } = {}
) {
  const withGrade = (items || []).map((item) => ({
    ...item,
    grade_level: gradeMap[Number(item.id)] || gradeMap[item.id] || '',
  }));
  if (adminMode || !filterToStudent) return withGrade;
  if (!studentGrade) return [];
  return withGrade.filter((item) => item.grade_level && item.grade_level === studentGrade);
}

/** Whether a student may open an item for their grade */
export function canOpenByGrade({ isAdmin = false, studentGrade = '', itemGrade = '' }) {
  if (isAdmin) return true;
  if (!studentGrade) return false;
  if (!itemGrade) return false;
  return itemGrade === studentGrade;
}

export { ADMIN_BOOTSTRAP_EMAIL };
