import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets window scroll position on every route change.
 * Prevents landing mid-page (bottom) when navigating from long pages.
 */
export default function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // If URL has a hash anchor, let the browser handle it
    if (hash) {
      const id = hash.replace('#', '');
      // slight delay so the target exists after lazy load
      const t = window.setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
      }, 50);
      return () => window.clearTimeout(t);
    }

    // Instant jump to top (auto avoids weird mid-scroll animation)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    // Also reset common scroll containers if any exist
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  }, [pathname, search, hash]);

  return null;
}
