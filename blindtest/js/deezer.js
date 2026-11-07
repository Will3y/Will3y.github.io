// Accès à l'API publique Deezer (sans compte).
// L'API ne renvoie pas d'en-têtes CORS : on passe par JSONP (balise <script>).
// Les liens d'extraits (preview) expirent au bout d'environ 15 minutes :
// on redemande toujours le morceau juste avant de le jouer (getFreshPreview).

let seq = 0;

export function dz(path, { timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const cb = `__dz_${Date.now().toString(36)}_${seq++}`;
    const script = document.createElement('script');
    let done = false;
    const finish = () => {
      done = true;
      clearTimeout(timer);
      script.remove();
      // On laisse une fonction vide au cas où la réponse arrive après le délai.
      window[cb] = () => { delete window[cb]; };
    };
    const timer = setTimeout(() => { if (!done) { finish(); reject(new Error('timeout')); } }, timeout);
    window[cb] = (data) => {
      if (done) return;
      finish();
      delete window[cb];
      if (data && data.error) {
        const err = new Error(data.error.message || 'Erreur Deezer');
        err.dzType = data.error.type;
        err.dzCode = data.error.code;
        reject(err);
      } else resolve(data);
    };
    script.onerror = () => { if (!done) { finish(); reject(new Error('network')); } };
    const sep = path.includes('?') ? '&' : '?';
    script.src = `https://api.deezer.com${path}${sep}output=jsonp&callback=${cb}`;
    document.head.appendChild(script);
  });
}

export async function searchPlaylists(query) {
  const r = await dz(`/search/playlist?q=${encodeURIComponent(query)}&limit=18`);
  return (r.data || []).map(simplifyPlaylist);
}

export async function getPlaylist(id) {
  return simplifyPlaylist(await dz(`/playlist/${id}`));
}

export async function getPlaylistTracks(id, max = 500) {
  const out = [];
  let index = 0;
  while (out.length < max) {
    const r = await dz(`/playlist/${id}/tracks?limit=100&index=${index}`);
    const page = r.data || [];
    out.push(...page);
    if (!r.next || page.length === 0) break;
    index += page.length;
  }
  return out.filter((t) => t && t.readable !== false && t.preview).map(simplifyTrack);
}

/** Redemande le morceau pour avoir un lien d'extrait valide. */
export async function getFreshPreview(trackId) {
  let t;
  try {
    t = await dz(`/track/${trackId}`);
  } catch (e) {
    if (e.dzType === 'DataException') return null; // morceau retiré du catalogue
    if (e.dzCode === 4) { // quota dépassé : on souffle un peu et on réessaie
      await new Promise((r) => setTimeout(r, 1500));
      t = await dz(`/track/${trackId}`);
    } else throw e;
  }
  if (!t || !t.preview || t.readable === false) return null;
  return { url: t.preview, at: Date.now(), track: simplifyTrack(t) };
}

/** Accepte un lien deezer.com/.../playlist/123 ou un identifiant. */
export function parsePlaylistInput(str) {
  const s = (str || '').trim();
  const m = s.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
  if (m) return m[1];
  if (/^\d{5,}$/.test(s)) return s;
  return null;
}

export const isShortLink = (str) => /(link\.deezer\.com|deezer\.page\.link)/i.test(str || '');

function simplifyPlaylist(p) {
  return {
    id: String(p.id),
    title: p.title,
    picture: p.picture_medium || p.picture,
    nb: p.nb_tracks,
    by: p.user?.name || p.creator?.name || '',
  };
}

function simplifyTrack(t) {
  return {
    id: t.id,
    title: t.title_short || t.title,
    artist: t.artist?.name || '',
    album: t.album?.title || '',
    cover: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
  };
}
