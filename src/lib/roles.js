export const STAFF_ROLES = ['admin', 'users', 'reports', 'content', 'exams', 'curriculum', 'support'];

/** Canonical role options shown in UI */
export const ROLE_OPTIONS = [
  {
    value: 'admin',
    label: 'الإدارة الكاملة',
    description: 'صلاحية كاملة على المنصة: المحتوى، الطلاب، الاختبارات، النتائج، وإعداد الحسابات',
    permissions: ['كل الأقسام', 'إعداد الحسابات', 'إنشاء مشرفين'],
  },
  {
    value: 'curriculum',
    label: 'إدارة المناهج',
    description: 'إدارة أقسام الكورسات والدروس والاختبارات والأسئلة معًا',
    permissions: ['الكورسات', 'الدروس', 'الاختبارات', 'الأسئلة', 'نظرة عامة'],
  },
  {
    value: 'users',
    label: 'إدارة المستخدمين',
    description: 'إدارة حسابات الطلاب ومتابعة بياناتهم ونتائجهم',
    permissions: ['الطلاب', 'النتائج', 'منصة الأوائل', 'الحضور والمتابعة', 'إنشاء الأكواد', 'التنبيهات', 'نظرة عامة'],
  },
  {
    value: 'reports',
    label: 'عرض التقارير فقط',
    description: 'عرض الإحصائيات ونتائج الاختبارات دون تعديل المحتوى',
    permissions: ['نظرة عامة', 'النتائج', 'منصة الأوائل', 'الحضور والمتابعة'],
  },
  {
    value: 'content',
    label: 'إدارة المحتوى',
    description: 'الكورسات والدروس والوسائط وذيل الموقع',
    permissions: ['الكورسات', 'الدروس', 'الذيل'],
  },
  {
    value: 'exams',
    label: 'إدارة الاختبارات',
    description: 'إنشاء الاختبارات والأسئلة ومتابعة النتائج',
    permissions: ['الاختبارات', 'الأسئلة', 'النتائج'],
  },
];

/** Tabs each role can open in admin panel */
export const ROLE_TABS = {
  admin: ['dashboard', 'courses', 'lessons', 'quizzes', 'questions', 'students', 'results', 'leaderboard', 'attendance', 'codes', 'notifications', 'footer', 'accounts'],
  curriculum: ['dashboard', 'courses', 'lessons', 'quizzes', 'questions'],
  users: ['dashboard', 'students', 'results', 'leaderboard', 'attendance', 'codes', 'notifications'],
  // legacy alias
  support: ['dashboard', 'students', 'results', 'leaderboard', 'attendance', 'codes', 'notifications'],
  reports: ['dashboard', 'results', 'leaderboard', 'attendance'],
  content: ['dashboard', 'courses', 'lessons', 'footer'],
  exams: ['dashboard', 'quizzes', 'questions', 'results'],
};

export function isStaffRole(role) {
  return STAFF_ROLES.includes(String(role || '').toLowerCase());
}

export function isFullAdmin(role) {
  return String(role || '').toLowerCase() === 'admin';
}

export function roleLabel(role) {
  const key = String(role || '').toLowerCase();
  if (key === 'support') return 'إدارة المستخدمين';
  return ROLE_OPTIONS.find((r) => r.value === key)?.label || (key === 'student' ? 'طالب' : role || '—');
}

export function roleDescription(role) {
  const key = String(role || '').toLowerCase();
  const mapped = key === 'support' ? 'users' : key;
  return ROLE_OPTIONS.find((r) => r.value === mapped)?.description || '';
}

export function tabsForRole(role) {
  const key = String(role || '').toLowerCase();
  return ROLE_TABS[key] || ROLE_TABS.admin;
}

/** Normalize legacy support → users when displaying/saving preferences */
export function normalizeStaffRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'support') return 'users';
  return r;
}
