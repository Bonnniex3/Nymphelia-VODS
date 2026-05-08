const vods = require("../src/vods/data/vods.json");

const SITE_NAME = "Nymphelia VOD archive";

const makeSlug = (vod) => {
  const title = (vod.title || "")
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
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

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const parseHMS = (str) => {
  if (str == null) return null;
  const m = String(str).toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;
  const [, h, mm, s] = m;
  if (h == null && mm == null && s == null) return null;
  return parseInt(h || 0, 10) * 3600 + parseInt(mm || 0, 10) * 60 + parseInt(s || 0, 10);
};

const fmtHMS = (secs) => {
  const n = parseInt(secs, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor(n / 60) % 60;
  const s = n % 60;
  return `${h}h${m}m${s}s`;
};

module.exports = (req, res) => {
  const { slug = "", s, e, n, t } = req.query || {};

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "nymphelia.com").split(",")[0].trim();
  const baseUrl = `${proto}://${host}`;

  const vod = vods.find((v) => makeSlug(v) === slug);

  // Reconstruct the canonical share URL (what the user actually pasted).
  const canonicalParams = new URLSearchParams();
  if (s) canonicalParams.set("s", s);
  if (e) canonicalParams.set("e", e);
  if (n) canonicalParams.set("n", n);
  if (t && !s && !e) canonicalParams.set("t", t);
  const canonicalQs = canonicalParams.toString();
  const canonicalUrl = `${baseUrl}/vod/${encodeURIComponent(slug)}${canonicalQs ? `?${canonicalQs}` : ""}`;

  if (!vod) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!DOCTYPE html><meta charset="utf-8"><title>Not found - ${escapeHtml(SITE_NAME)}</title>` +
        `<meta http-equiv="refresh" content="0; url=${escapeHtml(canonicalUrl)}">`
    );
    return;
  }

  const startSec = parseHMS(s);
  const endSec = parseHMS(e);
  const isClip = startSec != null && endSec != null && startSec < endSec;
  const clipName = n ? String(n).trim().slice(0, 80) : "";
  const range = isClip ? `${fmtHMS(startSec)} → ${fmtHMS(endSec)}` : null;

  const title = isClip
    ? clipName
      ? `${clipName} — Clip from ${vod.title}`
      : `Clip from ${vod.title}`
    : vod.title;

  const description = isClip
    ? range
      ? `${range} • A clip from ${vod.title}`
      : `A clip from ${vod.title}`
    : `Watch this VOD on ${SITE_NAME}`;

  // Thumbnail in vods.json is a site-relative path; make it absolute for OG.
  let image = vod.thumbnail_url || "/loading.gif";
  if (image.startsWith("/")) image = `${baseUrl}${image}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(vod.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(canonicalUrl)}">
</head>
<body>
<p>Redirecting to <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(title)}</a>…</p>
</body>
</html>`;

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(html);
};
