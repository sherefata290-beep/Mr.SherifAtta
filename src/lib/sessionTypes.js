/** Lesson session delivery types + attendance settings helpers */

export const SESSION_TYPES = {
  RECORDED_VIDEO: 'recorded_video',
  EXTERNAL_LINK: 'external_link',
};

export const SESSION_TYPE_OPTIONS = [
  {
    value: SESSION_TYPES.RECORDED_VIDEO,
    label: '🎥 فيديو مسجل داخل المنصة',
    shortLabel: 'فيديو مسجل',
    description: 'يتابع الطالب الفيديو داخل المنصة ويُحتسب الحضور حسب نسبة المشاهدة الفعلية (بدون احتساب التقديم للأمام)',
  },
  {
    value: SESSION_TYPES.EXTERNAL_LINK,
    label: '🔗 رابط خارجي',
    shortLabel: 'رابط خارجي',
    description:
      'يفتح الطالب رابطًا خارجيًا (يوتيوب/درايف/…) ويُحتسب وقت جلسة المتابعة على المنصة — دون معرفة نسبة مشاهدة الفيديو الخارجي',
  },
];

/** Safe defaults — used when a lesson has no custom attendance settings yet */
export const DEFAULT_ATTENDANCE_SETTINGS = {
  session_type: SESSION_TYPES.RECORDED_VIDEO,
  video_duration_minutes: 0,
  /** Default required honest watch percent for internal videos */
  required_watch_percent: 85,
  /** Default required external follow-up session duration: 30 minutes */
  external_required_seconds: 30 * 60,
  linked_quiz_id: '',
  session_points: 0,
};

export function normalizeSessionType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === SESSION_TYPES.EXTERNAL_LINK || v === 'external' || v === 'link') {
    return SESSION_TYPES.EXTERNAL_LINK;
  }
  if (v === SESSION_TYPES.RECORDED_VIDEO || v === 'video' || v === 'recorded') {
    return SESSION_TYPES.RECORDED_VIDEO;
  }
  return '';
}

export function sessionTypeLabel(value) {
  const n = normalizeSessionType(value);
  return SESSION_TYPE_OPTIONS.find((o) => o.value === n)?.shortLabel || 'غير محدد';
}

export function sessionTypeFullLabel(value) {
  const n = normalizeSessionType(value);
  return SESSION_TYPE_OPTIONS.find((o) => o.value === n)?.label || 'غير محدد';
}

/** Infer session type from lesson media when not explicitly set */
export function inferSessionTypeFromMedia(media = []) {
  const list = Array.isArray(media) ? media : [];
  const hasVideo = list.some((m) => {
    const t = String(m?.media_type || '').toLowerCase();
    return t === 'video' || /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(String(m?.url || ''));
  });
  const hasExternal = list.some((m) => String(m?.media_type || '').toLowerCase() === 'external');
  if (hasVideo && !hasExternal) return SESSION_TYPES.RECORDED_VIDEO;
  if (hasExternal && !hasVideo) return SESSION_TYPES.EXTERNAL_LINK;
  if (hasVideo) return SESSION_TYPES.RECORDED_VIDEO;
  if (hasExternal) return SESSION_TYPES.EXTERNAL_LINK;
  return SESSION_TYPES.RECORDED_VIDEO;
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Normalize attendance settings from API/form without wiping missing fields.
 * Existing lessons without settings keep sensible defaults.
 */
export function normalizeAttendanceSettings(input = {}, media = []) {
  const src = input && typeof input === 'object' ? input : {};
  const inferred = inferSessionTypeFromMedia(media);
  const session_type =
    normalizeSessionType(src.session_type) ||
    inferred ||
    DEFAULT_ATTENDANCE_SETTINGS.session_type;

  return {
    session_type,
    video_duration_minutes: clampInt(
      src.video_duration_minutes,
      0,
      24 * 60,
      DEFAULT_ATTENDANCE_SETTINGS.video_duration_minutes
    ),
    required_watch_percent: clampInt(
      src.required_watch_percent,
      1,
      100,
      DEFAULT_ATTENDANCE_SETTINGS.required_watch_percent
    ),
    external_required_seconds: clampInt(
      src.external_required_seconds,
      0,
      24 * 60 * 60,
      DEFAULT_ATTENDANCE_SETTINGS.external_required_seconds
    ),
    linked_quiz_id:
      src.linked_quiz_id === '' || src.linked_quiz_id == null
        ? ''
        : Number(src.linked_quiz_id) || '',
    session_points: clampInt(
      src.session_points,
      0,
      100000,
      DEFAULT_ATTENDANCE_SETTINGS.session_points
    ),
  };
}

export function resolveLessonSessionType(lesson) {
  const settings = normalizeAttendanceSettings(lesson || {}, lesson?.media);
  return settings.session_type;
}

export function getLessonAttendanceSettings(lesson) {
  return normalizeAttendanceSettings(lesson || {}, lesson?.media);
}

/** @deprecated use required_watch_percent from lesson settings */
export const VIDEO_COMPLETE_PERCENT = DEFAULT_ATTENDANCE_SETTINGS.required_watch_percent;

export function formatDurationSeconds(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r} ث`;
  return `${m} د${r ? ` ${r} ث` : ''}`;
}

/**
 * Canonical lesson attendance/session statuses (student-facing).
 * Students cannot set these manually — only automatic tracking updates them.
 */
export const LESSON_SESSION_STATUS = {
  not_started: {
    key: 'not_started',
    label: 'لم تبدأ',
    emoji: '🔴',
    fullLabel: '🔴 لم تبدأ',
    className: 'bg-red-100 text-red-800 border border-red-200',
    dot: 'bg-red-500',
  },
  in_progress: {
    key: 'in_progress',
    label: 'قيد المتابعة',
    emoji: '🟡',
    fullLabel: '🟡 قيد المتابعة',
    className: 'bg-amber-100 text-amber-900 border border-amber-200',
    dot: 'bg-amber-400',
  },
  stopped: {
    key: 'stopped',
    label: 'متوقفة',
    emoji: '⚠️',
    fullLabel: '⚠️ متوقفة',
    className: 'bg-orange-100 text-orange-900 border border-orange-200',
    dot: 'bg-orange-500',
  },
  completed: {
    key: 'completed',
    label: 'مكتملة',
    emoji: '🟢',
    fullLabel: '🟢 مكتملة',
    className: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    dot: 'bg-emerald-500',
  },
};

/** @deprecated use LESSON_SESSION_STATUS */
export const VIDEO_SESSION_STATUS = {
  not_started: LESSON_SESSION_STATUS.not_started,
  in_progress: LESSON_SESSION_STATUS.in_progress,
  eligible: {
    ...LESSON_SESSION_STATUS.in_progress,
    key: 'eligible',
    label: 'قيد المتابعة',
    fullLabel: '🟡 قيد المتابعة',
  },
  idle: LESSON_SESSION_STATUS.stopped,
  paused: LESSON_SESSION_STATUS.stopped,
  stopped: LESSON_SESSION_STATUS.stopped,
  completed: LESSON_SESSION_STATUS.completed,
};

/**
 * Resolve display status from tracking signals.
 * Priority: completed > stopped (idle/hidden) > in_progress > not_started
 */
export function resolveLessonSessionStatus({
  completed = false,
  progressPercent = 0,
  requiredPercent = 85,
  activeSeconds = 0,
  requiredSeconds = 0,
  isIdle = false,
  isStopped = false,
  isCounting = false,
  hasStarted = false,
  sessionStatus = '',
} = {}) {
  const raw = String(sessionStatus || '').toLowerCase();
  if (completed || raw === 'completed') return LESSON_SESSION_STATUS.completed;

  const started =
    hasStarted ||
    progressPercent > 0 ||
    activeSeconds > 0 ||
    ['in_progress', 'idle', 'paused', 'stopped', 'eligible'].includes(raw);

  if (!started) return LESSON_SESSION_STATUS.not_started;

  // Stopped: idle / tab hidden / explicitly paused — only while not completed
  if (
    isIdle ||
    isStopped ||
    raw === 'idle' ||
    raw === 'paused' ||
    raw === 'stopped' ||
    (started && isCounting === false && raw !== 'in_progress' && progressPercent < 100 && activeSeconds > 0 && !completed)
  ) {
    // If actively counting, prefer in_progress even if briefly flagged
    if (isCounting && !isIdle) return LESSON_SESSION_STATUS.in_progress;
    // If no pause signals and still progressing via percent only
    if (!isIdle && !isStopped && !['idle', 'paused', 'stopped'].includes(raw) && progressPercent > 0) {
      return LESSON_SESSION_STATUS.in_progress;
    }
    if (isIdle || isStopped || ['idle', 'paused', 'stopped'].includes(raw)) {
      return LESSON_SESSION_STATUS.stopped;
    }
  }

  // Eligible threshold still shows as in_progress until auto-completed
  if (requiredPercent > 0 && progressPercent >= requiredPercent) {
    return LESSON_SESSION_STATUS.in_progress;
  }
  if (requiredSeconds > 0 && activeSeconds >= requiredSeconds) {
    return LESSON_SESSION_STATUS.in_progress;
  }

  return LESSON_SESSION_STATUS.in_progress;
}

/** @deprecated use resolveLessonSessionStatus */
export function resolveVideoSessionStatus(args = {}) {
  return resolveLessonSessionStatus({
    completed: args.completed,
    progressPercent: args.progressPercent,
    requiredPercent: args.requiredPercent,
    hasStarted: (args.progressPercent || 0) > 0,
  });
}

export function sessionStatusFromAttendanceRow(row = {}) {
  const completed =
    row.tracking_completed ||
    row.status === 'completed' ||
    row.session_status === 'completed' ||
    row.completed === true;
  return resolveLessonSessionStatus({
    completed,
    progressPercent: Number(row.progress_percent || 0),
    activeSeconds: Number(row.active_seconds || row.watched_seconds || 0),
    sessionStatus: row.session_status,
    isIdle: row.session_status === 'idle',
    isStopped: row.session_status === 'paused' || row.session_status === 'stopped',
    hasStarted:
      Number(row.progress_percent || 0) > 0 ||
      Number(row.active_seconds || 0) > 0 ||
      row.status === 'present' ||
      Boolean(row.session_started_at),
  });
}
