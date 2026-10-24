import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  methodNotAllowed,
  serverError,
} from './security.js';

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeWordBank(value) {
  if (Array.isArray(value)) {
    // Flatten accidental "a - b - c" single-item banks
    return value
      .flatMap((w) => String(w).split(/\s*[-–—]\s*|[\n,|/]+/))
      .map((w) => String(w).trim().replace(/^\.+|\.+$/g, ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = parseJsonField(trimmed, []);
      if (Array.isArray(parsed)) {
        return parsed
          .flatMap((w) => String(w).split(/\s*[-–—]\s*|[\n,|/]+/))
          .map((w) => String(w).trim().replace(/^\.+|\.+$/g, ''))
          .filter(Boolean);
      }
    }
    return trimmed
      .split(/\s*[-–—]\s*|[\n,|/]+/)
      .map((w) => w.trim().replace(/^\.+|\.+$/g, ''))
      .filter(Boolean);
  }
  return [];
}

/** Prefer a real sentence over leftover MCQ defaults like "a"/"b"/"c"/"d". */
function pickWordOrderSentence(...candidates) {
  const cleaned = candidates
    .map((c) => String(c ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const real = cleaned.find((s) => !/^[a-d]$/i.test(s));
  return real || '';
}

function defaultInstruction(type) {
  if (type === 'word_form') return 'Read and write the correct form of the word[s] between brackets.';
  if (type === 'rewrite_brackets') return 'Rewrite the following sentences using the word(s) in brackets.';
  if (type === 'punctuate') return 'Punctuate the following sentences.';
  if (type === 'paragraph') return 'Write a paragraph of (50-60) words using the following guiding elements.';
  if (type === 'listening') return 'Listening\nA. Write True (T) or False (F)\nB. Listen again and Complete';
  return '';
}

function normalizeListeningPayload(body = {}, existingAnswerData = null) {
  const base = existingAnswerData && typeof existingAnswerData === 'object' ? existingAnswerData : {};
  const audio_url = String(body.audio_url || base.audio_url || '').trim();

  let true_false = body.true_false;
  if (typeof true_false === 'string') true_false = parseJsonField(true_false, null);
  if (!Array.isArray(true_false)) true_false = Array.isArray(base.true_false) ? base.true_false : [];
  true_false = true_false
    .slice(0, 2)
    .map((row, i) => ({
      statement: String(row?.statement || body[`tf_statement_${i + 1}`] || '').trim(),
      answer: String(row?.answer || body[`tf_answer_${i + 1}`] || 'T')
        .trim()
        .toUpperCase()
        .startsWith('F')
        ? 'F'
        : 'T',
    }));
  while (true_false.length < 2) true_false.push({ statement: '', answer: 'T' });

  let complete_blanks = body.complete_blanks;
  if (typeof complete_blanks === 'string') complete_blanks = parseJsonField(complete_blanks, null);
  if (!Array.isArray(complete_blanks)) complete_blanks = Array.isArray(base.complete_blanks) ? base.complete_blanks : [];
  complete_blanks = complete_blanks
    .slice(0, 3)
    .map((row, i) => ({
      sentence: String(row?.sentence || body[`blank_sentence_${i + 1}`] || '').trim(),
      answer: String(row?.answer || body[`blank_answer_${i + 1}`] || '').trim(),
    }));
  while (complete_blanks.length < 3) complete_blanks.push({ sentence: '', answer: '' });

  return { audio_url, true_false, complete_blanks };
}

async function attachQuestionMedia(questionIds) {
  if (!questionIds?.length) return {};
  try {
    const { data, error } = await supabase
      .from('question_media')
      .select('*')
      .in('question_id', questionIds)
      .order('id', { ascending: true });
    if (error) throw error;
    const byQ = {};
    (data || []).forEach((m) => {
      if (!byQ[m.question_id]) byQ[m.question_id] = [];
      byQ[m.question_id].push(m);
    });
    return byQ;
  } catch (err) {
    console.error('question media fetch failed:', err.message);
    return {};
  }
}

async function attachExtras(questions, hideAnswers = false) {
  if (!questions?.length) return questions || [];
  const ids = questions.map((q) => q.id);
  const { data: extras, error } = await supabase
    .from('question_extras')
    .select('*')
    .in('question_id', ids);
  if (error) throw error;

  const map = Object.fromEntries((extras || []).map((e) => [e.question_id, e]));
  const mediaMap = await attachQuestionMedia(ids);
  return questions.map((q) => {
    const extra = map[q.id];
    const question_type = extra?.question_type || 'multiple_choice';
    const passage_text = extra?.passage_text || '';
    const word_bank = normalizeWordBank(extra?.word_bank);
    const answer_data = parseJsonField(extra?.answer_data, null);
    const media = mediaMap[q.id] || [];

    const base = {
      ...q,
      question_type,
      passage_text,
      word_bank,
      media,
      answer_data: hideAnswers
        ? question_type === 'paragraph'
          ? {
              min_words: answer_data?.min_words || 50,
              max_words: answer_data?.max_words || 60,
              guiding_elements: passage_text || answer_data?.guiding_elements || '',
            }
          : question_type === 'reading_comprehension'
            ? {
                answer_mode: answer_data?.answer_mode === 'essay' ? 'essay' : 'multiple_choice',
                min_words: answer_data?.min_words || 20,
                max_words: answer_data?.max_words || 150,
              }
            : question_type === 'listening'
              ? {
                  audio_url: answer_data?.audio_url || '',
                  true_false: Array.isArray(answer_data?.true_false)
                    ? answer_data.true_false.map((row) => ({
                        statement: row?.statement || '',
                      }))
                    : [{ statement: '' }, { statement: '' }],
                  complete_blanks: Array.isArray(answer_data?.complete_blanks)
                    ? answer_data.complete_blanks.map((row) => ({
                        sentence: row?.sentence || '',
                      }))
                    : [{ sentence: '' }, { sentence: '' }, { sentence: '' }],
                }
              : undefined
        : answer_data,
    };

    if (hideAnswers) {
      const { correct_answer, ...rest } = base;
      if (question_type === 'word_order') {
        return {
          ...rest,
          word_bank: word_bank.length ? [...word_bank].sort(() => Math.random() - 0.5) : word_bank,
        };
      }
      return rest;
    }

    return base;
  });
}

function buildExtraPayload(body) {
  const question_type = body.question_type || 'multiple_choice';
  let passage_text = body.passage_text || body.guiding_elements || '';
  const word_bank = normalizeWordBank(body.word_bank);
  let answer_data = body.answer_data;

  if (typeof answer_data === 'string' && answer_data.trim()) {
    answer_data = parseJsonField(answer_data, answer_data);
  }

  if (question_type === 'complete_text') {
    // Always rebuild blanks from the dedicated field / correct_answer.
    // Prefer blanks_answers; ignore leftover MCQ defaults like "a"/"b"/"c"/"d".
    const candidates = [body.blanks_answers, body.correct_answer, answer_data]
      .map((v) => {
        if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
        if (v && typeof v === 'object') return null;
        const s = String(v ?? '').trim();
        if (!s || /^[a-d]$/i.test(s)) return null;
        if (s.startsWith('[')) {
          const parsed = parseJsonField(s, null);
          if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
        }
        return s.split('|').map((x) => x.trim()).filter(Boolean);
      })
      .find((arr) => Array.isArray(arr) && arr.length);
    answer_data = candidates || [];
  }

  if (question_type === 'word_order') {
    const fromAnswerData =
      typeof answer_data === 'object' && answer_data && !Array.isArray(answer_data)
        ? answer_data.correct_sentence
        : '';
    // Also accept answer_data when it arrives as a JSON string
    let parsedAnswerData = answer_data;
    if (typeof answer_data === 'string' && answer_data.trim().startsWith('{')) {
      parsedAnswerData = parseJsonField(answer_data, null);
    }
    const fromParsed =
      parsedAnswerData && typeof parsedAnswerData === 'object' && !Array.isArray(parsedAnswerData)
        ? parsedAnswerData.correct_sentence
        : '';
    const sentence = pickWordOrderSentence(
      body.correct_sentence,
      body.correct_answer,
      fromAnswerData,
      fromParsed
    );
    // Prefer an explicit word bank; otherwise derive words from the correct sentence.
    // Never keep a single combined "a - b - c" token as the bank.
    const derivedWords = sentence ? sentence.split(/\s+/).filter(Boolean) : [];
    const cleanedBank = word_bank.length > 1 || (word_bank.length === 1 && !/[-–—]/.test(word_bank[0]))
      ? word_bank
      : normalizeWordBank(word_bank[0] || '');
    answer_data = {
      correct_sentence: sentence,
      words: cleanedBank.length ? cleanedBank : derivedWords,
    };
  }

  if (question_type === 'word_form') {
    const blanks = String(body.correct_answer || body.blanks_answers || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    answer_data = { blanks };
  }

  if (question_type === 'rewrite_brackets') {
    const model_answers = String(body.correct_answer || body.blanks_answers || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    answer_data = { model_answers };
  }

  if (question_type === 'punctuate') {
    answer_data = {
      model_answer: body.correct_answer || '',
    };
  }

  if (question_type === 'paragraph') {
    const min_words = Number(body.min_words || answer_data?.min_words || 50);
    const max_words = Number(body.max_words || answer_data?.max_words || 60);
    answer_data = {
      guiding_elements: passage_text,
      min_words,
      max_words,
      model_answer: body.correct_answer || answer_data?.model_answer || '',
    };
  }

  if (question_type === 'reading_comprehension') {
    const answer_mode = body.answer_mode === 'essay' ? 'essay' : 'multiple_choice';
    if (answer_mode === 'essay') {
      answer_data = {
        answer_mode: 'essay',
        model_answer: body.correct_answer || body.model_answer || answer_data?.model_answer || '',
        min_words: Number(body.min_words || answer_data?.min_words || 20),
        max_words: Number(body.max_words || answer_data?.max_words || 150),
      };
    } else {
      answer_data = {
        answer_mode: 'multiple_choice',
      };
    }
  }

  if (question_type === 'listening') {
    const existing = typeof answer_data === 'object' && answer_data ? answer_data : parseJsonField(answer_data, null);
    answer_data = normalizeListeningPayload(body, existing);
  }

  return {
    question_type,
    passage_text,
    word_bank: JSON.stringify(word_bank),
    answer_data: answer_data != null ? JSON.stringify(answer_data) : '',
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'questions', limit: 100, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const { id, quiz_id, hide_answers, admin } = req.query;
      // Full answers only for authenticated admins. Everyone else gets sanitized questions.
      let hideAnswers = true;
      if (admin === 'true' || hide_answers === 'false') {
        const a = await requireAdmin(req, res);
        if (!a) return;
        hideAnswers = false;
      } else if (hide_answers === 'true') {
        hideAnswers = true;
      }

      if (id) {
        const { data, error } = await supabase.from('questions').select('*').eq('id', id).single();
        if (error) throw error;
        const [withExtra] = await attachExtras([data], hideAnswers);
        return res.status(200).json(withExtra);
      }

      // Listing all questions without quiz_id is admin-only
      if (!quiz_id) {
        const a = await requireAdmin(req, res);
        if (!a) return;
        hideAnswers = false;
      }

      let query = supabase.from('questions').select('*').order('order_index', { ascending: true });
      if (quiz_id) query = query.eq('quiz_id', quiz_id);
      const { data, error } = await query;
      if (error) throw error;
      const withExtras = await attachExtras(data, hideAnswers);
      return res.status(200).json(withExtras);
    }

    if (req.method === 'POST') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const {
        quiz_id,
        question_text,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        points,
        order_index,
        question_type = 'multiple_choice',
      } = body;

      let finalText = question_text || defaultInstruction(question_type);
      if (!quiz_id || !finalText) {
        return res.status(400).json({ error: 'الاختبار والسؤال مطلوبان' });
      }

      let finalCorrect = correct_answer || '';
      if (question_type === 'multiple_choice') {
        finalCorrect = correct_answer || 'a';
      }
      if (question_type === 'reading_comprehension') {
        if (body.answer_mode === 'essay') {
          finalCorrect = String(correct_answer || body.model_answer || '').trim();
        } else {
          finalCorrect = correct_answer || 'a';
        }
      }
      if (question_type === 'complete_text' || question_type === 'word_form' || question_type === 'rewrite_brackets') {
        // Prefer blanks_answers; ignore leftover MCQ single-letter defaults
        const rawCandidates = [body.blanks_answers, correct_answer, body.correct_answer]
          .map((s) => String(s ?? '').trim())
          .filter((s) => s && !/^[a-d]$/i.test(s));
        finalCorrect = (rawCandidates[0] || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean)
          .join('|');
        if (question_type === 'complete_text' && !finalCorrect) {
          return res.status(400).json({
            error: 'إجابات الفراغات مطلوبة لسؤال إكمال النص',
          });
        }
      }
      if (question_type === 'word_order') {
        // Prefer the dedicated correct_sentence field. Ignore leftover MCQ defaults like "a".
        const fromAd =
          body.answer_data && typeof body.answer_data === 'object'
            ? body.answer_data.correct_sentence
            : '';
        finalCorrect = pickWordOrderSentence(
          body.correct_sentence,
          correct_answer,
          fromAd
        );
        if (!finalCorrect) {
          return res.status(400).json({
            error: 'الجملة الصحيحة بالترتيب مطلوبة لسؤال ترتيب الكلمات',
          });
        }
      }
      if (question_type === 'punctuate' || question_type === 'paragraph') {
        finalCorrect = String(correct_answer || '').trim();
      }
      if (question_type === 'listening') {
        const listening = normalizeListeningPayload(body);
        finalCorrect = JSON.stringify({
          true_false: listening.true_false.map((r) => r.answer),
          complete_blanks: listening.complete_blanks.map((r) => r.answer),
        });
        body.answer_data = listening;
        body.audio_url = listening.audio_url;
      }

      const { data, error } = await supabase
        .from('questions')
        .insert({
          quiz_id,
          question_text: finalText,
          option_a: option_a || '',
          option_b: option_b || '',
          option_c: option_c || '',
          option_d: option_d || '',
          correct_answer: finalCorrect,
          points: points || 1,
          order_index: order_index || 1,
        })
        .select()
        .single();
      if (error) throw error;

      const extra = buildExtraPayload({ ...body, question_type, correct_answer: finalCorrect });
      await supabase.from('question_extras').insert({
        question_id: data.id,
        ...extra,
      });

      const [full] = await attachExtras([data], false);
      return res.status(201).json(full);
    }

    if (req.method === 'PUT') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const body = req.body || {};
      const {
        id,
        question_type,
        passage_text,
        guiding_elements,
        word_bank,
        answer_data,
        blanks_answers,
        correct_sentence,
        min_words,
        max_words,
        answer_mode,
        model_answer,
        ...rest
      } = body;
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });

      const updates = { ...rest };
      delete updates.question_type;
      delete updates.passage_text;
      delete updates.guiding_elements;
      delete updates.word_bank;
      delete updates.answer_data;
      delete updates.blanks_answers;
      delete updates.correct_sentence;
      delete updates.min_words;
      delete updates.max_words;
      delete updates.answer_mode;
      delete updates.model_answer;
      delete updates.media;

      const type = question_type || 'multiple_choice';
      if (!updates.question_text) {
        updates.question_text = defaultInstruction(type);
      }

      if (type === 'complete_text' || type === 'word_form' || type === 'rewrite_brackets') {
        const rawCandidates = [blanks_answers, body.blanks_answers, updates.correct_answer, body.correct_answer]
          .map((s) => String(s ?? '').trim())
          .filter((s) => s && !/^[a-d]$/i.test(s));
        updates.correct_answer = (rawCandidates[0] || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean)
          .join('|');
        if (type === 'complete_text' && !updates.correct_answer) {
          return res.status(400).json({
            error: 'إجابات الفراغات مطلوبة لسؤال إكمال النص',
          });
        }
      }
      if (type === 'word_order') {
        const fromAd =
          body.answer_data && typeof body.answer_data === 'object'
            ? body.answer_data.correct_sentence
            : typeof answer_data === 'object' && answer_data
              ? answer_data.correct_sentence
              : '';
        updates.correct_answer = pickWordOrderSentence(
          correct_sentence,
          body.correct_sentence,
          updates.correct_answer,
          fromAd
        );
        if (!updates.correct_answer) {
          return res.status(400).json({
            error: 'الجملة الصحيحة بالترتيب مطلوبة لسؤال ترتيب الكلمات',
          });
        }
      }
      if (type === 'reading_comprehension' && answer_mode === 'essay') {
        updates.correct_answer = String(model_answer || updates.correct_answer || '').trim();
      }
      if (type === 'listening') {
        const listening = normalizeListeningPayload({
          ...body,
          audio_url: body.audio_url,
          true_false: body.true_false,
          complete_blanks: body.complete_blanks,
        });
        updates.correct_answer = JSON.stringify({
          true_false: listening.true_false.map((r) => r.answer),
          complete_blanks: listening.complete_blanks.map((r) => r.answer),
        });
        body.answer_data = listening;
        body.audio_url = listening.audio_url;
      }

      // never write listening helper fields into questions table
      delete updates.audio_url;
      delete updates.true_false;
      delete updates.complete_blanks;
      delete updates.tf_statement_1;
      delete updates.tf_statement_2;
      delete updates.tf_answer_1;
      delete updates.tf_answer_2;
      delete updates.blank_sentence_1;
      delete updates.blank_sentence_2;
      delete updates.blank_sentence_3;
      delete updates.blank_answer_1;
      delete updates.blank_answer_2;
      delete updates.blank_answer_3;

      const { data, error } = await supabase.from('questions').update(updates).eq('id', id).select().single();
      if (error) throw error;

      const extra = buildExtraPayload({
        question_type: type,
        passage_text: passage_text || guiding_elements,
        guiding_elements,
        word_bank,
        answer_data: body.answer_data || answer_data || blanks_answers,
        correct_answer: updates.correct_answer,
        correct_sentence: correct_sentence || body.correct_sentence || updates.correct_answer,
        blanks_answers,
        min_words,
        max_words,
        answer_mode,
        model_answer: model_answer || updates.correct_answer,
      });

      const { data: existing } = await supabase
        .from('question_extras')
        .select('id')
        .eq('question_id', id)
        .maybeSingle();

      if (existing?.id) {
        await supabase.from('question_extras').update(extra).eq('question_id', id);
      } else {
        await supabase.from('question_extras').insert({ question_id: id, ...extra });
      }

      const [full] = await attachExtras([data], false);
      return res.status(200).json(full);
    }

    if (req.method === 'DELETE') {
      const a = await requireAdmin(req, res);
      if (!a) return;
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'المعرف مطلوب' });
      try {
        await supabase.from('question_media').delete().eq('question_id', id);
      } catch {}
      await supabase.from('question_extras').delete().eq('question_id', id);
      const { error } = await supabase.from('questions').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'questions');
  }
}
