import RAW_VODS from "../vods/data/vods.json";
import { toSeconds } from "./helpers";

const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

export const ALL_VODS = [...RAW_VODS].sort(byNewest);

export const durationSeconds = (vod) => {
  const secs = toSeconds(String(vod?.duration || "0"));
  return Number.isFinite(secs) ? secs : 0;
};

// Explicit `category` wins; otherwise fall back to the IA item naming convention.
export const categoryOf = (vod) => {
  if (vod.category) return String(vod.category).toLowerCase();
  return (vod.item_id || "").toUpperCase().includes("GAMING") ? "gaming" : "stream";
};

export const yearOf = (vod) => new Date(vod.createdAt).getUTCFullYear();

export const SORTS = [
  { id: "newest", label: "newest" },
  { id: "oldest", label: "oldest" },
  { id: "longest", label: "longest" },
  { id: "shortest", label: "shortest" },
  { id: "az", label: "a → z" },
];

const SORTERS = {
  newest: byNewest,
  oldest: (a, b) => byNewest(b, a),
  longest: (a, b) => durationSeconds(b) - durationSeconds(a),
  shortest: (a, b) => durationSeconds(a) - durationSeconds(b),
  az: (a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }),
};

export function queryVods(vods, { q = "", sort = "newest", year = "all", category = "all" } = {}) {
  const needle = q.trim().toLowerCase();
  const filtered = vods.filter((vod) => {
    if (needle && !(vod.title || "").toLowerCase().includes(needle)) return false;
    if (year !== "all" && String(yearOf(vod)) !== String(year)) return false;
    if (category !== "all" && categoryOf(vod) !== category) return false;
    return true;
  });
  return filtered.sort(SORTERS[sort] || SORTERS.newest);
}

const countBy = (vods, keyFn) => {
  const counts = new Map();
  for (const vod of vods) counts.set(keyFn(vod), (counts.get(keyFn(vod)) || 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
};

export function facets(vods) {
  return {
    years: countBy(vods, yearOf).sort((a, b) => b.value - a.value),
    categories: countBy(vods, categoryOf).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Totals plus a 12-month streams-per-month histogram ending at the newest VOD (or now).
export function archiveStats(vods, now = new Date()) {
  const seconds = vods.reduce((sum, vod) => sum + durationSeconds(vod), 0);
  const dates = vods.map((v) => new Date(v.createdAt)).sort((a, b) => b - a);
  const end = dates[0] || now;
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: MONTHS[d.getUTCMonth()], count: 0 });
  }
  const index = new Map(months.map((m, i) => [m.key, i]));
  for (const d of dates) {
    const i = index.get(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
    if (i !== undefined) months[i].count += 1;
  }
  const longest = vods.reduce((max, vod) => Math.max(max, durationSeconds(vod)), 0);
  return {
    count: vods.length,
    hours: seconds / 3600,
    avgSeconds: vods.length ? seconds / vods.length : 0,
    longestSeconds: longest,
    latest: dates[0] || null,
    first: dates[dates.length - 1] || null,
    perMonth: months,
  };
}

// The VODs either side of `vod` in date order, for "up next" style navigation.
export function neighbours(vod, vods = ALL_VODS) {
  const i = vods.findIndex((v) => v.id === vod.id);
  if (i === -1) return { newer: null, older: null };
  return { newer: vods[i - 1] || null, older: vods[i + 1] || null };
}

// Stable, human-friendly number for each VOD: №001 is the oldest stream.
const NUMBERS = new Map([...ALL_VODS].reverse().map((v, i) => [v.id, i + 1]));
export const vodNumber = (vod) => String(NUMBERS.get(vod.id) ?? 0).padStart(3, "0");

export const isNew = (vod, now = Date.now()) => now - new Date(vod.createdAt).getTime() < 7 * 24 * 3600 * 1000;

// Watch progress saved by the player (`video-position-<id>` in localStorage), as 0–1.
export function savedProgress(vod) {
  try {
    const seconds = parseFloat(localStorage.getItem(`video-position-${vod.id}`));
    const total = durationSeconds(vod);
    if (!Number.isFinite(seconds) || seconds < 30 || !total) return null;
    return Math.min(seconds / total, 1);
  } catch {
    return null;
  }
}
