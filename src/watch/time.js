const pad = (n) => String(n).padStart(2, "0");

// 4523 → "1:15:23" (always shows hours so LED readouts don't jump width).
export function clock(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// 13011 → "3h 36m", 900 → "15m", 75 → "1m 15s", 42 → "42s".
export function span(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  if (h) return m ? `${h}h ${pad(m)}m` : `${h}h`;
  if (m) return sec && m < 10 ? `${m}m ${pad(sec)}s` : `${m}m`;
  return `${sec}s`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Local-time pieces of an ISO date, lowercase to match the dot-matrix type.
export function dateParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: DAYS[d.getDay()],
    date: `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export const shortDate = (iso) => dateParts(iso)?.date ?? "";

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

// "3 days ago" relative to `now` (a Date from state, so renders stay pure).
export function ago(iso, now) {
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return RTF.format(Math.round(diff / size), unit);
  }
  return "just now";
}
