import { parse } from "tinyduration";

//Parse seconds to 1h2m3s format
export const toHMS = (secs) => {
  let sec_num = parseInt(secs, 10);
  let hours = Math.floor(sec_num / 3600);
  let minutes = Math.floor(sec_num / 60) % 60;
  let seconds = sec_num % 60;

  return `${hours}h${minutes}m${seconds}s`;
};

/**
 * Parse Timestamp (1h2m3s) to seconds.
 */
export const convertTimestamp = (timestamp) => {
  try {
    timestamp = parse(`PT${timestamp.toUpperCase()}`);
    timestamp = (timestamp?.hours || 0) * 60 * 60 + (timestamp?.minutes || 0) * 60 + (timestamp?.seconds || 0);
  } catch {
    timestamp = 0;
  }

  return timestamp;
};

/**
 * HHMMSS/MMSS to seconds
 */
export const toSeconds = (hms) => {
  var p = hms.split(":"),
    s = 0,
    m = 1;

  while (p.length > 0) {
    s += m * parseInt(p.pop(), 10);
    m *= 60;
  }

  return s;
};

/**
 * Build a readable, shareable URL slug from a VOD record.
 * Format: <sanitized-title>-YYYY-MM-DD-HHMM (UTC)
 * e.g. "resident-evil-requiem-2026-04-04-0202"
 */
export const makeSlug = (vod) => {
  const title = (vod.title || "")
    .toLowerCase()
    // strip emoji / pictographs / dingbats
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    // non-letter/number → dash (unicode-aware so non-English titles survive)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  const d = new Date(vod.createdAt);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hhmm = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${title}-${date}-${hhmm}`;
};

/**
 * seconds to HHMMSS
 */
export const toHHMMSS = (secs) => {
  var sec_num = parseInt(secs, 10);
  var hours = Math.floor(sec_num / 3600);
  var minutes = Math.floor(sec_num / 60) % 60;
  var seconds = sec_num % 60;

  return [hours, minutes, seconds]
    .map((v) => (v < 10 ? "0" + v : v))
    .filter((v, i) => v !== "00" || i > 0)
    .join(":");
};
