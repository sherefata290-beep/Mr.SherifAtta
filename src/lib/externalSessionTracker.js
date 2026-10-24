/**
 * External-link session timer.
 *
 * Continuous countdown from «بدء الحصة» until required duration.
 * Does NOT pause on idle or tab hide — time keeps running wall-clock style.
 * We cannot know YouTube/Drive watch percentage; this is only a required wait window.
 */

export const DEFAULT_EXTERNAL_REQUIRED_SECONDS = 30 * 60; // 30 minutes

export function clampSeconds(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function formatSessionClock(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Continuous wall-clock session from start until required seconds.
 * Call tick() every second while mounted.
 */
export function createExternalSessionClock({
  requiredSeconds = DEFAULT_EXTERNAL_REQUIRED_SECONDS,
  initialActiveSeconds = 0,
  startedAtIso = null,
  storageKey = null,
} = {}) {
  let required = clampSeconds(requiredSeconds, DEFAULT_EXTERNAL_REQUIRED_SECONDS);
  let startedAtMs = startedAtIso ? new Date(startedAtIso).getTime() : null;
  let startedAt = startedAtIso || null;
  let isRunning = false;
  // Seed elapsed if restoring
  let seedElapsed = clampSeconds(initialActiveSeconds, 0);
  const key = storageKey ? String(storageKey) : null;

  // Restore wall-clock start from localStorage so timer continues offline-tab
  if (!startedAtMs && key && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.started_at) {
          const t = new Date(parsed.started_at).getTime();
          if (Number.isFinite(t)) {
            startedAtMs = t;
            startedAt = parsed.started_at;
            isRunning = true;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  function persistStart() {
    if (!key || !startedAt || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ started_at: startedAt, required_seconds: required })
      );
    } catch {
      /* ignore */
    }
  }

  function clearPersist() {
    if (!key || typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function elapsedNow(now = Date.now()) {
    // Pure wall-clock from start — keeps going even if tab is hidden / student inactive
    if (startedAtMs && Number.isFinite(startedAtMs)) {
      return Math.max(0, Math.floor((now - startedAtMs) / 1000));
    }
    return Math.max(0, seedElapsed);
  }

  function snapshot(now = Date.now()) {
    const rawElapsed = startedAtMs || isRunning ? elapsedNow(now) : seedElapsed;
    const activeSeconds = required > 0 ? Math.min(rawElapsed, required) : rawElapsed;
    const percent = required > 0 ? Math.min(100, Math.round((rawElapsed / required) * 1000) / 10) : 0;
    const isEligible = required > 0 ? rawElapsed >= required : rawElapsed > 0;
    return {
      started_at: startedAt,
      last_activity_at: new Date(now).toISOString(),
      active_seconds: activeSeconds,
      // wall_elapsed can exceed required; UI uses active_seconds capped
      wall_elapsed_seconds: rawElapsed,
      eligible_seconds: activeSeconds,
      required_seconds: required,
      progress_percent: percent,
      is_running: Boolean(startedAtMs) && !isEligible,
      is_idle: false,
      is_page_visible: true,
      // Counting is wall-clock based — never depends on focus/activity
      is_counting: Boolean(startedAtMs) && !isEligible,
      is_eligible: isEligible,
    };
  }

  function start(now = Date.now()) {
    if (!startedAtMs) {
      // Fresh start from this moment (or resume seeded progress by backdating)
      if (seedElapsed > 0) {
        startedAtMs = now - seedElapsed * 1000;
      } else {
        startedAtMs = now;
      }
      startedAt = new Date(startedAtMs).toISOString();
    }
    isRunning = true;
    persistStart();
    return snapshot(now);
  }

  function tick(now = Date.now()) {
    if (!startedAtMs && !isRunning) return snapshot(now);
    const snap = snapshot(now);
    if (snap.is_eligible) {
      isRunning = false;
      seedElapsed = Math.max(seedElapsed, required);
      clearPersist();
    } else {
      isRunning = true;
      persistStart();
    }
    return snapshot(now);
  }

  function stop(now = Date.now()) {
    const snap = tick(now);
    isRunning = false;
    seedElapsed = snap.active_seconds;
    if (snap.is_eligible) clearPersist();
    return snapshot(now);
  }

  function markActivity() {
    // Continuous mode: activity does not affect the clock
    return snapshot();
  }

  function setPageVisible() {
    // Continuous mode: visibility does not pause the clock
    return snapshot();
  }

  function importState(state = {}) {
    if (state.active_seconds != null) seedElapsed = clampSeconds(state.active_seconds, seedElapsed);
    if (state.required_seconds != null) required = clampSeconds(state.required_seconds, required);
    if (state.started_at) {
      startedAt = state.started_at;
      const t = new Date(state.started_at).getTime();
      if (Number.isFinite(t)) startedAtMs = t;
    }
    return snapshot();
  }

  return {
    start,
    stop,
    tick,
    markActivity,
    setPageVisible,
    importState,
    snapshot,
    setRequired(sec) {
      required = clampSeconds(sec, required);
      return snapshot();
    },
  };
}
