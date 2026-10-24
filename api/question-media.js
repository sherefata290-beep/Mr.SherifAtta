import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  sanitizeText,
  sanitizeUrl,
  asPositiveInt,
  methodNotAllowed,
  serverError,
} from './security.js';

const ALLOWED_TYPES = ['image', 'video', 'external', 'audio', 'winamp', 'file'];

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'question-media', limit: 80, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { question_id, id } = req.query;
      if (id) {
        const { data, error } = await supabase.from('question_media').select('*').eq('id', id).single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      let query = supabase.from('question_media').select('*').order('id', { ascending: true });
      if (question_id) query = query.eq('question_id', question_id);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const question_id = asPositiveInt(body.question_id) || body.question_id;
      const url = sanitizeUrl(body.url) || sanitizeText(body.url, 2000);
      if (!question_id || !body.media_type || !url) {
        return res.status(400).json({ error: 'السؤال ونوع الملف والرابط مطلوبة' });
      }
      const type = ALLOWED_TYPES.includes(body.media_type) ? body.media_type : 'file';
      const { data, error } = await supabase
        .from('question_media')
        .insert({
          question_id: Number(question_id),
          media_type: type,
          url,
          title: sanitizeText(body.title, 200),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      const updates = {};
      if (body.url != null) updates.url = sanitizeUrl(body.url) || sanitizeText(body.url, 2000);
      if (body.title != null) updates.title = sanitizeText(body.title, 200);
      if (body.media_type != null && ALLOWED_TYPES.includes(body.media_type)) {
        updates.media_type = body.media_type;
      }
      const { data, error } = await supabase.from('question_media').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      const { error } = await supabase.from('question_media').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'question-media');
  }
}
