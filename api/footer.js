import supabase from './db-client.js';
import {
  handleOptions,
  rateLimit,
  rejectRateLimit,
  requireAdmin,
  sanitizeText,
  sanitizeUrl,
  methodNotAllowed,
  serverError,
} from './security.js';

const FOOTER_KEY = 'footer';

export const DEFAULT_FOOTER = {
  about: {
    title: 'English Mastery',
    subtitle: 'Mr. Sherif Atta',
    description:
      'منصة تعليمية متخصصة في اللغة الإنجليزية تقدم كورسات منظمة واختبارات تفاعلية ومتابعة مستمرة لمستوى الطلاب، بإشراف المدرس Mr. Sherif Atta.',
  },
  links: {
    title: 'روابط سريعة',
    items: [
      { label: 'الرئيسية', to: '/' },
      { label: 'الكورسات', to: '/courses' },
      { label: 'الاختبارات', to: '/quizzes' },
      { label: 'منصة الأوائل', to: '/leaderboard' },
      { label: 'الحضور والمتابعة', to: '/progress' },
      { label: 'تسجيل الدخول', to: '/login' },
    ],
  },
  contact: {
    title: 'تواصل معنا',
    email: 'info@englishmastery.com',
    phone: '+20 100 000 0000',
    address: 'مصر · دروس أونلاين وحضورية',
  },
  copyright: 'جميع الحقوق محفوظة © {year} English Mastery · Mr. Sherif Atta',
};

function safeLinkPath(to) {
  const s = String(to || '').trim();
  if (!s) return '/';
  // allow internal paths only
  if (s.startsWith('/') && !s.startsWith('//') && !s.includes('<') && s.length <= 200) {
    return s;
  }
  // allow external http(s)
  const url = sanitizeUrl(s);
  return url || '/';
}

function sanitizeFooter(input) {
  const src = input && typeof input === 'object' ? input : {};
  const aboutSrc = src.about && typeof src.about === 'object' ? src.about : {};
  const linksSrc = src.links && typeof src.links === 'object' ? src.links : {};
  const contactSrc = src.contact && typeof src.contact === 'object' ? src.contact : {};

  const itemsRaw = Array.isArray(linksSrc.items) ? linksSrc.items : DEFAULT_FOOTER.links.items;
  const items = itemsRaw
    .slice(0, 20)
    .map((it) => ({
      label: sanitizeText(it?.label, 80) || 'رابط',
      to: safeLinkPath(it?.to),
    }))
    .filter((it) => it.label);

  return {
    about: {
      title: sanitizeText(aboutSrc.title, 120) || DEFAULT_FOOTER.about.title,
      subtitle: sanitizeText(aboutSrc.subtitle, 120) || '',
      description: sanitizeText(aboutSrc.description, 1000) || '',
    },
    links: {
      title: sanitizeText(linksSrc.title, 80) || DEFAULT_FOOTER.links.title,
      items: items.length ? items : DEFAULT_FOOTER.links.items,
    },
    contact: {
      title: sanitizeText(contactSrc.title, 80) || DEFAULT_FOOTER.contact.title,
      email: sanitizeText(contactSrc.email, 120) || '',
      phone: sanitizeText(contactSrc.phone, 60) || '',
      address: sanitizeText(contactSrc.address, 200) || '',
    },
    copyright: sanitizeText(src.copyright, 300) || DEFAULT_FOOTER.copyright,
  };
}

async function readFooter() {
  const { data, error } = await supabase.from('settings').select('*').eq('key', FOOTER_KEY).maybeSingle();
  if (error) throw error;
  if (!data?.value) return DEFAULT_FOOTER;
  try {
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return sanitizeFooter(parsed);
  } catch {
    return DEFAULT_FOOTER;
  }
}

async function writeFooter(footer) {
  const clean = sanitizeFooter(footer);
  const value = JSON.stringify(clean);
  const { data: existing } = await supabase.from('settings').select('key').eq('key', FOOTER_KEY).maybeSingle();
  if (existing) {
    const { data, error } = await supabase
      .from('settings')
      .update({ value })
      .eq('key', FOOTER_KEY)
      .select()
      .single();
    if (error) throw error;
    return clean;
  }
  const { error } = await supabase.from('settings').insert({ key: FOOTER_KEY, value }).select().single();
  if (error) throw error;
  return clean;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = rateLimit(req, { key: 'footer', limit: 80, windowMs: 60_000 });
  if (!rl.ok) return rejectRateLimit(res, rl.retryAfter);

  try {
    if (req.method === 'GET') {
      const footer = await readFooter();
      return res.status(200).json(footer);
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const footer = await writeFooter(req.body || {});
      return res.status(200).json(footer);
    }

    return methodNotAllowed(res);
  } catch (err) {
    return serverError(res, err, 'footer');
  }
}
