/** Convert common external video URLs to embeddable iframe URLs */
export function getVideoEmbedUrl(url = '') {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');

    if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      // youtu.be/<id>
      if (host === 'youtu.be') {
        const id = u.pathname.split('/').filter(Boolean)[0]?.split('?')[0];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      // already embed
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.split('/').filter(Boolean)[1];
        return id ? `https://www.youtube.com/embed/${id}` : url;
      }
      // watch?v=
      const watchId = u.searchParams.get('v');
      if (watchId) return `https://www.youtube.com/embed/${watchId}`;
      // shorts / live / v
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') && parts[1]) {
        return `https://www.youtube.com/embed/${parts[1]}`;
      }
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      if (host === 'player.vimeo.com') return url;
      const id = u.pathname.split('/').filter(Boolean).find((p) => /^\d+$/.test(p));
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isDirectVideoUrl(url = '') {
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
}

export function isDirectAudioUrl(url = '') {
  return /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|wma)(\?.*)?$/i.test(url);
}

export function isPlaylistUrl(url = '') {
  return /\.(m3u8?|pls)(\?.*)?$/i.test(url);
}

export function isWinampMedia(item = {}) {
  const type = String(item.media_type || '').toLowerCase();
  if (type === 'audio' || type === 'winamp') return true;
  const url = String(item.url || '');
  return isDirectAudioUrl(url) || isPlaylistUrl(url);
}

export function isDocumentFile(item = {}) {
  const type = String(item.media_type || '').toLowerCase();
  if (type === 'file') return true;
  const url = String(item.url || '');
  return /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|zip|rar)(\?.*)?$/i.test(url);
}

/** Resolve relative playlist entries against playlist file URL */
function resolveAgainst(baseUrl, entry) {
  try {
    return new URL(entry, baseUrl).href;
  } catch {
    return entry;
  }
}

/**
 * Parse classic Winamp playlists (.m3u / .m3u8 / .pls)
 * Returns [{ title, url }]
 */
export function parsePlaylistText(text = '', baseUrl = '') {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // PLS format
  if (/^\[playlist\]/i.test(lines[0]) || lines.some((l) => /^File\d+=/i.test(l))) {
    const files = {};
    const titles = {};
    for (const line of lines) {
      const fm = line.match(/^File(\d+)=(.*)$/i);
      if (fm) {
        files[fm[1]] = fm[2].trim();
        continue;
      }
      const tm = line.match(/^Title(\d+)=(.*)$/i);
      if (tm) titles[tm[1]] = tm[2].trim();
    }
    return Object.keys(files)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => ({
        title: titles[k] || `Track ${k}`,
        url: resolveAgainst(baseUrl, files[k]),
      }))
      .filter((t) => t.url);
  }

  // M3U / M3U8
  const tracks = [];
  let pendingTitle = '';
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      pendingTitle = comma >= 0 ? line.slice(comma + 1).trim() : '';
      continue;
    }
    if (line.startsWith('#')) continue;
    tracks.push({
      title: pendingTitle || `Track ${tracks.length + 1}`,
      url: resolveAgainst(baseUrl, line),
    });
    pendingTitle = '';
  }
  return tracks.filter((t) => t.url);
}
