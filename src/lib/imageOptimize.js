/** Compress/resize an image file in the browser before upload. */
export async function optimizeImageFile(file, options = {}) {
  const {
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.72,
    mimeType = 'image/webp',
  } = options;

  if (!file || !file.type?.startsWith('image/')) return file;
  // Keep animated GIFs as-is
  if (file.type === 'image/gif') return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  let { width, height } = bitmap;
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  const tw = Math.max(1, Math.round(width * ratio));
  const th = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close?.();

  // Prefer WebP; fall back to JPEG if browser rejects webp blob
  const tryTypes = mimeType === 'image/webp'
    ? ['image/webp', 'image/jpeg']
    : [mimeType, 'image/jpeg'];

  let best = null;
  for (const type of tryTypes) {
    const q = type === 'image/webp' ? quality : Math.min(quality, 0.78);
    // eslint-disable-next-line no-await-in-loop
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), type, q);
    });
    if (blob && blob.size > 0) {
      if (!best || blob.size < best.blob.size) best = { blob, type };
    }
  }

  if (!best || best.blob.size >= file.size * 0.98) return file;

  const base = (file.name || 'image').replace(/\.[^.]+$/, '');
  const ext = best.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([best.blob], `${base}.${ext}`, {
    type: best.type,
    lastModified: Date.now(),
  });
}

export const HOMEPAGE_IMAGE_CACHE_KEY = 'em_homepage_image_url_v1';

export function readCachedHomepageImage() {
  try {
    const raw = localStorage.getItem(HOMEPAGE_IMAGE_CACHE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    if (parsed?.url && typeof parsed.url === 'string') return parsed.url;
  } catch {
    /* ignore */
  }
  return '';
}

export function writeCachedHomepageImage(url) {
  try {
    if (!url) {
      localStorage.removeItem(HOMEPAGE_IMAGE_CACHE_KEY);
      return;
    }
    localStorage.setItem(
      HOMEPAGE_IMAGE_CACHE_KEY,
      JSON.stringify({ url, ts: Date.now() })
    );
  } catch {
    /* ignore quota */
  }
}

/** Start network + browser decode as early as possible */
export function preloadImage(url) {
  if (!url || typeof document === 'undefined') return;

  try {
    const sel = `link[data-em-preload="${CSS.escape(url)}"]`;
    if (!document.querySelector(sel)) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = url;
      link.setAttribute('fetchpriority', 'high');
      link.setAttribute('data-em-preload', url);
      document.head.appendChild(link);
    }
  } catch {
    /* CSS.escape may fail — still warm Image() below */
  }

  // Warm HTTP + decode cache without blocking render
  try {
    const img = new Image();
    img.decoding = 'async';
    if ('fetchPriority' in img) img.fetchPriority = 'high';
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
