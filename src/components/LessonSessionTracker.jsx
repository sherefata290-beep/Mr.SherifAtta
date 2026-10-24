import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, PlayCircle, Link2, Loader2, ClipboardList, Award, Clock3 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { getVideoEmbedUrl, isDirectVideoUrl } from '../lib/media';
import {
  SESSION_TYPES,
  getLessonAttendanceSettings,
  sessionTypeFullLabel,
  formatDurationSeconds,
  resolveLessonSessionStatus,
  DEFAULT_ATTENDANCE_SETTINGS,
} from '../lib/sessionTypes';
import { createVideoWatchTracker, formatWatchTime } from '../lib/videoWatchTracker';
import {
  createExternalSessionClock,
  formatSessionClock,
  DEFAULT_EXTERNAL_REQUIRED_SECONDS,
} from '../lib/externalSessionTracker';

function pickPrimaryMedia(lesson, sessionType) {
  const media = Array.isArray(lesson?.media) ? lesson.media : [];
  if (sessionType === SESSION_TYPES.RECORDED_VIDEO) {
    return (
      media.find((m) => String(m.media_type).toLowerCase() === 'video') ||
      media.find((m) => isDirectVideoUrl(m.url)) ||
      media.find((m) => String(m.media_type).toLowerCase() === 'external' && getVideoEmbedUrl(m.url)) ||
      null
    );
  }
  return (
    media.find((m) => String(m.media_type).toLowerCase() === 'external') ||
    media.find((m) => String(m.media_type).toLowerCase() === 'video') ||
    media[0] ||
    null
  );
}

async function reportProgress(payload) {
  const res = await apiFetch('/api/attendance', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل تحديث المتابعة');
  return data;
}

/**
 * Session-type-aware attendance tracking for a lesson.
 * Recorded video uses honest watch ranges (seeking forward does not count).
 */
export default function LessonSessionTracker({
  lesson,
  disabled = false,
  alreadyCompleted = false,
  onCompleted,
  onProgress,
  /** Called after student presses «إكمال الحصة» successfully — advance to next step */
  onAdvance,
  /**
   * When false (default for merged media UI), do not render a second video/player.
   * Tracking attaches to the lesson media video via data-lesson-track-video="{lessonId}".
   */
  showMediaPlayer = false,
}) {
  const navigate = useNavigate();
  const settings = useMemo(() => getLessonAttendanceSettings(lesson), [lesson]);
  const sessionType = settings.session_type;
  const requiredWatchPercent = settings.required_watch_percent || 85;
  const externalRequiredSeconds =
    settings.external_required_seconds ||
    DEFAULT_ATTENDANCE_SETTINGS.external_required_seconds ||
    DEFAULT_EXTERNAL_REQUIRED_SECONDS;
  const videoDurationMinutes = settings.video_duration_minutes || 0;
  const sessionPoints = settings.session_points || 0;
  const linkedQuizId = settings.linked_quiz_id || '';

  const primary = useMemo(() => pickPrimaryMedia(lesson, sessionType), [lesson, sessionType]);
  const videoRef = useRef(null);
  const trackerRef = useRef(null);
  const externalClockRef = useRef(null);
  const lastSentRef = useRef({ percent: -1, at: 0 });
  const externalLastSentRef = useRef({ active: -1, at: 0 });
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const externalSessionIdRef = useRef(null);

  const [percent, setPercent] = useState(0);
  const [watchedSeconds, setWatchedSeconds] = useState(0);
  const [lastPosition, setLastPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState(alreadyCompleted ? 'completed' : 'not_started');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [externalElapsed, setExternalElapsed] = useState(0);
  const [externalEligible, setExternalEligible] = useState(0);
  const [externalCounting, setExternalCounting] = useState(false);
  const [externalIdle, setExternalIdle] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState('');
  const [pointsAwarded, setPointsAwarded] = useState(0);
  const [videoPaused, setVideoPaused] = useState(false);

  // Attendance requirement met (not the same as lesson marked completed).
  // Quiz score is never required for attendance.
  const attendanceRequirementMet =
    alreadyCompleted ||
    status === 'completed' ||
    status === 'eligible' ||
    (sessionType === SESSION_TYPES.RECORDED_VIDEO && percent >= requiredWatchPercent) ||
    (sessionType === SESSION_TYPES.EXTERNAL_LINK &&
      (externalRequiredSeconds <= 0
        ? externalElapsed > 0
        : externalElapsed >= externalRequiredSeconds));

  // Unified automatic status — never chosen manually by the student
  const statusMeta = useMemo(() => {
    if (status === 'eligible') {
      // Keep yellow "in progress" family until student presses complete; show clear label via message
      return resolveLessonSessionStatus({
        completed: false,
        progressPercent: Math.max(percent, 1),
        hasStarted: true,
        sessionStatus: 'in_progress',
      });
    }
    if (sessionType === SESSION_TYPES.EXTERNAL_LINK) {
      // Continuous timer — never "stopped" for idle/tab hide
      return resolveLessonSessionStatus({
        completed: status === 'completed' || alreadyCompleted,
        progressPercent: percent,
        activeSeconds: externalElapsed,
        requiredSeconds: externalRequiredSeconds,
        isIdle: false,
        isStopped: false,
        isCounting: status === 'in_progress' || status === 'eligible',
        hasStarted: status !== 'not_started' || externalElapsed > 0 || Boolean(sessionStartedAt),
        sessionStatus: status === 'eligible' ? 'in_progress' : status,
      });
    }
    return resolveLessonSessionStatus({
      completed: status === 'completed' || alreadyCompleted,
      progressPercent: percent,
      requiredPercent: requiredWatchPercent,
      hasStarted: status !== 'not_started' || percent > 0,
      isStopped: videoPaused && status === 'in_progress',
      isCounting: status === 'in_progress' && !videoPaused,
      sessionStatus: videoPaused && status === 'in_progress' ? 'paused' : status,
    });
  }, [
    sessionType,
    status,
    alreadyCompleted,
    percent,
    requiredWatchPercent,
    externalElapsed,
    externalRequiredSeconds,
    externalIdle,
    externalCounting,
    sessionStartedAt,
    videoPaused,
  ]);

  useEffect(() => {
    trackerRef.current = createVideoWatchTracker();
    externalClockRef.current = createExternalSessionClock({
      requiredSeconds: externalRequiredSeconds,
      initialActiveSeconds: 0,
      storageKey: lesson?.id ? `em_ext_session_${lesson.id}` : null,
    });
    externalSessionIdRef.current = null;
    setPercent(alreadyCompleted ? 100 : 0);
    setWatchedSeconds(0);
    setLastPosition(0);
    setDuration(0);
    setStatus(alreadyCompleted ? 'completed' : 'not_started');
    setMessage(alreadyCompleted ? 'تم تسجيل حضورك مسبقًا لهذه الحصة' : '');
    setExternalElapsed(0);
    setExternalEligible(0);
    setExternalCounting(false);
    setExternalIdle(false);
    setSessionStartedAt('');
    setPointsAwarded(0);
    lastSentRef.current = { percent: -1, at: 0 };
    externalLastSentRef.current = { active: -1, at: 0 };
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Restore previous progress if available
    if (!alreadyCompleted && lesson?.id) {
      apiFetch('/api/attendance')
        .then((r) => r.json())
        .then((data) => {
          const row = (data?.attendance || []).find((a) => Number(a.lesson_id) === Number(lesson.id));

          if (sessionType === SESSION_TYPES.RECORDED_VIDEO) {
            if (row?.progress_percent) setPercent(Number(row.progress_percent) || 0);
            const vtList = Array.isArray(data?.video_tracking) ? data.video_tracking : [];
            const vt = vtList.find((v) => Number(v.lesson_id) === Number(lesson.id));
            if (vt && trackerRef.current) {
              const snap = trackerRef.current.importState({
                ranges: vt.watched_ranges,
                last_position: vt.last_position,
                max_position: vt.max_position,
                duration: vt.duration,
              });
              setPercent(snap.progress_percent);
              setWatchedSeconds(snap.watched_seconds);
              setLastPosition(snap.last_position);
              setDuration(snap.duration);
              if (vt.completed) setStatus('completed');
              else if (snap.progress_percent >= requiredWatchPercent) setStatus('eligible');
              else if (snap.progress_percent > 0) setStatus('in_progress');
            } else if (row && Number(row.progress_percent) > 0 && !row.tracking_completed) {
              setStatus(Number(row.progress_percent) >= requiredWatchPercent ? 'eligible' : 'in_progress');
            }
          }

          if (sessionType === SESSION_TYPES.EXTERNAL_LINK) {
            const list = Array.isArray(data?.external_sessions) ? data.external_sessions : [];
            const ext =
              list.find((s) => Number(s.lesson_id) === Number(lesson.id) && !s.completed) ||
              list.find((s) => Number(s.lesson_id) === Number(lesson.id));
            if (ext && externalClockRef.current) {
              externalSessionIdRef.current = ext.id;
              const snap = externalClockRef.current.importState({
                active_seconds: ext.active_seconds,
                required_seconds: ext.required_seconds || externalRequiredSeconds,
                started_at: ext.started_at,
                last_activity_at: ext.last_activity_at,
              });
              setExternalElapsed(snap.active_seconds);
              setExternalEligible(snap.eligible_seconds);
              setSessionStartedAt(ext.started_at || '');
              setPercent(snap.progress_percent);
              if (ext.completed || row?.status === 'completed') setStatus('completed');
              else if (snap.is_eligible) setStatus('eligible');
              else if (snap.active_seconds > 0) setStatus('in_progress');
            }
          }
        })
        .catch(() => {});
    }
  }, [lesson?.id, alreadyCompleted, sessionType, requiredWatchPercent, externalRequiredSeconds]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // force re-bind when lesson media list changes
  const mediaBindKey = `${lesson?.id || ''}-${(Array.isArray(lesson?.media) ? lesson.media : [])
    .map((m) => m.id || m.url)
    .join('|')}`;

  const markLocalComplete = (data) => {
    setStatus('completed');
    if (data?.points_awarded) setPointsAwarded(Number(data.points_awarded) || 0);
    onCompleted?.(data);
  };

  const canCompleteVideo = percent >= requiredWatchPercent || status === 'eligible' || status === 'completed';
  const durationMetExternal =
    externalRequiredSeconds <= 0
      ? externalElapsed > 0
      : externalElapsed >= externalRequiredSeconds || status === 'eligible' || status === 'completed';
  // External + linked quiz: attendance completes after quiz, not via «إكمال الحصة»
  // External without quiz: show complete button after duration
  const canShowCompleteButton =
    !alreadyCompleted &&
    status !== 'completed' &&
    (sessionType === SESSION_TYPES.RECORDED_VIDEO
      ? canCompleteVideo && status !== 'not_started'
      : durationMetExternal && status !== 'not_started' && !linkedQuizId);

  /** Progress heartbeats only — never auto-complete the lesson */
  const persistVideoSnapshot = useCallback(async (snap, { force = false } = {}) => {
    if (disabled || !lesson?.id || !snap) return null;
    if (status === 'completed' || alreadyCompleted) return null;
    if (savingRef.current && !force) return null;

    const rounded = Math.round(snap.progress_percent * 10) / 10;
    const eligible = rounded >= requiredWatchPercent;
    const now = Date.now();
    const last = lastSentRef.current;
    // Throttle: every 5% change or 8s, always on force/eligible milestone
    if (
      !force &&
      !eligible &&
      Math.abs(rounded - last.percent) < 5 &&
      now - last.at < 8000
    ) {
      return null;
    }
    lastSentRef.current = { percent: rounded, at: now };
    savingRef.current = true;

    try {
      const data = await reportProgress({
        lesson_id: lesson.id,
        session_type: SESSION_TYPES.RECORDED_VIDEO,
        tracking_mode: 'video',
        progress_percent: rounded,
        watched_seconds: snap.watched_seconds,
        last_position: snap.last_position,
        max_position: snap.max_position,
        duration: snap.duration,
        watched_ranges: snap.ranges,
        required_watch_percent: requiredWatchPercent,
        // Keep attendance as present until student presses «إكمال الحصة»
        status: 'present',
        completed: false,
        note: eligible
          ? `وصلت لنسبة المشاهدة المطلوبة (${rounded}% / ${requiredWatchPercent}%) — بانتظار إكمال الحصة`
          : `مشاهدة فعلية ${rounded}% · ${formatWatchTime(snap.watched_seconds)} · آخر نقطة ${formatWatchTime(snap.last_position)}`,
      });

      onProgress?.(rounded);

      if (eligible) {
        setStatus('eligible');
        setMessage(`أصبحت الحصة مؤهلة — اضغط «إكمال الحصة» للمتابعة (شاهدت ${rounded}% / المطلوب ${requiredWatchPercent}%)`);
      } else if (rounded > 0) {
        setStatus((s) => (s === 'completed' ? s : 'in_progress'));
        setMessage(`جاري المشاهدة الفعلية... ${rounded}% (المطلوب ${requiredWatchPercent}%)`);
      }
      return data;
    } catch (err) {
      setMessage(err.message || 'تعذر حفظ متابعة الفيديو');
      return null;
    } finally {
      savingRef.current = false;
    }
  }, [disabled, lesson?.id, requiredWatchPercent, onProgress, status, alreadyCompleted]);

  const completeVideoLesson = async () => {
    if (disabled || !lesson?.id || busy || status === 'completed') return;
    const snap = trackerRef.current?.snapshot?.() || {
      progress_percent: percent,
      watched_seconds: watchedSeconds,
      last_position: lastPosition,
      max_position: lastPosition,
      duration,
      ranges: [],
    };
    const rounded = Math.round(Number(snap.progress_percent || percent) * 10) / 10;
    if (rounded < requiredWatchPercent) {
      setMessage(`لا يمكن إكمال الحصة قبل تحقيق ${requiredWatchPercent}% مشاهدة فعلية (الآن ${rounded}%)`);
      return;
    }

    setBusy(true);
    try {
      const data = await reportProgress({
        lesson_id: lesson.id,
        session_type: SESSION_TYPES.RECORDED_VIDEO,
        tracking_mode: 'video',
        progress_percent: rounded,
        watched_seconds: snap.watched_seconds,
        last_position: snap.last_position,
        max_position: snap.max_position || snap.last_position,
        duration: snap.duration,
        watched_ranges: snap.ranges,
        required_watch_percent: requiredWatchPercent,
        status: 'completed',
        completed: true,
        note: `إكمال الحصة بعد مشاهدة فعلية ${rounded}% (المطلوب ${requiredWatchPercent}%)`,
      });
      setPercent(rounded);
      setMessage(
        data?.points_awarded
          ? `تم إكمال الحصة (+${data.points_awarded} نقطة)`
          : 'تم إكمال الحصة بنجاح'
      );
      markLocalComplete(data);
      onAdvance?.(data);
    } catch (err) {
      setMessage(err.message || 'تعذر إكمال الحصة — تأكد من تحقيق نسبة المشاهدة المطلوبة');
    } finally {
      setBusy(false);
    }
  };

  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !trackerRef.current) return;
    if (!el.duration || !Number.isFinite(el.duration)) return;

    // Only accumulate while actually playing (not paused/seeking)
    if (el.paused || el.seeking) return;

    const snap = trackerRef.current.ingestPlayback(el.currentTime, el.duration);
    setPercent(snap.progress_percent);
    setWatchedSeconds(snap.watched_seconds);
    setLastPosition(snap.last_position);
    setDuration(snap.duration);
    if (status !== 'completed') {
      setStatus(snap.progress_percent >= requiredWatchPercent ? 'eligible' : 'in_progress');
    }
    persistVideoSnapshot(snap);
  };

  const handleSeeking = () => {
    // On seek, update cursor without filling gap — handled by next ingest when play resumes
    const el = videoRef.current;
    if (!el || !trackerRef.current) return;
    // Force a seek detection by ingesting with large jump (tracker compares deltas)
    const snap = trackerRef.current.ingestPlayback(el.currentTime, el.duration);
    setLastPosition(snap.last_position);
  };

  const handleSeeked = () => {
    const el = videoRef.current;
    if (!el || !trackerRef.current) return;
    const snap = trackerRef.current.ingestPlayback(el.currentTime, el.duration);
    setLastPosition(snap.last_position);
    setPercent(snap.progress_percent);
    setWatchedSeconds(snap.watched_seconds);
  };

  const handleEnded = () => {
    const el = videoRef.current;
    if (!trackerRef.current) return;
    const snap = trackerRef.current.markEnded(el?.duration);
    setPercent(snap.progress_percent);
    setWatchedSeconds(snap.watched_seconds);
    setLastPosition(snap.last_position);
    setDuration(snap.duration);
    persistVideoSnapshot(snap, { force: true });
  };

  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (!el || !trackerRef.current) return;
    trackerRef.current.setDuration(el.duration);
    setDuration(el.duration || 0);
    // Resume near last honest position if we have one
    if (lastPosition > 1 && lastPosition < (el.duration || 0) - 1) {
      try {
        el.currentTime = lastPosition;
      } catch {
        /* ignore */
      }
    }
  };

  // Attach tracking to the single media-gallery video (no duplicate player)
  useEffect(() => {
    if (showMediaPlayer) return undefined;
    if (sessionType !== SESSION_TYPES.RECORDED_VIDEO) return undefined;
    if (!lesson?.id) return undefined;

    let cancelled = false;
    let el = null;
    let tries = 0;

    const bind = () => {
      if (cancelled) return;
      el = document.querySelector(`[data-lesson-track-video="${lesson.id}"]`);
      if (!el || el.tagName !== 'VIDEO') {
        if (tries < 20) {
          tries += 1;
          setTimeout(bind, 150);
        }
        return;
      }

      videoRef.current = el;

      const onMeta = () => handleLoadedMetadata();
      const onTime = () => handleTimeUpdate();
      const onSeekingEv = () => handleSeeking();
      const onSeekedEv = () => handleSeeked();
      const onEndedEv = () => handleEnded();
      const onPlayEv = () => {
        setVideoPaused(false);
        setStatus((s) => (s === 'completed' ? s : 'in_progress'));
      };
      const onPauseEv = () => {
        setVideoPaused(true);
        const snap = trackerRef.current?.snapshot?.();
        if (snap) persistVideoSnapshot(snap, { force: true });
      };

      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('seeking', onSeekingEv);
      el.addEventListener('seeked', onSeekedEv);
      el.addEventListener('ended', onEndedEv);
      el.addEventListener('play', onPlayEv);
      el.addEventListener('pause', onPauseEv);

      if (el.readyState >= 1) onMeta();

      el._emTrackCleanup = () => {
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('seeking', onSeekingEv);
        el.removeEventListener('seeked', onSeekedEv);
        el.removeEventListener('ended', onEndedEv);
        el.removeEventListener('play', onPlayEv);
        el.removeEventListener('pause', onPauseEv);
      };
    };

    bind();

    return () => {
      cancelled = true;
      if (el && typeof el._emTrackCleanup === 'function') {
        el._emTrackCleanup();
        delete el._emTrackCleanup;
      }
      if (videoRef.current === el) videoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMediaPlayer, sessionType, lesson?.id, mediaBindKey]);

  const applyExternalSnap = (snap) => {
    if (!snap) return;
    setExternalElapsed(snap.active_seconds || 0);
    setExternalEligible(snap.eligible_seconds || 0);
    setExternalCounting(Boolean(snap.is_counting));
    setExternalIdle(Boolean(snap.is_idle));
    setPercent(snap.progress_percent || 0);
    onProgress?.(snap.progress_percent || 0);
    if (status !== 'completed') {
      if (snap.is_eligible) setStatus('eligible');
      else if (snap.active_seconds > 0) setStatus('in_progress');
    }
  };

  const persistExternalSession = async (snap, extra = {}) => {
    if (!lesson?.id || !snap) return null;
    if (status === 'completed' || alreadyCompleted) return null;
    const now = Date.now();
    const last = externalLastSentRef.current;
    const force = Boolean(extra.force || extra.completed);
    // throttle heartbeats: every 20s or +30 elapsed seconds
    if (
      !force &&
      Math.abs((snap.active_seconds || 0) - last.active) < 30 &&
      now - last.at < 20000
    ) {
      return null;
    }
    externalLastSentRef.current = { active: snap.active_seconds || 0, at: now };

    // With linked quiz: never complete attendance here — only after quiz
    // Without linked quiz: allow explicit complete after duration
    const wantsComplete = Boolean(extra.completed) && !linkedQuizId;
    const meetsDuration =
      externalRequiredSeconds <= 0
        ? (snap.active_seconds || 0) > 0
        : (snap.active_seconds || 0) >= externalRequiredSeconds;

    try {
      const data = await reportProgress({
        lesson_id: lesson.id,
        session_type: SESSION_TYPES.EXTERNAL_LINK,
        tracking_mode: 'external_link',
        opened_external: true,
        external_url: primary?.url || '',
        external_session_id: externalSessionIdRef.current,
        session_started_at: snap.started_at || sessionStartedAt || new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        active_seconds: snap.active_seconds,
        eligible_seconds: snap.eligible_seconds,
        external_required_seconds: externalRequiredSeconds,
        external_elapsed_seconds: snap.active_seconds,
        watched_seconds: snap.active_seconds,
        progress_percent: snap.progress_percent,
        session_is_active: !meetsDuration,
        session_is_idle: false,
        completed: wantsComplete && meetsDuration,
        status: wantsComplete && meetsDuration ? 'completed' : 'present',
        note:
          extra.note ||
          (meetsDuration
            ? linkedQuizId
              ? `انتهت مدة المتابعة (${formatSessionClock(externalRequiredSeconds)}) — بانتظار اختبار الحصة`
              : `انتهت مدة المتابعة — بانتظار إكمال الحصة`
            : `جلسة خارجية مستمرة منذ البدء — ${formatSessionClock(snap.active_seconds)} / ${formatSessionClock(externalRequiredSeconds)}`),
      });
      if (data?.external_session_id) externalSessionIdRef.current = data.external_session_id;
      if (data?.external_session?.id) externalSessionIdRef.current = data.external_session.id;
      if (data?.session_started_at) setSessionStartedAt(data.session_started_at);

      if (wantsComplete && (data?.status === 'completed' || data?.external_session?.completed)) {
        setStatus('completed');
        setMessage(
          data?.points_awarded
            ? `تم تسجيل الحضور (+${data.points_awarded} نقطة)`
            : 'تم تسجيل الحضور'
        );
        markLocalComplete(data);
        onAdvance?.(data);
      } else if (meetsDuration && status !== 'completed') {
        setStatus('eligible');
        setMessage(
          linkedQuizId
            ? `انقضت المدة المطلوبة — اضغط «📝 اختبار الحصة» (الحضور يُحتسب بعد إنهاء الاختبار)`
            : `انقضت المدة المطلوبة — اضغط «إكمال الحصة» لتسجيل الحضور`
        );
      }
      return data;
    } catch (err) {
      setMessage(err.message || 'تعذر حفظ جلسة المتابعة');
      return null;
    }
  };

  const stopExternalSessionLoop = () => {
    if (timerRef.current) {
      if (typeof timerRef.current._emCleanup === 'function') {
        try {
          timerRef.current._emCleanup();
        } catch {
          /* ignore */
        }
      }
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startExternalSessionLoop = () => {
    stopExternalSessionLoop();
    // Use wall-clock ticks; also catch up immediately when tab becomes visible again
    const pulse = () => {
      if (!externalClockRef.current) return;
      const snap = externalClockRef.current.tick();
      applyExternalSnap(snap);
      if (snap.is_eligible && status !== 'completed' && status !== 'eligible') {
        setStatus('eligible');
        setMessage(
          linkedQuizId
            ? `انقضت المدة — ابدأ «📝 اختبار الحصة» لتسجيل الحضور بعد إنهائه`
            : `انقضت المدة — اضغط «إكمال الحصة» لتسجيل الحضور`
        );
        persistExternalSession(snap, { force: true });
        externalClockRef.current.stop();
        stopExternalSessionLoop();
      } else if (!snap.is_eligible) {
        persistExternalSession(snap);
      }
    };
    pulse();
    timerRef.current = setInterval(pulse, 1000);
    // When user returns from external site, recompute elapsed from start time immediately
    const onFocus = () => pulse();
    const onVis = () => {
      if (document.visibilityState === 'visible') pulse();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    // stash cleanups on interval id object
    timerRef.current._emCleanup = () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  };

  const startExternalSession = async () => {
    if (disabled || !primary?.url || busy || status === 'completed') return;
    // If already eligible, just reopen link / show quiz path
    if (status === 'eligible' || durationMetExternal) {
      window.open(primary.url, '_blank', 'noopener,noreferrer');
      setMessage(
        linkedQuizId
          ? 'المدة اكتملت مسبقًا — اضغط «📝 اختبار الحصة»'
          : 'المدة اكتملت مسبقًا — اضغط «إكمال الحصة»'
      );
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (!externalClockRef.current) {
        externalClockRef.current = createExternalSessionClock({
          requiredSeconds: externalRequiredSeconds,
          initialActiveSeconds: externalElapsed,
          startedAtIso: sessionStartedAt || null,
          storageKey: lesson?.id ? `em_ext_session_${lesson.id}` : null,
        });
      }
      externalClockRef.current.setRequired?.(externalRequiredSeconds);
      const snap = externalClockRef.current.start();
      applyExternalSnap(snap);
      setSessionStartedAt(snap.started_at || new Date().toISOString());
      setStatus('in_progress');

      const data = await persistExternalSession(snap, {
        force: true,
        note: 'بدء الحصة — العدّ الزمني مستمر من هذه اللحظة حتى انتهاء المدة (حتى لو لم يكن الطالب نشطًا على المنصة)',
      });
      if (data?.external_session_id) externalSessionIdRef.current = data.external_session_id;

      window.open(primary.url, '_blank', 'noopener,noreferrer');

      startExternalSessionLoop();
      setMessage(
        `بدأ احتساب الوقت من الآن لمدة ${formatDurationSeconds(externalRequiredSeconds)} باستمرار — حتى أثناء فتح الرابط الخارجي أو عدم استخدام المنصة. بعد انتهاء المدة يظهر اختبار الحصة.`
      );
    } catch (err) {
      setMessage(err.message || 'تعذر بدء جلسة المتابعة');
    } finally {
      setBusy(false);
    }
  };

  const completeExternalLesson = async () => {
    if (disabled || !lesson?.id || busy || status === 'completed') return;
    const snap = externalClockRef.current?.tick?.() || {
      active_seconds: externalElapsed,
      eligible_seconds: externalEligible,
      progress_percent: percent,
      is_eligible: externalElapsed >= externalRequiredSeconds,
      is_running: false,
      is_idle: false,
      started_at: sessionStartedAt,
    };
    applyExternalSnap(snap);

    if (externalRequiredSeconds > 0 && (snap.active_seconds || 0) < externalRequiredSeconds) {
      setMessage(
        `لا يمكن إكمال الحصة قبل تحقيق مدة المتابعة المطلوبة (الآن ${formatSessionClock(snap.active_seconds)} / المطلوب ${formatSessionClock(externalRequiredSeconds)})`
      );
      return;
    }

    setBusy(true);
    try {
      externalClockRef.current?.stop?.();
      stopExternalSessionLoop();
      await persistExternalSession(
        { ...snap, is_running: false, is_eligible: true },
        { force: true, completed: true, note: 'إكمال الحصة بعد استيفاء مدة جلسة المتابعة' }
      );
    } catch (err) {
      setMessage(err.message || 'تعذر إكمال الحصة');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteLesson = () => {
    if (sessionType === SESSION_TYPES.RECORDED_VIDEO) return completeVideoLesson();
    return completeExternalLesson();
  };

  if (disabled) return null;

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
          {sessionType === SESSION_TYPES.EXTERNAL_LINK ? (
            <Link2 className="w-4 h-4" />
          ) : (
            <PlayCircle className="w-4 h-4" />
          )}
          متابعة الحصة · {sessionTypeFullLabel(sessionType)}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black ${statusMeta.className}`}
          title="تُحدَّث تلقائيًا حسب تقدّمك — لا يمكن تغييرها يدويًا"
        >
          <span className={`w-2 h-2 rounded-full ${statusMeta.dot || 'bg-current'}`} />
          {statusMeta.fullLabel || statusMeta.label}
        </span>
      </div>
      <p className="text-[11px] text-stone-500 -mt-1">
        حالة الحصة تُحدَّث تلقائيًا حسب التقدّم · لا يمكن للطالب تغييرها يدويًا
      </p>

      <div className="flex flex-wrap gap-2 text-[11px] text-stone-600">
        {sessionType === SESSION_TYPES.RECORDED_VIDEO && (
          <>
            {videoDurationMinutes > 0 && (
              <span className="px-2 py-1 rounded-lg bg-white border border-amber-100">
                مدة الفيديو: {videoDurationMinutes} د
              </span>
            )}
            <span className="px-2 py-1 rounded-lg bg-white border border-amber-100">
              نسبة المشاهدة المطلوبة: {requiredWatchPercent}%
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-amber-100">
              <Clock3 className="w-3 h-3" />
              شوهد فعليًا: {formatWatchTime(watchedSeconds)}
              {duration > 0 ? ` / ${formatWatchTime(duration)}` : ''}
            </span>
            <span className="px-2 py-1 rounded-lg bg-white border border-amber-100">
              آخر نقطة: {formatWatchTime(lastPosition)}
            </span>
          </>
        )}
        {sessionType === SESSION_TYPES.EXTERNAL_LINK && (
          <>
            <span className="px-2 py-1 rounded-lg bg-white border border-amber-100">
              المدة المطلوبة: {formatDurationSeconds(externalRequiredSeconds)}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-amber-100">
              <Clock3 className="w-3 h-3" />
              الوقت المنقضي: {formatSessionClock(externalElapsed)}
            </span>
            {sessionStartedAt && (
              <span className="px-2 py-1 rounded-lg bg-white border border-amber-100">
                بدأت: {new Date(sessionStartedAt).toLocaleTimeString('ar-EG')}
              </span>
            )}
            <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200">
              العدّ مستمر حتى بدون نشاط على المنصة
            </span>
          </>
        )}
        {sessionPoints > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-amber-100">
            <Award className="w-3 h-3 text-amber-700" />
            نقاط الحصة: {sessionPoints}
          </span>
        )}
        {linkedQuizId && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-amber-100">
            <ClipboardList className="w-3 h-3 text-amber-700" />
            اختبار مرتبط
          </span>
        )}
      </div>

      <div className="h-2 rounded-full bg-white/80 overflow-hidden border border-amber-100">
        <div
          className="h-full rounded-full bg-gradient-to-l from-amber-600 to-stone-800 transition-all"
          style={{ width: `${Math.max(percent, status === 'completed' ? 100 : 0)}%` }}
        />
      </div>
      {sessionType === SESSION_TYPES.RECORDED_VIDEO ? (
        <div className="flex justify-between text-[11px] text-stone-500 font-medium">
          <span>نسبة المشاهدة الفعلية: {Math.round(percent * 10) / 10}%</span>
          <span>المطلوب: {requiredWatchPercent}%</span>
        </div>
      ) : (
        <div className="flex justify-between text-[11px] text-stone-500 font-medium">
          <span>تقدّم جلسة المتابعة: {Math.round(percent * 10) / 10}%</span>
          <span>المطلوب: {formatDurationSeconds(externalRequiredSeconds)}</span>
        </div>
      )}

      {sessionType === SESSION_TYPES.RECORDED_VIDEO && (
        <div className="space-y-2">
          <p className="text-xs text-stone-600 leading-relaxed">
            شاهد الفيديو من قسم الوسائط بالأسفل. تُحسب فقط الأجزاء التي شاهدتها فعليًا — تقديم الفيديو للأمام لا يُحتسب.
            يظهر زر «إكمال الحصة» بعد الوصول إلى {requiredWatchPercent}% مشاهدة فعلية
            {videoDurationMinutes > 0 ? ` (المدة المتوقعة ${videoDurationMinutes} دقيقة)` : ''}.
          </p>
          {showMediaPlayer ? (
            primary && (String(primary.media_type).toLowerCase() === 'video' || isDirectVideoUrl(primary.url)) ? (
              <div className="course-media-frame rounded-xl overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  src={primary.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onSeeking={handleSeeking}
                  onSeeked={handleSeeked}
                  onEnded={handleEnded}
                  onPlay={() => {
                    setVideoPaused(false);
                    setStatus((s) => (s === 'completed' ? s : 'in_progress'));
                  }}
                  onPause={() => {
                    setVideoPaused(true);
                    const snap = trackerRef.current?.snapshot?.();
                    if (snap) persistVideoSnapshot(snap, { force: true });
                  }}
                />
              </div>
            ) : primary && getVideoEmbedUrl(primary.url) ? (
              <div className="space-y-2">
                <div className="course-media-frame rounded-xl overflow-hidden">
                  <iframe
                    src={getVideoEmbedUrl(primary.url)}
                    title={primary.title || 'فيديو الحصة'}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-red-600 font-medium">
                لا يوجد فيديو مسجل مرتبط بهذه الحصة بعد. اطلب من المدرس رفع فيديو.
              </p>
            )
          ) : !primary ? (
            <p className="text-xs text-red-600 font-medium">
              لا يوجد فيديو في وسائط الدرس بعد. ارفع فيديو من لوحة المدرس.
            </p>
          ) : (
            <p className="text-[11px] text-stone-500">
              يتم تتبع المشاهدة من مشغّل الفيديو في «وسائط الدرس» (بدون تكرار العرض).
            </p>
          )}
        </div>
      )}

      {sessionType === SESSION_TYPES.EXTERNAL_LINK && (
        <div className="space-y-3">
          <p className="text-xs text-stone-600 leading-relaxed">
            اضغط «بدء الحصة» لفتح الرابط وبدء احتساب الوقت فورًا.
            يستمر العدّ حتى انتهاء المدة المحددة حتى لو لم تكن نشطًا على المنصة أو كنت داخل الرابط الخارجي.
            {linkedQuizId
              ? ' بعد انتهاء المدة يظهر «اختبار الحصة»، ويُسجَّل الحضور بعد إنهاء الاختبار (أي درجة).'
              : ' بعد انتهاء المدة اضغط «إكمال الحصة» لتسجيل الحضور.'}
            <strong className="block mt-1 text-amber-950">
              لا تُحسب نسبة مشاهدة YouTube/Drive — فقط الوقت منذ «بدء الحصة».
            </strong>
          </p>
          {status !== 'completed' && (
            <p className="text-xs font-semibold text-amber-900">
              الوقت المنقضي: {formatSessionClock(externalElapsed)} / {formatSessionClock(externalRequiredSeconds)}
              {status === 'in_progress' ? ' · جاري العدّ…' : status === 'eligible' ? ' · انتهت المدة' : ''}
            </p>
          )}
          {primary?.url ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || status === 'completed'}
                onClick={startExternalSession}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                {status === 'not_started' ? 'بدء الحصة' : 'إعادة فتح الرابط'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-red-600 font-medium">
              لا يوجد رابط خارجي في وسائط الدرس بعد. أضفه من لوحة المدرس.
            </p>
          )}
        </div>
      )}

      {/* Complete lesson — only after required threshold is met */}
      {canShowCompleteButton && (
        <div className="pt-3 mt-1 border-t border-amber-200 space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleCompleteLesson}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-black hover:bg-emerald-800 disabled:opacity-60 shadow-sm"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            إكمال الحصة
          </button>
          <p className="text-[11px] text-emerald-900 font-medium">
            {sessionType === SESSION_TYPES.RECORDED_VIDEO
              ? `تم تحقيق نسبة المشاهدة المطلوبة (${Math.round(percent)}% / ${requiredWatchPercent}%). اضغط لإكمال الحصة والانتقال للخطوة التالية.`
              : `تم تحقيق مدة المتابعة المطلوبة (${formatSessionClock(externalElapsed)} / ${formatSessionClock(externalRequiredSeconds)}). اضغط لإكمال الحصة والانتقال للخطوة التالية.`}
          </p>
        </div>
      )}

      {status !== 'completed' && status !== 'eligible' && status !== 'not_started' && (
        <p className="text-[11px] text-stone-500">
          زر «إكمال الحصة» سيظهر تلقائيًا بعد استيفاء الشرط المطلوب
          {sessionType === SESSION_TYPES.RECORDED_VIDEO
            ? ` (${requiredWatchPercent}% مشاهدة فعلية)`
            : ` (${formatDurationSeconds(externalRequiredSeconds)} متابعة)`}
          .
        </p>
      )}

      {/* Optional lesson quiz — only after attendance requirement is met.
          Score is NOT required for attendance. */}
      {/* External (or any) linked quiz after duration/watch requirement — attendance after quiz finish for external */}
      {attendanceRequirementMet && linkedQuizId && status !== 'completed' && (
        <div className="pt-3 mt-1 border-t border-amber-200 space-y-2">
          <button
            type="button"
            onClick={() => {
              navigate(`/quizzes/${linkedQuizId}?lesson_id=${encodeURIComponent(lesson.id)}`);
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-black hover:bg-stone-800 shadow-sm"
          >
            <ClipboardList className="w-4 h-4" />
            📝 اختبار الحصة
          </button>
          <p className="text-[11px] text-stone-600">
            {sessionType === SESSION_TYPES.EXTERNAL_LINK
              ? 'بعد إنهاء الاختبار يُسجَّل حضورك تلقائيًا (الدرجة غير مشترطة).'
              : 'اختبار مرتبط بالحصة. درجة الاختبار لا تُشترط لتسجيل الحضور.'}
          </p>
        </div>
      )}
      {status === 'completed' && linkedQuizId && (
        <div className="pt-2 border-t border-amber-200">
          <Link
            to={`/quizzes/${linkedQuizId}?lesson_id=${encodeURIComponent(lesson.id)}`}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-900 hover:text-amber-800"
          >
            <ClipboardList className="w-4 h-4" />
            مراجعة / إعادة اختبار الحصة
          </Link>
        </div>
      )}

      {message && (
        <p className={`text-xs font-medium ${status === 'completed' ? 'text-emerald-700' : 'text-stone-600'}`}>
          {message}
          {pointsAwarded > 0 ? ` · +${pointsAwarded} نقطة` : ''}
        </p>
      )}
    </div>
  );
}
