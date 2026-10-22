/*
 * Chat replay: pure logic (no React, no DOM), unit-tested in replay.test.js.
 * The sidecar contract (written by scripts/chat-sync): { version, twitchVodId, videoFile, offsetSeconds, messages }.
 */

export const CHAT_VERSION = 1;

// Hard limits so a bad or hostile sidecar can't bloat memory or the DOM.
export const MAX_MESSAGES = 300_000;
export const MAX_FRAGMENTS = 100;
export const MAX_TEXT = 500;
export const MAX_USER = 40;
export const MAX_URL = 512;
/** Sidecar URLs carry the percent-encoded video name, so they get more room than emote URLs. */
export const MAX_CHAT_URL = 2048;
// Chat badges: images arrive once in the sidecar's `badgeCatalog` as PNG data URLs.
export const MAX_BADGE_CATALOG = 128;
export const MAX_BADGE_BYTES = 32 * 1024;
export const MAX_BADGE_TOTAL_BYTES = 2 * 1024 * 1024;
export const MAX_BADGE_DIMENSION = 256;
export const MAX_BADGE_TITLE = 64;
export const MAX_MESSAGE_BADGES = 8;
/** Rows kept in the DOM at once: the newest MAX_ROWS messages up to "now". */
export const MAX_ROWS = 120;

// C0/C1 controls, line/paragraph separators, bidi embeddings/isolates, BOM.
// Zero-width joiner (U+200D) stays: emoji sequences need it.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

export const cleanText = (value, max) => (typeof value === "string" ? value.replace(UNSAFE_CHARS, "").trim().slice(0, max) : "");

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** The URL as a string if it is a plain https URL (no credentials), else null. */
export function safeHttpsUrl(value, max = MAX_URL) {
  if (typeof value !== "string" || value.length > max) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url.href;
}

/**
 * Where to fetch the sidecar from: an https URL, or a same-origin path when
 * `base` (the page URL) is given. Anything else (http, data:, javascript:,
 * cross-origin relative tricks like `//host/x`) is refused.
 */
export function safeChatUrl(value, base) {
  const absolute = safeHttpsUrl(value, MAX_CHAT_URL);
  if (absolute) return absolute;
  if (typeof value !== "string" || value.length > MAX_CHAT_URL || !base || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  try {
    const url = new URL(value, base);
    return url.origin === new URL(base).origin ? url.href : null;
  } catch {
    return null;
  }
}

const BADGE_IMAGE_PREFIX = "data:image/png;base64,";
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BADGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BADGE_VERSION_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_BADGE_B64 = Math.ceil(MAX_BADGE_BYTES / 3) * 4;
const badgeKey = (id, version) => `${id}/${version}`;

/** The colour if it is a `#rrggbb` string, else null. Kept as written. */
export const safeColor = (value) => (typeof value === "string" && COLOR_RE.test(value) ? value : null);

/**
 * The decoded byte size of a PNG data URL if it is well formed, else 0: canonical base64,
 * at most MAX_BADGE_BYTES, a real PNG signature + IHDR, and at most MAX_BADGE_DIMENSION
 * pixels each way (so a tiny payload can't declare a huge image).
 */
export function badgeImageSize(value) {
  if (typeof value !== "string" || !value.startsWith(BADGE_IMAGE_PREFIX)) return 0;
  const payload = value.slice(BADGE_IMAGE_PREFIX.length);
  if (payload.length < 32 || payload.length > MAX_BADGE_B64 || payload.length % 4 !== 0 || !BASE64_RE.test(payload)) return 0;
  const bytes = (payload.length / 4) * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (bytes > MAX_BADGE_BYTES) return 0;
  let head;
  try {
    head = atob(payload.slice(0, 32)); // 24 bytes: signature, IHDR length + type, width, height
  } catch {
    return 0;
  }
  const u32 = (at) => ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0;
  if (!payload.startsWith("iVBORw0KGgo") || u32(8) !== 13 || head.slice(12, 16) !== "IHDR") return 0;
  const width = u32(16);
  const height = u32(20);
  return width >= 1 && height >= 1 && width <= MAX_BADGE_DIMENSION && height <= MAX_BADGE_DIMENSION ? bytes : 0;
}

/**
 * `badgeCatalog` → Map of `id/version` → `{ id, version, title, imageUrl }`. Malformed entries
 * are skipped; the count and total image size are capped. The objects are shared by every
 * message that references them, so a badge is held in memory once.
 */
export function parseBadgeCatalog(raw) {
  const catalog = new Map();
  if (!Array.isArray(raw)) return catalog;
  let total = 0;
  for (const entry of raw.slice(0, MAX_BADGE_CATALOG)) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || !BADGE_ID_RE.test(entry.id) || typeof entry.version !== "string" || !BADGE_VERSION_RE.test(entry.version)) continue;
    const key = badgeKey(entry.id, entry.version);
    if (catalog.has(key)) continue;
    const size = badgeImageSize(entry.imageUrl);
    if (!size || total + size > MAX_BADGE_TOTAL_BYTES) continue;
    total += size;
    catalog.set(key, Object.freeze({ id: entry.id, version: entry.version, title: cleanText(entry.title, MAX_BADGE_TITLE) || entry.id, imageUrl: entry.imageUrl }));
  }
  return catalog;
}

/** A message's `badges` references → the shared catalog objects (unknown or repeated refs ignored). */
function resolveBadges(raw, catalog) {
  const out = [];
  if (!catalog?.size || !Array.isArray(raw)) return out;
  for (const ref of raw.slice(0, MAX_MESSAGE_BADGES)) {
    if (!ref || typeof ref !== "object") continue;
    const badge = catalog.get(badgeKey(ref.id, ref.version));
    if (badge && !out.includes(badge)) out.push(badge);
  }
  return out;
}

function normalizeFragments(raw, text) {
  const out = [];
  let remaining = MAX_TEXT;
  if (Array.isArray(raw)) {
    for (const frag of raw.slice(0, MAX_FRAGMENTS)) {
      if (!frag || typeof frag !== "object") continue;
      // Twitch fragments are consecutive substrings, including their whitespace.
      const fragText = typeof frag.text === "string" ? frag.text.replace(UNSAFE_CHARS, "").slice(0, remaining) : "";
      if (!fragText) continue;
      const emoteUrl = safeHttpsUrl(frag.emoteUrl);
      out.push(emoteUrl ? { text: fragText, emoteUrl } : { text: fragText });
      remaining -= fragText.length;
      if (!remaining) break;
    }
  }
  return out.length ? out : text ? [{ text }] : [];
}

/**
 * One raw message → `{ id, offsetSeconds, user, text, fragments, color?, badges? }`, or null if
 * unusable. `catalog` is the parsed badge Map; bad colour/badge metadata is ignored, never the message.
 */
export function normalizeMessage(raw, index, catalog) {
  if (!raw || typeof raw !== "object" || !isNum(raw.offsetSeconds) || raw.offsetSeconds < 0) return null;
  const user = cleanText(raw.user, MAX_USER);
  let fragments = normalizeFragments(raw.fragments, cleanText(raw.text, MAX_TEXT));
  const text = cleanText(raw.text, MAX_TEXT) || cleanText(fragments.map((f) => f.text).join(""), MAX_TEXT);
  if (!fragments.length && text) fragments = [{ text }];
  if (!user && !text) return null;
  const id = typeof raw.id === "string" || isNum(raw.id) ? cleanText(String(raw.id), 64) : "";
  const message = { id: id || String(index), offsetSeconds: raw.offsetSeconds, user: user || "anon", text, fragments };
  const color = safeColor(raw.color);
  if (color) message.color = color;
  const badges = resolveBadges(raw.badges, catalog);
  if (badges.length) message.badges = badges;
  return message;
}

const err = (code, message) => ({ ok: false, code, message });

/**
 * Validate and normalise a sidecar document.
 *   expect.videoFile: the VOD's exact file name; a sidecar for another file is refused.
 * Returns `{ ok: true, replay }` or `{ ok: false, code, message }`.
 * `replay.offsetSeconds` is the document's own offset (null when absent).
 */
export function parseChatReplay(doc, expect = {}) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return err("invalid", "chat file is not a JSON object");
  if (doc.version !== CHAT_VERSION) return err("version", `unsupported chat version ${JSON.stringify(doc.version) ?? "(none)"}`);
  if (typeof doc.videoFile !== "string" || !doc.videoFile) return err("invalid", "chat file has no videoFile");
  if (expect.videoFile && doc.videoFile !== expect.videoFile) return err("mismatch", "this chat belongs to a different video file");
  const twitchVodId = typeof doc.twitchVodId === "string" ? doc.twitchVodId : Number.isSafeInteger(doc.twitchVodId) ? String(doc.twitchVodId) : "";
  if (!/^[0-9]{1,20}$/.test(twitchVodId)) return err("invalid", "chat file has no valid Twitch VOD id");
  if (expect.twitchVodId != null && twitchVodId !== String(expect.twitchVodId)) return err("mismatch", "this chat belongs to a different Twitch VOD");
  if (!Array.isArray(doc.messages)) return err("invalid", "chat file has no messages list");

  const catalog = parseBadgeCatalog(doc.badgeCatalog);
  const source = doc.messages.length > MAX_MESSAGES ? doc.messages.slice(0, MAX_MESSAGES) : doc.messages;
  const messages = [];
  const seen = new Set();
  let sorted = true;
  source.forEach((raw, i) => {
    const msg = normalizeMessage(raw, i, catalog);
    if (!msg) return;
    // Only deduplicate supplied IDs; generated index IDs do not identify comments.
    const suppliedId = typeof raw.id === "string" ? raw.id : isNum(raw.id) ? String(raw.id) : "";
    if (suppliedId) {
      if (seen.has(suppliedId)) return;
      seen.add(suppliedId);
    }
    if (messages.length && msg.offsetSeconds < messages[messages.length - 1].offsetSeconds) sorted = false;
    messages.push(msg);
  });
  // countUpTo() binary-searches, so the list must be ordered (Array#sort is stable).
  if (!sorted) messages.sort((a, b) => a.offsetSeconds - b.offsetSeconds);

  return {
    ok: true,
    replay: {
      twitchVodId,
      videoFile: doc.videoFile,
      offsetSeconds: isNum(doc.offsetSeconds) ? doc.offsetSeconds : null,
      messages,
      badgeCatalog: [...catalog.values()],
      dropped: source.length - messages.length,
      truncated: doc.messages.length > MAX_MESSAGES,
    },
  };
}

/**
 * The single source of the chat↔video offset: the manifest's `vod.chat.offsetSeconds`
 * if it is a number, else the sidecar's own `offsetSeconds`, else 0.
 */
export function resolveOffset(manifestChat, replayOffset) {
  if (isNum(manifestChat?.offsetSeconds)) return manifestChat.offsetSeconds;
  if (isNum(replayOffset)) return replayOffset;
  return 0;
}

/** Explicit mapping, never inferred from durations: chatTime = videoTime + offset. */
export const chatTime = (videoTime, offset) => videoTime + offset;

/** Inverse of chatTime: where in the video a message at `chatSeconds` sits. */
export const videoTimeOf = (chatSeconds, offset) => Math.max(0, chatSeconds - offset);

/** How many messages (of an offset-sorted list) have `offsetSeconds <= t`. Binary search. */
export function countUpTo(messages, t) {
  if (!Number.isFinite(t)) return 0;
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (messages[mid].offsetSeconds <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The slice [start, end) of rows to render when `end` messages have happened. */
export const windowStart = (end, max = MAX_ROWS) => Math.max(0, end - max);

/** Stable pick of one of `n` name colours, so a chatter keeps theirs. */
export function colorIndex(user, n) {
  let h = 0;
  for (let i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) >>> 0;
  return h % n;
}
