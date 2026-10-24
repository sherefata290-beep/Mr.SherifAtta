import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  validateUploadPayload,
  methodNotAllowed,
  serverError,
  MAX_UPLOAD_BYTES,
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_DIRECT_UPLOAD_LABEL,
  ALLOWED_UPLOAD_MIME_TYPES,
  isAllowedUploadMime,
} from './security.js';

const ALLOWED_FOLDERS = new Set(['courses', 'lessons', 'quizzes', 'homepage', 'questions']);

function safeFileName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120) || 'file';
}

function normalizeContentType(contentType, fileName = '') {
  let t = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!t || t === 'application/octet-stream') {
    const n = String(fileName || '').toLowerCase();
    if (n.endsWith('.mp3')) t = 'audio/mpeg';
    else if (n.endsWith('.wav')) t = 'audio/wav';
    else if (n.endsWith('.m4a')) t = 'audio/mp4';
    else if (n.endsWith('.aac')) t = 'audio/aac';
    else if (n.endsWith('.ogg') || n.endsWith('.oga')) t = 'audio/ogg';
    else if (n.endsWith('.flac')) t = 'audio/flac';
    else if (n.endsWith('.webm')) t = 'audio/webm';
    else if (n.endsWith('.mp4') || n.endsWith('.m4v')) t = 'video/mp4';
    else if (n.endsWith('.mov')) t = 'video/quicktime';
    else if (n.endsWith('.jpg') || n.endsWith('.jpeg')) t = 'image/jpeg';
    else if (n.endsWith('.png')) t = 'image/png';
    else if (n.endsWith('.webp')) t = 'image/webp';
    else if (n.endsWith('.gif')) t = 'image/gif';
    else if (n.endsWith('.m3u') || n.endsWith('.m3u8')) t = 'audio/x-mpegurl';
    else if (n.endsWith('.pls')) t = 'audio/x-scpls';
    else if (n.endsWith('.pdf')) t = 'application/pdf';
    else if (n.endsWith('.doc')) t = 'application/msword';
    else if (n.endsWith('.docx')) t = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (n.endsWith('.xls')) t = 'application/vnd.ms-excel';
    else if (n.endsWith('.xlsx')) t = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (n.endsWith('.ppt')) t = 'application/vnd.ms-powerpoint';
    else if (n.endsWith('.pptx')) t = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    else if (n.endsWith('.txt')) t = 'text/plain';
    else if (n.endsWith('.csv')) t = 'text/csv';
    else if (n.endsWith('.rtf')) t = 'application/rtf';
    else if (n.endsWith('.zip')) t = 'application/zip';
    else if (n.endsWith('.rar')) t = 'application/vnd.rar';
  }
  // normalize common aliases
  if (t === 'audio/mp3') t = 'audio/mpeg';
  if (t === 'audio/x-mp3') t = 'audio/mpeg';
  if (t === 'audio/m4a' || t === 'audio/x-m4a') t = 'audio/mp4';
  if (t === 'audio/wave' || t === 'audio/x-wav') t = 'audio/wav';
  return t || 'application/octet-stream';
}

async function ensureBucket() {
  // Keep the bucket public and unrestricted by MIME.
  // Browsers send inconsistent audio types (e.g. audio/x-m4a). App-level checks
  // happen in this API. Do NOT set fileSizeLimit here — large values can be
  // rejected by the project and break updates; null = project default.
  try {
    await supabase.storage.createBucket('course-media', {
      public: true,
      allowedMimeTypes: null,
    });
  } catch {
    /* already exists */
  }
  try {
    // Clear any previous MIME allow-list that blocked audio (audio/x-m4a, etc.)
    await supabase.storage.updateBucket('course-media', {
      public: true,
      allowedMimeTypes: null,
    });
  } catch {
    /* ignore if update not supported */
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  // Higher limit for large audio/video signed URL requests
  const rl = rateLimit(req, { key: 'upload', limit: 80, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method !== 'POST') return methodNotAllowed(res);

    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const body = req.body || {};
    const {
      fileName,
      fileBase64,
      contentType: rawType,
      folder,
      mode,
      fileSize,
    } = body;

    const contentType = normalizeContentType(rawType, fileName);

    if (contentType && contentType !== 'application/octet-stream' && !isAllowedUploadMime(contentType)) {
      return res.status(400).json({
        error: 'نوع الملف غير مدعوم. استخدم صورة أو فيديو أو صوت أو مستند (PDF/Word/Excel/PowerPoint/ZIP).',
      });
    }

    const prefix = ALLOWED_FOLDERS.has(folder) ? folder : 'courses';
    const path = `${prefix}/${Date.now()}-${safeFileName(fileName)}`;

    await ensureBucket();

    // Direct-to-storage signed upload (required for audio/video / large files)
    if (mode === 'signed' || mode === 'direct') {
      if (!fileName) return res.status(400).json({ error: 'اسم الملف مطلوب' });
      const size = Number(fileSize) || 0;
      if (size > MAX_DIRECT_UPLOAD_BYTES) {
        return res.status(400).json({
          error: `حجم الملف كبير جداً (الحد الأقصى ${MAX_DIRECT_UPLOAD_LABEL}).`,
        });
      }
      if (size > 0 && size < 10) {
        return res.status(400).json({ error: 'ملف فارغ أو تالف' });
      }

      const { data, error } = await supabase.storage
        .from('course-media')
        .createSignedUploadUrl(path);

      if (error) throw error;

      const { data: urlData } = supabase.storage.from('course-media').getPublicUrl(path);

      return res.status(200).json({
        mode: 'signed',
        path: data.path || path,
        token: data.token,
        signedUrl: data.signedUrl,
        publicUrl: urlData.publicUrl,
        contentType,
        maxBytes: MAX_DIRECT_UPLOAD_BYTES,
      });
    }

    // Legacy small base64 upload
    const check = validateUploadPayload({ fileName, fileBase64, contentType });
    if (!check.ok) return res.status(400).json({ error: check.error });

    let buffer;
    try {
      buffer = Buffer.from(String(fileBase64).replace(/\s/g, ''), 'base64');
    } catch {
      return res.status(400).json({ error: 'ملف تالف' });
    }
    if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(400).json({
        error: `حجم الملف غير مسموح عبر الرفع العادي. استخدم الرفع المباشر (حتى ${MAX_DIRECT_UPLOAD_LABEL}).`,
      });
    }

    const { error } = await supabase.storage.from('course-media').upload(path, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw error;

    const { data: urlData } = supabase.storage.from('course-media').getPublicUrl(path);
    return res.status(200).json({
      url: urlData.publicUrl,
      path,
      contentType: contentType || '',
    });
  } catch (err) {
    return serverError(res, err, 'upload');
  }
}
