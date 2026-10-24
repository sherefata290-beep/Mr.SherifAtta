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

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'course-media', limit: 80, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { course_id, id } = req.query;
      if (id) {
        const { data, error } = await supabase.from('course_media').select('*').eq('id', id).single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      let query = supabase.from('course_media').select('*').order('id', { ascending: true });
      if (course_id) query = query.eq('course_id', course_id);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const course_id = asPositiveInt(body.course_id) || body.course_id;
      const url = sanitizeUrl(body.url) || sanitizeText(body.url, 2000);
      if (!course_id || !body.media_type || !url) {
        return res.status(400).json({ error: 'الكورس ونوع الوسائط والرابط مطلوبة' });
      }
      const type = ['image', 'video', 'external', 'audio', 'winamp'].includes(body.media_type)
        ? body.media_type
        : 'external';
      const { data, error } = await supabase
        .from('course_media')
        .insert({
          course_id: Number(course_id),
          media_type: type,
          url,
          title: sanitizeText(body.title, 200),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;

      if (type === 'image') {
        const { error: coverErr } = await supabase
          .from('courses')
          .update({ image_url: data.url })
          .eq('id', Number(course_id));
        if (coverErr) console.error('cover image sync failed:', coverErr.message);
      }

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
      if (body.media_type != null && ['image', 'video', 'external', 'audio', 'winamp'].includes(body.media_type)) {
        updates.media_type = body.media_type;
      }
      const { data, error } = await supabase.from('course_media').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      const { data: existing } = await supabase.from('course_media').select('*').eq('id', id).maybeSingle();
      const { error } = await supabase.from('course_media').delete().eq('id', id);
      if (error) throw error;

      if (existing?.media_type === 'image' && existing.course_id) {
        // Only clear/replace cover if the deleted media was the current cover
        const { data: courseRow } = await supabase
          .from('courses')
          .select('image_url')
          .eq('id', existing.course_id)
          .maybeSingle();

        // Only touch cover when this exact media URL is the current cover
        const wasCover = Boolean(courseRow?.image_url) && courseRow.image_url === existing.url;
        if (wasCover) {
          const { data: remaining } = await supabase
            .from('course_media')
            .select('url')
            .eq('course_id', existing.course_id)
            .eq('media_type', 'image')
            .order('id', { ascending: false })
            .limit(1);
          const { error: coverErr } = await supabase
            .from('courses')
            .update({ image_url: remaining?.[0]?.url || '' })
            .eq('id', existing.course_id);
          if (coverErr) console.error('cover image clear failed:', coverErr.message);
        }
      }

      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'course-media');
  }
}
