/**
 * Honest video watch tracker.
 * Only continuous playback counts toward watched ranges.
 * Seeking forward does NOT mark skipped segments as watched.
 */

const SEEK_JUMP_SECONDS = 1.25;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Merge overlapping/adjacent ranges */
export function mergeRanges(ranges = []) {
  const cleaned = (ranges || [])
    .map((r) => ({
      start: Number(r.start),
      end: Number(r.end),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);

  if (!cleaned.length) return [];

  const out = [{ ...cleaned[0] }];
  for (let i = 1; i < cleaned.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = cleaned[i];
    // merge if overlapping or within 0.35s
    if (cur.start <= prev.end + 0.35) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function uniqueWatchedSeconds(ranges = []) {
  return mergeRanges(ranges).reduce((sum, r) => sum + (r.end - r.start), 0);
}

export function watchPercent(ranges = [], duration = 0) {
  const d = Number(duration) || 0;
  if (d <= 0) return 0;
  const watched = uniqueWatchedSeconds(ranges);
  return clamp((watched / d) * 100, 0, 100);
}

/**
 * Mutable tracker instance for a single video session.
 */
export function createVideoWatchTracker(initial = {}) {
  let ranges = mergeRanges(initial.ranges || []);
  let lastMediaTime = Number(initial.last_position) || 0;
  let duration = Number(initial.duration) || 0;
  let maxReached = Number(initial.max_position) || lastMediaTime || 0;
  let lastWallTs = 0;

  function setDuration(d) {
    if (Number.isFinite(d) && d > 0) duration = d;
  }

  function ingestPlayback(currentTime, mediaDuration) {
    const t = Number(currentTime);
    if (!Number.isFinite(t) || t < 0) return snapshot();

    if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
      duration = mediaDuration;
    }

    maxReached = Math.max(maxReached, t);

    const now = Date.now();
    const wallDelta = lastWallTs ? (now - lastWallTs) / 1000 : 0;
    lastWallTs = now;

    const mediaDelta = t - lastMediaTime;

    // Seek / scrub detection:
    // - large forward jump in media time
    // - or media advanced much faster than wall clock (scrubbing)
    const isSeekForward = mediaDelta > SEEK_JUMP_SECONDS;
    const isSeekBackward = mediaDelta < -0.35;
    const isUnnaturalSpeed =
      wallDelta > 0 && mediaDelta > 0 && mediaDelta > Math.max(SEEK_JUMP_SECONDS, wallDelta * 2.5 + 0.75);

    if (isSeekForward || isSeekBackward || isUnnaturalSpeed) {
      // Do not fill the gap — only move the cursor
      lastMediaTime = t;
      return snapshot();
    }

    // Continuous play (or tiny stall/jitter): count [lastMediaTime, t]
    if (mediaDelta > 0.05) {
      const start = Math.max(0, lastMediaTime);
      const end = Math.max(start, t);
      if (end - start >= 0.05) {
        ranges = mergeRanges([...ranges, { start, end }]);
      }
    }

    lastMediaTime = t;
    return snapshot();
  }

  /** Mark a tiny end segment if user reached natural end while playing */
  function markEnded(mediaDuration) {
    if (Number.isFinite(mediaDuration) && mediaDuration > 0) duration = mediaDuration;
    if (duration > 0 && lastMediaTime > duration - 1.5) {
      // credit only the tail from last known continuous position, not full video
      const start = Math.max(0, Math.min(lastMediaTime, duration));
      ranges = mergeRanges([...ranges, { start, end: duration }]);
      lastMediaTime = duration;
      maxReached = Math.max(maxReached, duration);
    }
    return snapshot();
  }

  function snapshot() {
    const watched = uniqueWatchedSeconds(ranges);
    const percent = watchPercent(ranges, duration);
    return {
      ranges: mergeRanges(ranges),
      watched_seconds: Math.round(watched * 10) / 10,
      progress_percent: Math.round(percent * 10) / 10,
      last_position: Math.round(lastMediaTime * 10) / 10,
      max_position: Math.round(maxReached * 10) / 10,
      duration: Math.round(duration * 10) / 10,
    };
  }

  function importState(state = {}) {
    ranges = mergeRanges(state.ranges || ranges);
    if (state.last_position != null) lastMediaTime = Number(state.last_position) || lastMediaTime;
    if (state.max_position != null) maxReached = Number(state.max_position) || maxReached;
    if (state.duration != null) duration = Number(state.duration) || duration;
    return snapshot();
  }

  return {
    ingestPlayback,
    markEnded,
    setDuration,
    snapshot,
    importState,
  };
}

export function formatWatchTime(seconds = 0) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r} ث`;
  return `${m}:${String(r).padStart(2, '0')}`;
}
