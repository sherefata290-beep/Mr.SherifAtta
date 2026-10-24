import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Clock, PlayCircle, Video, ExternalLink, FileText, Download, CheckCircle2, CalendarCheck2 } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import AccessGate from '../components/AccessGate';
import WinampPlayer from '../components/WinampPlayer';
import LessonSessionTracker from '../components/LessonSessionTracker';
import { getVideoEmbedUrl, isDirectVideoUrl, isWinampMedia } from '../lib/media';
import { apiFetch, onDataChanged } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { gradeLabel } from '../lib/grades';
import { isStaffRole } from '../lib/roles';
import {
  sessionTypeLabel,
  sessionStatusFromAttendanceRow,
  LESSON_SESSION_STATUS,
  resolveLessonSessionStatus,
} from '../lib/sessionTypes';

const levelLabels = {
  beginner: { ar: 'مبتدئ', color: 'bg-yellow-100 text-yellow-900' },
  intermediate: { ar: 'متوسط', color: 'bg-stone-200 text-stone-800' },
  advanced: { ar: 'متقدم', color: 'bg-stone-200 text-stone-800' },
};

export default function CourseDetail() {
  const { id } = useParams();
  const { user, profile, loading: authLoading } = useAuth();
  const [course, setCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attendedLessonIds, setAttendedLessonIds] = useState(() => new Set());
  const [lessonStatusMap, setLessonStatusMap] = useState(() => ({}));
  const [attendanceNote, setAttendanceNote] = useState('');

  useEffect(() => {
    if (authLoading) return;
    // Wait for profile so staff grade bypass works on first load
    if (user && !profile) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const load = async () => {
      try {
        if (!user) {
          throw new Error('يجب تسجيل الدخول لفتح الكورس');
        }
        const staff = isStaffRole(profile?.role);
        if (!staff && !profile?.has_access) {
          throw new Error('يجب إدخال كود الوصول أولاً لفتح الكورس');
        }
        const adminQ = staff ? '&admin=true' : '';
        const courseRes = await apiFetch(`/api/courses?id=${encodeURIComponent(id)}${adminQ}`);
        const c = await courseRes.json();
        if (!courseRes.ok || c?.error) throw new Error(c?.error || 'فشل تحميل الكورس');
        if (cancelled) return;
        setCourse(c);

        try {
          const lessonsRes = await apiFetch(`/api/lessons?course_id=${encodeURIComponent(id)}&with_media=true`);
          const l = await lessonsRes.json();
          if (cancelled) return;
          if (!lessonsRes.ok) {
            setLessons([]);
          } else {
            const list = Array.isArray(l) ? l : [];
            setLessons(list);
            if (list.length) setActiveLesson(list[0]);
          }
        } catch {
          if (!cancelled) {
            setLessons([]);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'فشل التحميل');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const unsubData = onDataChanged(() => { load(); });
    return () => {
      cancelled = true;
      unsubData();
    };
  }, [id, user, profile, authLoading]);

  // Load student's attendance for this course
  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    apiFetch('/api/attendance')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.error) return;
        const ids = new Set(
          (data.attendance || [])
            .filter((a) => a.status === 'completed' || a.tracking_completed)
            .map((a) => Number(a.lesson_id))
        );
        setAttendedLessonIds(ids);
        const map = {};
        (data.attendance || []).forEach((row) => {
          map[Number(row.lesson_id)] = sessionStatusFromAttendanceRow(row);
        });
        setLessonStatusMap(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user, id]);

  // Attendance is handled by LessonSessionTracker based on session_type
  // (video progress or external-link flow) — no auto-complete on open.

  const handleSessionCompleted = (lessonId) => {
    if (!lessonId) return;
    setAttendedLessonIds((prev) => {
      const next = new Set(prev);
      next.add(Number(lessonId));
      return next;
    });
    setLessonStatusMap((prev) => ({
      ...prev,
      [Number(lessonId)]: LESSON_SESSION_STATUS.completed,
    }));
    setAttendanceNote('تم إكمال الحصة بنجاح');
  };

  const handleSessionProgress = (lessonId, progressPercent = 0) => {
    if (!lessonId || attendedLessonIds.has(Number(lessonId))) return;
    const nextStatus = resolveLessonSessionStatus({
      completed: false,
      progressPercent: Number(progressPercent) || 0,
      hasStarted: Number(progressPercent) > 0,
      sessionStatus: Number(progressPercent) > 0 ? 'in_progress' : 'not_started',
    });
    setLessonStatusMap((prev) => {
      if (prev[Number(lessonId)]?.key === 'completed') return prev;
      return { ...prev, [Number(lessonId)]: nextStatus };
    });
  };

  /** After «إكمال الحصة»: go to linked quiz if any, else next lesson */
  const handleSessionAdvance = (lessonId, result) => {
    handleSessionCompleted(lessonId);
    const current = lessons.find((l) => Number(l.id) === Number(lessonId));
    const linkedQuizId = result?.linked_quiz_id || current?.linked_quiz_id;
    // Optional lesson quiz is independent of attendance — show button, don't force quiz
    if (linkedQuizId) {
      setAttendanceNote('تم استيفاء الحضور — يمكنك أداء «اختبار الحصة» اختياريًا (الدرجة لا تؤثر على الحضور)');
      return;
    }
    const idx = lessons.findIndex((l) => Number(l.id) === Number(lessonId));
    if (idx >= 0 && idx < lessons.length - 1) {
      const nextLesson = lessons[idx + 1];
      setActiveLesson(nextLesson);
      setAttendanceNote(`تم إكمال الحصة — انتقلت إلى: ${nextLesson.title_ar || nextLesson.title}`);
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        /* ignore */
      }
    } else {
      setAttendanceNote('تم إكمال آخر حصة في هذا الكورس — أحسنت!');
    }
  };

  if (authLoading || loading) return <LoadingSpinner />;

  const isStaff = isStaffRole(profile?.role);
  // Students cannot view course content without redeeming an access code first
  // (grade selection at signup alone is not enough)
  if (user && !isStaff && !profile?.has_access) {
    return (
      <AccessGate
        mode="page"
        title="كود الوصول مطلوب لفتح الكورس"
        description="اخترت صفك عند التسجيل — والآن أدخل كود الوصول من المدرس لفتح كورسات صفك."
        onSuccess={() => { window.location.reload(); }}
      />
    );
  }

  if (error || !course) {
    const needsCode = /كود|حدد صفك|صفك الدراسي/.test(error || '');
    if (user && needsCode && !isStaff) {
      return (
        <AccessGate
          mode="page"
          title="كود الوصول مطلوب"
          description={error || 'أدخل كود الوصول لفتح هذا الكورس.'}
          onSuccess={() => { window.location.reload(); }}
        />
      );
    }
    const locked = /صفك|تسجيل الدخول|حدد صفك|كود/.test(error || '');
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className={`mb-4 p-6 rounded-2xl border ${locked ? 'bg-amber-50 border-amber-200 text-amber-950' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <p className="font-medium mb-1">{error || 'الكورس غير موجود'}</p>
          {locked && (
            <p className="text-sm opacity-80">يجب تسجيل الدخول وإدخال كود الوصول، والفتح متاح فقط لصفك الدراسي.</p>
          )}
        </div>
        {!user ? (
          <Link to="/login" className="text-amber-700 font-medium">تسجيل الدخول</Link>
        ) : (
          <Link to="/courses" className="text-amber-700 font-medium">العودة للكورسات</Link>
        )}
      </div>
    );
  }

  const lvl = levelLabels[course.level] || levelLabels.beginner;
  const media = Array.isArray(course.media) ? course.media : [];
  const lessonMedia = Array.isArray(activeLesson?.media) ? activeLesson.media : [];

  // Primary media for attendance tracking (same item shown once in media gallery)
  const primaryTrackedMedia = (() => {
    const list = lessonMedia;
    if (!list.length) return null;
    const st = String(activeLesson?.session_type || '').toLowerCase();
    if (st === 'external_link') {
      return (
        list.find((m) => String(m.media_type).toLowerCase() === 'external') ||
        list.find((m) => String(m.media_type).toLowerCase() === 'video') ||
        null
      );
    }
    return (
      list.find((m) => String(m.media_type).toLowerCase() === 'video') ||
      list.find((m) => /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(String(m.url || ''))) ||
      list.find((m) => String(m.media_type).toLowerCase() === 'external') ||
      null
    );
  })();

  const isPrimaryTrackedMedia = (item) => {
    if (!primaryTrackedMedia || !item) return false;
    if (item.id != null && primaryTrackedMedia.id != null) {
      return String(item.id) === String(primaryTrackedMedia.id);
    }
    return String(item.url || '') === String(primaryTrackedMedia.url || '');
  };

  const renderMediaItem = (item, keyPrefix = '') => {
    const trackThis =
      !isStaff &&
      isPrimaryTrackedMedia(item) &&
      String(activeLesson?.session_type || 'recorded_video') !== 'external_link' &&
      (item.media_type === 'video' || isDirectVideoUrl(item.url));
    const embed = item.media_type === 'external' ? getVideoEmbedUrl(item.url) : null;
    // Images: show visual only — no titles/urls/meta
    if (item.media_type === 'image') {
      return (
        <div key={`${keyPrefix}${item.id}`} className="course-media-frame border border-stone-200 shadow-sm">
          <img src={item.url} alt="" loading="lazy" decoding="async" />
        </div>
      );
    }
    // Audio / Winamp playlists & tracks
    if (isWinampMedia(item)) {
      return (
        <div key={`${keyPrefix}${item.id}`} className="rounded-2xl overflow-hidden border border-stone-700 shadow-lg">
          <WinampPlayer src={item.url} title={item.title || 'English Mastery Audio'} />
        </div>
      );
    }
    // Downloadable files (PDF, Word, etc.)
    if (item.media_type === 'file') {
      return (
        <div key={`${keyPrefix}${item.id}`} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-5">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            download
            className="flex items-center gap-3 text-amber-900 font-medium hover:bg-amber-50 rounded-xl p-2 -m-2 transition-colors"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6 text-amber-800" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold truncate">{item.title || 'ملف مرفق'}</div>
              <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                <Download className="w-3.5 h-3.5" />
                تحميل / فتح الملف
              </div>
            </div>
          </a>
        </div>
      );
    }
    return (
      <div key={`${keyPrefix}${item.id}`} className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        {item.media_type === 'video' && (
          <div className="course-media-frame rounded-none">
            <video
              src={item.url}
              controls
              playsInline
              preload="metadata"
              {...(trackThis ? { 'data-lesson-track-video': String(activeLesson.id) } : {})}
            />
          </div>
        )}
        {item.media_type === 'external' && embed && (
          <div className="course-media-frame rounded-none">
            <iframe
              src={embed}
              title="فيديو"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
        {item.media_type === 'external' && !embed && isDirectVideoUrl(item.url) && (
          <div className="course-media-frame rounded-none">
            <video
              src={item.url}
              controls
              playsInline
              preload="metadata"
              {...(trackThis ? { 'data-lesson-track-video': String(activeLesson.id) } : {})}
            />
          </div>
        )}
        {item.media_type === 'external' && !embed && !isDirectVideoUrl(item.url) && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 p-6 sm:p-8 text-amber-800 font-medium hover:bg-amber-50 min-h-[120px]"
          >
            <ExternalLink className="w-5 h-5" />
            مشاهدة الفيديو
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/courses" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-amber-700 mb-6">
        <ArrowRight className="w-4 h-4" />
        العودة للكورسات
      </Link>

      <div className="bg-gradient-to-l from-amber-700 to-stone-800 rounded-3xl p-6 md:p-10 text-white mb-8 shadow-xl shadow-stone-400/40">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className={`px-3 py-1 rounded-lg text-xs font-bold ${lvl.color}`}>{lvl.ar}</span>
          {course.grade_level && (
            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-white/90 text-amber-900">
              {gradeLabel(course.grade_level)}
            </span>
          )}
          {course.duration && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white/15 text-xs">
              <Clock className="w-3.5 h-3.5" />
              {course.duration}
            </span>
          )}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold mb-2">{course.title_ar || course.title}</h1>
        <p className="text-amber-100 text-lg mb-3">{course.title}</p>
        <p className="text-amber-100/90 max-w-3xl leading-relaxed">{course.description_ar || course.description}</p>
      </div>

      {media.length > 0 && (
        <div className="mb-8 space-y-4">
          <h2 className="font-bold text-stone-900 text-xl flex items-center gap-2">
            <Video className="w-5 h-5 text-amber-700" />
            وسائط الكورس
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {media.map((item) => renderMediaItem(item, 'course-'))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <h2 className="font-bold text-stone-900 mb-3 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-700" />
            الدروس ({lessons.length})
          </h2>
          {lessons.length === 0 ? (
            <p className="text-stone-500 text-sm py-6">لا توجد دروس بعد</p>
          ) : (
            lessons.map((lesson, idx) => (
              <button
                key={lesson.id}
                onClick={() => setActiveLesson(lesson)}
                className={`w-full text-right p-3 rounded-xl border transition-all ${
                  activeLesson?.id === lesson.id
                    ? 'border-amber-400 bg-amber-50 shadow-sm'
                    : attendedLessonIds.has(Number(lesson.id))
                      ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                    : 'border-stone-200 bg-white hover:border-stone-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                    activeLesson?.id === lesson.id
                      ? 'bg-amber-700 text-white'
                      : attendedLessonIds.has(Number(lesson.id))
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-200 text-stone-600'
                  }`}>
                    {attendedLessonIds.has(Number(lesson.id)) ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-stone-900 text-sm truncate">{lesson.title_ar || lesson.title}</div>
                    <div className="text-xs text-stone-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{lesson.duration_minutes || 30} دقيقة</span>
                      {(() => {
                        const st =
                          lessonStatusMap[Number(lesson.id)] ||
                          (attendedLessonIds.has(Number(lesson.id))
                            ? LESSON_SESSION_STATUS.completed
                            : LESSON_SESSION_STATUS.not_started);
                        return (
                          <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${st.className}`}>
                            {st.fullLabel || st.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="lg:col-span-2">
          {activeLesson ? (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-amber-700 text-sm font-medium">
                  <PlayCircle className="w-4 h-4" />
                  محتوى الدرس
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 text-stone-700 text-xs font-bold">
                    <CalendarCheck2 className="w-3.5 h-3.5" />
                    {sessionTypeLabel(activeLesson.session_type)}
                  </span>
                  {(() => {
                    const st =
                      lessonStatusMap[Number(activeLesson.id)] ||
                      (attendedLessonIds.has(Number(activeLesson.id))
                        ? LESSON_SESSION_STATUS.completed
                        : LESSON_SESSION_STATUS.not_started);
                    return (
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black ${st.className}`}>
                        {st.fullLabel || st.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
              {attendanceNote && (
                <p className="mb-3 text-xs font-medium text-emerald-700">{attendanceNote}</p>
              )}
              <h2 className="text-2xl font-bold text-stone-900 mb-1">{activeLesson.title_ar || activeLesson.title}</h2>
              <p className="text-amber-700 mb-4">{activeLesson.title}</p>

              {/* Media first — single video source for the lesson */}
              {lessonMedia.length > 0 && (
                <div className="mb-6 space-y-3">
                  <div className="text-sm font-semibold text-stone-800 flex items-center gap-2">
                    <Video className="w-4 h-4 text-amber-700" />
                    وسائط الدرس
                  </div>
                  <div className="grid gap-4">
                    {lessonMedia.map((item) => renderMediaItem(item, 'lesson-'))}
                  </div>
                </div>
              )}

              {/* Attendance controls only (no second video player) */}
              {!isStaff && (
                <LessonSessionTracker
                  lesson={activeLesson}
                  showMediaPlayer={false}
                  alreadyCompleted={attendedLessonIds.has(Number(activeLesson.id))}
                  onCompleted={() => handleSessionCompleted(activeLesson.id)}
                  onProgress={(pct) => handleSessionProgress(activeLesson.id, pct)}
                  onAdvance={(data) => handleSessionAdvance(activeLesson.id, data)}
                />
              )}

              <div className="prose prose-stone max-w-none text-stone-700 leading-relaxed whitespace-pre-wrap">
                {activeLesson.content || 'لا يوجد محتوى لهذا الدرس بعد.'}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center text-stone-500">
              اختر درساً لعرض محتواه
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
