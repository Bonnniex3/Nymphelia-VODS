/*
 * 7TV emotes: optional enrichment of already-parsed chat fragments (no React, no DOM),
 * unit-tested in sevenTv.test.js. The stored chat text is never changed: 7TV words in
 * plain-text fragments are split out at render time into extra emote fragments.
 *
 * The emote sets are the CURRENT 7TV global set and the CURRENT channel set, not a
 * snapshot of what was available when the stream aired (display-only enrichment).
 */
import { MAX_URL, safeHttpsUrl } from "./replay";
import { readChatResponse } from "./useChatReplay";

export const SEVENTV_API = "https://7tv.io/v3";
export const SEVENTV_CDN = "https://cdn.7tv.app/emote";

/** Sets are small (global ~hundreds, big channels a few thousand); this only stops absurd payloads. */
export const MAX_EMOTES = 20_000;
export const MAX_NAME = 100;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;
/** A fully loaded pair of sets is reused this long; a failed/partial one is retried sooner. */
export const OK_TTL_MS = 30 * 60_000;
export const RETRY_TTL_MS = 60_000;

/** The shared "nothing yet" map, so consumers keep one stable identity until real emotes arrive. */
export const NO_EMOTES = new Map();

const EMOTE_ID = /^[A-Za-z0-9]{8,40}$/;
const CHANNEL_ID = /^[0-9]{1,20}$/;
// Only the official CDN host, with an emote-id path: no ports, credentials, queries or other hosts.
const HOST_URL = /^(?:https:)?\/\/cdn\.7tv\.app\/emote\/([A-Za-z0-9]{8,40})\/?$/;
const FILE_NAME = /^[1-4]x\.(?:webp|avif|gif|png)$/;
// Animated webp keeps its animation, so every webp size beats gif/png; png is static-only.
const WEBP_FILES = ["2x.webp", "3x.webp", "4x.webp", "1x.webp"];
const ANIMATED_FALLBACK = ["2x.gif", "3x.gif", "1x.gif", "4x.gif"];
const STATIC_FALLBACK = ["2x.png", "3x.png", "1x.png", "4x.png"];
// Same set of characters replay.js strips from chat text, plus any whitespace: an alias is one word.
// eslint-disable-next-line no-control-regex
const BAD_NAME = /[\s\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;

/** The channel's numeric Twitch id as a string, or "" when it isn't a plain number. */
export function normalizeChannelId(value) {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof id === "string" && CHANNEL_ID.test(id) ? id : "";
}

/**
 * The https URL of one emote image on the official CDN, or null.
 * It is built from a validated emote id and a file name that is both well-formed and
 * actually listed, never copied from the response, so the API can't point us elsewhere.
 */
export function emoteImageUrl(host, animated) {
  if (!host || typeof host !== "object" || typeof host.url !== "string" || host.url.length > MAX_URL || !Array.isArray(host.files)) return null;
  const match = HOST_URL.exec(host.url);
  if (!match) return null;
  const listed = new Set();
  for (const file of host.files) {
    if (file && typeof file === "object" && typeof file.name === "string" && FILE_NAME.test(file.name)) listed.add(file.name);
  }
  const order = [...WEBP_FILES, ...(animated === true ? ANIMATED_FALLBACK : STATIC_FALLBACK)];
  const name = order.find((n) => listed.has(n));
  return name ? safeHttpsUrl(`${SEVENTV_CDN}/${match[1]}/${name}`) : null;
}

/**
 * The word chat types to get this emote, or "". The active entry's own name (the channel's
 * alias) wins over the emote's original name; an alias that is present but unusable is
 * skipped rather than silently replaced by the original name.
 */
export function emoteWord(entry) {
  const name = typeof entry.name === "string" ? entry.name : entry.name == null ? entry.data?.name : undefined;
  return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME && !BAD_NAME.test(name) ? name : "";
}

/**
 * One emote-set document (`{ emotes: [...] }`) → `Map<word, imageUrl>`, or null if it isn't
 * an emote set at all. Bad entries are dropped individually; the first entry of a word wins.
 */
export function parseEmoteSet(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.emotes)) return null;
  const emotes = new Map();
  for (const entry of doc.emotes.slice(0, MAX_EMOTES)) {
    if (!entry || typeof entry !== "object") continue;
    const word = emoteWord(entry);
    if (!word || emotes.has(word)) continue;
    const url = emoteImageUrl(entry.data?.host, entry.data?.animated);
    if (url) emotes.set(word, url);
  }
  return emotes;
}

/** `/users/twitch/{id}` → the channel's active emote set; a user with no set is a valid empty channel. */
export function parseChannelSet(doc) {
  if (!doc || typeof doc !== "object") return null;
  return doc.emote_set == null ? new Map() : parseEmoteSet(doc.emote_set);
}

/** Global first, channel on top: a channel emote replaces a global one with the same word. */
export function mergeEmotes(globalSet, channelSet) {
  const merged = new Map(globalSet ?? []);
  for (const [word, url] of channelSet ?? []) merged.set(word, url);
  return merged;
}

/**
 * Split plain-text fragments so that every whitespace-delimited word that is exactly (case-
 * sensitively) a 7TV emote becomes its own `{ text, emoteUrl }` fragment. Everything else,
 * including all whitespace and punctuation, stays byte-for-byte in text fragments, and
 * fragments that already carry an emoteUrl (Twitch's own emotes) are never touched.
 * Returns the very same array when nothing matched, so memoised rows stay memoised.
 */
export function enrichFragments(fragments, emotes) {
  if (!emotes || emotes.size === 0 || !Array.isArray(fragments) || fragments.length === 0) return fragments;
  const out = [];
  let changed = false;
  let run = "";
  let before = ""; // text of the non-text fragment just before this run
  // Consecutive text fragments are one string: a word may straddle a fragment boundary.
  // A word touching a neighbouring emote fragment without whitespace between them is part
  // of a longer whitespace-delimited token ("helloKappa"), so it isn't a 7TV word.
  const flush = (after) => {
    if (!run) return;
    const words = run.split(/(\s+)/);
    const last = words.length - 1;
    let plain = "";
    words.forEach((word, i) => {
      const touching = (i === 0 && before !== "" && !/\s$/.test(before)) || (i === last && after !== "" && !/^\s/.test(after));
      const emoteUrl = word && !touching ? emotes.get(word) : undefined;
      if (!emoteUrl) {
        plain += word;
        return;
      }
      if (plain) out.push({ text: plain });
      plain = "";
      out.push({ text: word, emoteUrl });
      changed = true;
    });
    if (plain) out.push({ text: plain });
    run = "";
  };
  for (const f of fragments) {
    if (f.emoteUrl) {
      flush(f.text);
      out.push(f);
      before = f.text;
    } else {
      run += f.text;
    }
  }
  flush("");
  return changed ? out : fragments;
}

/**
 * A loader with its own cache. One request per channel at a time is shared by everyone who
 * asks; results are reused for a finite TTL; every request has a timeout. `load` never
 * rejects: any failure just means "no emotes" (or the previous good copy of that set).
 */
export function createSevenTvLoader({ fetchImpl, now = Date.now, okTtl = OK_TTL_MS, retryTtl = RETRY_TTL_MS, timeoutMs = REQUEST_TIMEOUT_MS, api = SEVENTV_API } = {}) {
  const entries = new Map(); // key -> { emotes, globalSet, channelSet, expires }
  const inflight = new Map(); // key -> Promise<Map>

  const fresh = (key) => {
    const entry = entries.get(key);
    return entry && entry.expires > now() ? entry : null;
  };

  async function fetchSet(url, parse) {
    const doFetch = fetchImpl ?? globalThis.fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`7TV answered ${res.status}`);
      const set = parse(await readChatResponse(res, MAX_RESPONSE_BYTES));
      if (!set) throw new Error("7TV answered with an unexpected document");
      return set;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(key, channelId) {
    const previous = entries.get(key);
    const [g, c] = await Promise.allSettled([
      fetchSet(`${api}/emote-sets/global`, parseEmoteSet),
      channelId ? fetchSet(`${api}/users/twitch/${channelId}`, parseChannelSet) : Promise.resolve(null),
    ]);
    // A set that failed keeps its previous good copy; the entry is retried soon instead of reused for long.
    const globalSet = g.status === "fulfilled" ? g.value : (previous?.globalSet ?? null);
    const channelSet = c.status === "fulfilled" ? c.value : (previous?.channelSet ?? null);
    const complete = g.status === "fulfilled" && c.status === "fulfilled";
    const emotes = globalSet || channelSet ? mergeEmotes(globalSet, channelSet) : NO_EMOTES;
    entries.set(key, { emotes, globalSet, channelSet, expires: now() + (complete ? okTtl : retryTtl) });
    return emotes;
  }

  return {
    /** The cached emotes for this channel if still fresh, else null. */
    peek: (channelId) => fresh(normalizeChannelId(channelId) || "global")?.emotes ?? null,
    /** Cached, shared or newly fetched emotes: global set plus the channel's, if its id is a valid number. */
    load(channelId) {
      const id = normalizeChannelId(channelId);
      const key = id || "global";
      const hit = fresh(key);
      if (hit) return Promise.resolve(hit.emotes);
      let request = inflight.get(key);
      if (!request) {
        request = refresh(key, id)
          .catch(() => NO_EMOTES)
          .finally(() => inflight.delete(key));
        inflight.set(key, request);
      }
      return request;
    },
    clear() {
      entries.clear();
    },
  };
}

/** The loader the app uses; the cache lives for the page session and is shared by every mount. */
export const sevenTv = createSevenTvLoader();

/**
 * Ask for a channel's emotes and get `onLoad(emotes)` at most once. The returned `cancel()`
 * (called on unmount or channel change) guarantees no callback happens afterwards, so a slow
 * response can't update state that no longer wants it. The request itself is shared and
 * continues, which only warms the cache.
 */
export function watchSevenTv(channelId, onLoad, loader = sevenTv) {
  let live = true;
  loader.load(channelId).then((emotes) => {
    if (live) onLoad(emotes);
  });
  return () => {
    live = false;
  };
}
