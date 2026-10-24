import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, ClipboardList, Users, HelpCircle,
  Plus, Pencil, Trash2, X, Save, BarChart3, Image as ImageIcon, Video, Link2, Upload,
  PanelBottom, Printer, FileDown, KeyRound, Shield, Lock, UserCog, Trophy, Eye, EyeOff, Crown, Search,
  Music2, FileText, Paperclip, File, CalendarCheck2, QrCode, Download, RefreshCw, MessageCircle
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import WinampPlayer from '../components/WinampPlayer';
import { apiFetch, notifyDataChanged } from '../lib/api';
import { gradeLabel, GRADE_OPTIONS } from '../lib/grades';
import { optimizeImageFile, preloadImage, writeCachedHomepageImage } from '../lib/imageOptimize';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_OPTIONS, roleLabel, roleDescription, tabsForRole, isFullAdmin } from '../lib/roles';
import {
  parentTrackUrl,
  qrImageUrl,
  downloadQrPng,
  downloadQrPdf,
  printQr,
} from '../lib/qr';
import {
  SESSION_TYPE_OPTIONS,
  sessionTypeLabel,
  normalizeSessionType,
  DEFAULT_ATTENDANCE_SETTINGS,
  getLessonAttendanceSettings,
} from '../lib/sessionTypes';
import supabase from '../lib/supabase';

const TABS = [
  { id: 'dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
  { id: 'courses', label: 'الكورسات', icon: BookOpen },
  { id: 'lessons', label: 'الدروس', icon: BookOpen },
  { id: 'quizzes', label: 'الاختبارات', icon: ClipboardList },
  { id: 'questions', label: 'الأسئلة', icon: HelpCircle },
  { id: 'students', label: 'الطلاب', icon: Users },
  { id: 'results', label: 'النتائج', icon: BarChart3 },
  { id: 'leaderboard', label: 'منصة الأوائل', icon: Trophy },
  { id: 'attendance', label: 'الحضور والمتابعة', icon: CalendarCheck2 },
  { id: 'codes', label: 'إنشاء الأكواد', icon: KeyRound },
  { id: 'notifications', label: 'التنبيهات', icon: MessageCircle },
  { id: 'footer', label: 'الذيل', icon: PanelBottom },
  { id: 'accounts', label: 'إعداد الحسابات', icon: UserCog },
];

const DEFAULT_LEADERBOARD_CONFIG = {
  title: 'منصة الأوائل',
  subtitle: 'أفضل طلاب English Mastery · Mr. Sherif Atta',
  show_auto_ranking: true,
  show_top_results: true,
  show_featured: true,
  max_students: 50,
  max_results: 20,
  enabled: true,
};

const DEFAULT_FOOTER_FORM = {
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

const emptyCourse = {
  title: '',
  title_ar: '',
  description: '',
  description_ar: '',
  level: 'beginner',
  grade_level: 'primary_3',
  duration: '',
  is_published: true,
  image_url: '',
};
const emptyLesson = {
  course_id: '',
  title: '',
  title_ar: '',
  content: '',
  order_index: 1,
  duration_minutes: 30,
  session_type: DEFAULT_ATTENDANCE_SETTINGS.session_type,
  video_duration_minutes: DEFAULT_ATTENDANCE_SETTINGS.video_duration_minutes,
  required_watch_percent: DEFAULT_ATTENDANCE_SETTINGS.required_watch_percent,
  external_required_seconds: DEFAULT_ATTENDANCE_SETTINGS.external_required_seconds,
  linked_quiz_id: DEFAULT_ATTENDANCE_SETTINGS.linked_quiz_id,
  session_points: DEFAULT_ATTENDANCE_SETTINGS.session_points,
};
const emptyQuiz = {
  title: '',
  title_ar: '',
  description: '',
  course_id: '',
  level: 'beginner',
  grade_level: 'primary_3',
  duration_minutes: 20,
  max_attempts: 1,
  pass_percentage: 50,
  is_published: true,
  image_url: '',
};
const emptyQuestion = {
  grade_filter: '',
  quiz_id: '',
  question_type: 'multiple_choice',
  question_text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_answer: 'a',
  passage_text: '',
  word_bank: '',
  blanks_answers: '',
  correct_sentence: '',
  guiding_elements: '',
  answer_mode: 'multiple_choice',
  min_words: 50,
  max_words: 60,
  audio_url: '',
  tf_statement_1: '',
  tf_answer_1: 'T',
  tf_statement_2: '',
  tf_answer_2: 'T',
  blank_sentence_1: '',
  blank_answer_1: '',
  blank_sentence_2: '',
  blank_answer_2: '',
  blank_sentence_3: '',
  blank_answer_3: '',
  points: 1,
  order_index: 1,
};

const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'اختيار من متعدد (Multiple Choice)' },
  { value: 'complete_text', label: 'Read and complete the text with the words in the box' },
  { value: 'reading_comprehension', label: 'Read the text and answer the questions' },
  { value: 'word_order', label: 'Put the words in the correct order to make sentences' },
  { value: 'word_form', label: 'Read and write the correct form of the word[s] between brackets' },
  { value: 'rewrite_brackets', label: 'Rewrite the following sentences using the word(s) in brackets' },
  { value: 'punctuate', label: 'Punctuate the following sentences' },
  { value: 'paragraph', label: 'Write a paragraph of (50-60) words using guiding elements' },
  { value: 'listening', label: 'Listening — True/False + Listen again and Complete' },
];

export default function Admin() {
  const { profile, user, refreshProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedTabIds = tabsForRole(profile?.role);
  const canManageAccounts = isFullAdmin(profile?.role);

  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab');
    return t || 'dashboard';
  });

  // Keep tab in sync with URL (?tab=attendance)
  useEffect(() => {
    const t = searchParams.get('tab');
    if (!t || t === tab) return;
    // Allow known tabs even before profile roles finish loading
    const known = new Set([
      ...allowedTabIds,
      'dashboard',
      'courses',
      'lessons',
      'quizzes',
      'questions',
      'students',
      'results',
      'attendance',
      'leaderboard',
      'footer',
      'codes',
      'notifications',
      'accounts',
    ]);
    if (known.has(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!tab) return;
    const current = searchParams.get('tab');
    if (current !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [stats, setStats] = useState(null);
  const [courses, setCourses] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [students, setStudents] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { type, mode, data }
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [filterCourse, setFilterCourse] = useState('');
  const [filterQuiz, setFilterQuiz] = useState('');
  const [filterQuestionGrade, setFilterQuestionGrade] = useState('');
  const [filterStudentGrade, setFilterStudentGrade] = useState('');
  const [filterResultGrade, setFilterResultGrade] = useState('');
  const [studentNameSearch, setStudentNameSearch] = useState('');
  const [resultNameSearch, setResultNameSearch] = useState('');
  const [entityMedia, setEntityMedia] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [externalLink, setExternalLink] = useState('');
  const [externalTitle, setExternalTitle] = useState('');
  const [homepageImage, setHomepageImage] = useState('');
  const [savingHomeImage, setSavingHomeImage] = useState(false);
  const [footerForm, setFooterForm] = useState(DEFAULT_FOOTER_FORM);
  const [savingFooter, setSavingFooter] = useState(false);
  const [lbConfig, setLbConfig] = useState(DEFAULT_LEADERBOARD_CONFIG);
  const [lbEntries, setLbEntries] = useState([]);
  const [lbHidden, setLbHidden] = useState([]);
  const [lbStudents, setLbStudents] = useState([]);
  const [lbResults, setLbResults] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbSaving, setLbSaving] = useState(false);
  const [lbSubTab, setLbSubTab] = useState('settings');
  const [accessCodes, setAccessCodes] = useState([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesSaving, setCodesSaving] = useState(false);
  const [qrModal, setQrModal] = useState(null); // { codeRow, token }
  const [qrBusy, setQrBusy] = useState(false);

  // WhatsApp Cloud API — test connection only (no auto parent notify yet)
  const [waStatus, setWaStatus] = useState(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waTestTo, setWaTestTo] = useState('');
  const [waTestResult, setWaTestResult] = useState(null);
  const [waLogs, setWaLogs] = useState([]);
  const [waLogsLoading, setWaLogsLoading] = useState(false);
  const [waForm, setWaForm] = useState({
    test_to: '',
    template_name: '',
    template_lang: 'ar',
    parent_notify_enabled: false,
    allow_text_fallback: true,
    incomplete_threshold: 2,
  });
  const [codeFilterGrade, setCodeFilterGrade] = useState('');
  const [codeSearch, setCodeSearch] = useState('');
  const [codeForm, setCodeForm] = useState({
    grade_level: 'primary_4',
    student_name: '',
    label: '',
    note: '',
    max_uses: 1,
    count: 1,
    code: '',
    expires_at: '',
    is_active: true,
  });
  const [editingCode, setEditingCode] = useState(null);
  const [lbEntryForm, setLbEntryForm] = useState({
    display_name: '',
    points: 0,
    badge: '',
    note: '',
    sort_order: 0,
    is_published: true,
  });
  const [editingLbEntryId, setEditingLbEntryId] = useState(null);
  const [pointsDrafts, setPointsDrafts] = useState({});

  // Attendance admin (full matrix report)
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attendanceStudents, setAttendanceStudents] = useState([]);
  const [attendanceLessons, setAttendanceLessons] = useState([]);
  const [attendanceStats, setAttendanceStats] = useState({ students: 0, lessons: 0, completed: 0, in_progress: 0, not_started: 0 });
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceFilterStudent, setAttendanceFilterStudent] = useState('');
  const [attendanceFilterLesson, setAttendanceFilterLesson] = useState('');
  const [attendanceFilterStatus, setAttendanceFilterStatus] = useState('');
  const [attendanceFilterType, setAttendanceFilterType] = useState('');
  const [attendanceFilterGrade, setAttendanceFilterGrade] = useState('');
  const [attendanceForm, setAttendanceForm] = useState({
    user_id: '',
    lesson_id: '',
    status: 'present',
    note: '',
  });

  // Accounts section (PIN protected)
  const [accountsUnlocked, setAccountsUnlocked] = useState(false);
  const [accountsPin, setAccountsPin] = useState('');
  const [accountsPinInput, setAccountsPinInput] = useState('');
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [accountForm, setAccountForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'users',
  });
  const [myAccountForm, setMyAccountForm] = useState({
    full_name: '',
    password: '',
    password2: '',
  });
  const [myAccountSaving, setMyAccountSaving] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountSaving, setAccountSaving] = useState(false);

  const loadAll = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [s, c, l, q, qs, st, r, home, footerData] = await Promise.all([
        apiFetch('/api/stats?admin=true').then((x) => x.json()),
        apiFetch('/api/courses?admin=true').then((x) => x.json()),
        apiFetch('/api/lessons?admin=true').then((x) => x.json()),
        apiFetch('/api/quizzes?admin=true').then((x) => x.json()),
        apiFetch('/api/questions?admin=true').then((x) => x.json()),
        apiFetch('/api/profiles').then((x) => x.json()),
        apiFetch('/api/results').then((x) => x.json()),
        apiFetch('/api/settings?key=homepage_image').then((x) => x.json()).catch(() => ({ value: '' })),
        apiFetch('/api/footer').then((x) => x.json()).catch(() => DEFAULT_FOOTER_FORM),
      ]);
      setStats(s);
      setCourses(Array.isArray(c) ? c : []);
      setLessons(Array.isArray(l) ? l : []);
      setQuizzes(Array.isArray(q) ? q : []);
      setQuestions(Array.isArray(qs) ? qs : []);
      setStudents(Array.isArray(st) ? st : []);
      setResults(Array.isArray(r) ? r : []);
      setHomepageImage(home?.value || '');
      if (footerData && !footerData.error) {
        setFooterForm({
          about: { ...DEFAULT_FOOTER_FORM.about, ...(footerData.about || {}) },
          links: {
            title: footerData.links?.title || DEFAULT_FOOTER_FORM.links.title,
            items: Array.isArray(footerData.links?.items) && footerData.links.items.length
              ? footerData.links.items.map((it) => ({ label: it.label || '', to: it.to || '/' }))
              : DEFAULT_FOOTER_FORM.links.items,
          },
          contact: { ...DEFAULT_FOOTER_FORM.contact, ...(footerData.contact || {}) },
          copyright: footerData.copyright || DEFAULT_FOOTER_FORM.copyright,
        });
      }
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const refreshAfterMutation = async (detail = {}) => {
    await loadAll({ silent: true });
    notifyDataChanged(detail);
  };

  useEffect(() => { loadAll(); }, []);

  const openCreate = (type, overrides = {}) => {
    // For questions: auto-bind to the quiz selected in the Questions tab filter
    let questionDefaults = {
      ...emptyQuestion,
      grade_filter: overrides.grade_filter || overrides.grade_level || filterQuestionGrade || '',
      quiz_id: overrides.quiz_id || filterQuiz || '',
    };
    if (type === 'question') {
      const selectedQuizId = String(questionDefaults.quiz_id || filterQuiz || '');
      const selectedQuiz = quizzes.find((q) => String(q.id) === selectedQuizId);
      if (selectedQuiz) {
        questionDefaults = {
          ...questionDefaults,
          quiz_id: selectedQuiz.id,
          grade_filter: selectedQuiz.grade_level || questionDefaults.grade_filter || '',
        };
      } else if (questionDefaults.grade_filter) {
        // If only grade is chosen, auto-pick first quiz in that grade when there's exactly one
        const gradeQuizzes = quizzes.filter((q) => q.grade_level === questionDefaults.grade_filter);
        if (gradeQuizzes.length === 1) {
          questionDefaults.quiz_id = gradeQuizzes[0].id;
        }
      }
    }

    const defaults = {
      course: emptyCourse,
      lesson: { ...emptyLesson, course_id: courses[0]?.id || '' },
      quiz: emptyQuiz,
      question: questionDefaults,
    };
    setForm({ ...(defaults[type] || {}), ...overrides, ...(type === 'question' ? {
      quiz_id: overrides.quiz_id || questionDefaults.quiz_id,
      grade_filter: overrides.grade_filter || questionDefaults.grade_filter,
    } : {}) });
    setEntityMedia([]);
    setExternalLink('');
    setExternalTitle('');
    setModal({
      type,
      mode: 'create',
      // Lock quiz when user already chose one in the questions filter
      lockQuiz: type === 'question' && !!(overrides.quiz_id || filterQuiz),
    });
  };

  const openEdit = async (type, data) => {
    let formData = { ...data };
    if (type === 'lesson') {
      // Prefer fresh lesson payload from API so attendance settings are current
      let lessonRow = data;
      try {
        if (data?.id) {
          const res = await apiFetch(`/api/lessons?id=${encodeURIComponent(data.id)}&admin=true`);
          const fresh = await res.json();
          if (res.ok && fresh && fresh.id) lessonRow = fresh;
        }
      } catch {
        /* keep list row */
      }
      const s = getLessonAttendanceSettings(lessonRow);
      formData = {
        ...emptyLesson,
        ...lessonRow,
        id: lessonRow.id,
        course_id: lessonRow.course_id ?? '',
        title: lessonRow.title || '',
        title_ar: lessonRow.title_ar || '',
        content: lessonRow.content || '',
        order_index: lessonRow.order_index ?? 1,
        duration_minutes: lessonRow.duration_minutes ?? 30,
        session_type: s.session_type || 'recorded_video',
        video_duration_minutes: s.video_duration_minutes ?? 0,
        required_watch_percent: s.required_watch_percent ?? 85,
        external_required_seconds: s.external_required_seconds ?? 1800,
        linked_quiz_id: s.linked_quiz_id || '',
        session_points: s.session_points ?? 0,
      };
      // keep modal.data as the freshest row for id
      data = lessonRow;
    }
    if (type === 'question') {
      const rawBank = Array.isArray(data.word_bank)
        ? data.word_bank
        : String(data.word_bank || '')
            .split(/[\n,|]+/)
            .map((w) => w.trim())
            .filter(Boolean);
      // Support "a - b - c" single tokens from older saves
      const bankWords = rawBank
        .flatMap((w) => String(w).split(/\s*[-–—]\s*|[\n,|/]+/))
        .map((w) => w.trim().replace(/^\.+|\.+$/g, ''))
        .filter(Boolean);
      const bank = bankWords.join(', ');
      const isReadingEssay =
        data.question_type === 'reading_comprehension' && data.answer_data?.answer_mode === 'essay';
      const wordOrderSentence =
        data.question_type === 'word_order'
          ? [data.answer_data?.correct_sentence, data.correct_answer]
              .map((s) => String(s ?? '').trim().replace(/\s+/g, ' '))
              .filter(Boolean)
              .find((s) => !/^[a-d]$/i.test(s)) || ''
          : '';
      formData = {
        ...emptyQuestion,
        ...data,
        question_type: data.question_type || 'multiple_choice',
        passage_text: data.passage_text || '',
        word_bank: bank,
        blanks_answers: data.question_type === 'complete_text'
          ? (Array.isArray(data.answer_data) && data.answer_data.length
              ? data.answer_data.map((x) => String(x).trim()).filter(Boolean).join(' | ')
              : String(data.correct_answer || data.blanks_answers || '')
                  .replace(/\s*\|\s*/g, ' | ')
                  .trim())
          : '',
        correct_sentence: wordOrderSentence,
        guiding_elements:
          data.question_type === 'paragraph'
            ? (data.passage_text || data.answer_data?.guiding_elements || '')
            : (data.passage_text || ''),
        answer_mode: isReadingEssay ? 'essay' : 'multiple_choice',
        min_words:
          data.answer_data?.min_words ||
          (isReadingEssay ? 20 : 50),
        max_words:
          data.answer_data?.max_words ||
          (isReadingEssay ? 150 : 60),
        correct_answer: data.question_type === 'word_order'
          ? wordOrderSentence
          : isReadingEssay
          ? (data.answer_data?.model_answer || data.correct_answer || '')
          : (data.question_type === 'word_form' || data.question_type === 'rewrite_brackets')
            ? String(data.answer_data?.model_answers
              ? (Array.isArray(data.answer_data.model_answers) ? data.answer_data.model_answers.join(' | ') : data.answer_data.model_answers)
              : (data.correct_answer || '')).replace(/\|/g, ' | ')
            : data.question_type === 'complete_text'
              ? (Array.isArray(data.answer_data) && data.answer_data.length
                  ? data.answer_data.map((x) => String(x).trim()).filter(Boolean).join('|')
                  : String(data.correct_answer || '').trim())
              : (data.question_type && data.question_type !== 'multiple_choice' && data.question_type !== 'reading_comprehension')
                ? (data.correct_answer || '')
                : (data.correct_answer || 'a'),
        audio_url: data.answer_data?.audio_url || '',
        tf_statement_1: data.answer_data?.true_false?.[0]?.statement || '',
        tf_answer_1: data.answer_data?.true_false?.[0]?.answer || 'T',
        tf_statement_2: data.answer_data?.true_false?.[1]?.statement || '',
        tf_answer_2: data.answer_data?.true_false?.[1]?.answer || 'T',
        blank_sentence_1: data.answer_data?.complete_blanks?.[0]?.sentence || '',
        blank_answer_1: data.answer_data?.complete_blanks?.[0]?.answer || '',
        blank_sentence_2: data.answer_data?.complete_blanks?.[1]?.sentence || '',
        blank_answer_2: data.answer_data?.complete_blanks?.[1]?.answer || '',
        blank_sentence_3: data.answer_data?.complete_blanks?.[2]?.sentence || '',
        blank_answer_3: data.answer_data?.complete_blanks?.[2]?.answer || '',
        grade_filter:
          quizzes.find((q) => String(q.id) === String(data.quiz_id))?.grade_level || '',
      };

      // If a quiz is selected in the Questions tab filter, bind edit to that quiz automatically
      if (filterQuiz) {
        const lockedQuiz = quizzes.find((q) => String(q.id) === String(filterQuiz));
        if (lockedQuiz) {
          formData.quiz_id = lockedQuiz.id;
          formData.grade_filter = lockedQuiz.grade_level || formData.grade_filter || '';
        }
      } else if (filterQuestionGrade && !formData.grade_filter) {
        formData.grade_filter = filterQuestionGrade;
      }
    }
    if (type === 'quiz') {
      formData = {
        ...emptyQuiz,
        ...data,
        max_attempts: data.max_attempts ?? 1,
        pass_percentage: data.pass_percentage ?? 50,
        image_url: data.image_url || '',
        grade_level: data.grade_level || 'primary_3',
      };
    }
    setForm(formData);
    setExternalLink('');
    setExternalTitle('');
    setEntityMedia([]);
    setModal({
      type,
      mode: 'edit',
      data,
      lockQuiz: type === 'question' && !!filterQuiz,
    });
    if (type === 'course' && data?.id) {
      try {
        const res = await apiFetch(`/api/course-media?course_id=${data.id}`);
        const media = await res.json();
        setEntityMedia(Array.isArray(media) ? media : []);
      } catch {
        setEntityMedia([]);
      }
    }
    if (type === 'lesson' && data?.id) {
      try {
        const res = await apiFetch(`/api/lesson-media?lesson_id=${data.id}`);
        const media = await res.json();
        setEntityMedia(Array.isArray(media) ? media : []);
      } catch {
        setEntityMedia([]);
      }
    }
    if (type === 'question' && data?.id) {
      try {
        if (Array.isArray(data.media) && data.media.length) {
          setEntityMedia(data.media);
        } else {
          const res = await apiFetch(`/api/question-media?question_id=${data.id}`);
          const media = await res.json();
          setEntityMedia(Array.isArray(media) ? media : []);
        }
      } catch {
        setEntityMedia([]);
      }
    }
  };

  const closeModal = () => {
    setModal(null);
    setForm({});
    setEntityMedia([]);
    setExternalLink('');
    setExternalTitle('');
  };

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  /**
   * Upload via signed URL directly to storage.
   * Avoids Vercel/serverless body size limits that break video uploads.
   */
  const resolveUploadMeta = (file) => {
    const name = String(file?.name || '').toLowerCase();
    let contentType = String(file?.type || '').toLowerCase().split(';')[0].trim();
    const isPlaylist = /\.(m3u8?|pls)$/i.test(name);
    const isAudio =
      contentType.startsWith('audio/') ||
      isPlaylist ||
      /\.(mp3|wav|m4a|ogg|oga|aac|flac|webm|opus)$/i.test(name);
    const isVideo =
      contentType.startsWith('video/') ||
      /\.(mp4|webm|mov|m4v)$/i.test(name);
    const isImage =
      contentType.startsWith('image/') ||
      /\.(jpe?g|png|webp|gif)$/i.test(name);

    const isDoc =
      /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|zip|rar)$/i.test(name) ||
      contentType === 'application/pdf' ||
      contentType.includes('officedocument') ||
      contentType.includes('msword') ||
      contentType.includes('ms-excel') ||
      contentType.includes('ms-powerpoint') ||
      contentType.includes('zip') ||
      contentType.includes('rar');

    if (!contentType || contentType === 'application/octet-stream') {
      if (name.endsWith('.mp3')) contentType = 'audio/mpeg';
      else if (name.endsWith('.wav')) contentType = 'audio/wav';
      else if (name.endsWith('.m4a')) contentType = 'audio/mp4';
      else if (name.endsWith('.aac')) contentType = 'audio/aac';
      else if (name.endsWith('.ogg') || name.endsWith('.oga')) contentType = 'audio/ogg';
      else if (name.endsWith('.flac')) contentType = 'audio/flac';
      else if (name.endsWith('.m3u') || name.endsWith('.m3u8')) contentType = 'audio/x-mpegurl';
      else if (name.endsWith('.pls')) contentType = 'audio/x-scpls';
      else if (name.endsWith('.mp4')) contentType = 'video/mp4';
      else if (name.endsWith('.webm')) contentType = isAudio ? 'audio/webm' : 'video/webm';
      else if (name.endsWith('.mov')) contentType = 'video/quicktime';
      else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (name.endsWith('.png')) contentType = 'image/png';
      else if (name.endsWith('.webp')) contentType = 'image/webp';
      else if (name.endsWith('.gif')) contentType = 'image/gif';
      else if (name.endsWith('.pdf')) contentType = 'application/pdf';
      else if (name.endsWith('.doc')) contentType = 'application/msword';
      else if (name.endsWith('.docx')) contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (name.endsWith('.xls')) contentType = 'application/vnd.ms-excel';
      else if (name.endsWith('.xlsx')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (name.endsWith('.ppt')) contentType = 'application/vnd.ms-powerpoint';
      else if (name.endsWith('.pptx')) contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      else if (name.endsWith('.txt')) contentType = 'text/plain';
      else if (name.endsWith('.csv')) contentType = 'text/csv';
      else if (name.endsWith('.zip')) contentType = 'application/zip';
      else if (name.endsWith('.rar')) contentType = 'application/vnd.rar';
      else if (isAudio) contentType = 'audio/mpeg';
      else if (isVideo) contentType = 'video/mp4';
      else contentType = 'application/octet-stream';
    }
    if (contentType === 'audio/mp3' || contentType === 'audio/x-mp3') contentType = 'audio/mpeg';
    if (contentType === 'audio/m4a' || contentType === 'audio/x-m4a') contentType = 'audio/mp4';

    const defaultName = isPlaylist
      ? 'playlist.m3u'
      : isAudio
        ? 'audio.mp3'
        : isVideo
          ? 'video.mp4'
          : isImage
            ? 'image.jpg'
            : isDoc
              ? 'document.pdf'
              : 'file.bin';
    return {
      isAudio,
      isVideo,
      isImage,
      isPlaylist,
      isDoc,
      contentType,
      fileName: file?.name || defaultName,
    };
  };

  const uploadFile = async (file, folder = 'courses') => {
    setUploading(true);
    setError('');
    try {
      if (!file) throw new Error('لم يتم اختيار ملف');

      const meta = resolveUploadMeta(file);
      // Maximum in-app limit for all media including audio (5 GB)
      const maxBytes = 5 * 1024 * 1024 * 1024;
      if (file.size > maxBytes) {
        throw new Error(
          meta.isAudio
            ? 'حجم الملف الصوتي كبير جداً (الحد الأقصى 5 جيجابايت).'
            : meta.isVideo
              ? 'حجم الفيديو كبير جداً (الحد الأقصى 5 جيجابايت). للفيديوهات الأكبر استخدم رابط يوتيوب/فيميو.'
              : 'حجم الملف كبير جداً (الحد الأقصى 5 جيجابايت).'
        );
      }
      if (file.size < 10) throw new Error('ملف فارغ أو تالف');

      // 1) Ask server for a signed upload slot (auth + path)
      const signRes = await apiFetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'signed',
          fileName: meta.fileName,
          contentType: meta.contentType,
          folder,
          fileSize: file.size,
        }),
      });
      const signData = await signRes.json().catch(() => ({}));
      if (!signRes.ok) {
        throw new Error(signData.error || `فشل تجهيز الرفع (${signRes.status})`);
      }
      if (!signData.token || !signData.path) {
        throw new Error('تعذر إنشاء رابط الرفع. حاول مرة أخرى.');
      }

      // Normalize browser aliases so Storage never sees unsupported types like audio/x-m4a
      let finalType = signData.contentType || meta.contentType || 'application/octet-stream';
      if (finalType === 'audio/x-m4a' || finalType === 'audio/m4a') finalType = 'audio/mp4';
      if (finalType === 'audio/mp3' || finalType === 'audio/x-mp3') finalType = 'audio/mpeg';
      if (finalType === 'audio/wave' || finalType === 'audio/x-wav') finalType = 'audio/wav';

      // Always wrap as Blob with normalized MIME — File.type may still be audio/x-m4a
      const uploadBlob =
        file instanceof Blob
          ? new Blob([file], { type: finalType })
          : file;

      // 2) Upload binary file directly to Supabase Storage (no base64, no body limit)
      let putData = null;
      let lastErr = null;

      const parseStorageError = async (resOrErr) => {
        if (!resOrErr) return '';
        if (typeof resOrErr === 'string') return resOrErr;
        if (resOrErr.message) {
          // Try extract nested JSON message from storage
          try {
            const m = resOrErr.message.match(/\{[\s\S]*\}/);
            if (m) {
              const j = JSON.parse(m[0]);
              if (j.message) return j.message;
              if (j.error) return String(j.error);
            }
          } catch { /* ignore */ }
          return resOrErr.message;
        }
        return '';
      };

      try {
        const result = await supabase.storage
          .from('course-media')
          .uploadToSignedUrl(signData.path, signData.token, uploadBlob, {
            contentType: finalType,
            upsert: true,
          });
        if (result.error) throw result.error;
        putData = result.data;
      } catch (err1) {
        lastErr = err1;
        // Fallback: raw PUT with forced normalized Content-Type
        if (signData.signedUrl) {
          const putRes = await fetch(signData.signedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': finalType,
              'x-upsert': 'true',
            },
            body: uploadBlob,
          });
          if (!putRes.ok) {
            const t = await putRes.text().catch(() => '');
            let friendly = t || (await parseStorageError(lastErr)) || 'فشل رفع الملف إلى التخزين';
            if (/invalid_mime_type|415|mime type/i.test(friendly)) {
              friendly =
                'نوع الملف الصوتي غير مقبول حالياً. جرّب تحويل الملف إلى MP3 أو أعد المحاولة بعد تحديث المنصة.';
            }
            throw new Error(friendly);
          }
        } else {
          throw new Error((await parseStorageError(lastErr)) || 'فشل رفع الملف إلى التخزين');
        }
      }

      const publicUrl =
        signData.publicUrl ||
        supabase.storage.from('course-media').getPublicUrl(signData.path).data?.publicUrl;

      if (!publicUrl) throw new Error('تم الرفع لكن تعذر الحصول على رابط الملف');

      return {
        url: publicUrl,
        path: putData?.path || signData.path,
        contentType: finalType,
      };
    } catch (err) {
      const msg = err?.message || 'فشل رفع الملف';
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const saveHomepageImage = async (url) => {
    setSavingHomeImage(true);
    setError('');
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'homepage_image', value: url || '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ صورة الواجهة');
      const next = data.value || '';
      setHomepageImage(next);
      writeCachedHomepageImage(next);
      if (next) preloadImage(next);
      try {
        window.dispatchEvent(new CustomEvent('em:homepage-image', { detail: { url: next } }));
      } catch { /* ignore */ }
      notifyDataChanged({ source: 'homepage_image' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingHomeImage(false);
    }
  };

  const handleHomepageImageUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      // Strong compression so homepage paints fast for all visitors
      const optimized = await optimizeImageFile(file, {
        maxWidth: 1280,
        maxHeight: 720,
        quality: 0.68,
        mimeType: 'image/webp',
      });
      const uploaded = await uploadFile(optimized, 'homepage');
      await saveHomepageImage(uploaded.url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveHomepageImage = async () => {
    if (!confirm('هل تريد إزالة صورة الواجهة الرئيسية؟')) return;
    await saveHomepageImage('');
  };

  const updateFooterAbout = (key, value) => {
    setFooterForm((prev) => ({ ...prev, about: { ...prev.about, [key]: value } }));
  };

  const updateFooterContact = (key, value) => {
    setFooterForm((prev) => ({ ...prev, contact: { ...prev.contact, [key]: value } }));
  };

  const updateFooterLink = (index, key, value) => {
    setFooterForm((prev) => {
      const items = [...(prev.links?.items || [])];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, links: { ...prev.links, items } };
    });
  };

  const addFooterLink = () => {
    setFooterForm((prev) => ({
      ...prev,
      links: {
        ...prev.links,
        items: [...(prev.links?.items || []), { label: 'رابط جديد', to: '/' }],
      },
    }));
  };

  const removeFooterLink = (index) => {
    setFooterForm((prev) => ({
      ...prev,
      links: {
        ...prev.links,
        items: (prev.links?.items || []).filter((_, i) => i !== index),
      },
    }));
  };

  const saveFooter = async () => {
    setSavingFooter(true);
    setError('');
    try {
      const res = await apiFetch('/api/footer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(footerForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ الذيل');
      setFooterForm({
        about: { ...DEFAULT_FOOTER_FORM.about, ...(data.about || {}) },
        links: {
          title: data.links?.title || DEFAULT_FOOTER_FORM.links.title,
          items: Array.isArray(data.links?.items) ? data.links.items : DEFAULT_FOOTER_FORM.links.items,
        },
        contact: { ...DEFAULT_FOOTER_FORM.contact, ...(data.contact || {}) },
        copyright: data.copyright || DEFAULT_FOOTER_FORM.copyright,
      });
      notifyDataChanged({ source: 'footer' });
      alert('تم حفظ إعدادات الذيل بنجاح');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFooter(false);
    }
  };

  const loadLeaderboardAdmin = async () => {
    setLbLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/leaderboard?admin=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل منصة الأوائل');
      setLbConfig({ ...DEFAULT_LEADERBOARD_CONFIG, ...(data.config || {}) });
      setLbEntries(Array.isArray(data.entries) ? data.entries : []);
      setLbHidden(Array.isArray(data.hidden) ? data.hidden : []);
      const studs = Array.isArray(data.students) ? data.students : [];
      setLbStudents(studs);
      setLbResults(Array.isArray(data.topResults) ? data.topResults : []);
      const drafts = {};
      studs.forEach((s) => { drafts[s.id] = s.total_points || 0; });
      setPointsDrafts(drafts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLbLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'leaderboard') {
      loadLeaderboardAdmin();
    }
    if (tab === 'attendance') {
      loadAttendanceAdmin();
    }
  }, [tab]);

  // Reload attendance matrix when filters change (server-side student/lesson/grade filter)
  useEffect(() => {
    if (tab !== 'attendance') return;
    loadAttendanceAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceFilterStudent, attendanceFilterLesson, attendanceFilterGrade]);

  const loadAttendanceAdmin = async () => {
    setAttendanceLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ admin: 'true', matrix: 'true' });
      if (attendanceFilterStudent) params.set('user_id', attendanceFilterStudent);
      if (attendanceFilterLesson) params.set('lesson_id', attendanceFilterLesson);
      if (attendanceFilterGrade) params.set('grade_level', attendanceFilterGrade);
      if (attendanceSearch.trim()) params.set('q', attendanceSearch.trim());
      const res = await apiFetch(`/api/attendance?${params.toString()}`);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error('استجابة غير صالحة من الخادم');
      }
      if (!res.ok) throw new Error(data?.error || 'فشل تحميل الحضور');
      if (data && Array.isArray(data.rows)) {
        setAttendanceRows(data.rows);
        setAttendanceStudents(Array.isArray(data.students) ? data.students : []);
        setAttendanceLessons(Array.isArray(data.lessons) ? data.lessons : []);
        setAttendanceStats(data.stats || { students: 0, lessons: 0, completed: 0, in_progress: 0, not_started: 0 });
      } else if (Array.isArray(data)) {
        setAttendanceRows(data);
      } else {
        setAttendanceRows([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAttendanceLoading(false);
    }
  };

  const saveAttendanceAdmin = async () => {
    if (!attendanceForm.user_id || !attendanceForm.lesson_id) {
      setError('اختر الطالب والدرس');
      return;
    }
    setAttendanceSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          user_id: attendanceForm.user_id,
          lesson_id: Number(attendanceForm.lesson_id),
          status: attendanceForm.status || 'present',
          note: attendanceForm.note || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ الحضور');
      setAttendanceForm({ user_id: '', lesson_id: '', status: 'present', note: '' });
      await loadAttendanceAdmin();
      notifyDataChanged({ source: 'attendance' });
    } catch (err) {
      setError(err.message);
    } finally {
      setAttendanceSaving(false);
    }
  };

  const updateAttendanceStatus = async (id, status) => {
    try {
      const res = await apiFetch('/api/attendance', {
        method: 'PUT',
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحديث');
      await loadAttendanceAdmin();
      notifyDataChanged({ source: 'attendance' });
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteAttendance = async (id) => {
    if (!window.confirm('حذف سجل الحضور؟')) return;
    try {
      const res = await apiFetch('/api/attendance', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      await loadAttendanceAdmin();
      notifyDataChanged({ source: 'attendance' });
    } catch (err) {
      setError(err.message);
    }
  };

  const saveLeaderboardConfig = async () => {
    setLbSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/leaderboard', {
        method: 'POST',
        body: JSON.stringify({ action: 'save_config', config: lbConfig }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ الإعدادات');
      setLbConfig({ ...DEFAULT_LEADERBOARD_CONFIG, ...(data.config || lbConfig) });
      notifyDataChanged({ source: 'leaderboard' });
      alert('تم حفظ إعدادات منصة الأوائل');
    } catch (err) {
      setError(err.message);
    } finally {
      setLbSaving(false);
    }
  };

  const saveLbEntry = async () => {
    setLbSaving(true);
    setError('');
    try {
      if (!lbEntryForm.display_name?.trim()) throw new Error('اسم المتفوق مطلوب');
      if (editingLbEntryId) {
        const res = await apiFetch('/api/leaderboard', {
          method: 'PUT',
          body: JSON.stringify({ id: editingLbEntryId, ...lbEntryForm }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل التعديل');
      } else {
        const res = await apiFetch('/api/leaderboard', {
          method: 'POST',
          body: JSON.stringify({ action: 'create_entry', ...lbEntryForm }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل الإضافة');
      }
      setLbEntryForm({ display_name: '', points: 0, badge: '', note: '', sort_order: 0, is_published: true });
      setEditingLbEntryId(null);
      await loadLeaderboardAdmin();
      notifyDataChanged({ source: 'leaderboard' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLbSaving(false);
    }
  };

  const editLbEntry = (entry) => {
    setEditingLbEntryId(entry.id);
    setLbEntryForm({
      display_name: entry.display_name || '',
      points: entry.points || 0,
      badge: entry.badge || '',
      note: entry.note || '',
      sort_order: entry.sort_order || 0,
      is_published: entry.is_published !== false,
    });
    setLbSubTab('featured');
  };

  const deleteLbEntry = async (id) => {
    if (!confirm('حذف هذا المتفوق المميز؟')) return;
    try {
      const res = await apiFetch('/api/leaderboard', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      await loadLeaderboardAdmin();
      notifyDataChanged({ source: 'leaderboard' });
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleHideStudent = async (userId, hide) => {
    try {
      const res = await apiFetch('/api/leaderboard', {
        method: 'POST',
        body: JSON.stringify({
          action: hide ? 'hide_student' : 'unhide_student',
          user_id: userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحديث');
      await loadLeaderboardAdmin();
      notifyDataChanged({ source: 'leaderboard' });
    } catch (err) {
      setError(err.message);
    }
  };

  const saveStudentPoints = async (userId) => {
    const pts = Number(pointsDrafts[userId]);
    if (!Number.isFinite(pts) || pts < 0) {
      setError('النقاط غير صالحة');
      return;
    }
    try {
      const res = await apiFetch('/api/leaderboard', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_points', user_id: userId, total_points: pts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحديث النقاط');
      setLbStudents((prev) => prev.map((s) => (s.id === userId ? { ...s, total_points: data.total_points } : s)));
      // also refresh main students list if loaded
      setStudents((prev) => prev.map((s) => (s.id === userId ? { ...s, total_points: data.total_points } : s)));
      notifyDataChanged({ source: 'leaderboard' });
    } catch (err) {
      setError(err.message);
    }
  };

  const resetAllPoints = async () => {
    if (!confirm('هل أنت متأكد من تصفير نقاط جميع الطلاب؟ لا يمكن التراجع.')) return;
    try {
      const res = await apiFetch('/api/leaderboard', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_all_points' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التصفير');
      await loadLeaderboardAdmin();
      await refreshAfterMutation();
      alert('تم تصفير نقاط جميع الطلاب');
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteLbResult = async (id) => {
    if (!confirm('حذف هذه النتيجة من أعلى النتائج؟')) return;
    try {
      const res = await apiFetch('/api/leaderboard', {
        method: 'DELETE',
        body: JSON.stringify({ type: 'result', id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      setLbResults((prev) => prev.filter((r) => r.id !== id));
      notifyDataChanged({ source: 'leaderboard' });
    } catch (err) {
      setError(err.message);
    }
  };

  const mediaApiFor = (entityType) => {
    if (entityType === 'lesson') return '/api/lesson-media';
    if (entityType === 'question') return '/api/question-media';
    return '/api/course-media';
  };

  const parentKeyFor = (entityType) => {
    if (entityType === 'lesson') return 'lesson_id';
    if (entityType === 'question') return 'question_id';
    return 'course_id';
  };

  const addMediaToEntity = async (entityType, entityId, media_type, url, title = '') => {
    const res = await apiFetch(mediaApiFor(entityType), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        [parentKeyFor(entityType)]: entityId,
        media_type,
        url,
        title,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل حفظ الوسائط');
    setEntityMedia((prev) => [...prev, data]);
    if (entityType === 'course' && media_type === 'image') {
      setForm((prev) => ({ ...prev, image_url: url }));
    }
    notifyDataChanged({ source: 'media', entityType });
    return data;
  };

  const persistCoverImage = async (entityType, entityId, imageUrl) => {
    if (!entityId) return;
    const endpoint = entityType === 'quiz' ? '/api/quizzes' : '/api/courses';
    const res = await apiFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entityId, image_url: imageUrl || '' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحديث صورة الغلاف');

    // Refresh list cards immediately
    if (entityType === 'course') {
      setCourses((prev) => prev.map((c) => (c.id === entityId ? { ...c, image_url: imageUrl || '' } : c)));
    } else if (entityType === 'quiz') {
      setQuizzes((prev) => prev.map((q) => (q.id === entityId ? { ...q, image_url: imageUrl || '' } : q)));
    }

    // Keep modal.data in sync so re-open/save won't restore old cover
    setModal((prev) =>
      prev?.data?.id === entityId
        ? { ...prev, data: { ...prev.data, image_url: imageUrl || '' } }
        : prev
    );
    notifyDataChanged({ source: 'cover', entityType, entityId });
    return data;
  };

  const handleCoverImageUpload = async (e, entityType) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      setError('يرجى اختيار صورة فقط');
      return;
    }
    setError('');
    try {
      const folder = entityType === 'quiz' ? 'quizzes' : 'courses';
      const uploaded = await uploadFile(file, folder);
      setForm((prev) => ({ ...prev, image_url: uploaded.url }));

      // Persist immediately when editing an existing item
      if (modal?.mode === 'edit' && modal.data?.id) {
        await persistCoverImage(entityType, modal.data.id, uploaded.url);

        // Keep course media list in sync for cover images (replace previous cover entry if any)
        if (entityType === 'course') {
          const oldCover = entityMedia.find(
            (m) => m.media_type === 'image' && (m.title === 'صورة الغلاف' || m.url === modal.data.image_url)
          );
          if (oldCover && !oldCover.pending && !String(oldCover.id).startsWith('pending-')) {
            try {
              await apiFetch('/api/course-media', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: oldCover.id }),
              });
              setEntityMedia((prev) => prev.filter((m) => m.id !== oldCover.id));
            } catch {
              /* non-blocking */
            }
          }
          await addMediaToEntity('course', modal.data.id, 'image', uploaded.url, file.name || 'صورة الغلاف');
          // Ensure cover field stays on the new image (addMedia also sets it)
          await persistCoverImage('course', modal.data.id, uploaded.url);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const clearCoverImage = async () => {
    if (!confirm('هل تريد حذف صورة الغلاف؟')) return;
    setError('');
    const previousUrl = form.image_url || '';
    setForm((prev) => ({ ...prev, image_url: '' }));

    try {
      // Persist empty cover immediately for existing course/quiz
      if (modal?.mode === 'edit' && modal.data?.id && (modal.type === 'course' || modal.type === 'quiz')) {
        await persistCoverImage(modal.type, modal.data.id, '');

        // Remove matching cover media rows so they don't reappear / re-sync
        if (modal.type === 'course' && entityMedia.length) {
          const covers = entityMedia.filter(
            (m) =>
              m.media_type === 'image' &&
              (m.url === previousUrl || m.title === 'صورة الغلاف' || m.title === 'cover')
          );
          for (const item of covers) {
            if (item.pending || String(item.id).startsWith('pending-')) {
              setEntityMedia((prev) => prev.filter((m) => m.id !== item.id));
              continue;
            }
            try {
              await apiFetch('/api/course-media', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id }),
              });
              setEntityMedia((prev) => prev.filter((m) => m.id !== item.id));
            } catch {
              /* continue */
            }
          }
        }
      } else {
        // Creating new item: also drop pending cover media
        setEntityMedia((prev) =>
          prev.filter(
            (m) =>
              !(m.media_type === 'image' && (m.url === previousUrl || m.title === 'صورة الغلاف' || m.pending))
          )
        );
      }
    } catch (err) {
      // restore on failure
      setForm((prev) => ({ ...prev, image_url: previousUrl }));
      setError(err.message || 'فشل حذف صورة الغلاف');
    }
  };

  const handleEntityFileUpload = async (e, mediaType) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !modal) return;
    const entityType = modal.type;
    if (entityType !== 'course' && entityType !== 'lesson' && entityType !== 'question') return;

    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    if (mediaType === 'video' && !type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(name)) {
      setError('يرجى اختيار ملف فيديو (MP4 أو WEBM)');
      return;
    }
    if (mediaType === 'image' && !type.startsWith('image/') && !/\.(jpe?g|png|webp|gif)$/i.test(name)) {
      setError('يرجى اختيار ملف صورة');
      return;
    }
    if (
      (mediaType === 'audio' || mediaType === 'winamp') &&
      !(
        type.startsWith('audio/') ||
        /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|m3u8?|pls)$/i.test(name)
      )
    ) {
      setError('يرجى اختيار ملف صوتي (MP3/WAV/M4A) أو قائمة Winamp (.m3u / .pls)');
      return;
    }
    if (
      mediaType === 'file' &&
      (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) &&
      !/\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|zip|rar)$/i.test(name)
    ) {
      // Allow any non-empty file for general attachments, including images if user wants as "file"
    }

    // Playlists and audio both use Winamp player on the frontend
    let resolvedType =
      mediaType === 'audio' || mediaType === 'winamp' || /\.(m3u8?|pls)$/i.test(name)
        ? 'winamp'
        : mediaType;

    // Auto-detect document uploads
    if (mediaType === 'file' || /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|zip|rar)$/i.test(name)) {
      if (mediaType === 'file') resolvedType = 'file';
    }

    setError('');
    try {
      const folder =
        entityType === 'lesson' ? 'lessons' : entityType === 'question' ? 'questions' : 'courses';
      const uploaded = await uploadFile(file, folder);
      if (!uploaded?.url) throw new Error('تم الرفع لكن لم يُرجع رابط الملف');

      if (modal.mode === 'edit' && modal.data?.id) {
        await addMediaToEntity(entityType, modal.data.id, resolvedType, uploaded.url, file.name);
      } else {
        const pending = {
          id: `pending-${Date.now()}`,
          media_type: resolvedType,
          url: uploaded.url,
          title: file.name,
          pending: true,
        };
        setEntityMedia((prev) => [...prev, pending]);
        if (entityType === 'course' && resolvedType === 'image') {
          setForm((prev) => ({ ...prev, image_url: uploaded.url }));
        }
      }
    } catch (err) {
      console.error('entity file upload failed:', err);
      setError(err.message || 'فشل رفع الملف. جرّب ملفاً أصغر أو صيغة مدعومة.');
    }
  };

  const handleAddExternalLink = async () => {
    const url = externalLink.trim();
    if (!url) {
      setError('أدخل رابط فيديو أو صوت خارجي');
      return;
    }
    if (!modal || (modal.type !== 'course' && modal.type !== 'lesson')) return;
    const lower = url.toLowerCase();
    const isAudioLink =
      /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)(\?.*)?$/i.test(lower) ||
      /\.(m3u8?|pls)(\?.*)?$/i.test(lower) ||
      /winamp|audio|soundcloud|radio/i.test(lower);
    const mediaType = isAudioLink ? 'winamp' : 'external';
    const defaultTitle = isAudioLink ? 'مشغّل Winamp' : 'فيديو خارجي';
    try {
      if (modal.mode === 'edit' && modal.data?.id) {
        await addMediaToEntity(modal.type, modal.data.id, mediaType, url, externalTitle || defaultTitle);
      } else {
        setEntityMedia((prev) => [
          ...prev,
          {
            id: `pending-${Date.now()}`,
            media_type: mediaType,
            url,
            title: externalTitle || defaultTitle,
            pending: true,
          },
        ]);
      }
      setExternalLink('');
      setExternalTitle('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteMedia = async (item) => {
    if (!confirm('حذف هذه الوسائط؟')) return;
    try {
      const wasCover =
        modal?.type === 'course' &&
        item.media_type === 'image' &&
        (item.url === form.image_url || item.title === 'صورة الغلاف');

      if (item.pending || String(item.id).startsWith('pending-')) {
        setEntityMedia((prev) => prev.filter((m) => m.id !== item.id));
        if (wasCover) {
          setForm((prev) => ({ ...prev, image_url: '' }));
        }
        return;
      }
      const api = mediaApiFor(modal?.type || 'course');
      const res = await apiFetch(api, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      setEntityMedia((prev) => prev.filter((m) => m.id !== item.id));

      // If deleted media was the cover, clear cover field and persist
      if (wasCover && modal?.data?.id) {
        setForm((prev) => ({ ...prev, image_url: '' }));
        await persistCoverImage('course', modal.data.id, '');
      } else {
        notifyDataChanged({ source: 'media-delete' });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const endpoints = {
    course: '/api/courses',
    lesson: '/api/lessons',
    quiz: '/api/quizzes',
    question: '/api/questions',
  };

  const handleSave = async () => {
    if (!modal) return;
    setSaving(true);
    setError('');
    try {
      const endpoint = endpoints[modal.type];
      // Snapshot form at save time to avoid stale closures
      const liveForm = { ...form };
      const body = { ...liveForm };
      // strip non-column helpers
      delete body.media;
      delete body.grade_filter;
      delete body.attendance_settings;
      // Always send cover field for courses/quizzes so empty means "delete cover"
      if (modal.type === 'course' || modal.type === 'quiz') {
        body.image_url = liveForm.image_url ? String(liveForm.image_url) : '';
      }
      if (body.course_id === '' || body.course_id == null) {
        if (modal.type === 'lesson') {
          throw new Error('اختر الكورس قبل حفظ الدرس');
        }
        body.course_id = null;
      } else {
        body.course_id = Number(body.course_id);
      }
      if (body.quiz_id !== undefined && body.quiz_id !== '' && body.quiz_id != null) {
        body.quiz_id = Number(body.quiz_id);
      }
      if (body.order_index !== undefined && body.order_index !== '' && body.order_index != null) {
        body.order_index = Number(body.order_index);
      }
      if (body.duration_minutes !== undefined && body.duration_minutes !== '' && body.duration_minutes != null) {
        body.duration_minutes = Number(body.duration_minutes);
      }
      if (body.max_attempts != null && body.max_attempts !== '') body.max_attempts = Number(body.max_attempts);
      if (body.pass_percentage != null && body.pass_percentage !== '') body.pass_percentage = Number(body.pass_percentage);
      if (body.points) body.points = Number(body.points);

      // Lesson-specific: always send full editable fields + attendance settings
      if (modal.type === 'lesson') {
        if (!String(body.title || '').trim()) {
          throw new Error('عنوان الدرس (English) مطلوب');
        }
        body.title = String(body.title || '').trim();
        body.title_ar = String(body.title_ar || body.title || '').trim();
        body.content = body.content != null ? String(body.content) : '';
        body.order_index = Number(body.order_index) > 0 ? Number(body.order_index) : 1;
        body.duration_minutes =
          Number(body.duration_minutes) > 0 ? Number(body.duration_minutes) : 30;
        body.session_type =
          body.session_type === 'external_link' ? 'external_link' : 'recorded_video';
        body.video_duration_minutes =
          body.video_duration_minutes === '' || body.video_duration_minutes == null
            ? 0
            : Number(body.video_duration_minutes) || 0;
        body.required_watch_percent =
          body.required_watch_percent === '' || body.required_watch_percent == null
            ? 85
            : Number(body.required_watch_percent) || 85;
        body.external_required_seconds =
          body.external_required_seconds === '' || body.external_required_seconds == null
            ? 1800
            : Number(body.external_required_seconds) || 1800;
        body.session_points =
          body.session_points === '' || body.session_points == null
            ? 0
            : Number(body.session_points) || 0;
        body.linked_quiz_id =
          body.linked_quiz_id === '' || body.linked_quiz_id == null
            ? null
            : Number(body.linked_quiz_id) || null;
        // Nested copy for API normalizer
        body.attendance_settings = {
          session_type: body.session_type,
          video_duration_minutes: body.video_duration_minutes,
          required_watch_percent: body.required_watch_percent,
          external_required_seconds: body.external_required_seconds,
          linked_quiz_id: body.linked_quiz_id,
          session_points: body.session_points,
        };
      }

      if (modal.type === 'question') {
        if (!body.quiz_id) {
          throw new Error('اختر الصف ثم الاختبار قبل حفظ السؤال');
        }
        const qType = body.question_type || 'multiple_choice';
        if (qType === 'word_order') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Put the words in the correct order to make sentences.';
          }
          // The UI stores the model answer in correct_sentence; map it to correct_answer
          // and never keep the default multiple-choice value "a".
          // Prefer live form values so typing isn't lost due to stale body snapshots
          const sentenceCandidates = [
            form.correct_sentence,
            form.correct_answer,
            body.correct_sentence,
            body.correct_answer,
            body.answer_data?.correct_sentence,
          ]
            .map((s) => String(s ?? '').trim().replace(/\s+/g, ' '))
            .filter(Boolean);
          const sentence = sentenceCandidates.find((s) => !/^[a-d]$/i.test(s)) || '';
          if (!sentence) {
            throw new Error('أدخل الجملة الصحيحة بالترتيب قبل الحفظ (مثال: We start school by saluting the national anthem)');
          }
          const words = String(form.word_bank || body.word_bank || '')
            .split(/\s*[-–—]\s*|[\n,|/]+/)
            .map((w) => w.trim().replace(/^\.+|\.+$/g, ''))
            .filter(Boolean);
          const finalWords = words.length ? words : sentence.split(/\s+/).filter(Boolean);
          body.correct_sentence = sentence;
          body.correct_answer = sentence;
          body.word_bank = finalWords.join(', ');
          body.answer_data = {
            correct_sentence: sentence,
            words: finalWords,
          };
          body.option_a = '';
          body.option_b = '';
          body.option_c = '';
          body.option_d = '';
        }
        if (qType === 'complete_text') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Read and complete the text with the words in the box.';
          }
          // Prefer the dedicated blanks field; never keep leftover MCQ default "a"/"b"/"c"/"d"
          const blanksRaw = [form.blanks_answers, body.blanks_answers, form.correct_answer, body.correct_answer]
            .map((s) => String(s ?? '').trim())
            .find((s) => s && !/^[a-d]$/i.test(s)) || '';
          const blanks = blanksRaw
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
          if (!blanks.length) {
            throw new Error('أدخل إجابات الفراغات بالترتيب (افصل بينها بـ | ) قبل الحفظ');
          }
          const joined = blanks.join('|');
          body.blanks_answers = joined;
          body.correct_answer = joined;
          body.answer_data = blanks;
          // word bank
          const bank = String(form.word_bank || body.word_bank || '')
            .split(/\s*[-–—]\s*|[\n,|/]+/)
            .map((w) => w.trim())
            .filter(Boolean);
          body.word_bank = bank.join(', ');
          body.option_a = '';
          body.option_b = '';
          body.option_c = '';
          body.option_d = '';
        }
        if (qType === 'word_form') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Read and write the correct form of the word[s] between brackets.';
          }
          body.blanks_answers = body.correct_answer || body.blanks_answers || '';
        }
        if (qType === 'rewrite_brackets') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Rewrite the following sentences using the word(s) in brackets.';
          }
          body.blanks_answers = body.correct_answer || body.blanks_answers || '';
          body.option_a = '';
          body.option_b = '';
          body.option_c = '';
          body.option_d = '';
        }
        if (qType === 'punctuate') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Punctuate the following sentences.';
          }
        }
        if (qType === 'paragraph') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Write a paragraph of (50-60) words using the following guiding elements.';
          }
          body.passage_text = body.guiding_elements || body.passage_text || '';
          body.min_words = Number(body.min_words) || 50;
          body.max_words = Number(body.max_words) || 60;
          body.answer_data = {
            guiding_elements: body.passage_text,
            min_words: body.min_words,
            max_words: body.max_words,
            model_answer: body.correct_answer || '',
          };
        }
        if (qType === 'reading_comprehension') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = body.answer_mode === 'essay'
              ? 'Read the text and write a short answer.'
              : 'Read the text and answer the questions.';
          }
          if (body.answer_mode === 'essay') {
            body.min_words = Number(body.min_words) || 20;
            body.max_words = Number(body.max_words) || 150;
            body.model_answer = body.correct_answer || '';
            body.option_a = '';
            body.option_b = '';
            body.option_c = '';
            body.option_d = '';
          } else {
            body.answer_mode = 'multiple_choice';
          }
        }
        if (qType === 'listening') {
          if (!String(body.question_text || '').trim()) {
            body.question_text = 'Listening\nA. Write True (T) or False (F)\nB. Listen again and Complete';
          }
          body.true_false = [
            { statement: body.tf_statement_1 || '', answer: body.tf_answer_1 || 'T' },
            { statement: body.tf_statement_2 || '', answer: body.tf_answer_2 || 'T' },
          ];
          body.complete_blanks = [
            { sentence: body.blank_sentence_1 || '', answer: body.blank_answer_1 || '' },
            { sentence: body.blank_sentence_2 || '', answer: body.blank_answer_2 || '' },
            { sentence: body.blank_sentence_3 || '', answer: body.blank_answer_3 || '' },
          ];
          body.answer_data = {
            audio_url: body.audio_url || '',
            true_false: body.true_false,
            complete_blanks: body.complete_blanks,
          };
          body.option_a = '';
          body.option_b = '';
          body.option_c = '';
          body.option_d = '';
        }
        delete body.guiding_elements;
        delete body.tf_statement_1;
        delete body.tf_statement_2;
        delete body.tf_answer_1;
        delete body.tf_answer_2;
        delete body.blank_sentence_1;
        delete body.blank_sentence_2;
        delete body.blank_sentence_3;
        delete body.blank_answer_1;
        delete body.blank_answer_2;
        delete body.blank_answer_3;
      }

      const method = modal.mode === 'create' ? 'POST' : 'PUT';
      if (modal.mode === 'edit') {
        const editId = modal.data?.id ?? liveForm.id;
        if (editId == null || editId === '') {
          throw new Error('تعذر تحديد معرّف العنصر للتعديل — أعد فتح نافذة التعديل');
        }
        body.id = Number(editId) || editId;
      }

      const res = await apiFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(text?.slice?.(0, 180) || 'استجابة غير صالحة من الخادم');
      }
      if (!res.ok) throw new Error(data?.error || data?.message || 'فشل الحفظ');

      // Persist pending media after create/update for courses, lessons, and questions
      if ((modal.type === 'course' || modal.type === 'lesson' || modal.type === 'question') && data?.id) {
        const pending = entityMedia.filter((m) => m.pending || String(m.id).startsWith('pending-'));
        const api = mediaApiFor(modal.type);
        const parentKey = parentKeyFor(modal.type);
        for (const item of pending) {
          const mediaRes = await apiFetch(api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              [parentKey]: data.id,
              media_type: item.media_type,
              url: item.url,
              title: item.title || '',
            }),
          });
          if (!mediaRes.ok) {
            const mediaErr = await mediaRes.json().catch(() => ({}));
            throw new Error(mediaErr.error || 'تم حفظ الدرس لكن فشل حفظ بعض الوسائط');
          }
        }
      }

      // Optimistically update local lessons list so UI reflects save immediately
      if (modal.type === 'lesson' && data?.id) {
        setLessons((prev) => {
          const list = Array.isArray(prev) ? [...prev] : [];
          const idx = list.findIndex((l) => Number(l.id) === Number(data.id));
          if (idx >= 0) list[idx] = { ...list[idx], ...data };
          else list.push(data);
          return list;
        });
      }

      closeModal();
      await refreshAfterMutation({ source: modal.type, id: data?.id });
    } catch (e) {
      setError(e.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type, id) => {
    if (!confirm('هل أنت متأكد من الحذف؟')) return;
    try {
      const endpoint = type === 'result' ? '/api/results' : type === 'student' ? '/api/profiles' : endpoints[type];
      const res = await apiFetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'فشل الحذف');
      }
      await refreshAfterMutation();
    } catch (e) {
      setError(e.message);
    }
  };

  const updateStudentRole = async (id, role) => {
    try {
      await apiFetch('/api/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, role }),
      });
      await refreshAfterMutation();
    } catch (e) {
      setError(e.message);
    }
  };

  const updateStudentGrade = async (id, grade_level) => {
    try {
      await apiFetch('/api/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, grade_level }),
      });
      // Optimistic local update for snappy filtering
      setStudents((prev) =>
        prev.map((s) => (s.id === id ? { ...s, grade_level } : s))
      );
      notifyDataChanged({ source: 'student-grade' });
    } catch (e) {
      setError(e.message);
      await refreshAfterMutation();
    }
  };

  const visibleTabs = TABS.filter((t) => allowedTabIds.includes(t.id));

  useEffect(() => {
    if (!allowedTabIds.includes(tab)) {
      setTab(allowedTabIds[0] || 'dashboard');
    }
  }, [allowedTabIds, tab]);

  const unlockAccounts = async () => {
    setAccountsLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/admin-accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'unlock', pin: accountsPinInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل فتح القسم');
      setAccountsPin(accountsPinInput);
      setAccountsUnlocked(true);
      await loadStaffAccounts(accountsPinInput);
    } catch (e) {
      setError(e.message);
      setAccountsUnlocked(false);
      setAccountsPin('');
    } finally {
      setAccountsLoading(false);
    }
  };

  const loadStaffAccounts = async (pin = accountsPin) => {
    const res = await apiFetch(`/api/admin-accounts?pin=${encodeURIComponent(pin)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحميل الحسابات');
    setStaffAccounts(Array.isArray(data.accounts) ? data.accounts : []);
  };

  const lockAccountsSection = () => {
    setAccountsUnlocked(false);
    setAccountsPin('');
    setAccountsPinInput('');
    setStaffAccounts([]);
    setEditingAccount(null);
    setAccountForm({ full_name: '', email: '', password: '', role: 'users' });
  };

  const loadAccessCodes = async () => {
    setCodesLoading(true);
    try {
      const res = await apiFetch('/api/access-codes');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل الأكواد');
      setAccessCodes(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setCodesLoading(false);
    }
  };

  /** Ensure / show parent-track QR for an access code (codes section only) */
  const openTrackQr = async (row) => {
    setQrBusy(true);
    setError('');
    try {
      let token = row.track_token || '';
      if (!token) {
        const res = await apiFetch('/api/parent-track', {
          method: 'POST',
          body: JSON.stringify({ action: 'ensure', access_code_id: row.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل إنشاء QR المتابعة');
        token = data.tokens?.[0]?.token || data.token?.token || '';
        await loadAccessCodes();
      }
      if (!token) throw new Error('تعذر الحصول على رمز المتابعة');
      setQrModal({
        codeRow: row,
        token,
        studentName: row.student_name || row.label || 'طالب',
        grade: row.grade_level || '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setQrBusy(false);
    }
  };

  const regenerateTrackQr = async (row) => {
    if (!window.confirm('إلغاء QR الحالي وإنشاء QR جديد؟ (الرابط القديم سيتوقف فورًا)')) return;
    setQrBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/parent-track', {
        method: 'POST',
        body: JSON.stringify({ action: 'regenerate', access_code_id: row.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل إعادة إنشاء QR');
      const token = data.token?.token || '';
      await loadAccessCodes();
      if (token) {
        setQrModal({
          codeRow: row,
          token,
          studentName: row.student_name || row.label || 'طالب',
          grade: row.grade_level || '',
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setQrBusy(false);
    }
  };

  const revokeTrackQr = async (row) => {
    if (!window.confirm('إلغاء QR المتابعة لهذا الكود؟')) return;
    setQrBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/parent-track', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke', access_code_id: row.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل إلغاء QR');
      setQrModal(null);
      await loadAccessCodes();
    } catch (err) {
      setError(err.message);
    } finally {
      setQrBusy(false);
    }
  };

  const syncWaFormFromStatus = (data) => {
    if (!data || typeof data !== 'object') return;
    setWaForm((prev) => ({
      ...prev,
      test_to: data.test_to || prev.test_to || '',
      template_name: data.template_name || '',
      template_lang: data.template_lang || 'ar',
      parent_notify_enabled:
        data.parent_notify_enabled != null ? Boolean(data.parent_notify_enabled) : false,
      allow_text_fallback:
        data.allow_text_fallback != null ? Boolean(data.allow_text_fallback) : true,
      incomplete_threshold: Number(data.incomplete_threshold) || 2,
    }));
    if (data.test_to) setWaTestTo(data.test_to);
  };

  const loadWhatsAppStatus = async () => {
    if (!canManageAccounts) return;
    setWaLoading(true);
    try {
      const res = await apiFetch('/api/whatsapp');
      const data = await res.json();
      setWaStatus(data && typeof data === 'object' ? data : null);
      syncWaFormFromStatus(data);
    } catch (e) {
      setWaStatus({ ok: false, message: e.message || 'فشل فحص واتساب' });
    } finally {
      setWaLoading(false);
    }
  };

  const loadWhatsAppLogs = async () => {
    if (!canManageAccounts) return;
    setWaLogsLoading(true);
    try {
      const res = await apiFetch('/api/whatsapp?logs=1');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل السجل');
      setWaLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (e) {
      setWaLogs([]);
      setError(e.message);
    } finally {
      setWaLogsLoading(false);
    }
  };

  const saveWhatsAppConfig = async () => {
    if (!canManageAccounts) return;
    setWaSaving(true);
    setError('');
    setWaTestResult(null);
    try {
      const payload = {
        action: 'save_config',
        test_to: String(waForm.test_to || '').trim(),
        template_name: String(waForm.template_name || '').trim(),
        template_lang: String(waForm.template_lang || 'ar').trim() || 'ar',
        parent_notify_enabled: Boolean(waForm.parent_notify_enabled),
        allow_text_fallback: Boolean(waForm.allow_text_fallback),
        incomplete_threshold: Number(waForm.incomplete_threshold) || 2,
      };

      const res = await apiFetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `فشل الحفظ (${res.status})`);
      }

      setWaStatus(data);
      syncWaFormFromStatus(data);
      setWaTestResult({
        ok: true,
        message: data.message || 'تم حفظ الإعدادات (الـ Token من Secrets فقط)',
      });
    } catch (e) {
      setWaTestResult({ ok: false, error: e.message });
      setError(e.message);
    } finally {
      setWaSaving(false);
    }
  };

  const testWhatsAppConnection = async () => {
    if (!canManageAccounts) return;
    setWaLoading(true);
    setWaTestResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_connection' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'فشل فحص الاتصال');
      setWaStatus(data);
      syncWaFormFromStatus(data);
      setWaTestResult({
        ok: true,
        message: data.message || '🟢 WhatsApp API Connected Successfully',
        display_phone_number: data.display_phone_number,
        verified_name: data.verified_name,
      });
    } catch (e) {
      setWaTestResult({ ok: false, error: e.message });
      setError(e.message);
    } finally {
      setWaLoading(false);
    }
  };

  const sendWhatsAppTest = async () => {
    if (!canManageAccounts) return;
    setWaSending(true);
    setWaTestResult(null);
    setError('');
    try {
      const res = await apiFetch('/api/whatsapp', {
        method: 'POST',
        body: JSON.stringify({
          action: 'test_send',
          to: (waTestTo || waForm.test_to || '').trim() || undefined,
          message:
            'اختبار ربط English Mastery بـ WhatsApp Business Cloud API ✅\nMr. Sherif Atta\n(رسالة اختبار واحدة)',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'فشل إرسال الاختبار');
      setWaTestResult({ ok: true, ...data });
      await loadWhatsAppStatus();
    } catch (e) {
      setWaTestResult({ ok: false, error: e.message });
      setError(e.message);
    } finally {
      setWaSending(false);
    }
  };

  useEffect(() => {
    if (tab === 'codes') {
      loadAccessCodes();
    }
    if (tab === 'notifications' && canManageAccounts) {
      loadWhatsAppStatus();
      loadWhatsAppLogs();
    }
  }, [tab, canManageAccounts]);

  const resetCodeForm = () => {
    setEditingCode(null);
    setCodeForm({
      grade_level: 'primary_4',
      student_name: '',
      label: '',
      note: '',
      max_uses: 1,
      count: 1,
      code: '',
      expires_at: '',
      is_active: true,
    });
  };

  const saveAccessCode = async () => {
    setCodesSaving(true);
    setError('');
    try {
      if (!codeForm.grade_level) throw new Error('اختر الصف الدراسي');
      if (editingCode) {
        const res = await apiFetch('/api/access-codes', {
          method: 'PUT',
          body: JSON.stringify({
            id: editingCode.id,
            grade_level: codeForm.grade_level,
            student_name: codeForm.student_name,
            label: codeForm.label,
            note: codeForm.note,
            max_uses: Number(codeForm.max_uses) || 1,
            code: codeForm.code || undefined,
            expires_at: codeForm.expires_at || null,
            is_active: codeForm.is_active !== false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل التعديل');
      } else {
        const res = await apiFetch('/api/access-codes', {
          method: 'POST',
          body: JSON.stringify({
            grade_level: codeForm.grade_level,
            student_name: codeForm.student_name,
            label: codeForm.label,
            note: codeForm.note,
            max_uses: Number(codeForm.max_uses) || 1,
            count: Number(codeForm.count) || 1,
            code: codeForm.code || undefined,
            expires_at: codeForm.expires_at || null,
            is_active: codeForm.is_active !== false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل إنشاء الكود');
      }
      resetCodeForm();
      await loadAccessCodes();
      notifyDataChanged({ source: 'access-codes' });
    } catch (e) {
      setError(e.message);
    } finally {
      setCodesSaving(false);
    }
  };

  const editAccessCode = (row) => {
    setEditingCode(row);
    setCodeForm({
      grade_level: row.grade_level || 'primary_4',
      student_name: row.student_name || '',
      label: row.label || '',
      note: row.note || '',
      max_uses: row.max_uses || 1,
      count: 1,
      code: row.code || '',
      expires_at: row.expires_at ? String(row.expires_at).slice(0, 10) : '',
      is_active: row.is_active !== false,
    });
  };

  const toggleAccessCode = async (row) => {
    try {
      const res = await apiFetch('/api/access-codes', {
        method: 'PUT',
        body: JSON.stringify({ id: row.id, is_active: !row.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحديث');
      await loadAccessCodes();
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteAccessCode = async (id) => {
    if (!confirm('حذف هذا الكود؟')) return;
    try {
      const res = await apiFetch('/api/access-codes', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      if (editingCode?.id === id) resetCodeForm();
      await loadAccessCodes();
    } catch (e) {
      setError(e.message);
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const filteredAccessCodes = accessCodes.filter((c) => {
    if (codeFilterGrade && c.grade_level !== codeFilterGrade) return false;
    const q = codeSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(c.code || '').toLowerCase().includes(q) ||
      String(c.student_name || '').toLowerCase().includes(q) ||
      String(c.label || '').toLowerCase().includes(q)
    );
  });

  const resetAccountForm = () => {
    setEditingAccount(null);
    setAccountForm({ full_name: '', email: '', password: '', role: 'users' });
  };

  // Prefill "my account" form when profile loads / section opens
  useEffect(() => {
    if (profile) {
      setMyAccountForm((prev) => ({
        ...prev,
        full_name: profile.full_name || '',
      }));
    }
  }, [profile?.id, profile?.full_name]);

  const saveMyAccount = async () => {
    if (!user?.id) return;
    setMyAccountSaving(true);
    setError('');
    try {
      const name = myAccountForm.full_name.trim();
      if (!name) throw new Error('الاسم مطلوب');

      // Update own profile name via profiles API
      const res = await apiFetch('/api/profiles', {
        method: 'PUT',
        body: JSON.stringify({ id: user.id, full_name: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحديث البيانات');

      // Optional password change via admin-accounts (full admin + pin)
      if (myAccountForm.password) {
        if (myAccountForm.password.length < 6) throw new Error('كلمة المرور 6 أحرف على الأقل');
        if (myAccountForm.password !== myAccountForm.password2) throw new Error('كلمتا المرور غير متطابقتين');
        if (!accountsPin) throw new Error('افتح القسم بالرقم السري أولاً لتغيير كلمة المرور');
        const pwRes = await apiFetch('/api/admin-accounts', {
          method: 'PUT',
          body: JSON.stringify({
            pin: accountsPin,
            id: user.id,
            password: myAccountForm.password,
          }),
        });
        const pwData = await pwRes.json();
        if (!pwRes.ok) throw new Error(pwData.error || 'فشل تحديث كلمة المرور');
      }

      setMyAccountForm((p) => ({ ...p, password: '', password2: '' }));
      try { await refreshProfile?.(); } catch { /* ignore */ }
      if (accountsUnlocked) await loadStaffAccounts();
    } catch (e) {
      setError(e.message);
    } finally {
      setMyAccountSaving(false);
    }
  };

  const startEditAccount = (acc) => {
    setEditingAccount(acc);
    const role = acc.role === 'support' ? 'users' : (acc.role || 'users');
    setAccountForm({
      full_name: acc.full_name || '',
      email: acc.email || '',
      password: '',
      role,
    });
  };

  const saveAccount = async () => {
    setAccountSaving(true);
    setError('');
    try {
      if (editingAccount) {
        const res = await apiFetch('/api/admin-accounts', {
          method: 'PUT',
          body: JSON.stringify({
            pin: accountsPin,
            id: editingAccount.id,
            full_name: accountForm.full_name,
            role: accountForm.role,
            password: accountForm.password || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل التعديل');
        if (editingAccount.id === user?.id) {
          try { await refreshProfile?.(); } catch { /* ignore */ }
        }
      } else {
        const res = await apiFetch('/api/admin-accounts', {
          method: 'POST',
          body: JSON.stringify({
            action: 'create',
            pin: accountsPin,
            full_name: accountForm.full_name,
            email: accountForm.email,
            password: accountForm.password,
            role: accountForm.role,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل إنشاء الحساب');
      }
      resetAccountForm();
      await loadStaffAccounts();
      await refreshAfterMutation();
    } catch (e) {
      setError(e.message);
    } finally {
      setAccountSaving(false);
    }
  };

  const removeStaffAccess = async (acc) => {
    if (!confirm(`إزالة صلاحيات المشرف من «${acc.full_name || acc.email}»؟`)) return;
    setError('');
    try {
      const res = await apiFetch('/api/admin-accounts', {
        method: 'DELETE',
        body: JSON.stringify({ pin: accountsPin, id: acc.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الإزالة');
      if (editingAccount?.id === acc.id) resetAccountForm();
      await loadStaffAccounts();
      await refreshAfterMutation();
    } catch (e) {
      setError(e.message);
    }
  };

  const filteredLessons = filterCourse
    ? lessons.filter((l) => String(l.course_id) === String(filterCourse))
    : lessons;
  const quizzesForQuestionGrade = (gradeValue) => {
    if (!gradeValue) return quizzes;
    return quizzes.filter((q) => q.grade_level === gradeValue);
  };

  const filteredQuestions = questions.filter((q) => {
    if (filterQuiz && String(q.quiz_id) !== String(filterQuiz)) return false;
    if (filterQuestionGrade) {
      const quiz = quizzes.find((x) => String(x.id) === String(q.quiz_id));
      if (!quiz || quiz.grade_level !== filterQuestionGrade) return false;
    }
    return true;
  });

  const quizzesInQuestionFilter = quizzesForQuestionGrade(filterQuestionGrade);

  const studentGradeById = Object.fromEntries(
    students.map((s) => [s.id, s.grade_level || ''])
  );
  const studentEmailById = Object.fromEntries(
    students.map((s) => [s.id, s.email || ''])
  );
  const studentNameById = Object.fromEntries(
    students.map((s) => [s.id, s.full_name || ''])
  );
  const quizGradeById = Object.fromEntries(
    quizzes.flatMap((q) => {
      const g = q.grade_level || '';
      return [[String(q.id), g], [Number(q.id), g]];
    })
  );

  const getResultGrade = (r) => {
    const fromStudent =
      studentGradeById[r.user_id] ||
      studentGradeById[String(r.user_id)] ||
      '';
    if (fromStudent) return fromStudent;
    return quizGradeById[r.quiz_id] || quizGradeById[String(r.quiz_id)] || quizGradeById[Number(r.quiz_id)] || '';
  };

  const filteredResults = (() => {
    let list = results;
    if (filterResultGrade === '__none__') {
      list = list.filter((r) => !getResultGrade(r));
    } else if (filterResultGrade) {
      list = list.filter((r) => getResultGrade(r) === filterResultGrade);
    }
    const q = resultNameSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const resultName = String(r.user_name || '').toLowerCase();
        const profileName = String(
          studentNameById[r.user_id] || studentNameById[String(r.user_id)] || ''
        ).toLowerCase();
        const email = String(
          studentEmailById[r.user_id] || studentEmailById[String(r.user_id)] || ''
        ).toLowerCase();
        return resultName.includes(q) || profileName.includes(q) || email.includes(q);
      });
    }
    return list;
  })();

  const resultGradeCounts = GRADE_OPTIONS.reduce((acc, g) => {
    acc[g.value] = results.filter((r) => getResultGrade(r) === g.value).length;
    return acc;
  }, {});
  const resultNoGradeCount = results.filter((r) => !getResultGrade(r)).length;

  const formatResultDateTime = (value) => {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  };

  const filteredStudents = (() => {
    let list = students;
    if (filterStudentGrade === '__none__') {
      list = list.filter((s) => !s.grade_level);
    } else if (filterStudentGrade) {
      list = list.filter((s) => s.grade_level === filterStudentGrade);
    }
    const q = studentNameSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => {
        const name = String(s.full_name || '').toLowerCase();
        const email = String(s.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }
    return list;
  })();

  const gradeCounts = GRADE_OPTIONS.reduce((acc, g) => {
    acc[g.value] = students.filter((s) => s.grade_level === g.value).length;
    return acc;
  }, {});
  const noGradeCount = students.filter((s) => !s.grade_level).length;

  const findQuiz = (quizId) => {
    const idNum = Number(quizId);
    return quizzes.find((q) => Number(q.id) === idNum || String(q.id) === String(quizId));
  };

  const displayGrade = (value) => {
    if (!value) return 'بدون صف';
    const label = gradeLabel(value);
    return !label || label === '—' ? 'بدون صف' : label;
  };

  const buildStudentsReportData = () => {
    const filterText = !filterStudentGrade
      ? 'كل الصفوف'
      : filterStudentGrade === '__none__'
        ? 'بدون صف'
        : displayGrade(filterStudentGrade);

    return {
      title: 'تقرير الطلاب',
      subtitle: `التصفية: ${filterText} · English Mastery`,
      fileName: 'students-report',
      headers: ['#', 'الاسم', 'البريد', 'الصف', 'ولي الأمر', 'الدور', 'النقاط'],
      rows: filteredStudents.map((s, i) => [
        i + 1,
        s.full_name || '—',
        s.email || '—',
        displayGrade(s.grade_level),
        s.parent_phone || '—',
        roleLabel(s.role),
        Number(s.total_points) || 0,
      ]),
    };
  };

  const buildResultsReportData = () => {
    const filterText = !filterResultGrade
      ? 'كل الصفوف'
      : filterResultGrade === '__none__'
        ? 'بدون صف'
        : displayGrade(filterResultGrade);

    return {
      title: 'تقرير نتائج الاختبارات',
      subtitle: `التصفية: ${filterText} · English Mastery`,
      fileName: 'quiz-results-report',
      headers: ['#', 'الطالب', 'الصف', 'الاختبار', 'النتيجة', 'النسبة', 'التاريخ والوقت'],
      rows: filteredResults.map((r, i) => {
        const quiz = findQuiz(r.quiz_id);
        const quizTitle = quiz?.title_ar || quiz?.title || (r.quiz_id != null ? `اختبار #${r.quiz_id}` : '—');
        const score = Number(r.score) || 0;
        const total = Number(r.total_questions) || 0;
        const pct = r.percentage != null && r.percentage !== ''
          ? Number(r.percentage)
          : (total > 0 ? Math.round((score / total) * 100) : 0);
        return [
          i + 1,
          r.user_name || '—',
          displayGrade(getResultGrade(r)),
          quizTitle,
          `${score}/${total}`,
          `${Number.isFinite(pct) ? pct : 0}%`,
          formatResultDateTime(r.completed_at),
        ];
      }),
    };
  };

  const exportStudentsPdf = () => {
    void import('../lib/exportReport').then(({ downloadPdfReport }) => downloadPdfReport(buildStudentsReportData()));
  };
  const printStudentsReport = () => {
    void import('../lib/exportReport').then(({ openPrintableReport }) => openPrintableReport(buildStudentsReportData()));
  };
  const exportResultsPdf = () => {
    void import('../lib/exportReport').then(({ downloadPdfReport }) => downloadPdfReport(buildResultsReportData()));
  };
  const printResultsReport = () => {
    void import('../lib/exportReport').then(({ openPrintableReport }) => openPrintableReport(buildResultsReportData()));
  };

  const field = (key, label, type = 'text', opts = null) => (
    <div key={key}>
      <label className="block text-sm font-medium text-stone-700 mb-1">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={form[key] ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            setForm((prev) => ({ ...prev, [key]: value }));
          }}
          rows={4}
          className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
        />
      ) : type === 'select' ? (
        <select
          value={form[key] ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            const value = raw === 'true' ? true : raw === 'false' ? false : raw;
            setForm((prev) => ({ ...prev, [key]: value }));
          }}
          className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
        >
          {opts?.map((o) => (
            <option key={String(o.value)} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : type === 'checkbox' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form[key]}
            onChange={(e) => {
              const checked = e.target.checked;
              setForm((prev) => ({ ...prev, [key]: checked }));
            }}
            className="rounded border-stone-400 text-amber-700 focus:ring-amber-600"
          />
          {label}
        </label>
      ) : (
        <input
          type={type}
          value={form[key] ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            setForm((prev) => ({ ...prev, [key]: value }));
          }}
          className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
          dir={type === 'number' || key.includes('title') && !key.includes('_ar') ? 'ltr' : undefined}
        />
      )}
    </div>
  );

  const renderModalFields = () => {
    if (!modal) return null;
    if (modal.type === 'course') {
      const mediaLabel = {
        image: 'صورة',
        video: 'فيديو',
        external: 'رابط خارجي',
        audio: 'صوت Winamp',
        winamp: 'Winamp',
        file: 'ملف',
      };
      return (
        <div className="space-y-3">
          {field('title', 'العنوان (English)')}
          {field('title_ar', 'العنوان (عربي)')}
          {field('description', 'الوصف (English)', 'textarea')}
          {field('description_ar', 'الوصف (عربي)', 'textarea')}
          {field('grade_level', 'الصف الدراسي', 'select', GRADE_OPTIONS.map((g) => ({ value: g.value, label: g.label })))}
          {field('level', 'المستوى', 'select', [
            { value: 'beginner', label: 'مبتدئ' },
            { value: 'intermediate', label: 'متوسط' },
            { value: 'advanced', label: 'متقدم' },
          ])}
          {field('duration', 'المدة')}
          {field('is_published', 'منشور', 'select', [
            { value: true, label: 'نعم' },
            { value: false, label: 'لا' },
          ])}

          <div className="pt-3 mt-2 border-t border-stone-200 space-y-3">
            <h4 className="font-bold text-stone-900 text-sm">صورة غلاف الكورس</h4>
            <p className="text-xs text-stone-500">ستظهر هذه الصورة في واجهة قائمة الكورسات وصفحة الكورس</p>
            {form.image_url ? (
              <div className="relative rounded-xl overflow-hidden border border-stone-200">
                <img src={form.image_url} alt="غلاف الكورس" className="w-full h-40 object-cover" />
                <div className="absolute top-2 left-2 flex gap-2">
                  <label className="px-3 py-1.5 rounded-lg bg-white/95 text-xs font-semibold text-stone-800 cursor-pointer shadow">
                    تغيير
                    <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => handleCoverImageUpload(e, 'course')} />
                  </label>
                  <button type="button" onClick={clearCoverImage} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow">
                    حذف
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <ImageIcon className="w-6 h-6 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع صورة الغلاف</span>
                <span className="text-[11px] text-stone-400">JPG / PNG / WEBP</span>
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => handleCoverImageUpload(e, 'course')} />
              </label>
            )}
          </div>

          <div id="course-media-section" className="pt-4 mt-3 border-t-2 border-amber-300 space-y-3 rounded-2xl bg-amber-50/50 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-700 text-white flex items-center justify-center shrink-0">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-stone-900 text-base">وسائط الكورس (صورة · فيديو · رابط خارجي)</h4>
                <p className="text-xs text-stone-600 mt-0.5">
                  ارفع صورة أو فيديو من جهازك، أو الصق رابط يوتيوب/فيديو خارجي. للكورس الجديد: أضف الوسائط ثم اضغط حفظ.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-2">
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <ImageIcon className="w-5 h-5 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع صورة</span>
                <span className="text-[11px] text-stone-400">JPG / PNG / WEBP</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'image')}
                />
              </label>
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <Video className="w-5 h-5 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع فيديو</span>
                <span className="text-[11px] text-stone-400">MP4 / WEBM</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'video')}
                />
              </label>
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/40 cursor-pointer hover:bg-amber-50 transition-colors">
                <Music2 className="w-5 h-5 text-amber-800" />
                <span className="text-sm font-medium text-stone-800">Winamp / صوت</span>
                <span className="text-[11px] text-stone-500">MP3 · WAV · M3U · PLS</span>
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.aac,.flac,.m3u,.m3u8,.pls"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'winamp')}
                />
              </label>
            </div>

            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
                <Link2 className="w-4 h-4 text-amber-700" />
                رابط خارجي (فيديو أو صوت / Winamp)
              </div>
              <input
                type="url"
                value={externalLink}
                onChange={(e) => setExternalLink(e.target.value)}
                placeholder="https://youtube.com/... أو https://.../track.mp3 أو playlist.m3u"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                dir="ltr"
              />
              <input
                type="text"
                value={externalTitle}
                onChange={(e) => setExternalTitle(e.target.value)}
                placeholder="عنوان اختياري للرابط"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
              />
              <button
                type="button"
                onClick={handleAddExternalLink}
                className="w-full py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
              >
                إضافة الرابط
              </button>
            </div>

            {uploading && (
              <div className="flex items-center gap-2 text-sm text-amber-800 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <Upload className="w-4 h-4 animate-pulse" />
                جاري رفع الملف مباشرة إلى التخزين... قد يستغرق بعض الوقت حسب الحجم
              </div>
            )}

            {entityMedia.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-stone-800">الوسائط المضافة ({entityMedia.length})</div>
                {entityMedia.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-stone-200 bg-white"
                  >
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                      {item.media_type === 'image' ? (
                        <img src={item.url} alt="" className="w-full h-full object-cover" />
                      ) : item.media_type === 'video' ? (
                        <Video className="w-6 h-6 text-stone-500" />
                      ) : item.media_type === 'file' ? (
                        <FileText className="w-6 h-6 text-amber-700" />
                      ) : item.media_type === 'audio' || item.media_type === 'winamp' ? (
                        <Music2 className="w-6 h-6 text-amber-700" />
                      ) : (
                        <Link2 className="w-6 h-6 text-stone-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-amber-800 mb-0.5">{mediaLabel[item.media_type] || item.media_type}</div>
                      <div className="text-sm font-medium text-stone-800 truncate">{item.title || 'بدون عنوان'}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-stone-500 truncate block" dir="ltr">
                        {item.url}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(item)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    if (modal.type === 'lesson') {
      const mediaLabel = {
        image: 'صورة',
        video: 'فيديو',
        external: 'رابط خارجي',
        audio: 'صوت Winamp',
        winamp: 'Winamp',
        file: 'ملف',
      };
      const attendance = getLessonAttendanceSettings(form);
      const sessionType = attendance.session_type || 'recorded_video';
      const quizOptions = [
        { value: '', label: '— بدون اختبار مرتبط —' },
        ...quizzes.map((q) => ({
          value: q.id,
          label: `${q.title_ar || q.title}${q.grade_level ? ` (${gradeLabel(q.grade_level)})` : ''}`,
        })),
      ];
      return (
        <div className="space-y-3">
          {field('course_id', 'الكورس', 'select', courses.map((c) => ({ value: c.id, label: c.title_ar || c.title })))}
          {field('title', 'العنوان (English)')}
          {field('title_ar', 'العنوان (عربي)')}
          {field('content', 'المحتوى', 'textarea')}
          {field('order_index', 'الترتيب', 'number')}
          {field('duration_minutes', 'المدة بالدقائق', 'number')}

          <div id="lesson-media-section" className="space-y-4 rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-700 text-white flex items-center justify-center shrink-0">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-stone-900 text-base">وسائط الدرس + الحضور والمتابعة</h4>
                <p className="text-xs text-stone-600 mt-0.5">
                  قسم واحد: ارفع الفيديو/الرابط مرة واحدة، واضبط إعدادات الحضور. يظهر للطالب مشغّل الوسائط فقط (بدون تكرار).
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-stone-300 bg-white space-y-3">
              <h5 className="text-sm font-bold text-stone-900">إعدادات الحضور</h5>
              <div>
                <label className="block text-sm font-medium text-stone-800 mb-1">نوع الحصة</label>
                <select
                  value={sessionType}
                  onChange={(e) => setForm((prev) => ({ ...prev, session_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm font-medium"
                >
                  {SESSION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-stone-500 mt-1">
                  {SESSION_TYPE_OPTIONS.find((o) => o.value === sessionType)?.description}
                </p>
              </div>

              {sessionType === 'recorded_video' && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-stone-800 mb-1">مدة الفيديو (بالدقائق)</label>
                    <input
                      type="number"
                      min={0}
                      value={form.video_duration_minutes ?? 0}
                      onChange={(e) => setForm((prev) => ({ ...prev, video_duration_minutes: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      placeholder="مثال: 25"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-800 mb-1">نسبة المشاهدة المطلوبة (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={form.required_watch_percent ?? 85}
                      onChange={(e) => setForm((prev) => ({ ...prev, required_watch_percent: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      placeholder="85"
                    />
                  </div>
                </div>
              )}

              {sessionType === 'external_link' && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-stone-800 mb-1">
                    مدة جلسة المتابعة المطلوبة (دقائق)
                  </label>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={
                        form.external_required_seconds == null || form.external_required_seconds === ''
                          ? 30
                          : Math.round(Number(form.external_required_seconds) / 60)
                      }
                      onChange={(e) => {
                        const mins = Number(e.target.value);
                        const seconds = Number.isFinite(mins) ? Math.max(0, Math.round(mins * 60)) : 1800;
                        setForm((prev) => ({ ...prev, external_required_seconds: seconds }));
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      placeholder="30"
                    />
                    <input
                      type="number"
                      min={0}
                      value={form.external_required_seconds ?? 1800}
                      onChange={(e) => setForm((prev) => ({ ...prev, external_required_seconds: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      placeholder="1800"
                    />
                  </div>
                  <p className="text-[11px] text-stone-500">
                    الافتراضي 30 دقيقة. لا تُحسب نسبة مشاهدة YouTube/Drive — وقت الجلسة على المنصة فقط.
                  </p>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-stone-800 mb-1">اختبار الحصة (اختياري)</label>
                  <select
                    value={form.linked_quiz_id ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, linked_quiz_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  >
                    {quizOptions.map((o) => (
                      <option key={String(o.value)} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-stone-500 mt-1">
                    يظهر زر «📝 اختبار الحصة» بعد استيفاء شرط الحضور — الدرجة لا تُشترط لتسجيل الحضور
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-800 mb-1">نقاط الحصة</label>
                  <input
                    type="number"
                    min={0}
                    value={form.session_points ?? 0}
                    onChange={(e) => setForm((prev) => ({ ...prev, session_points: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="pt-1">
              <h5 className="text-sm font-bold text-stone-900 mb-2">رفع الوسائط (مرة واحدة)</h5>
              <p className="text-xs text-stone-600 mb-3">
                {sessionType === 'external_link'
                  ? 'أضف رابط YouTube/Drive هنا. سيظهر للطالب في وسائط الدرس فقط.'
                  : 'ارفع فيديو MP4/WEBM هنا. سيظهر للطالب في وسائط الدرس فقط (مع تتبع الحضور عليه).'}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <ImageIcon className="w-5 h-5 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع صورة</span>
                <span className="text-[11px] text-stone-400">JPG / PNG / WEBP</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'image')}
                />
              </label>
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <Video className="w-5 h-5 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع فيديو</span>
                <span className="text-[11px] text-stone-400">MP4 / WEBM</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'video')}
                />
              </label>
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-amber-400 bg-white cursor-pointer hover:bg-amber-50 transition-colors">
                <FileText className="w-5 h-5 text-amber-800" />
                <span className="text-sm font-medium text-stone-800">رفع ملف</span>
                <span className="text-[11px] text-stone-500">PDF · Word · Excel · ZIP</span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip,.rar,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'file')}
                />
              </label>
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/40 cursor-pointer hover:bg-amber-50 transition-colors">
                <Music2 className="w-5 h-5 text-amber-800" />
                <span className="text-sm font-medium text-stone-800">Winamp / صوت</span>
                <span className="text-[11px] text-stone-500">MP3 · WAV · M3U · PLS</span>
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.aac,.flac,.m3u,.m3u8,.pls"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'winamp')}
                />
              </label>
            </div>

            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
                <Link2 className="w-4 h-4 text-amber-700" />
                رابط خارجي (فيديو أو صوت / Winamp)
              </div>
              <input
                type="url"
                value={externalLink}
                onChange={(e) => setExternalLink(e.target.value)}
                placeholder="https://youtube.com/... أو https://.../track.mp3"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                dir="ltr"
              />
              <input
                type="text"
                value={externalTitle}
                onChange={(e) => setExternalTitle(e.target.value)}
                placeholder="عنوان اختياري للرابط"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
              />
              <button
                type="button"
                onClick={handleAddExternalLink}
                className="w-full py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
              >
                إضافة الرابط
              </button>
            </div>

            {uploading && (
              <div className="flex items-center gap-2 text-sm text-amber-800 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <Upload className="w-4 h-4 animate-pulse" />
                جاري رفع الملف مباشرة إلى التخزين... قد يستغرق بعض الوقت حسب الحجم
              </div>
            )}

            {entityMedia.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-stone-800">الوسائط المضافة ({entityMedia.length})</div>
                {entityMedia.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-stone-200 bg-white"
                  >
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                      {item.media_type === 'image' ? (
                        <img src={item.url} alt="" className="w-full h-full object-cover" />
                      ) : item.media_type === 'video' ? (
                        <Video className="w-6 h-6 text-stone-500" />
                      ) : item.media_type === 'file' ? (
                        <FileText className="w-6 h-6 text-amber-700" />
                      ) : item.media_type === 'audio' || item.media_type === 'winamp' ? (
                        <Music2 className="w-6 h-6 text-amber-700" />
                      ) : (
                        <Link2 className="w-6 h-6 text-stone-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-amber-800 mb-0.5">{mediaLabel[item.media_type] || item.media_type}</div>
                      <div className="text-sm font-medium text-stone-800 truncate">{item.title || 'بدون عنوان'}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-stone-500 truncate block" dir="ltr">
                        {item.url}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(item)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    if (modal.type === 'quiz') {
      return (
        <div className="space-y-3">
          {field('title', 'العنوان (English)')}
          {field('title_ar', 'العنوان (عربي)')}
          {field('description', 'الوصف', 'textarea')}
          {field('course_id', 'الكورس (اختياري)', 'select', [
            { value: '', label: '— بدون —' },
            ...courses.map((c) => ({ value: c.id, label: c.title_ar || c.title })),
          ])}
          {field('grade_level', 'الصف الدراسي', 'select', GRADE_OPTIONS.map((g) => ({ value: g.value, label: g.label })))}
          {field('level', 'المستوى', 'select', [
            { value: 'beginner', label: 'مبتدئ' },
            { value: 'intermediate', label: 'متوسط' },
            { value: 'advanced', label: 'متقدم' },
          ])}
          {field('duration_minutes', 'المدة بالدقائق', 'number')}
          {field('max_attempts', 'الحد الأقصى للمحاولات', 'number')}
          {field('pass_percentage', 'نسبة النجاح المطلوبة (%)', 'number')}
          <p className="text-xs text-stone-500 -mt-1">
            مثال: محاولتان ونسبة نجاح 60% — ينجح الطالب إذا حصل على 60% أو أكثر، ويمكنه إعادة الاختبار حتى استنفاد المحاولات.
          </p>
          {field('is_published', 'منشور', 'select', [
            { value: true, label: 'نعم' },
            { value: false, label: 'لا' },
          ])}

          <div className="pt-3 mt-2 border-t border-stone-200 space-y-3">
            <h4 className="font-bold text-stone-900 text-sm">صورة غلاف الاختبار</h4>
            <p className="text-xs text-stone-500">ستظهر هذه الصورة في واجهة قائمة الاختبارات وصفحة بدء الاختبار</p>
            {form.image_url ? (
              <div className="relative rounded-xl overflow-hidden border border-stone-200">
                <img src={form.image_url} alt="غلاف الاختبار" className="w-full h-40 object-cover" />
                <div className="absolute top-2 left-2 flex gap-2">
                  <label className="px-3 py-1.5 rounded-lg bg-white/95 text-xs font-semibold text-stone-800 cursor-pointer shadow">
                    تغيير
                    <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => handleCoverImageUpload(e, 'quiz')} />
                  </label>
                  <button type="button" onClick={clearCoverImage} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold shadow">
                    حذف
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <ImageIcon className="w-6 h-6 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع صورة الغلاف</span>
                <span className="text-[11px] text-stone-400">JPG / PNG / WEBP</span>
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => handleCoverImageUpload(e, 'quiz')} />
              </label>
            )}
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <Upload className="w-4 h-4 animate-pulse" />
                جاري رفع الصورة...
              </div>
            )}
          </div>
        </div>
      );
    }
    if (modal.type === 'question') {
      const qType = form.question_type || 'multiple_choice';
      const selectedGrade = form.grade_filter || '';
      const gradeQuizzes = quizzesForQuestionGrade(selectedGrade);
      const quizOptions = gradeQuizzes.map((q) => ({
        value: q.id,
        label: `${q.title_ar || q.title}${q.description ? ` — ${String(q.description).slice(0, 40)}` : ''}`,
      }));
      const lockedQuiz = quizzes.find((q) => String(q.id) === String(form.quiz_id));
      const quizLocked = !!modal.lockQuiz && !!form.quiz_id;
      return (
        <div className="space-y-3">
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/70 space-y-3">
            {quizLocked ? (
              <>
                <p className="text-xs text-amber-900 leading-relaxed">
                  سيتم {modal.mode === 'edit' ? 'تعديل' : 'إضافة'} السؤال تلقائياً للاختبار المحدد من قسم الأسئلة.
                </p>
                <div className="rounded-xl border border-amber-300 bg-white p-3 space-y-1">
                  <div className="text-xs font-semibold text-amber-800">الاختبار المحدد</div>
                  <div className="text-sm font-bold text-stone-900">
                    {lockedQuiz?.title_ar || lockedQuiz?.title || `اختبار #${form.quiz_id}`}
                  </div>
                  <div className="text-xs text-stone-500">
                    {gradeLabel(lockedQuiz?.grade_level || selectedGrade) || '—'}
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-amber-900 leading-relaxed">
                  اختر أولاً <strong>الصف / القسم</strong> كما في الاختبارات، ثم اختر الاختبار داخل هذا القسم لإضافة السؤال.
                  {' '}أو حدّد الاختبار من فلتر قسم الأسئلة ليتم الربط تلقائياً.
                </p>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">الصف / القسم</label>
                  <select
                    value={selectedGrade}
                    onChange={(e) => {
                      const grade = e.target.value;
                      const nextQuizzes = quizzesForQuestionGrade(grade);
                      const keepQuiz = nextQuizzes.some((q) => String(q.id) === String(form.quiz_id));
                      setForm({
                        ...form,
                        grade_filter: grade,
                        quiz_id: keepQuiz ? form.quiz_id : (nextQuizzes.length === 1 ? nextQuizzes[0].id : ''),
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm bg-white"
                  >
                    <option value="">— اختر الصف أولاً —</option>
                    {GRADE_OPTIONS.map((g) => {
                      const count = quizzes.filter((q) => q.grade_level === g.value).length;
                      return (
                        <option key={g.value} value={g.value}>
                          {g.label} ({count} اختبار)
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">الاختبار داخل القسم</label>
                  <select
                    value={form.quiz_id ?? ''}
                    onChange={(e) => {
                      const quizId = e.target.value;
                      const quiz = quizzes.find((q) => String(q.id) === String(quizId));
                      setForm({
                        ...form,
                        quiz_id: quizId,
                        grade_filter: quiz?.grade_level || form.grade_filter || '',
                      });
                    }}
                    disabled={!selectedGrade}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm bg-white disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    <option value="">
                      {!selectedGrade
                        ? 'اختر الصف أولاً'
                        : quizOptions.length
                          ? '— اختر الاختبار —'
                          : 'لا توجد اختبارات في هذا الصف'}
                    </option>
                    {quizOptions.map((o) => (
                      <option key={String(o.value)} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {selectedGrade && !quizOptions.length && (
                    <p className="text-xs text-red-600 mt-1">
                      لا يوجد اختبارات لهذا الصف. أنشئ اختباراً من تبويب «الاختبارات» أولاً.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">نوع السؤال</label>
            <select
              value={form.question_type || 'multiple_choice'}
              onChange={(e) => {
                const nextType = e.target.value;
                setForm((prev) => {
                  const next = { ...prev, question_type: nextType };
                  if (nextType === 'word_order') {
                    // Drop leftover MCQ default answer when switching type
                    if (/^[a-d]$/i.test(String(next.correct_answer || '').trim())) {
                      next.correct_answer = '';
                    }
                    if (/^[a-d]$/i.test(String(next.correct_sentence || '').trim())) {
                      next.correct_sentence = '';
                    }
                    if (!next.question_text || next.question_text === emptyQuestion.question_text) {
                      next.question_text = 'Put the words in the correct order to make sentences.';
                    }
                  }
                  if (nextType === 'complete_text') {
                    // Clear MCQ default so blanks_answers is the source of truth
                    if (/^[a-d]$/i.test(String(next.correct_answer || '').trim())) {
                      next.correct_answer = '';
                    }
                    if (!next.question_text || next.question_text === emptyQuestion.question_text) {
                      next.question_text = 'Read and complete the text with the words in the box.';
                    }
                    next.blanks_answers = next.blanks_answers || '';
                  }
                  if (nextType === 'multiple_choice' && (!next.correct_answer || String(next.correct_answer).length > 1)) {
                    next.correct_answer = 'a';
                  }
                  return next;
                });
              }}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
            >
              {QUESTION_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {qType === 'multiple_choice' && (
            <>
              {field('question_text', 'نص السؤال', 'textarea')}
              {field('option_a', 'الخيار A')}
              {field('option_b', 'الخيار B')}
              {field('option_c', 'الخيار C')}
              {field('option_d', 'الخيار D')}
              {field('correct_answer', 'الإجابة الصحيحة', 'select', [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
                { value: 'c', label: 'C' },
                { value: 'd', label: 'D' },
              ])}
            </>
          )}

          {qType === 'complete_text' && (
            <>
              {field('question_text', 'التعليمات (Instruction)', 'textarea')}
              {field('passage_text', 'النص مع الفراغات (استخدم ___ لكل فراغ)', 'textarea')}
              {field('word_bank', 'كلمات الصندوق (افصل بينها بفاصلة)', 'textarea')}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  إجابات الفراغات بالترتيب (افصل بـ | )
                </label>
                <textarea
                  value={form.blanks_answers ?? form.correct_answer ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      blanks_answers: value,
                      // Keep correct_answer in sync so the answer is never lost as MCQ default
                      correct_answer: value,
                    }));
                  }}
                  rows={3}
                  dir="ltr"
                  placeholder="am | is | are"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                />
              </div>
              <p className="text-xs text-stone-500 leading-relaxed">
                مثال النص: I ___ a student and she ___ my sister.<br />
                كلمات الصندوق: am, is<br />
                الإجابات: am|is
              </p>
            </>
          )}

          {qType === 'reading_comprehension' && (
            <>
              {field('passage_text', 'نص القراءة (Reading passage)', 'textarea')}
              {field('question_text', 'السؤال بعد قراءة النص', 'textarea')}
              {field('answer_mode', 'نوع الإجابة', 'select', [
                { value: 'multiple_choice', label: 'اختيار من متعدد (Multiple Choice)' },
                { value: 'essay', label: 'سؤال مقالي (Open / Essay answer)' },
              ])}
              {(form.answer_mode || 'multiple_choice') === 'multiple_choice' ? (
                <>
                  {field('option_a', 'الخيار A')}
                  {field('option_b', 'الخيار B')}
                  {field('option_c', 'الخيار C')}
                  {field('option_d', 'الخيار D')}
                  {field('correct_answer', 'الإجابة الصحيحة', 'select', [
                    { value: 'a', label: 'A' },
                    { value: 'b', label: 'B' },
                    { value: 'c', label: 'C' },
                    { value: 'd', label: 'D' },
                  ])}
                </>
              ) : (
                <>
                  {field('correct_answer', 'نموذج الإجابة المقالية (اختياري للمراجعة)', 'textarea')}
                  {field('min_words', 'الحد الأدنى لعدد الكلمات', 'number')}
                  {field('max_words', 'الحد الأقصى لعدد الكلمات', 'number')}
                  <p className="text-xs text-stone-500 leading-relaxed">
                    يكتب الطالب إجابة مقالية حرة بعد قراءة النص.
                    إذا أدخلت نموذج إجابة يتم المطابقة النصية؛ وإلا يُقبل أي نص ضمن عدد الكلمات المحدد.
                  </p>
                </>
              )}
            </>
          )}

          {qType === 'word_order' && (
            <>
              {field('question_text', 'التعليمات', 'textarea')}
              {field('word_bank', 'الكلمات المبعثرة (افصل بفاصلة)', 'textarea')}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">الجملة الصحيحة بالترتيب</label>
                <textarea
                  value={form.correct_sentence ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      correct_sentence: value,
                      // Keep both fields in sync so the answer is never lost as the MCQ default "a"
                      correct_answer: value,
                    }));
                  }}
                  onBlur={(e) => {
                    const value = String(e.target.value || '').trim().replace(/\s+/g, ' ');
                    setForm((prev) => ({
                      ...prev,
                      correct_sentence: value,
                      correct_answer: value,
                    }));
                  }}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-amber-50/40 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  placeholder="He is a student"
                  dir="ltr"
                />
                {String(form.correct_sentence || '').trim() && !/^[a-d]$/i.test(String(form.correct_sentence || '').trim()) ? (
                  <p className="mt-2 text-xs text-emerald-700 font-medium" dir="ltr">
                    سيتم حفظ الإجابة: {String(form.correct_sentence).trim()}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-red-600 font-medium">
                    اكتب الجملة الإنجليزية الكاملة هنا (وليس a/b/c/d) ثم اضغط حفظ
                  </p>
                )}
              </div>
              <p className="text-xs text-stone-500">
                مثال الكلمات: student / a / is / He<br />
                الجملة الصحيحة: He is a student
              </p>
            </>
          )}

          {qType === 'word_form' && (
            <>
              {field(
                'question_text',
                'التعليمات (افتراضي: Read and write the correct form of the word[s] between brackets.)',
                'textarea'
              )}
              {field('passage_text', 'الجمل مع الكلمات بين أقواس', 'textarea')}
              {field('correct_answer', 'الإجابات الصحيحة بالترتيب (افصل بـ | )', 'textarea')}
              <p className="text-xs text-stone-500 leading-relaxed">
                مثال الجمل: She (go) ___ to school every day. He (be) ___ happy yesterday.<br />
                الإجابات: goes|was<br />
                يمكن قبول أكثر من إجابة لنفس الفراغ هكذا: goes/go|was
              </p>
            </>
          )}

          {qType === 'rewrite_brackets' && (
            <>
              {field(
                'question_text',
                'التعليمات (افتراضي: Rewrite the following sentences using the word(s) in brackets.)',
                'textarea'
              )}
              {field('passage_text', 'الجمل المطلوب إعادة كتابتها (كل جملة في سطر — مع الكلمة بين أقواس)', 'textarea')}
              {field('correct_answer', 'الإجابات النموذجية بالترتيب (افصل بـ | )', 'textarea')}
              <p className="text-xs text-stone-500 leading-relaxed">
                مثال الجمل (كل جملة في سطر):
                <br />
                She is a teacher. (work)
                <br />
                They bought a new car. (buy)
                <br />
                الإجابات: She works as a teacher.|They have bought a new car.
                <br />
                يمكن قبول أكثر من صياغة لنفس الجملة: She works as a teacher./She works as a teacher
              </p>
            </>
          )}

          {qType === 'punctuate' && (
            <>
              {field(
                'question_text',
                'التعليمات (افتراضي: Punctuate the following sentences.)',
                'textarea'
              )}
              {field('passage_text', 'الجمل بدون ترقيم (للطالب)', 'textarea')}
              {field('correct_answer', 'الجمل بعد الترقيم الصحيح (نموذج الإجابة)', 'textarea')}
              <p className="text-xs text-stone-500 leading-relaxed">
                مثال للطالب: what is your name i am ali<br />
                النموذج: What is your name? I am Ali.
              </p>
            </>
          )}

          {qType === 'paragraph' && (
            <>
              {field(
                'question_text',
                'التعليمات (مثال: Write a paragraph of 50-60 words...)',
                'textarea'
              )}
              {field('guiding_elements', 'Guiding elements (عناصر إرشادية)', 'textarea')}
              {field('min_words', 'الحد الأدنى لعدد الكلمات', 'number')}
              {field('max_words', 'الحد الأقصى لعدد الكلمات', 'number')}
              {field('correct_answer', 'نموذج إجابة اختياري (للمراجعة)', 'textarea')}
              <p className="text-xs text-stone-500 leading-relaxed">
                يكتب الطالب فقرة حرة. التصحيح التلقائي يعتمد على عدد الكلمات ضمن المدى المحدد.
                مثال العناصر: name - age - hobbies - school - future job
              </p>
            </>
          )}

          {qType === 'listening' && (
            <div className="space-y-4">
              {field(
                'question_text',
                'التعليمات (Listening instructions)',
                'textarea'
              )}

              <div className="p-3 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-stone-900">
                  <Music2 className="w-4 h-4 text-amber-700" />
                  ملف الصوت — مشغّل Winamp
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">
                  ارفع ملفاً صوتياً أو قائمة تشغيل Winamp. يتم التشغيل بواجهة Winamp داخل المنصة
                  (MP3 / WAV / M4A / OGG / AAC / FLAC / M3U / PLS) — حتى 5 جيجابايت
                </p>
                {form.audio_url ? (
                  <div className="space-y-3">
                    <WinampPlayer
                      key={form.audio_url}
                      src={form.audio_url}
                      title={form.question_text?.slice?.(0, 60) || 'Listening Track'}
                    />
                    <div className="flex flex-wrap gap-2">
                      <label className="flex-1 min-w-[140px] text-center py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold cursor-pointer hover:bg-amber-800">
                        {uploading ? 'جاري الرفع...' : 'استبدال الملف'}
                        <input
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.aac,.flac,.webm,.m3u,.m3u8,.pls"
                          className="hidden"
                          disabled={uploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            try {
                              const uploaded = await uploadFile(file, 'questions');
                              setForm((prev) => ({ ...prev, audio_url: uploaded.url }));
                              setError('');
                            } catch (err) {
                              setError(err?.message || 'فشل رفع الملف الصوتي');
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, audio_url: '' }))}
                        className="px-4 py-2 rounded-xl border border-stone-300 text-sm text-red-600 hover:bg-red-50"
                      >
                        حذف
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-stone-600">أو الصق رابط صوت / قائمة Winamp</label>
                      <input
                        type="url"
                        value={form.audio_url}
                        onChange={(e) => setForm((prev) => ({ ...prev, audio_url: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                        dir="ltr"
                        placeholder="https://.../track.mp3 أو playlist.m3u"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-white transition-colors">
                      <Music2 className="w-6 h-6 text-amber-700" />
                      <span className="text-sm font-medium text-stone-700">
                        {uploading ? 'جاري رفع الصوت لـ Winamp...' : 'رفع ملف صوتي / قائمة Winamp'}
                      </span>
                      <span className="text-[11px] text-stone-400">MP3 · WAV · M4A · OGG · M3U · PLS · حتى 5GB</span>
                      <input
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.aac,.flac,.webm,.m3u,.m3u8,.pls"
                        className="hidden"
                        disabled={uploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          try {
                            const uploaded = await uploadFile(file, 'questions');
                            setForm((prev) => ({ ...prev, audio_url: uploaded.url }));
                            setError('');
                          } catch (err) {
                            setError(err?.message || 'فشل رفع الملف الصوتي');
                          }
                        }}
                      />
                    </label>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-stone-600">أو الصق رابط صوت / قائمة Winamp</label>
                      <input
                        type="url"
                        value={form.audio_url || ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, audio_url: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                        dir="ltr"
                        placeholder="https://.../track.mp3 أو playlist.m3u"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl border border-stone-200 space-y-3">
                <div className="text-sm font-bold text-stone-900">A. Write True (T) or False (F)</div>
                <p className="text-xs text-stone-500">أنشئ عبارتين مبنيتين على الدرس / الملف الصوتي</p>
                {[1, 2].map((n) => (
                  <div key={n} className="grid sm:grid-cols-[1fr_110px] gap-2">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Statement {n}</label>
                      <input
                        type="text"
                        value={form[`tf_statement_${n}`] || ''}
                        onChange={(e) => setForm({ ...form, [`tf_statement_${n}`]: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                        placeholder={`Statement ${n}`}
                        dir="auto"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Answer</label>
                      <select
                        value={form[`tf_answer_${n}`] || 'T'}
                        onChange={(e) => setForm({ ...form, [`tf_answer_${n}`]: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      >
                        <option value="T">True (T)</option>
                        <option value="F">False (F)</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl border border-stone-200 space-y-3">
                <div className="text-sm font-bold text-stone-900">B. Listen again and Complete</div>
                <p className="text-xs text-stone-500">أنشئ 3 جمل بفراغات. استخدم ___ مكان الفراغ إن أردت.</p>
                {[1, 2, 3].map((n) => (
                  <div key={n} className="space-y-2 p-3 rounded-xl bg-stone-50 border border-stone-100">
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Sentence {n}</label>
                      <input
                        type="text"
                        value={form[`blank_sentence_${n}`] || ''}
                        onChange={(e) => setForm({ ...form, [`blank_sentence_${n}`]: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                        placeholder={`e.g. She ___ to school every day.`}
                        dir="auto"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-600 mb-1">Correct answer {n}</label>
                      <input
                        type="text"
                        value={form[`blank_answer_${n}`] || ''}
                        onChange={(e) => setForm({ ...form, [`blank_answer_${n}`]: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                        placeholder="goes (or goes/go)"
                        dir="ltr"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {field('points', 'النقاط', 'number')}
          {field('order_index', 'الترتيب', 'number')}

          <div className="pt-4 mt-3 border-t-2 border-amber-300 space-y-3 rounded-2xl bg-amber-50/50 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-700 text-white flex items-center justify-center shrink-0">
                <Paperclip className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-stone-900 text-base">مرفقات السؤال</h4>
                <p className="text-xs text-stone-600 mt-0.5">
                  ارفع ملفاً مرافقاً للسؤال (PDF / Word / صورة / أي ملف). يظهر للطالب أثناء الاختبار.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-amber-400 bg-white cursor-pointer hover:bg-amber-50 transition-colors">
                <File className="w-5 h-5 text-amber-800" />
                <span className="text-sm font-medium text-stone-800">رفع ملف</span>
                <span className="text-[11px] text-stone-500">PDF · Word · Excel · صورة · ZIP</span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip,.rar,image/*,application/pdf"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'file')}
                />
              </label>
              <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-stone-300 cursor-pointer hover:bg-stone-50 transition-colors">
                <ImageIcon className="w-5 h-5 text-amber-700" />
                <span className="text-sm font-medium text-stone-700">رفع صورة للسؤال</span>
                <span className="text-[11px] text-stone-400">JPG / PNG / WEBP</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleEntityFileUpload(e, 'image')}
                />
              </label>
            </div>

            {uploading && (
              <div className="flex items-center gap-2 text-sm text-amber-800 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <Upload className="w-4 h-4 animate-pulse" />
                جاري رفع الملف...
              </div>
            )}

            {entityMedia.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-stone-800">الملفات المرفقة ({entityMedia.length})</div>
                {entityMedia.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-stone-200 bg-white"
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                      {item.media_type === 'image' ? (
                        <img src={item.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <FileText className="w-5 h-5 text-amber-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-amber-800 mb-0.5">
                        {item.media_type === 'image' ? 'صورة' : item.media_type === 'file' ? 'ملف' : item.media_type}
                      </div>
                      <div className="text-sm font-medium text-stone-800 truncate">{item.title || 'مرفق'}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-stone-500 truncate block" dir="ltr">
                        {item.url}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(item)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-stone-900 mb-1">لوحة تحكم المشرف</h1>
        <p className="text-stone-600">إدارة كاملة لمنصة English Mastery</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
        {visibleTabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`admin-tab px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors shadow-sm ${
                active ? 'admin-tab-active' : 'admin-tab-idle'
              }`}
              style={
                active
                  ? { backgroundColor: '#b45309', color: '#ffffff' }
                  : { backgroundColor: '#ffffff', color: '#57534e', border: '1px solid #d6d3d1' }
              }
            >
              <t.icon
                className="w-4 h-4 shrink-0"
                strokeWidth={2.25}
                aria-hidden="true"
                style={{ color: active ? '#ffffff' : '#57534e', stroke: active ? '#ffffff' : '#57534e' }}
              />
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {tab === 'dashboard' && stats && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'الكورسات', value: stats.courses, color: 'from-amber-600 to-yellow-700' },
                  { label: 'الدروس', value: stats.lessons, color: 'from-stone-600 to-zinc-700' },
                  { label: 'الاختبارات', value: stats.quizzes, color: 'from-amber-700 to-yellow-800' },
                  { label: 'الأسئلة', value: stats.questions, color: 'from-yellow-600 to-amber-800' },
                  { label: 'الطلاب', value: stats.students, color: 'from-stone-600 to-zinc-800' },
                  { label: 'النتائج', value: stats.results, color: 'from-stone-500 to-zinc-600' },
                ].map((s) => (
                  <div key={s.label} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} mb-3`} />
                    <div className="text-3xl font-black text-stone-900">{s.value}</div>
                    <div className="text-sm text-stone-500">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-amber-700" />
                      صورة الواجهة الرئيسية
                    </h2>
                    <p className="text-sm text-stone-500 mt-1">
                      تظهر فوق قسم «لماذا English Mastery؟» في الصفحة الرئيسية
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold cursor-pointer hover:bg-amber-800">
                      <Upload className="w-4 h-4" />
                      {uploading || savingHomeImage ? 'جاري...' : homepageImage ? 'تغيير الصورة' : 'رفع صورة'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        disabled={uploading || savingHomeImage}
                        onChange={handleHomepageImageUpload}
                      />
                    </label>
                    {homepageImage && (
                      <button
                        type="button"
                        onClick={handleRemoveHomepageImage}
                        disabled={savingHomeImage}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-60"
                      >
                        <Trash2 className="w-4 h-4" />
                        إزالة
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl overflow-hidden border border-stone-200 bg-stone-100 min-h-[180px] flex items-center justify-center">
                  {homepageImage ? (
                    <img
                      src={homepageImage}
                      alt="صورة الواجهة الرئيسية"
                      className="w-full max-h-[360px] object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="text-center px-6 py-12 text-stone-500">
                      <ImageIcon className="w-10 h-10 mx-auto mb-3 text-stone-400" />
                      <p className="font-medium">لا توجد صورة حالياً</p>
                      <p className="text-sm mt-1">ارفع صورة لتظهر في الواجهة الرئيسية</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'courses' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900">الكورسات حسب الصف</h2>
                  <p className="text-sm text-stone-500 mt-1">
                    أضف كورسات جديدة داخل كل قسم — كل كورس يظهر لطلاب هذا الصف فقط
                  </p>
                  <p className="text-xs text-amber-800 mt-1 font-medium">
                    لإضافة صورة أو فيديو أو رابط يوتيوب: اضغط «وسائط» بجانب الكورس، أو عدّل الكورس وانزل لقسم الوسائط
                  </p>
                </div>
                <button
                  onClick={() => openCreate('course')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                >
                  <Plus className="w-4 h-4" />
                  كورس جديد
                </button>
              </div>

              <div className="space-y-4">
                {GRADE_OPTIONS.map((grade) => {
                  const gradeCourses = courses.filter((c) => c.grade_level === grade.value);
                  return (
                    <div
                      key={grade.value}
                      className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-stone-200 bg-stone-50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-700 text-white flex items-center justify-center font-bold text-sm">
                            {gradeCourses.length}
                          </div>
                          <div>
                            <h3 className="font-bold text-stone-900">{grade.label}</h3>
                            <p className="text-xs text-stone-500">
                              {gradeCourses.length === 0
                                ? 'لا توجد كورسات في هذا القسم بعد'
                                : `${gradeCourses.length} كورس`}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => openCreate('course', { grade_level: grade.value })}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
                        >
                          <Plus className="w-4 h-4" />
                          إضافة كورس في {grade.label}
                        </button>
                      </div>

                      {gradeCourses.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-stone-500">
                          اضغط «إضافة كورس» لإنشاء أول كورس لهذا الصف
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-stone-100 bg-white">
                                {['#', 'الغلاف', 'العنوان', 'المستوى', 'المدة', 'الحالة', 'وسائط / إجراءات'].map((h) => (
                                  <th key={h} className="text-right px-4 py-3 font-semibold text-stone-600 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {gradeCourses.map((c) => (
                                <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50/80">
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{c.id}</td>
                                  <td className="px-4 py-3">
                                    {c.image_url ? (
                                      <img src={c.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-stone-200 flex items-center justify-center">
                                        <BookOpen className="w-4 h-4 text-stone-500" />
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-stone-700">
                                    <div className="font-medium">{c.title_ar || c.title}</div>
                                    <div className="text-xs text-stone-400">{c.title}</div>
                                  </td>
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{c.level}</td>
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{c.duration || '—'}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    {c.is_published ? <Badge green>منشور</Badge> : <Badge>مسودة</Badge>}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <Actions
                                      onEdit={() => openEdit('course', c)}
                                      onMedia={() => openEdit('course', c)}
                                      onDelete={() => handleDelete('course', c.id)}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}

                {(() => {
                  const unassigned = courses.filter(
                    (c) => !c.grade_level || !GRADE_OPTIONS.some((g) => g.value === c.grade_level)
                  );
                  if (!unassigned.length) return null;
                  return (
                    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-amber-100 bg-amber-50">
                        <h3 className="font-bold text-amber-950">كورسات بدون صف محدد</h3>
                        <p className="text-xs text-amber-800 mt-0.5">عدّل كل كورس واختر الصف الدراسي</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-stone-100">
                              {['#', 'العنوان', 'إجراءات'].map((h) => (
                                <th key={h} className="text-right px-4 py-3 font-semibold text-stone-600">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {unassigned.map((c) => (
                              <tr key={c.id} className="border-b border-stone-100">
                                <td className="px-4 py-3">{c.id}</td>
                                <td className="px-4 py-3">{c.title_ar || c.title}</td>
                                <td className="px-4 py-3">
                                  <Actions
                                    onEdit={() => openEdit('course', c)}
                                    onMedia={() => openEdit('course', c)}
                                    onDelete={() => handleDelete('course', c.id)}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {tab === 'lessons' && (
            <Section
              title="الدروس"
              onAdd={() => openCreate('lesson')}
              addLabel="درس جديد"
              filter={
                <select
                  value={filterCourse}
                  onChange={(e) => setFilterCourse(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                >
                  <option value="">كل الكورسات</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title_ar || c.title}</option>
                  ))}
                </select>
              }
            >
              <Table
                headers={['#', 'العنوان', 'الكورس', 'نوع الحصة', 'إعداد الحضور', 'نقاط', 'الترتيب', 'المدة', 'إجراءات']}
                rows={filteredLessons.map((l) => {
                  const s = getLessonAttendanceSettings(l);
                  const attendanceHint =
                    s.session_type === 'external_link'
                      ? `جلسة ${Math.round((s.external_required_seconds || 1800) / 60)}د`
                      : `مشاهدة ${s.required_watch_percent || 85}%${s.video_duration_minutes ? ` · ${s.video_duration_minutes}د` : ''}`;
                  return [
                    l.id,
                    l.title_ar || l.title,
                    courses.find((c) => c.id === l.course_id)?.title_ar || l.course_id,
                    <span key="st" className="text-xs font-semibold text-stone-700">
                      {sessionTypeLabel(s.session_type)}
                    </span>,
                    <span key="ah" className="text-xs text-stone-600">{attendanceHint}</span>,
                    s.session_points || 0,
                    l.order_index,
                    `${l.duration_minutes || 30} د`,
                    <Actions
                      key="a"
                      onEdit={() => openEdit('lesson', l)}
                      onMedia={() => openEdit('lesson', l)}
                      onDelete={() => handleDelete('lesson', l.id)}
                    />,
                  ];
                })}
              />
            </Section>
          )}

          {tab === 'quizzes' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900">الاختبارات حسب الصف</h2>
                  <p className="text-sm text-stone-500 mt-1">
                    أضف اختبارات جديدة داخل كل قسم (مثل الثالث الإعدادي) — كل اختبار يظهر لطلاب هذا الصف فقط
                  </p>
                </div>
                <button
                  onClick={() => openCreate('quiz')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                >
                  <Plus className="w-4 h-4" />
                  اختبار جديد
                </button>
              </div>

              <div className="space-y-4">
                {GRADE_OPTIONS.map((grade) => {
                  const gradeQuizzes = quizzes.filter((q) => q.grade_level === grade.value);
                  return (
                    <div
                      key={grade.value}
                      className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-stone-200 bg-stone-50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-700 text-white flex items-center justify-center font-bold text-sm">
                            {gradeQuizzes.length}
                          </div>
                          <div>
                            <h3 className="font-bold text-stone-900">{grade.label}</h3>
                            <p className="text-xs text-stone-500">
                              {gradeQuizzes.length === 0
                                ? 'لا توجد اختبارات في هذا القسم بعد'
                                : `${gradeQuizzes.length} اختبار`}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => openCreate('quiz', { grade_level: grade.value })}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
                        >
                          <Plus className="w-4 h-4" />
                          إضافة اختبار في {grade.label}
                        </button>
                      </div>

                      {gradeQuizzes.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-stone-500">
                          اضغط «إضافة اختبار» لإنشاء أول اختبار لهذا الصف
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-stone-100 bg-white">
                                {['#', 'الغلاف', 'العنوان', 'المستوى', 'المدة', 'المحاولات', 'نسبة النجاح', 'الحالة', 'إجراءات'].map((h) => (
                                  <th key={h} className="text-right px-4 py-3 font-semibold text-stone-600 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {gradeQuizzes.map((q) => (
                                <tr key={q.id} className="border-b border-stone-100 hover:bg-stone-50/80">
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{q.id}</td>
                                  <td className="px-4 py-3">
                                    {q.image_url ? (
                                      <img src={q.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-stone-200 flex items-center justify-center">
                                        <ClipboardList className="w-4 h-4 text-stone-500" />
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-stone-700">
                                    <div className="font-medium">{q.title_ar || q.title}</div>
                                    <div className="text-xs text-stone-400">{q.title}</div>
                                  </td>
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{q.level}</td>
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{q.duration_minutes || 20} د</td>
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{q.max_attempts ?? 1}</td>
                                  <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{q.pass_percentage ?? 50}%</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    {q.is_published ? <Badge green>منشور</Badge> : <Badge>مسودة</Badge>}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <Actions
                                      onEdit={() => openEdit('quiz', q)}
                                      onDelete={() => handleDelete('quiz', q.id)}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}

                {(() => {
                  const unassigned = quizzes.filter((q) => !q.grade_level || !GRADE_OPTIONS.some((g) => g.value === q.grade_level));
                  if (!unassigned.length) return null;
                  return (
                    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-amber-100 bg-amber-50">
                        <h3 className="font-bold text-amber-950">اختبارات بدون صف محدد</h3>
                        <p className="text-xs text-amber-800 mt-0.5">عدّل كل اختبار واختر الصف الدراسي</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-stone-100">
                              {['#', 'العنوان', 'إجراءات'].map((h) => (
                                <th key={h} className="text-right px-4 py-3 font-semibold text-stone-600">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {unassigned.map((q) => (
                              <tr key={q.id} className="border-b border-stone-100">
                                <td className="px-4 py-3">{q.id}</td>
                                <td className="px-4 py-3">{q.title_ar || q.title}</td>
                                <td className="px-4 py-3">
                                  <Actions onEdit={() => openEdit('quiz', q)} onDelete={() => handleDelete('quiz', q.id)} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {tab === 'questions' && (
            <Section
              title="الأسئلة"
              onAdd={() => {
                if (!filterQuiz) {
                  setError('اختر اختباراً من القائمة أولاً لإضافة الأسئلة إليه تلقائياً');
                  return;
                }
                const quiz = quizzes.find((q) => String(q.id) === String(filterQuiz));
                openCreate('question', {
                  quiz_id: filterQuiz,
                  grade_filter: quiz?.grade_level || filterQuestionGrade || '',
                });
              }}
              addLabel="سؤال جديد"
              filter={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={filterQuestionGrade}
                    onChange={(e) => {
                      setFilterQuestionGrade(e.target.value);
                      setFilterQuiz('');
                    }}
                    className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
                  >
                    <option value="">كل الصفوف / الأقسام</option>
                    {GRADE_OPTIONS.map((g) => {
                      const count = quizzes.filter((q) => q.grade_level === g.value).length;
                      return (
                        <option key={g.value} value={g.value}>
                          {g.label} ({count})
                        </option>
                      );
                    })}
                  </select>
                  <select
                    value={filterQuiz}
                    onChange={(e) => {
                      const quizId = e.target.value;
                      setFilterQuiz(quizId);
                      // Auto-sync grade filter when a quiz is chosen
                      if (quizId) {
                        const quiz = quizzes.find((q) => String(q.id) === String(quizId));
                        if (quiz?.grade_level) setFilterQuestionGrade(quiz.grade_level);
                      }
                    }}
                    className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white min-w-[200px]"
                    disabled={false}
                  >
                    <option value="">
                      {filterQuestionGrade ? 'اختر اختبار هذا الصف' : 'اختر الاختبار'}
                    </option>
                    {quizzesInQuestionFilter.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.title_ar || q.title}
                        {q.grade_level ? ` — ${gradeLabel(q.grade_level)}` : ''}
                      </option>
                    ))}
                  </select>
                  {filterQuiz && (
                    <span className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-900">
                      مرتبط بـ: {quizzes.find((q) => String(q.id) === String(filterQuiz))?.title_ar
                        || quizzes.find((q) => String(q.id) === String(filterQuiz))?.title
                        || filterQuiz}
                    </span>
                  )}
                </div>
              }
            >
              <Table
                headers={['#', 'النوع', 'السؤال', 'الصف', 'الاختبار', 'نقاط', 'إجراءات']}
                rows={filteredQuestions.map((q) => {
                  const quiz = quizzes.find((x) => String(x.id) === String(q.quiz_id));
                  return [
                    q.id,
                    <span key="t" className="text-xs font-semibold text-amber-800 whitespace-nowrap">
                      {QUESTION_TYPES.find((t) => t.value === (q.question_type || 'multiple_choice'))?.label || 'اختيار من متعدد'}
                    </span>,
                    <span key="q" className="line-clamp-2 max-w-xs text-sm">{q.question_text}</span>,
                    gradeLabel(quiz?.grade_level) || '—',
                    quiz?.title_ar || quiz?.title || q.quiz_id,
                    q.points,
                    <Actions key="a" onEdit={() => openEdit('question', q)} onDelete={() => handleDelete('question', q.id)} />,
                  ];
                })}
              />
            </Section>
          )}

          {tab === 'students' && (
            <Section
              title="الطلاب والمستخدمون"
              filter={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                    <input
                      type="search"
                      value={studentNameSearch}
                      onChange={(e) => setStudentNameSearch(e.target.value)}
                      placeholder="بحث باسم الطالب..."
                      className="pr-9 pl-3 py-2 rounded-xl border border-stone-300 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />
                  </div>
                  <label className="text-sm font-medium text-stone-600 whitespace-nowrap">الصف الدراسي</label>
                  <select
                    value={filterStudentGrade}
                    onChange={(e) => setFilterStudentGrade(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-amber-600"
                  >
                    <option value="">كل الصفوف ({students.length})</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label} ({gradeCounts[g.value] || 0})
                      </option>
                    ))}
                    <option value="__none__">بدون صف ({noGradeCount})</option>
                  </select>
                  <button
                    type="button"
                    onClick={exportStudentsPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
                    title="تحميل ملف PDF"
                  >
                    <FileDown className="w-4 h-4" />
                    تصدير PDF
                  </button>
                  <button
                    type="button"
                    onClick={printStudentsReport}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold hover:bg-stone-50"
                    title="طباعة القائمة"
                  >
                    <Printer className="w-4 h-4" />
                    طباعة
                  </button>
                </div>
              }
            >
              {(filterStudentGrade || studentNameSearch.trim()) && (
                <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {studentNameSearch.trim() && (
                      <>
                        بحث: <strong>{studentNameSearch.trim()}</strong>
                        {(filterStudentGrade || filteredStudents.length >= 0) ? ' · ' : ''}
                      </>
                    )}
                    {filterStudentGrade && (
                      <>
                        عرض طلاب:{' '}
                        <strong>
                          {filterStudentGrade === '__none__'
                            ? 'بدون صف'
                            : gradeLabel(filterStudentGrade)}
                        </strong>
                      </>
                    )}
                    {' '}· {filteredStudents.length} مستخدم
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStudentGrade('');
                      setStudentNameSearch('');
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-amber-200 hover:bg-amber-100"
                  >
                    إظهار الكل
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setFilterStudentGrade('')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    !filterStudentGrade
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  الكل ({students.length})
                </button>
                {GRADE_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setFilterStudentGrade(g.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      filterStudentGrade === g.value
                        ? 'bg-amber-700 text-white border-amber-700'
                        : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    {g.label} ({gradeCounts[g.value] || 0})
                  </button>
                ))}
              </div>

              <Table
                headers={['الاسم', 'البريد', 'الصف', 'ولي الأمر', 'الدور', 'النقاط', 'إجراءات']}
                rows={filteredStudents.map((s) => [
                  s.full_name,
                  <span key="e" dir="ltr" className="text-sm">{s.email}</span>,
                  <select
                    key="g"
                    value={s.grade_level || ''}
                    onChange={(e) => updateStudentGrade(s.id, e.target.value)}
                    className="px-2 py-1.5 rounded-lg border border-stone-300 text-xs min-w-[150px] bg-white focus:outline-none focus:ring-2 focus:ring-amber-600"
                  >
                    <option value="">— بدون صف —</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>,
                  <span key="p" dir="ltr" className="text-sm font-medium text-stone-700">
                    {s.parent_phone || '—'}
                  </span>,
                  <select
                    key="r"
                    value={s.role}
                    onChange={(e) => updateStudentRole(s.id, e.target.value)}
                    className="px-2 py-1 rounded-lg border border-stone-300 text-xs"
                    disabled={!canManageAccounts}
                  >
                    <option value="student">طالب</option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>,
                  s.total_points || 0,
                  <button
                    key="d"
                    onClick={() => handleDelete('student', s.id)}
                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>,
                ])}
              />
            </Section>
          )}

          {tab === 'results' && (
            <Section
              title="نتائج الاختبارات"
              filter={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                    <input
                      type="search"
                      value={resultNameSearch}
                      onChange={(e) => setResultNameSearch(e.target.value)}
                      placeholder="بحث باسم الطالب..."
                      className="pr-9 pl-3 py-2 rounded-xl border border-stone-300 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />
                  </div>
                  <label className="text-sm font-medium text-stone-600 whitespace-nowrap">الصف الدراسي</label>
                  <select
                    value={filterResultGrade}
                    onChange={(e) => setFilterResultGrade(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white min-w-[220px] focus:outline-none focus:ring-2 focus:ring-amber-600"
                  >
                    <option value="">كل الصفوف ({results.length})</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label} ({resultGradeCounts[g.value] || 0})
                      </option>
                    ))}
                    <option value="__none__">بدون صف ({resultNoGradeCount})</option>
                  </select>
                  <button
                    type="button"
                    onClick={exportResultsPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800"
                    title="تحميل ملف PDF"
                  >
                    <FileDown className="w-4 h-4" />
                    تصدير PDF
                  </button>
                  <button
                    type="button"
                    onClick={printResultsReport}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold hover:bg-stone-50"
                    title="طباعة النتائج"
                  >
                    <Printer className="w-4 h-4" />
                    طباعة
                  </button>
                </div>
              }
            >
              {(filterResultGrade || resultNameSearch.trim()) && (
                <div className="mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {resultNameSearch.trim() && (
                      <>
                        بحث: <strong>{resultNameSearch.trim()}</strong>
                        {' · '}
                      </>
                    )}
                    {filterResultGrade && (
                      <>
                        نتائج صف:{' '}
                        <strong>
                          {filterResultGrade === '__none__'
                            ? 'بدون صف'
                            : gradeLabel(filterResultGrade)}
                        </strong>
                      </>
                    )}
                    {' '}· {filteredResults.length} نتيجة
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterResultGrade('');
                      setResultNameSearch('');
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-amber-200 hover:bg-amber-100"
                  >
                    إظهار الكل
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setFilterResultGrade('')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    !filterResultGrade
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  الكل ({results.length})
                </button>
                {GRADE_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setFilterResultGrade(g.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      filterResultGrade === g.value
                        ? 'bg-amber-700 text-white border-amber-700'
                        : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    {g.label} ({resultGradeCounts[g.value] || 0})
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFilterResultGrade('__none__')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    filterResultGrade === '__none__'
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  بدون صف ({resultNoGradeCount})
                </button>
              </div>

              <Table
                headers={['#', 'الطالب', 'الصف', 'الاختبار', 'النتيجة', 'النسبة', 'التاريخ والوقت', 'حذف']}
                rows={filteredResults.map((r) => [
                  r.id,
                  r.user_name,
                  displayGrade(getResultGrade(r)),
                  (() => {
                    const quiz = findQuiz(r.quiz_id);
                    return quiz?.title_ar || quiz?.title || (r.quiz_id != null ? `اختبار #${r.quiz_id}` : '—');
                  })(),
                  `${Number(r.score) || 0}/${Number(r.total_questions) || 0}`,
                  `${r.percentage != null ? r.percentage : 0}%`,
                  <span key="dt" className="whitespace-nowrap text-xs">
                    {formatResultDateTime(r.completed_at)}
                  </span>,
                  <button
                    key="d"
                    onClick={() => handleDelete('result', r.id)}
                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                    title="حذف النتيجة"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>,
                ])}
              />
            </Section>
          )}

          {tab === 'attendance' && (() => {
            const statusLabel = {
              not_started: { text: '🔴 لم تبدأ', cls: 'bg-red-50 text-red-800' },
              in_progress: { text: '🟡 قيد المتابعة', cls: 'bg-amber-50 text-amber-900' },
              completed: { text: '🟢 مكتملة', cls: 'bg-emerald-50 text-emerald-800' },
              absent: { text: 'غائب', cls: 'bg-stone-100 text-stone-700' },
              excused: { text: 'بعذر', cls: 'bg-stone-100 text-stone-700' },
            };
            const quizLabel = {
              none: { text: '—', cls: 'text-stone-400' },
              started: { text: 'بدأ', cls: 'bg-amber-50 text-amber-900' },
              completed: { text: 'مكتمل', cls: 'bg-emerald-50 text-emerald-800' },
            };
            const formatSec = (s) => {
              const n = Math.max(0, Math.floor(Number(s) || 0));
              const m = Math.floor(n / 60);
              const r = n % 60;
              return `${m}:${String(r).padStart(2, '0')}`;
            };
            const filtered = attendanceRows.filter((row) => {
              if (attendanceFilterStudent && row.user_id !== attendanceFilterStudent) return false;
              if (attendanceFilterLesson && String(row.lesson_id) !== String(attendanceFilterLesson)) return false;
              if (attendanceFilterStatus && row.status !== attendanceFilterStatus) return false;
              if (attendanceFilterType && row.session_type !== attendanceFilterType) return false;
              if (attendanceFilterGrade) {
                const g = row.grade_level || row.student_grade_level || row.lesson_grade_level || '';
                if (g !== attendanceFilterGrade) return false;
              }
              const q = attendanceSearch.trim().toLowerCase();
              if (!q) return true;
              const hay = `${row.student_name || ''} ${row.student_email || ''} ${row.lesson_title || ''} ${row.course_title || ''} ${gradeLabel(row.grade_level || row.student_grade_level || '')}`.toLowerCase();
              return hay.includes(q);
            });
            const studentOptions = (attendanceStudents.length
              ? attendanceStudents
              : students.filter((s) => !s.role || s.role === 'student').map((s) => ({
                  id: s.id,
                  full_name: s.full_name,
                  email: s.email,
                  total_points: s.total_points,
                  grade_level: s.grade_level,
                }))
            ).filter((s) => {
              if (!attendanceFilterGrade) return true;
              return !s.grade_level || s.grade_level === attendanceFilterGrade;
            });
            const lessonOptions = (attendanceLessons.length
              ? attendanceLessons
              : lessons.map((l) => ({
                  id: l.id,
                  title: l.title_ar || l.title,
                  course_title: courses.find((c) => String(c.id) === String(l.course_id))?.title_ar || '',
                  grade_level: l.grade_level || courses.find((c) => String(c.id) === String(l.course_id))?.grade_level || '',
                }))
            ).filter((l) => {
              if (!attendanceFilterGrade) return true;
              return !l.grade_level || l.grade_level === attendanceFilterGrade;
            });

            return (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                      <CalendarCheck2 className="w-5 h-5 text-amber-700" />
                      الحضور والمتابعة
                    </h2>
                    <p className="text-sm text-stone-500 mt-1">
                      جميع الطلاب × جميع الحصص: الحالة، نسبة المشاهدة، مدة الجلسة، الاختبار، النقاط — مع تصفية بالصف الدراسي
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadAttendanceAdmin}
                    className="px-4 py-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50"
                  >
                    تحديث
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
                  {[
                    { label: 'الطلاب', value: attendanceStats.students || studentOptions.length },
                    { label: 'الحصص', value: attendanceStats.lessons || lessonOptions.length },
                    { label: 'مكتملة', value: attendanceStats.completed || 0 },
                    { label: 'قيد المتابعة', value: attendanceStats.in_progress || 0 },
                    { label: 'لم تبدأ', value: attendanceStats.not_started || 0 },
                  ].map((c) => (
                    <div key={c.label} className="bg-white rounded-2xl border border-stone-200 p-4">
                      <div className="text-xs text-stone-500 mb-1">{c.label}</div>
                      <div className="text-2xl font-black text-stone-900">{c.value}</div>
                    </div>
                  ))}
                </div>

                {attendanceFilterGrade ? (
                  <div className="px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950 text-sm font-semibold">
                    التصفية النشطة حسب الصف: {gradeLabel(attendanceFilterGrade)}
                  </div>
                ) : null}

                <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                    <div className="relative md:col-span-2 xl:col-span-1">
                      <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                      <input
                        value={attendanceSearch}
                        onChange={(e) => setAttendanceSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') loadAttendanceAdmin();
                        }}
                        placeholder="بحث بالطالب أو الحصة أو الصف..."
                        className="w-full pr-9 pl-3 py-2 rounded-xl border border-stone-300 text-sm"
                      />
                    </div>
                    <select
                      value={attendanceFilterGrade}
                      onChange={(e) => setAttendanceFilterGrade(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-amber-300 bg-amber-50/40 text-sm font-semibold text-stone-800"
                    >
                      <option value="">كل الصفوف الدراسية</option>
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                    <select
                      value={attendanceFilterStudent}
                      onChange={(e) => setAttendanceFilterStudent(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    >
                      <option value="">كل الطلاب</option>
                      {studentOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name || s.email}
                          {s.grade_level ? ` — ${gradeLabel(s.grade_level)}` : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      value={attendanceFilterLesson}
                      onChange={(e) => setAttendanceFilterLesson(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    >
                      <option value="">كل الحصص</option>
                      {lessonOptions.map((l) => (
                        <option key={l.id} value={l.id}>
                          {(l.course_title ? `${l.course_title} — ` : '') + (l.title || l.id)}
                          {l.grade_level ? ` (${gradeLabel(l.grade_level)})` : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      value={attendanceFilterStatus}
                      onChange={(e) => setAttendanceFilterStatus(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    >
                      <option value="">كل الحالات</option>
                      <option value="not_started">لم تبدأ</option>
                      <option value="in_progress">قيد المتابعة</option>
                      <option value="completed">مكتملة</option>
                    </select>
                    <select
                      value={attendanceFilterType}
                      onChange={(e) => setAttendanceFilterType(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    >
                      <option value="">كل أنواع الحصص</option>
                      <option value="recorded_video">فيديو مسجل</option>
                      <option value="external_link">رابط خارجي</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={loadAttendanceAdmin}
                      className="px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                    >
                      تطبيق التصفية
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttendanceSearch('');
                        setAttendanceFilterStudent('');
                        setAttendanceFilterLesson('');
                        setAttendanceFilterStatus('');
                        setAttendanceFilterType('');
                        setAttendanceFilterGrade('');
                        setTimeout(() => loadAttendanceAdmin(), 0);
                      }}
                      className="px-4 py-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50"
                    >
                      إعادة ضبط
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
                  <div className="p-4 border-b border-stone-100 flex items-center justify-between gap-3">
                    <h3 className="font-bold text-stone-900">
                      تقرير الحضور ({filtered.length} صف)
                    </h3>
                    <span className="text-xs text-stone-500">
                      يشمل جميع الطلاب والحصص حتى بدون سجل حضور
                    </span>
                  </div>
                  {attendanceLoading ? (
                    <LoadingSpinner text="جاري تحميل تقرير الحضور..." />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[1100px]">
                        <thead className="bg-stone-50 text-stone-600">
                          <tr>
                            <th className="text-right font-semibold px-3 py-3">الطالب</th>
                            <th className="text-right font-semibold px-3 py-3">الصف</th>
                            <th className="text-right font-semibold px-3 py-3">الحصة</th>
                            <th className="text-right font-semibold px-3 py-3">النوع</th>
                            <th className="text-right font-semibold px-3 py-3">حالة الطالب</th>
                            <th className="text-right font-semibold px-3 py-3">مشاهدة الفيديو</th>
                            <th className="text-right font-semibold px-3 py-3">جلسة الرابط</th>
                            <th className="text-right font-semibold px-3 py-3">حالة الاختبار</th>
                            <th className="text-right font-semibold px-3 py-3">درجة الاختبار</th>
                            <th className="text-right font-semibold px-3 py-3">نقاط الطالب</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((row) => {
                            const st = statusLabel[row.status] || statusLabel.not_started;
                            const qs = quizLabel[row.quiz_status] || quizLabel.none;
                            const grade = row.grade_level || row.student_grade_level || row.lesson_grade_level || '';
                            return (
                              <tr key={`${row.user_id}_${row.lesson_id}`} className="border-t border-stone-100 hover:bg-stone-50/60">
                                <td className="px-3 py-3">
                                  {row.user_id ? (
                                    <Link
                                      to={`/admin/attendance/${encodeURIComponent(row.user_id)}`}
                                      className="group block"
                                      title="عرض تفاصيل حضور الطالب"
                                    >
                                      <div className="font-medium text-amber-900 group-hover:text-amber-700 group-hover:underline underline-offset-2">
                                        {row.student_name || '—'}
                                      </div>
                                      <div className="text-[11px] text-stone-500" dir="ltr">{row.student_email || ''}</div>
                                      <div className="text-[10px] text-amber-700/80 font-semibold mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        عرض تفاصيل الحضور
                                      </div>
                                    </Link>
                                  ) : (
                                    <>
                                      <div className="font-medium text-stone-900">{row.student_name || '—'}</div>
                                      <div className="text-[11px] text-stone-500" dir="ltr">{row.student_email || ''}</div>
                                    </>
                                  )}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  <span className="inline-flex px-2 py-1 rounded-lg text-xs font-bold bg-stone-100 text-stone-800">
                                    {grade ? gradeLabel(grade) : '—'}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="font-medium text-stone-800">{row.lesson_title}</div>
                                  <div className="text-[11px] text-stone-500">{row.course_title}</div>
                                </td>
                                <td className="px-3 py-3 text-xs font-semibold text-stone-700 whitespace-nowrap">
                                  {sessionTypeLabel(row.session_type)}
                                </td>
                                <td className="px-3 py-3">
                                  <span className={`inline-flex px-2 py-1 rounded-lg text-xs font-black ${st.cls}`}>
                                    {st.text}
                                  </span>
                                </td>
                                <td className="px-3 py-3 font-semibold text-stone-800 whitespace-nowrap">
                                  {row.session_type === 'recorded_video'
                                    ? `${Math.round(Number(row.watch_percent || 0) * 10) / 10}%`
                                    : '—'}
                                  {row.session_type === 'recorded_video' && row.required_watch_percent ? (
                                    <span className="block text-[10px] text-stone-400 font-medium">
                                      المطلوب {row.required_watch_percent}%
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-3 font-semibold text-stone-800 whitespace-nowrap">
                                  {row.session_type === 'external_link'
                                    ? `${formatSec(row.external_seconds)} / ${formatSec(row.external_required_seconds)}`
                                    : '—'}
                                </td>
                                <td className="px-3 py-3">
                                  <span className={`inline-flex px-2 py-1 rounded-lg text-xs font-bold ${qs.cls}`}>
                                    {qs.text}
                                  </span>
                                </td>
                                <td className="px-3 py-3 font-bold text-stone-900 whitespace-nowrap">
                                  {row.quiz_percentage != null
                                    ? `${row.quiz_percentage}%`
                                    : row.quiz_score != null
                                      ? `${row.quiz_score}${row.quiz_total_questions != null ? `/${row.quiz_total_questions}` : ''}`
                                      : '—'}
                                  {row.quiz_correct_answers != null && row.quiz_total_questions != null ? (
                                    <span className="block text-[10px] text-stone-400 font-medium">
                                      صحيحة {row.quiz_correct_answers}/{row.quiz_total_questions}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-3 font-black text-amber-900">
                                  {row.student_points ?? 0}
                                </td>
                              </tr>
                            );
                          })}
                          {!filtered.length && (
                            <tr>
                              <td colSpan={10} className="px-4 py-12 text-center text-stone-500">
                                لا توجد بيانات مطابقة للتصفية الحالية
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
                  <h3 className="font-bold text-stone-900">تسجيل حضور يدوي (للمشرف)</h3>
                  <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">الطالب</label>
                      <select
                        value={attendanceForm.user_id}
                        onChange={(e) => setAttendanceForm((p) => ({ ...p, user_id: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                      >
                        <option value="">اختر الطالب</option>
                        {studentOptions.map((s) => (
                          <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">الحصة</label>
                      <select
                        value={attendanceForm.lesson_id}
                        onChange={(e) => setAttendanceForm((p) => ({ ...p, lesson_id: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                      >
                        <option value="">اختر الحصة</option>
                        {lessonOptions.map((l) => (
                          <option key={l.id} value={l.id}>
                            {(l.course_title ? `${l.course_title} — ` : '') + (l.title || l.id)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">الحالة</label>
                      <select
                        value={attendanceForm.status}
                        onChange={(e) => setAttendanceForm((p) => ({ ...p, status: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                      >
                        <option value="present">حاضر / قيد المتابعة</option>
                        <option value="completed">مكتمل</option>
                        <option value="absent">غائب</option>
                        <option value="excused">بعذر</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">ملاحظة</label>
                      <input
                        value={attendanceForm.note}
                        onChange={(e) => setAttendanceForm((p) => ({ ...p, note: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                        placeholder="اختياري"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={attendanceSaving}
                    onClick={saveAttendanceAdmin}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    {attendanceSaving ? 'جاري الحفظ...' : 'حفظ الحضور'}
                  </button>
                </div>
              </div>
            );
          })()}

          {tab === 'leaderboard' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-700" />
                    إدارة منصة الأوائل
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    تحكم كامل في الترتيب التلقائي، المتفوقين المميزين، أعلى النتائج، وإعدادات العرض العامة
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadLeaderboardAdmin}
                  className="px-4 py-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50"
                >
                  تحديث البيانات
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'settings', label: 'الإعدادات' },
                  { id: 'ranking', label: 'الترتيب والنقاط' },
                  { id: 'featured', label: 'المتفوقون المميزون' },
                  { id: 'results', label: 'أعلى النتائج' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setLbSubTab(s.id)}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                      lbSubTab === s.id
                        ? 'bg-amber-700 text-white border-amber-700'
                        : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {lbLoading ? (
                <LoadingSpinner text="جاري تحميل منصة الأوائل..." />
              ) : (
                <>
                  {lbSubTab === 'settings' && (
                    <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4 shadow-sm">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-stone-700 mb-1">عنوان اللوحة</label>
                          <input
                            type="text"
                            value={lbConfig.title || ''}
                            onChange={(e) => setLbConfig((p) => ({ ...p, title: e.target.value }))}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-stone-700 mb-1">العنوان الفرعي</label>
                          <input
                            type="text"
                            value={lbConfig.subtitle || ''}
                            onChange={(e) => setLbConfig((p) => ({ ...p, subtitle: e.target.value }))}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-stone-700 mb-1">أقصى عدد طلاب في الترتيب</label>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={lbConfig.max_students ?? 50}
                            onChange={(e) => setLbConfig((p) => ({ ...p, max_students: Number(e.target.value) }))}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-stone-700 mb-1">أقصى عدد لأعلى النتائج</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={lbConfig.max_results ?? 20}
                            onChange={(e) => setLbConfig((p) => ({ ...p, max_results: Number(e.target.value) }))}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                          />
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3">
                        {[
                          { key: 'enabled', label: 'تفعيل منصة الأوائل للعامة' },
                          { key: 'show_auto_ranking', label: 'إظهار ترتيب النقاط التلقائي' },
                          { key: 'show_featured', label: 'إظهار المتفوقين المميزين' },
                          { key: 'show_top_results', label: 'إظهار أعلى نتائج الاختبارات' },
                        ].map((opt) => (
                          <label
                            key={opt.key}
                            className="flex items-center gap-3 p-3 rounded-xl border border-stone-200 bg-stone-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={!!lbConfig[opt.key]}
                              onChange={(e) => setLbConfig((p) => ({ ...p, [opt.key]: e.target.checked }))}
                              className="w-4 h-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600"
                            />
                            <span className="text-sm font-medium text-stone-800">{opt.label}</span>
                          </label>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <button
                          type="button"
                          onClick={saveLeaderboardConfig}
                          disabled={lbSaving}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                        >
                          <Save className="w-4 h-4" />
                          {lbSaving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
                        </button>
                        <a
                          href="/leaderboard"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50"
                        >
                          <Eye className="w-4 h-4" />
                          معاينة اللوحة
                        </a>
                      </div>
                    </div>
                  )}

                  {lbSubTab === 'ranking' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-stone-600">
                          عدّل نقاط الطلاب أو أخفهم من الترتيب العام. الطلاب المخفيون: <strong>{lbHidden.length}</strong>
                        </p>
                        <button
                          type="button"
                          onClick={resetAllPoints}
                          className="px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm font-semibold hover:bg-red-100"
                        >
                          تصفير كل النقاط
                        </button>
                      </div>
                      <Table
                        headers={['#', 'الاسم', 'البريد', 'النقاط', 'الحالة', 'إجراءات']}
                        rows={lbStudents.map((s, idx) => {
                          const hidden = lbHidden.includes(s.id);
                          return [
                            idx + 1,
                            s.full_name || '—',
                            <span key="e" dir="ltr" className="text-sm">{s.email || '—'}</span>,
                            <div key="pts" className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                value={pointsDrafts[s.id] ?? s.total_points ?? 0}
                                onChange={(e) =>
                                  setPointsDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))
                                }
                                className="w-24 px-2 py-1.5 rounded-lg border border-stone-300 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => saveStudentPoints(s.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800"
                              >
                                حفظ
                              </button>
                            </div>,
                            hidden ? (
                              <span key="st" className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded-md">مخفي</span>
                            ) : (
                              <span key="st" className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">ظاهر</span>
                            ),
                            <button
                              key="h"
                              type="button"
                              onClick={() => toggleHideStudent(s.id, !hidden)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                                hidden
                                  ? 'bg-stone-900 text-white hover:bg-stone-800'
                                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                              }`}
                              title={hidden ? 'إظهار في اللوحة' : 'إخفاء من اللوحة'}
                            >
                              {hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                              {hidden ? 'إظهار' : 'إخفاء'}
                            </button>,
                          ];
                        })}
                      />
                    </div>
                  )}

                  {lbSubTab === 'featured' && (
                    <div className="space-y-5">
                      <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3 shadow-sm">
                        <h3 className="font-bold text-stone-900 flex items-center gap-2">
                          <Crown className="w-4 h-4 text-amber-700" />
                          {editingLbEntryId ? 'تعديل متفوق مميز' : 'إضافة متفوق مميز'}
                        </h3>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">الاسم</label>
                            <input
                              type="text"
                              value={lbEntryForm.display_name}
                              onChange={(e) => setLbEntryForm((p) => ({ ...p, display_name: e.target.value }))}
                              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                              placeholder="اسم الطالب"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">النقاط</label>
                            <input
                              type="number"
                              min={0}
                              value={lbEntryForm.points}
                              onChange={(e) => setLbEntryForm((p) => ({ ...p, points: Number(e.target.value) }))}
                              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">الشارة / اللقب</label>
                            <input
                              type="text"
                              value={lbEntryForm.badge}
                              onChange={(e) => setLbEntryForm((p) => ({ ...p, badge: e.target.value }))}
                              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                              placeholder="مثال: متفوق الشهر"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1">الترتيب اليدوي</label>
                            <input
                              type="number"
                              value={lbEntryForm.sort_order}
                              onChange={(e) => setLbEntryForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-stone-700 mb-1">ملاحظة</label>
                            <input
                              type="text"
                              value={lbEntryForm.note}
                              onChange={(e) => setLbEntryForm((p) => ({ ...p, note: e.target.value }))}
                              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                              placeholder="ملاحظة اختيارية"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                            <input
                              type="checkbox"
                              checked={lbEntryForm.is_published !== false}
                              onChange={(e) => setLbEntryForm((p) => ({ ...p, is_published: e.target.checked }))}
                              className="rounded border-stone-300 text-amber-700 focus:ring-amber-600"
                            />
                            منشور للعامة
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={saveLbEntry}
                            disabled={lbSaving}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                          >
                            <Save className="w-4 h-4" />
                            {editingLbEntryId ? 'حفظ التعديل' : 'إضافة'}
                          </button>
                          {editingLbEntryId && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLbEntryId(null);
                                setLbEntryForm({ display_name: '', points: 0, badge: '', note: '', sort_order: 0, is_published: true });
                              }}
                              className="px-4 py-2 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                            >
                              إلغاء
                            </button>
                          )}
                        </div>
                      </div>

                      <Table
                        headers={['الترتيب', 'الاسم', 'النقاط', 'الشارة', 'الحالة', 'إجراءات']}
                        rows={lbEntries.map((e) => [
                          e.sort_order ?? 0,
                          <div key="n">
                            <div className="font-medium">{e.display_name}</div>
                            {e.note ? <div className="text-xs text-stone-400">{e.note}</div> : null}
                          </div>,
                          e.points || 0,
                          e.badge || '—',
                          e.is_published ? (
                            <span key="p" className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">منشور</span>
                          ) : (
                            <span key="p" className="text-xs font-semibold text-stone-600 bg-stone-100 px-2 py-1 rounded-md">مسودة</span>
                          ),
                          <div key="a" className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => editLbEntry(e)}
                              className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-50"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteLbEntry(e.id)}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>,
                        ])}
                      />
                    </div>
                  )}

                  {lbSubTab === 'results' && (
                    <div className="space-y-3">
                      <p className="text-sm text-stone-600">
                        يمكنك حذف أي نتيجة من قائمة أعلى النتائج الظاهرة في منصة الأوائل العامة.
                      </p>
                      <Table
                        headers={['#', 'الطالب', 'الاختبار', 'النتيجة', 'النسبة', 'حذف']}
                        rows={lbResults.map((r) => [
                          r.id,
                          r.user_name || '—',
                          r.quiz_id != null ? `#${r.quiz_id}` : '—',
                          `${r.score}/${r.total_questions}`,
                          `${r.percentage}%`,
                          <button
                            key="d"
                            type="button"
                            onClick={() => deleteLbResult(r.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>,
                        ])}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'footer' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                    <PanelBottom className="w-5 h-5 text-amber-700" />
                    إدارة الذيل (Footer)
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    تحكم كامل في الأقسام الثلاثة الظاهرة أسفل كل صفحات المنصة
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveFooter}
                  disabled={savingFooter}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  {savingFooter ? 'جاري الحفظ...' : 'حفظ الذيل'}
                </button>
              </div>

              {/* القسم 1: عن المنصة */}
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-bold text-sm flex items-center justify-center">1</span>
                  <h3 className="font-bold text-stone-900">قسم عن المنصة</h3>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">العنوان</label>
                    <input
                      type="text"
                      value={footerForm.about?.title || ''}
                      onChange={(e) => updateFooterAbout('title', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">العنوان الفرعي</label>
                    <input
                      type="text"
                      value={footerForm.about?.subtitle || ''}
                      onChange={(e) => updateFooterAbout('subtitle', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">الوصف</label>
                  <textarea
                    rows={4}
                    value={footerForm.about?.description || ''}
                    onChange={(e) => updateFooterAbout('description', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  />
                </div>
              </div>

              {/* القسم 2: الروابط السريعة */}
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-bold text-sm flex items-center justify-center">2</span>
                    <h3 className="font-bold text-stone-900">قسم الروابط السريعة</h3>
                  </div>
                  <button
                    type="button"
                    onClick={addFooterLink}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة رابط
                  </button>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">عنوان القسم</label>
                  <input
                    type="text"
                    value={footerForm.links?.title || ''}
                    onChange={(e) => setFooterForm((prev) => ({ ...prev, links: { ...prev.links, title: e.target.value } }))}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  />
                </div>
                <div className="space-y-3">
                  {(footerForm.links?.items || []).map((item, index) => (
                    <div key={index} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 p-3 rounded-xl border border-stone-200 bg-stone-50">
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">اسم الرابط</label>
                        <input
                          type="text"
                          value={item.label || ''}
                          onChange={(e) => updateFooterLink(index, 'label', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-600 mb-1">المسار أو الرابط</label>
                        <input
                          type="text"
                          value={item.to || ''}
                          onChange={(e) => updateFooterLink(index, 'to', e.target.value)}
                          placeholder="/courses أو https://..."
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm bg-white"
                          dir="ltr"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeFooterLink(index)}
                          className="p-2.5 rounded-xl text-red-500 hover:bg-red-50 border border-red-100"
                          title="حذف الرابط"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(footerForm.links?.items || []).length === 0 && (
                    <p className="text-sm text-stone-500 text-center py-4">لا توجد روابط — أضف رابطاً جديداً</p>
                  )}
                </div>
              </div>

              {/* القسم 3: تواصل معنا */}
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-bold text-sm flex items-center justify-center">3</span>
                  <h3 className="font-bold text-stone-900">قسم تواصل معنا</h3>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">عنوان القسم</label>
                  <input
                    type="text"
                    value={footerForm.contact?.title || ''}
                    onChange={(e) => updateFooterContact('title', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">البريد الإلكتروني</label>
                    <input
                      type="email"
                      value={footerForm.contact?.email || ''}
                      onChange={(e) => updateFooterContact('email', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">رقم الهاتف</label>
                    <input
                      type="text"
                      value={footerForm.contact?.phone || ''}
                      onChange={(e) => updateFooterContact('phone', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">العنوان / الموقع</label>
                  <input
                    type="text"
                    value={footerForm.contact?.address || ''}
                    onChange={(e) => updateFooterContact('address', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                  />
                </div>
              </div>

              {/* حقوق النشر */}
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-stone-900">نص حقوق النشر أسفل الذيل</h3>
                <p className="text-xs text-stone-500">استخدم {'{year}'} لإظهار السنة الحالية تلقائياً</p>
                <input
                  type="text"
                  value={footerForm.copyright || ''}
                  onChange={(e) => setFooterForm((prev) => ({ ...prev, copyright: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                />
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={saveFooter}
                    disabled={savingFooter}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    {savingFooter ? 'جاري الحفظ...' : 'حفظ كل التغييرات'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'codes' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-amber-700" />
                    إنشاء أكواد الوصول
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    أنشئ كوداً لكل طالب (أو دفعة أكواد) لفتح كورسات واختبارات صفّه الدراسي بعد تفعيل الكود.
                    من هنا أيضًا: <strong>QR متابعة الطالب</strong> لولي الأمر (رمز عشوائي آمن).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadAccessCodes}
                  className="px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50"
                >
                  تحديث
                </button>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
                <div className="font-bold flex items-center gap-2 mb-1">
                  <QrCode className="w-4 h-4" />
                  QR متابعة الطالب
                </div>
                <p className="text-xs leading-relaxed text-amber-900/90">
                  عند إنشاء كود وصول يُنشأ تلقائيًا رمز متابعة فريد. من جدول الأكواد: عرض QR · تحميل PNG/PDF · طباعة · إلغاء وإنشاء جديد.
                  المسح يفتح صفحة متابعة ولي الأمر بدون تسجيل دخول. لا يظهر QR للطالب في الواجهة الرئيسية.
                </p>
              </div>

              <div className="grid lg:grid-cols-5 gap-6">
                <div className="lg:col-span-2 bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-stone-900">
                    {editingCode ? 'تعديل كود' : 'كود جديد'}
                  </h3>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">الصف الدراسي *</label>
                    <select
                      value={codeForm.grade_level}
                      onChange={(e) => setCodeForm({ ...codeForm, grade_level: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    >
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">اسم الطالب (اختياري)</label>
                    <input
                      value={codeForm.student_name}
                      onChange={(e) => setCodeForm({ ...codeForm, student_name: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                      placeholder="مثال: أحمد محمد"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">وصف / تسمية</label>
                    <input
                      value={codeForm.label}
                      onChange={(e) => setCodeForm({ ...codeForm, label: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                      placeholder="مجموعة أ / ترم أول..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">كود مخصص (اختياري)</label>
                    <input
                      value={codeForm.code}
                      onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm font-mono"
                      placeholder="اتركه فارغاً للتوليد التلقائي"
                      dir="ltr"
                    />
                  </div>
                  {!editingCode && (
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">عدد الأكواد</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={codeForm.count}
                        onChange={(e) => setCodeForm({ ...codeForm, count: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                        dir="ltr"
                      />
                      <p className="text-[11px] text-stone-400 mt-1">حتى 50 كوداً دفعة واحدة (بدون كود مخصص)</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">أقصى استخدام</label>
                      <input
                        type="number"
                        min={1}
                        value={codeForm.max_uses}
                        onChange={(e) => setCodeForm({ ...codeForm, max_uses: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">ينتهي في</label>
                      <input
                        type="date"
                        value={codeForm.expires_at}
                        onChange={(e) => setCodeForm({ ...codeForm, expires_at: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">ملاحظة</label>
                    <textarea
                      value={codeForm.note}
                      onChange={(e) => setCodeForm({ ...codeForm, note: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={codeForm.is_active !== false}
                      onChange={(e) => setCodeForm({ ...codeForm, is_active: e.target.checked })}
                    />
                    الكود مفعّل
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={saveAccessCode}
                      disabled={codesSaving}
                      className="flex-1 py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 disabled:opacity-60"
                    >
                      {codesSaving ? 'جاري الحفظ...' : editingCode ? 'حفظ التعديل' : 'إنشاء الكود'}
                    </button>
                    {editingCode && (
                      <button
                        type="button"
                        onClick={resetCodeForm}
                        className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-medium"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                      <input
                        value={codeSearch}
                        onChange={(e) => setCodeSearch(e.target.value)}
                        placeholder="بحث بالكود أو الاسم..."
                        className="w-full pr-9 pl-3 py-2 rounded-xl border border-stone-300 text-sm"
                      />
                    </div>
                    <select
                      value={codeFilterGrade}
                      onChange={(e) => setCodeFilterGrade(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                    >
                      <option value="">كل الصفوف</option>
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                  </div>

                  {codesLoading ? (
                    <LoadingSpinner text="جاري تحميل الأكواد..." />
                  ) : filteredAccessCodes.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center text-stone-500">
                      لا توجد أكواد بعد — أنشئ أول كود من النموذج
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-stone-200 bg-stone-50">
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">الكود</th>
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">الصف</th>
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">الطالب</th>
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">الاستخدام</th>
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">الحالة</th>
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">QR متابعة</th>
                            <th className="text-right px-3 py-3 font-semibold text-stone-600">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAccessCodes.map((row) => (
                            <tr key={row.id} className="border-b border-stone-100 hover:bg-stone-50/80">
                              <td className="px-3 py-3">
                                <button
                                  type="button"
                                  onClick={() => copyText(row.code)}
                                  className="font-mono font-bold text-amber-800 hover:underline"
                                  dir="ltr"
                                  title="نسخ"
                                >
                                  {row.code}
                                </button>
                                {row.label && (
                                  <div className="text-[11px] text-stone-400 mt-0.5">{row.label}</div>
                                )}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">{gradeLabel(row.grade_level)}</td>
                              <td className="px-3 py-3">{row.student_name || '—'}</td>
                              <td className="px-3 py-3 whitespace-nowrap" dir="ltr">
                                {row.used_count || 0}/{row.max_uses || 1}
                              </td>
                              <td className="px-3 py-3">
                                {row.is_active ? (
                                  <Badge green>مفعّل</Badge>
                                ) : (
                                  <Badge>موقوف</Badge>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <button
                                    type="button"
                                    disabled={qrBusy}
                                    onClick={() => openTrackQr(row)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50"
                                    title="عرض QR متابعة الطالب"
                                  >
                                    <QrCode className="w-3.5 h-3.5" />
                                    {row.track_token ? 'عرض QR' : 'إنشاء QR'}
                                  </button>
                                  {row.track_token ? (
                                    <button
                                      type="button"
                                      disabled={qrBusy}
                                      onClick={() => regenerateTrackQr(row)}
                                      className="p-1.5 rounded-lg text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                                      title="إلغاء وإنشاء QR جديد"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => editAccessCode(row)}
                                    className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-50"
                                    title="تعديل"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleAccessCode(row)}
                                    className="p-1.5 rounded-lg text-stone-600 hover:bg-stone-100"
                                    title={row.is_active ? 'إيقاف' : 'تفعيل'}
                                  >
                                    {row.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteAccessCode(row.id)}
                                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                                    title="حذف"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* QR متابعة الطالب modal — inside codes section only */}
              {qrModal?.token && (
                <div
                  className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50"
                  onClick={() => !qrBusy && setQrModal(null)}
                >
                  <div
                    className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-5 border-b border-stone-100 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-stone-900 flex items-center gap-2">
                          <QrCode className="w-5 h-5 text-amber-700" />
                          QR متابعة الطالب
                        </h3>
                        <p className="text-sm text-stone-600 mt-1">
                          {qrModal.studentName}
                          {qrModal.grade ? ` · ${gradeLabel(qrModal.grade)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQrModal(null)}
                        className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-6 flex flex-col items-center text-center">
                      <img
                        src={qrImageUrl(parentTrackUrl(qrModal.token), 280)}
                        alt="QR متابعة"
                        className="w-64 h-64 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm"
                      />
                      <p className="text-xs text-stone-500 mt-3 max-w-xs leading-relaxed">
                        رمز عشوائي آمن — لا يحتوي بيانات الطالب. المسح يفتح صفحة المتابعة لولي الأمر بدون تسجيل دخول.
                      </p>
                      <div className="grid grid-cols-2 gap-2 w-full mt-5">
                        <button
                          type="button"
                          disabled={qrBusy}
                          onClick={async () => {
                            setQrBusy(true);
                            try {
                              await downloadQrPng({
                                token: qrModal.token,
                                studentName: qrModal.studentName,
                              });
                            } catch (e) {
                              setError(e.message);
                            } finally {
                              setQrBusy(false);
                            }
                          }}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-bold hover:bg-amber-800 disabled:opacity-60"
                        >
                          <Download className="w-4 h-4" />
                          PNG
                        </button>
                        <button
                          type="button"
                          disabled={qrBusy}
                          onClick={async () => {
                            setQrBusy(true);
                            try {
                              await downloadQrPdf({
                                token: qrModal.token,
                                studentName: qrModal.studentName,
                                gradeLabel: gradeLabel(qrModal.grade),
                              });
                            } catch (e) {
                              setError(e.message);
                            } finally {
                              setQrBusy(false);
                            }
                          }}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-bold hover:bg-stone-800 disabled:opacity-60"
                        >
                          <FileDown className="w-4 h-4" />
                          PDF
                        </button>
                        <button
                          type="button"
                          disabled={qrBusy}
                          onClick={() => {
                            try {
                              printQr({
                                token: qrModal.token,
                                studentName: qrModal.studentName,
                                gradeLabel: gradeLabel(qrModal.grade),
                              });
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-stone-300 text-stone-800 text-sm font-bold hover:bg-stone-50 disabled:opacity-60"
                        >
                          <Printer className="w-4 h-4" />
                          طباعة
                        </button>
                        <button
                          type="button"
                          disabled={qrBusy}
                          onClick={() => regenerateTrackQr(qrModal.codeRow)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm font-bold hover:bg-amber-100 disabled:opacity-60"
                        >
                          <RefreshCw className="w-4 h-4" />
                          QR جديد
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={qrBusy}
                        onClick={() => revokeTrackQr(qrModal.codeRow)}
                        className="mt-3 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                      >
                        إلغاء QR الحالي
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'notifications' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-emerald-700" />
                    التنبيهات · WhatsApp
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    ربط WhatsApp Business Cloud API · تنبيهات الحصص المتراكمة لأولياء الأمور · سجل الإرسال
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    loadWhatsAppStatus();
                    loadWhatsAppLogs();
                  }}
                  disabled={waLoading || waLogsLoading}
                  className="px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  {waLoading || waLogsLoading ? 'جاري التحديث...' : 'تحديث'}
                </button>
              </div>

              {!canManageAccounts ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-950 text-sm">
                  قسم التنبيهات متاح للمشرف الكامل فقط.
                </div>
              ) : (
                <>
                  {/* Full WhatsApp config editor */}
                  <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-stone-900 flex items-center gap-2">
                          <MessageCircle className="w-5 h-5 text-emerald-700" />
                          إعدادات WhatsApp Cloud API
                        </h3>
                        <p className="text-xs text-stone-500 mt-1">
                          الـ Access Token من Secrets فقط (WHATSAPP_ACCESS_TOKEN) · لا يُعرض في الواجهة
                          {waStatus?.connected ? ' · 🟢 Connected' : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={testWhatsAppConnection}
                        disabled={waLoading}
                        className="px-3 py-1.5 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        {waLoading ? 'جاري الفحص...' : 'فحص الاتصال'}
                      </button>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                      {[
                        {
                          label: 'Token (Secrets)',
                          ok: waStatus?.token_set,
                          forceLabel: waStatus?.token_set ? 'من Secrets' : 'أضفه في Secrets',
                        },
                        { label: 'Phone Number ID', ok: waStatus?.phone_number_id_set },
                        { label: 'WABA ID', ok: waStatus?.waba_id_set },
                        {
                          label: 'تنبيه المتراكمين',
                          ok: false,
                          forceLabel: waStatus?.parent_notify_enabled ? 'مفعّل' : 'موقوف',
                        },
                      ].map((s) => (
                        <div
                          key={s.label}
                          className={`rounded-xl border px-3 py-2 font-semibold ${
                            s.label === 'تنبيه المتراكمين'
                              ? waStatus?.parent_notify_enabled
                                ? 'border-amber-200 bg-amber-50 text-amber-900'
                                : 'border-stone-200 bg-stone-50 text-stone-600'
                              : s.ok
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-amber-200 bg-amber-50 text-amber-900'
                          }`}
                        >
                          {s.label}: {s.forceLabel || (s.ok ? 'جاهز' : 'غير مضبوط')}
                        </div>
                      ))}
                    </div>

                    {waStatus?.message && (
                      <p
                        className={`text-sm font-medium ${
                          waStatus.ok ? 'text-emerald-800' : 'text-amber-900'
                        }`}
                      >
                        {waStatus.ok ? '✅ ' : '⚠️ '}
                        {waStatus.message}
                        {waStatus.display_phone_number
                          ? ` · الرقم: ${waStatus.display_phone_number}`
                          : ''}
                        {waStatus.verified_name ? ` · ${waStatus.verified_name}` : ''}
                      </p>
                    )}

                    <div
                      className={`rounded-xl border p-3 text-sm ${
                        waStatus?.connected || waStatus?.ok
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                          : 'border-amber-200 bg-amber-50 text-amber-950'
                      }`}
                    >
                      <p className="font-bold">
                        {waStatus?.connected || (waStatus?.ok && waStatus?.token_set)
                          ? '🟢 WhatsApp API Connected Successfully'
                          : 'Access Token من Secrets فقط'}
                      </p>
                      <p className="text-xs mt-1 leading-relaxed">
                        ضع System User Access Token في تبويب <strong>Secrets</strong> باسم{' '}
                        <code className="font-mono" dir="ltr">
                          WHATSAPP_ACCESS_TOKEN
                        </code>
                        . لا يُعرض ولا يُحفظ في الواجهة أو قاعدة البيانات.
                      </p>
                      <p className="text-[11px] mt-1 font-mono opacity-80" dir="ltr">
                        PHONE_NUMBER_ID: {waStatus?.phone_number_id || '1282802908249416'} · WABA:{' '}
                        {waStatus?.waba_id || '937397659416477'} · token:{' '}
                        {waStatus?.token_set ? 'set (Secrets)' : 'missing'}
                      </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">رقم اختبار افتراضي</label>
                        <input
                          value={waForm.test_to}
                          onChange={(e) => {
                            setWaForm((p) => ({ ...p, test_to: e.target.value }));
                            setWaTestTo(e.target.value);
                          }}
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm font-mono"
                          placeholder="2010xxxxxxxx"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">
                          حد الحصص المتراكمة
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={waForm.incomplete_threshold}
                          onChange={(e) =>
                            setWaForm((p) => ({ ...p, incomplete_threshold: e.target.value }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">
                          اسم قالب Meta (Template)
                        </label>
                        <input
                          value={waForm.template_name}
                          onChange={(e) => setWaForm((p) => ({ ...p, template_name: e.target.value }))}
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm font-mono"
                          placeholder="parent_backlog_alert"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">لغة القالب</label>
                        <input
                          value={waForm.template_lang}
                          onChange={(e) => setWaForm((p) => ({ ...p, template_lang: e.target.value }))}
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                          placeholder="ar"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(waForm.parent_notify_enabled)}
                          onChange={(e) =>
                            setWaForm((p) => ({ ...p, parent_notify_enabled: e.target.checked }))
                          }
                          className="rounded border-stone-300 text-emerald-700"
                        />
                        <span className="font-medium text-stone-800">تفعيل تنبيهات المتراكمين</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(waForm.allow_text_fallback)}
                          onChange={(e) =>
                            setWaForm((p) => ({ ...p, allow_text_fallback: e.target.checked }))
                          }
                          className="rounded border-stone-300 text-emerald-700"
                        />
                        <span className="font-medium text-stone-800">
                          السماح برسالة نصية إن فشل القالب
                        </span>
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={waLoading}
                        onClick={testWhatsAppConnection}
                        className="px-4 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-2"
                      >
                        <RefreshCw className={`w-4 h-4 ${waLoading ? 'animate-spin' : ''}`} />
                        {waLoading ? 'جاري الفحص...' : 'فحص اتصال WhatsApp'}
                      </button>
                      <button
                        type="button"
                        disabled={waSaving}
                        onClick={() => saveWhatsAppConfig()}
                        className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-800 text-sm font-bold hover:bg-stone-50 disabled:opacity-50 inline-flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        {waSaving ? 'جاري الحفظ...' : 'حفظ تفضيلات التنبيه'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 space-y-1">
                    <p className="font-bold">لماذا قد لا تصل الرسالة؟</p>
                    <ul className="text-xs list-disc pr-5 space-y-1 leading-relaxed">
                      <li>
                        يجب <strong>Access Token حقيقي ودائم</strong> من Meta (ليس تجريبيًا منتهيًا).
                      </li>
                      <li>
                        في وضع التطوير: رقم ولي الأمر يجب إضافته كـ <strong>Test number</strong> في Meta.
                      </li>
                      <li>
                        خارج نافذة 24 ساعة: يلزم <strong>Template معتمد</strong> — أدخل اسمه أعلاه.
                      </li>
                      <li>رقم ولي الأمر يجب أن يكون محفوظًا في ملف الطالب (ولي الأمر).</li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm space-y-3">
                    <h3 className="font-bold text-stone-900">اختبار الإرسال لرقم ولي أمر</h3>
                    <p className="text-xs text-stone-500">
                      أرسل لنفسك أولاً (رقم الاختبار) قبل تشغيل التنبيهات الجماعية.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-stone-700 mb-1">
                          رقم واتساب (ولي الأمر / اختبار)
                        </label>
                        <input
                          value={waTestTo}
                          onChange={(e) => setWaTestTo(e.target.value)}
                          placeholder="010xxxxxxxx أو 2010xxxxxxxx"
                          dir="ltr"
                          className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={sendWhatsAppTest}
                        disabled={waSending || !waStatus?.token_set}
                        className="px-4 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-2"
                      >
                        <MessageCircle className="w-4 h-4" />
                        {waSending ? 'جاري الإرسال...' : 'رسالة اختبار بسيطة'}
                      </button>
                      <button
                        type="button"
                        disabled={waSending || !waStatus?.token_set}
                        onClick={async () => {
                          setWaSending(true);
                          setWaTestResult(null);
                          setError('');
                          try {
                            const res = await apiFetch('/api/whatsapp', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'send_parent_sample',
                                to: (waTestTo || waForm.test_to || '').trim() || undefined,
                                student_name: 'طالب تجريبي',
                                incomplete_count: Number(waForm.incomplete_threshold) || 2,
                              }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.error || 'فشل إرسال نموذج التنبيه');
                            setWaTestResult({ ok: true, ...data });
                          } catch (e) {
                            setWaTestResult({ ok: false, error: e.message });
                            setError(e.message);
                          } finally {
                            setWaSending(false);
                          }
                        }}
                        className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-bold hover:bg-stone-800 disabled:opacity-50"
                      >
                        نموذج تنبيه ولي الأمر
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm space-y-3">
                    <h3 className="font-bold text-stone-900">تنبيهات الحصص المتراكمة (جماعي)</h3>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      عند وجود <strong>{waForm.incomplete_threshold || 2} حصص غير مكتملة أو أكثر</strong> يُرسل
                      واتساب لولي الأمر. التهدئة 24 ساعة فقط بعد <strong>نجاح</strong> الإرسال.
                      {!waStatus?.token_set && (
                        <span className="block mt-1 text-amber-800 font-semibold">
                          ⚠ احفظ Access Token حقيقي أعلاه أولاً — الإرسال لن يعمل بدونه.
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={waSending}
                        onClick={async () => {
                          setWaSending(true);
                          setWaTestResult(null);
                          try {
                            const res = await apiFetch('/api/cron-parent-notify', {
                              method: 'POST',
                              body: JSON.stringify({ dry_run: true }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.error || `فشل الفحص (${res.status})`);
                            const sample = Array.isArray(data.sample)
                              ? data.sample
                                  .map(
                                    (s) =>
                                      `${s.student_name}(${s.incomplete}${s.has_phone ? '' : ' بلا رقم'})`
                                  )
                                  .join(' · ')
                              : '';
                            setWaTestResult({
                              ok: true,
                              message:
                                (data.message ||
                                  `فحص جاف: متراكمون ${data.eligible || 0} · بدون رقم ${data.skipped_no_phone || 0}`) +
                                (sample ? ` | ${sample}` : ''),
                              to: 'dry_run',
                            });
                          } catch (e) {
                            setWaTestResult({ ok: false, error: e.message });
                          } finally {
                            setWaSending(false);
                          }
                        }}
                        className="px-3 py-2 rounded-xl border border-stone-300 text-xs font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        فحص المتراكمين (بدون إرسال)
                      </button>
                      <button
                        type="button"
                        disabled={waSending || !waStatus?.token_set}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'تشغيل إرسال تنبيهات المتراكمين الآن لأولياء الأمور؟\nتأكد أن الـ Token صالح وأن الأرقام مسموحة في Meta.'
                            )
                          )
                            return;
                          setWaSending(true);
                          setWaTestResult(null);
                          try {
                            const res = await apiFetch('/api/cron-parent-notify', {
                              method: 'POST',
                              body: JSON.stringify({}),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.error || `فشل التشغيل (${res.status})`);
                            const ok = Number(data.sent || 0) > 0 || Number(data.failed || 0) === 0;
                            setWaTestResult({
                              ok,
                              message:
                                data.message ||
                                `أُرسل ${data.sent || 0} · فشل ${data.failed || 0} · بدون رقم ${data.skipped_no_phone || 0} · تهدئة ${data.skipped_cooldown || 0}`,
                              error: !ok ? data.message || data.last_error : undefined,
                              to: 'job',
                            });
                            await loadWhatsAppLogs();
                          } catch (e) {
                            setWaTestResult({ ok: false, error: e.message });
                          } finally {
                            setWaSending(false);
                          }
                        }}
                        className="px-3 py-2 rounded-xl bg-emerald-800 text-white text-xs font-bold hover:bg-emerald-900 disabled:opacity-50"
                      >
                        تشغيل التنبيهات الآن (إرسال فعلي)
                      </button>
                    </div>

                    {waTestResult && (
                      <div
                        className={`rounded-xl border p-3 text-sm ${
                          waTestResult.ok
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : 'border-red-200 bg-red-50 text-red-700'
                        }`}
                      >
                        {waTestResult.ok ? (
                          <>
                            <div className="font-bold">
                              {waTestResult.message || 'تم بنجاح'}
                            </div>
                            {waTestResult.to && waTestResult.to !== 'dry_run' && waTestResult.to !== 'job' ? (
                              <div className="text-xs mt-1" dir="ltr">
                                to: {waTestResult.to}
                                {waTestResult.message_id ? ` · id: ${waTestResult.message_id}` : ''}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="font-medium whitespace-pre-wrap">
                            {waTestResult.error || waTestResult.message}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-stone-100 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-stone-900">سجل التنبيهات</h3>
                        <p className="text-xs text-stone-500 mt-0.5">
                          آخر المحاولات من قاعدة البيانات (parent_notify_logs)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={loadWhatsAppLogs}
                        disabled={waLogsLoading}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 hover:bg-stone-50"
                      >
                        {waLogsLoading ? '...' : 'تحديث السجل'}
                      </button>
                    </div>
                    {waLogsLoading ? (
                      <LoadingSpinner text="جاري تحميل السجل..." />
                    ) : waLogs.length === 0 ? (
                      <div className="p-10 text-center text-stone-500 text-sm">لا توجد سجلات بعد</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-stone-50 text-stone-600">
                            <tr>
                              <th className="text-right font-semibold px-3 py-3">الوقت</th>
                              <th className="text-right font-semibold px-3 py-3">الطالب</th>
                              <th className="text-right font-semibold px-3 py-3">ولي الأمر</th>
                              <th className="text-right font-semibold px-3 py-3">المتراكم</th>
                              <th className="text-right font-semibold px-3 py-3">الحالة</th>
                              <th className="text-right font-semibold px-3 py-3">ملاحظة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {waLogs.map((row) => (
                              <tr key={row.id} className="border-t border-stone-100">
                                <td className="px-3 py-2 text-xs text-stone-500 whitespace-nowrap">
                                  {row.created_at
                                    ? new Date(row.created_at).toLocaleString('ar-EG')
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 font-medium text-stone-900">
                                  {row.student_name || '—'}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                                  {row.parent_phone || '—'}
                                </td>
                                <td className="px-3 py-2 font-bold tabular-nums">
                                  {row.incomplete_count ?? '—'}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-flex px-2 py-0.5 rounded-md text-xs font-bold ${
                                      row.status === 'success'
                                        ? 'bg-emerald-50 text-emerald-800'
                                        : row.status === 'failed'
                                          ? 'bg-red-50 text-red-700'
                                          : row.status === 'dry_run'
                                            ? 'bg-stone-100 text-stone-700'
                                            : 'bg-amber-50 text-amber-900'
                                    }`}
                                  >
                                    {row.status || '—'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs text-stone-500 max-w-[220px] truncate">
                                  {row.error_message || row.channel || row.message_id || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'accounts' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                    <UserCog className="w-5 h-5 text-amber-700" />
                    إعداد الحسابات
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    عدّل بيانات حسابك، وأنشئ مشرفين جدد مع تحديد الصلاحيات — القسم محمي برقم سري
                  </p>
                </div>
                {accountsUnlocked && (
                  <button
                    type="button"
                    onClick={lockAccountsSection}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold hover:bg-stone-50"
                  >
                    <Lock className="w-4 h-4" />
                    قفل القسم
                  </button>
                )}
              </div>

              {!canManageAccounts ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-900 text-sm">
                  هذا القسم متاح للمشرف ذي الإدارة الكاملة فقط.
                </div>
              ) : !accountsUnlocked ? (
                <div className="max-w-md bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-stone-900 text-white flex items-center justify-center">
                    <KeyRound className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-lg">أدخل الرقم السري</h3>
                    <p className="text-sm text-stone-500 mt-1">لفتح قسم إعداد الحسابات أدخل الرقم السري الخاص</p>
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={accountsPinInput}
                    onChange={(e) => setAccountsPinInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') unlockAccounts(); }}
                    placeholder="الرقم السري"
                    className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={unlockAccounts}
                    disabled={accountsLoading || !accountsPinInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 disabled:opacity-60"
                  >
                    {accountsLoading ? 'جاري التحقق...' : 'فتح القسم'}
                  </button>
                </div>
              ) : (
                <>
                  {/* Current admin profile */}
                  <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-stone-200 bg-gradient-to-l from-stone-900 to-stone-800 text-white">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-amber-600 flex items-center justify-center font-black text-lg">
                          {(profile?.full_name || 'A').charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg">حساب المشرف الحالي</h3>
                          <p className="text-sm text-stone-300" dir="ltr">{profile?.email || user?.email}</p>
                        </div>
                        <span className="mr-auto px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-200 text-xs font-bold">
                          {roleLabel(profile?.role)}
                        </span>
                      </div>
                    </div>
                    <div className="p-5 grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">الاسم الظاهر</label>
                        <input
                          type="text"
                          value={myAccountForm.full_name}
                          onChange={(e) => setMyAccountForm((p) => ({ ...p, full_name: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                          placeholder="اسمك"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">البريد الإلكتروني</label>
                        <div className="px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-sm text-stone-600" dir="ltr">
                          {profile?.email || user?.email || '—'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">كلمة مرور جديدة (اختياري)</label>
                        <input
                          type="password"
                          value={myAccountForm.password}
                          onChange={(e) => setMyAccountForm((p) => ({ ...p, password: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                          dir="ltr"
                          placeholder="اتركها فارغة إن لم ترد التغيير"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">تأكيد كلمة المرور</label>
                        <input
                          type="password"
                          value={myAccountForm.password2}
                          onChange={(e) => setMyAccountForm((p) => ({ ...p, password2: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                          dir="ltr"
                          placeholder="أعد كتابة كلمة المرور"
                        />
                      </div>
                      <div className="md:col-span-2 flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={saveMyAccount}
                          disabled={myAccountSaving}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                        >
                          <Save className="w-4 h-4" />
                          {myAccountSaving ? 'جاري الحفظ...' : 'حفظ بياناتي'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid lg:grid-cols-5 gap-6">
                    {/* Create / Edit staff form */}
                    <div className="lg:col-span-3 bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Shield className="w-5 h-5 text-amber-700" />
                          <h3 className="font-bold text-stone-900">
                            {editingAccount ? 'تعديل حساب مشرف' : 'إنشاء حساب مشرف جديد'}
                          </h3>
                        </div>
                        {editingAccount && (
                          <button
                            type="button"
                            onClick={resetAccountForm}
                            className="text-xs font-semibold text-stone-500 hover:text-stone-800"
                          >
                            + حساب جديد
                          </button>
                        )}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-medium text-stone-700 mb-1">الاسم الكامل</label>
                          <input
                            type="text"
                            value={accountForm.full_name}
                            onChange={(e) => setAccountForm((p) => ({ ...p, full_name: e.target.value }))}
                            className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                            placeholder="اسم المشرف"
                          />
                        </div>

                        {!editingAccount ? (
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-stone-700 mb-1">البريد الإلكتروني</label>
                            <input
                              type="email"
                              value={accountForm.email}
                              onChange={(e) => setAccountForm((p) => ({ ...p, email: e.target.value }))}
                              className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                              dir="ltr"
                              placeholder="admin@example.com"
                            />
                          </div>
                        ) : (
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-stone-700 mb-1">البريد</label>
                            <div className="px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-sm" dir="ltr">
                              {editingAccount.email}
                            </div>
                          </div>
                        )}

                        <div className="sm:col-span-2">
                          <label className="block text-sm font-medium text-stone-700 mb-1">
                            {editingAccount ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}
                          </label>
                          <input
                            type="password"
                            value={accountForm.password}
                            onChange={(e) => setAccountForm((p) => ({ ...p, password: e.target.value }))}
                            className="w-full px-3 py-2.5 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-600 text-sm"
                            dir="ltr"
                            placeholder={editingAccount ? 'اتركها فارغة للإبقاء على الحالية' : '6 أحرف على الأقل'}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-2">الدور والصلاحيات</label>
                        <div className="space-y-2">
                          {ROLE_OPTIONS.map((r) => {
                            const selected = accountForm.role === r.value;
                            return (
                              <label
                                key={r.value}
                                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                  selected
                                    ? 'border-amber-500 bg-amber-50 shadow-sm'
                                    : 'border-stone-200 bg-white hover:border-stone-300'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="staff-role"
                                  value={r.value}
                                  checked={selected}
                                  onChange={() => setAccountForm((p) => ({ ...p, role: r.value }))}
                                  className="mt-1 accent-amber-700"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-stone-900 text-sm">{r.label}</div>
                                  <div className="text-xs text-stone-600 mt-0.5 leading-relaxed">{r.description}</div>
                                  {r.permissions?.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                      {r.permissions.map((p) => (
                                        <span
                                          key={p}
                                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                                            selected ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-600'
                                          }`}
                                        >
                                          {p}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1 border-t border-stone-100">
                        <button
                          type="button"
                          onClick={saveAccount}
                          disabled={accountSaving}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800 disabled:opacity-60"
                        >
                          {editingAccount ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          {accountSaving ? 'جاري الحفظ...' : editingAccount ? 'حفظ التعديلات' : 'إضافة مشرف'}
                        </button>
                        {editingAccount && (
                          <button
                            type="button"
                            onClick={resetAccountForm}
                            className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-700 text-sm font-medium hover:bg-stone-50"
                          >
                            إلغاء
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Roles guide */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                      <h3 className="font-bold text-stone-900 mb-1 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-amber-700" />
                        دليل الصلاحيات
                      </h3>
                      <p className="text-xs text-stone-500 mb-4">اختر الدور المناسب لكل مشرف حسب مهامه</p>
                      <div className="space-y-3">
                        {ROLE_OPTIONS.map((r) => (
                          <div key={r.value} className="p-3 rounded-xl border border-stone-200 bg-stone-50">
                            <div className="font-semibold text-stone-900 text-sm">{r.label}</div>
                            <div className="text-xs text-stone-600 mt-1 leading-relaxed">{r.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Staff accounts table */}
                  <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
                      <h3 className="font-bold text-stone-900">حسابات المشرفين ({staffAccounts.length})</h3>
                      <button
                        type="button"
                        onClick={() => loadStaffAccounts().catch((e) => setError(e.message))}
                        className="text-xs font-semibold text-amber-800 hover:underline"
                      >
                        تحديث القائمة
                      </button>
                    </div>
                    {staffAccounts.length === 0 ? (
                      <div className="p-8 text-center text-stone-500 text-sm">لا توجد حسابات مشرفين بعد — أنشئ أول حساب من النموذج أعلاه</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-stone-50 text-stone-600">
                              <th className="text-right px-4 py-3 font-semibold">الاسم</th>
                              <th className="text-right px-4 py-3 font-semibold">البريد</th>
                              <th className="text-right px-4 py-3 font-semibold">الدور</th>
                              <th className="text-right px-4 py-3 font-semibold">الصلاحيات</th>
                              <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staffAccounts.map((acc) => (
                              <tr key={acc.id} className={`border-t border-stone-100 ${editingAccount?.id === acc.id ? 'bg-amber-50/40' : ''}`}>
                                <td className="px-4 py-3">
                                  <div className="font-medium text-stone-900">{acc.full_name || '—'}</div>
                                  {acc.id === user?.id && (
                                    <span className="text-[11px] text-amber-800 font-semibold">أنت</span>
                                  )}
                                </td>
                                <td className="px-4 py-3" dir="ltr">{acc.email}</td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex px-2 py-1 rounded-lg bg-amber-50 text-amber-900 text-xs font-semibold">
                                    {roleLabel(acc.role)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-stone-500 max-w-[200px]">
                                  {roleDescription(acc.role) || '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => startEditAccount(acc)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-amber-800 bg-amber-50 hover:bg-amber-100 text-xs font-semibold"
                                      title="تعديل"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                      تعديل
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeStaffAccess(acc)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-red-600 bg-red-50 hover:bg-red-100 text-xs font-semibold disabled:opacity-40"
                                      title="إزالة صلاحيات المشرف"
                                      disabled={acc.id === user?.id}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      إزالة
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto ${modal.type === 'course' || modal.type === 'lesson' ? 'max-w-3xl' : 'max-w-lg'}`}
            ref={(el) => {
              if (el && (modal.type === 'course' || modal.type === 'lesson')) {
                // Scroll media section into view shortly after open
                setTimeout(() => {
                  const target = el.querySelector('#course-media-section, #lesson-media-section');
                  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 180);
              }
            }}
          >
            <div className="flex items-center justify-between p-5 border-b border-stone-200 sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-bold text-lg text-stone-900">
                  {modal.mode === 'create' ? 'إضافة' : 'تعديل'}{' '}
                  {{ course: 'كورس', lesson: 'درس', quiz: 'اختبار', question: 'سؤال' }[modal.type]}
                </h3>
                {(modal.type === 'course' || modal.type === 'lesson') && (
                  <p className="text-xs text-amber-800 mt-0.5 font-medium">
                    قسم الوسائط: صورة · فيديو · رابط خارجي — أسفل النموذج
                  </p>
                )}
              </div>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-stone-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">{renderModalFields()}</div>
            <div className="flex gap-2 p-5 border-t border-stone-200 sticky bottom-0 bg-white">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-700 text-white font-semibold hover:bg-amber-800 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
              <button onClick={closeModal} className="px-5 py-2.5 rounded-xl border border-stone-300 text-stone-600 font-medium hover:bg-stone-100">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, onAdd, addLabel, filter, children }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-stone-900">{title}</h2>
        <div className="flex items-center gap-2">
          {filter}
          {onAdd && (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
            >
              <Plus className="w-4 h-4" />
              {addLabel}
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function Table({ headers, rows }) {
  if (!rows.length) {
    return <div className="text-center py-12 text-stone-500 bg-white rounded-2xl border border-stone-200">لا توجد بيانات</div>;
  }
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-100/80">
            {headers.map((h) => (
              <th key={h} className="text-right px-4 py-3 font-semibold text-stone-600 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-stone-100 hover:bg-stone-100/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-stone-700 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Actions({ onEdit, onDelete, onMedia }) {
  return (
    <div className="flex items-center gap-1">
      {onMedia && (
        <button
          onClick={onMedia}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 hover:bg-amber-200"
          title="إدارة الوسائط"
        >
          <Video className="w-3.5 h-3.5" />
          وسائط
        </button>
      )}
      <button onClick={onEdit} className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-50" title="تعديل">
        <Pencil className="w-4 h-4" />
      </button>
      <button onClick={onDelete} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="حذف">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function Badge({ children, green }) {
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
      green ? 'bg-yellow-100 text-yellow-900' : 'bg-stone-200 text-stone-600'
    }`}>
      {children}
    </span>
  );
}
