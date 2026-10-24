import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Re-run `onRefresh` when:
 * - route changes (entering the page again)
 * - admin/data events fire (em:data-changed)
 * - window regains focus / tab becomes visible
 */
export default function useRefreshOnChange(onRefresh, deps = []) {
  const location = useLocation();
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;
  const lastRun = useRef(0);

  useEffect(() => {
    const run = () => {
      const now = Date.now();
      // debounce bursts (focus + visibility + event together)
      if (now - lastRun.current < 250) return;
      lastRun.current = now;
      try {
        cbRef.current?.();
      } catch (err) {
        console.error('refresh error:', err);
      }
    };

    // Initial load for this effect cycle
    run();

    const onData = () => run();
    const onFocus = () => run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    window.addEventListener('em:data-changed', onData);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('em:data-changed', onData);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, ...deps]);
}
