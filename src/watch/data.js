import { ALL_VODS } from "../lib/vods";
import { convertTimestamp, makeSlug } from "../lib/helpers";

// ── Slugs ────────────────────────────────────────────────────────────────────
// Same lookup as `ALL_VODS.find((v) => makeSlug(v) === slug)` (first match wins),
// computed once instead of on every navigation.
const SLUG_BY_ID = new Map();
const VOD_BY_SLUG = new Map();
for (const vod of ALL_VODS) {
  const slug = makeSlug(vod);
  SLUG_BY_ID.set(vod.id, slug);
  if (!VOD_BY_SLUG.has(slug)) VOD_BY_SLUG.set(slug, vod);
}

export const findVod = (slug) => (slug ? VOD_BY_SLUG.get(slug) ?? null : null);
export const slugOf = (vod) => SLUG_BY_ID.get(vod.id) ?? makeSlug(vod);
export const vodPath = (vod) => `/vod/${slugOf(vod)}`;

// 1-based stream number, oldest first (ALL_VODS is newest-first).
export const streamNumber = (vod) => {
  const i = ALL_VODS.findIndex((v) => v.id === vod.id);
  return i === -1 ? null : ALL_VODS.length - i;
};

// ── Source ───────────────────────────────────────────────────────────────────
const CDN_BASE = "https://archive.org/download";

// `video_url` from the manifest, else the Internet Archive naming convention.
export const sourceOf = (vod) => vod.video_url || `${CDN_BASE}/${vod.id}/${vod.id}.mp4`;

export const driveLink = (vod) => {
  const live = Array.isArray(vod.drive) ? vod.drive.filter((d) => d.type === "live") : [];
  return live[0] ? `https://drive.google.com/u/2/open?id=${live[0].id}` : null;
};

// ── Resume position (localStorage, same key as the old player) ───────────────
const positionKey = (id) => `video-position-${id}`;

export function readPosition(id) {
  try {
    const value = parseFloat(localStorage.getItem(positionKey(id)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function savePosition(id, seconds) {
  if (!(seconds > 0)) return;
  try {
    localStorage.setItem(positionKey(id), seconds);
  } catch {
    /* storage full / blocked: resume is a nicety */
  }
}

export function clearPosition(id) {
  try {
    localStorage.removeItem(positionKey(id));
  } catch {
    /* ignore */
  }
}

// ── Clip links: ?s=1h2m3s&e=1h3m0s&n=name ────────────────────────────────────
export const CLIP_NAME_MAX = 80;

export function parseClip(params) {
  const s = params.get("s");
  const e = params.get("e");
  const start = s !== null ? convertTimestamp(s) : null;
  const end = e !== null ? convertTimestamp(e) : null;
  if (start == null || end == null || !(start < end)) return null;
  const raw = params.get("n");
  const name = raw ? raw.trim().slice(0, CLIP_NAME_MAX) : null;
  return { start, end, name: name || null };
}

// ── Chapters ─────────────────────────────────────────────────────────────────
// Chapter records are { name, image, start, end } where `end` is the chapter's
// *length* in seconds (Twitch API shape), not an absolute end time.

// The chapter playing at `t` (seconds on the VOD timeline): the last one that
// has started, so gaps between chapters keep the previous one highlighted.
export function activeChapterIndex(chapters, t) {
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= t) idx = i;
    else break;
  }
  return idx;
}

// Older Twitch box-art links carry a {width}x{height} template.
export const chapterArt = (link) => (link ? link.replace("{width}x{height}", "80x106") : null);
