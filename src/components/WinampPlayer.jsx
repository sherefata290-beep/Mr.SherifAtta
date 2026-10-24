import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { isDirectAudioUrl, isPlaylistUrl, parsePlaylistText } from '../lib/media';

function formatTime(sec = 0) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function WinampPlayer({
  src = '',
  title = 'English Mastery Radio',
  tracks: initialTracks = null,
}) {
  const audioRef = useRef(null);
  const [tracks, setTracks] = useState(() => {
    if (Array.isArray(initialTracks) && initialTracks.length) return initialTracks;
    if (src && isDirectAudioUrl(src)) return [{ title: title || 'Track', url: src }];
    return src ? [{ title: title || 'Stream', url: src }] : [];
  });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');

  const active = tracks[index] || null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (Array.isArray(initialTracks) && initialTracks.length) {
        setTracks(initialTracks);
        return;
      }
      if (!src) return;
      if (isPlaylistUrl(src)) {
        setLoadingList(true);
        setError('');
        try {
          const res = await fetch(src);
          const text = await res.text();
          const parsed = parsePlaylistText(text, src);
          if (!cancelled) {
            setTracks(parsed.length ? parsed : [{ title: title || 'Playlist', url: src }]);
            setIndex(0);
          }
        } catch {
          if (!cancelled) {
            setError('تعذر تحميل قائمة التشغيل');
            setTracks([{ title: title || 'Stream', url: src }]);
          }
        } finally {
          if (!cancelled) setLoadingList(false);
        }
        return;
      }
      setTracks([{ title: title || (isDirectAudioUrl(src) ? 'Track' : 'Stream'), url: src }]);
      setIndex(0);
    }
    load();
    return () => { cancelled = true; };
  }, [src, title, initialTracks]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !active?.url) return;
    el.volume = volume;
    el.load();
    if (playing) {
      el.play().catch(() => setPlaying(false));
    }
  }, [active?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  const progress = useMemo(() => {
    if (!duration) return 0;
    return Math.min(100, Math.max(0, (current / duration) * 100));
  }, [current, duration]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    try {
      await el.play();
      setPlaying(true);
    } catch {
      setError('تعذر تشغيل الملف الصوتي');
      setPlaying(false);
    }
  };

  const prev = () => {
    setIndex((i) => (tracks.length ? (i - 1 + tracks.length) % tracks.length : 0));
    setPlaying(true);
  };

  const next = () => {
    setIndex((i) => (tracks.length ? (i + 1) % tracks.length : 0));
    setPlaying(true);
  };

  const seek = (e) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(el.currentTime);
  };

  return (
    <div className="winamp-skin" dir="ltr">
      <div className="winamp-titlebar">
        <span className="winamp-logo">WINAMP</span>
        <span className="winamp-sub">English Mastery</span>
      </div>

      <div className="winamp-body">
        <div className="winamp-lcd">
          <div className="winamp-lcd-row">
            <span className="winamp-time">{formatTime(current)}</span>
            <span className="winamp-status">{loadingList ? 'LOAD' : playing ? 'PLAY' : 'STOP'}</span>
          </div>
          <div className="winamp-marquee" title={active?.title || title}>
            {active?.title || title || 'No track'}
            {tracks.length > 1 ? `  ·  ${index + 1}/${tracks.length}` : ''}
          </div>
          <div className="winamp-seek" onClick={seek} role="presentation">
            <div className="winamp-seek-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="winamp-controls">
          <button type="button" className="winamp-btn" onClick={prev} title="Previous" disabled={tracks.length < 2}>
            <SkipBack className="w-4 h-4" />
          </button>
          <button type="button" className="winamp-btn winamp-btn-main" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button type="button" className="winamp-btn" onClick={next} title="Next" disabled={tracks.length < 2}>
            <SkipForward className="w-4 h-4" />
          </button>
          <div className="winamp-vol">
            <Volume2 className="w-3.5 h-3.5" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>
        </div>

        {tracks.length > 1 && (
          <div className="winamp-playlist">
            {tracks.map((t, i) => (
              <button
                key={`${t.url}-${i}`}
                type="button"
                className={`winamp-track ${i === index ? 'active' : ''}`}
                onClick={() => { setIndex(i); setPlaying(true); }}
              >
                <span className="winamp-track-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="winamp-track-name">{t.title || `Track ${i + 1}`}</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="winamp-error">{error}</div>}
      </div>

      <audio
        ref={audioRef}
        src={active?.url || ''}
        preload="metadata"
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime || 0)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={next}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setError('تعذر تشغيل هذا المسار')}
      />
    </div>
  );
}
