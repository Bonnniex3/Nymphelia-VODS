/* global process, Buffer */
// Pull the Meoyumi site's frontend into this fork, re-branded with ./brand.json.
//   node scripts/meoyumi-sync/sync.mjs <path-to-a-MeoyumiVODS-checkout>
// Copies Meoyumi's app (src, configs, brand templates), remaps every palette colour, swaps
// name/handle/kana/socials, applies ./overlay (fork-only files) and brand.json patches, then
// runs npm install. The fork's own VOD data, archive scripts, .env and pfp are left alone.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , MEO_ARG, FORK_ARG] = process.argv;
if (!MEO_ARG) throw new Error("usage: node scripts/meoyumi-sync/sync.mjs <path-to-MeoyumiVODS>");
const MEO = path.resolve(MEO_ARG);
const FORK = path.resolve(FORK_ARG || path.join(HERE, "../.."));
const B = JSON.parse(fs.readFileSync(path.join(HERE, "brand.json"), "utf8"));
const KEY = B.repo;
if (!/name: "Meoyumi"/.test(fs.existsSync(path.join(MEO, "src/lib/channel.js")) ? fs.readFileSync(path.join(MEO, "src/lib/channel.js"), "utf8") : "")) {
  throw new Error(`${MEO} doesn't look like the Meoyumi site (src/lib/channel.js)`);
}

/* ───────────── colour mapping ───────────── */

// Meoyumi's palette, keyed the same way as brands.json. Verified against index.css below.
const MEO_PAL = {
  void: "#07040a", ink: "#0d0811", panel: "#140c19", panel2: "#1c1122", panel3: "#28182f",
  cream: "#fff8f6", blush: "#f8d4e1", petal: "#efa8c5", neon: "#ff8ac4", rose: "#b96586",
  sky: "#75b9dd", lilac: "#a08bd0", mute: "#a8929f", dim: "#6f5b6c",
};
const CSS_TOKEN = { panel2: "panel-2", panel3: "panel-3" };
{
  const css = fs.readFileSync(path.join(MEO, "src/styles/index.css"), "utf8");
  for (const [k, hex] of Object.entries(MEO_PAL)) {
    const m = css.match(new RegExp(`--color-${CSS_TOKEN[k] || k}:\\s*(#[0-9a-f]{6})`, "i"));
    if (!m || m[1].toLowerCase() !== hex) throw new Error(`Meoyumi palette changed: ${k} is ${m?.[1]} (expected ${hex}); update MEO_PAL`);
  }
}

const hexToRgb = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hueDiff = (a, b) => ((a - b + 540) % 360) - 180;

const ANCHORS = Object.keys(MEO_PAL).map((k) => {
  const from = hexToRgb(MEO_PAL[k]);
  const to = hexToRgb(B.palette[k]);
  if (!B.palette[k]) throw new Error(`brand ${KEY} is missing palette.${k}`);
  return { k, from, to, fromHsl: rgbToHsl(from), toHsl: rgbToHsl(to) };
});
const EXACT = new Map(ANCHORS.map((a) => [a.from.join(","), a.to]));
const KEEP = new Set(["191,148,255"]); // Twitch purple hover stays Twitch purple
const colourStats = { exact: 0, derived: 0 };

/** Map one Meoyumi colour to the brand. Returns null to leave it untouched. */
function mapRgb(c) {
  const key = c.join(",");
  if (EXACT.has(key)) {
    colourStats.exact++;
    return EXACT.get(key);
  }
  if (KEEP.has(key) || (c[0] === c[1] && c[1] === c[2])) return null;
  // A tint of her palette: carry its HSL offset from the nearest anchor over to the brand anchor.
  const hsl = rgbToHsl(c);
  let best = null;
  for (const a of ANCHORS) {
    const [h, s, l] = a.fromHsl;
    const d = (1.5 * Math.abs(hueDiff(hsl[0], h)) / 180) * Math.min(hsl[1], s) + Math.abs(hsl[1] - s) * 0.7 + Math.abs(hsl[2] - l) * 1.2;
    if (!best || d < best.d) best = { a, d };
  }
  const { a } = best;
  const out = hslToRgb([a.toHsl[0] + hueDiff(hsl[0], a.fromHsl[0]), clamp01(a.toHsl[1] + (hsl[1] - a.fromHsl[1])), clamp01(a.toHsl[2] + (hsl[2] - a.fromHsl[2]))]);
  colourStats.derived++;
  return out.map(Math.round);
}

function recolour(text) {
  // #rrggbb and URL-encoded %23rrggbb (cursor SVGs)
  text = text.replace(/(#|%23)([0-9a-fA-F]{6})(?![0-9a-fA-F])/g, (m, pre, hex) => {
    const out = mapRgb(hexToRgb(hex));
    if (!out) return m;
    const h = rgbToHex(out).slice(1);
    return pre + (hex === hex.toUpperCase() && /[A-F]/.test(hex) ? h.toUpperCase() : h);
  });
  // rgb()/rgba() triplets, incl. Tailwind's rgb(239_168_197/0.5)
  text = text.replace(/(rgba?\(\s*)(\d{1,3})([\s,_]+)(\d{1,3})([\s,_]+)(\d{1,3})(?=[\s,_/)])/g, (m, pre, r, s1, g, s2, b) => {
    const out = mapRgb([+r, +g, +b]);
    return out ? `${pre}${out[0]}${s1}${out[1]}${s2}${out[2]}` : m;
  });
  // [r, g, b(, a)] literals: exact palette hits only (parseColor's fallback)
  text = text.replace(/\[(\d{1,3}), (\d{1,3}), (\d{1,3})(?=[,\]])/g, (m, r, g, b) => {
    const out = EXACT.get(`${+r},${+g},${+b}`);
    return out ? `[${out.join(", ")}` : m;
  });
  // GLSL vec3(0.937, 0.659, 0.773) palette constants
  text = text.replace(/vec3\(\s*([01]\.\d+),\s*([01]\.\d+),\s*([01]\.\d+)\s*\)/g, (m, r, g, b) => {
    const c = [r, g, b].map((v) => Math.round(parseFloat(v) * 255));
    const hit = ANCHORS.find((a) => a.from.every((v, i) => Math.abs(v - c[i]) <= 1));
    if (!hit) return m;
    colourStats.exact++;
    const f = (v) => (v / 255).toFixed(3);
    return `vec3(${f(hit.to[0])}, ${f(hit.to[1])}, ${f(hit.to[2])})`;
  });
  return text;
}

/* ───────────── text / brand substitutions ───────────── */

const NAME = B.name;
const UPPER = NAME.toUpperCase();
const LOWER = NAME.toLowerCase();
const LETTERS = [...new Set(UPPER.replace(/[^A-Z]/g, ""))].join("");

function rebrand(text) {
  return text
    .replaceAll("vods.meoyumi.example", B.site)
    .replaceAll("meoyumii", B.handle)
    .replaceAll("メオユミ", B.kana)
    .replaceAll("MYM ✦", `${B.initials} ✦`)
    .replaceAll("MEOYUMI", UPPER)
    .replaceAll("Meoyumi", NAME)
    .replaceAll("meoyumi", LOWER);
}

// Edits that must land exactly once in a given file; a miss means Meoyumi changed and the
// port needs a look rather than silently shipping her branding.
const failures = [];
function edit(text, file, from, to) {
  const hits = typeof from === "string" ? text.split(from).length - 1 : (text.match(new RegExp(from.source, from.flags.includes("g") ? from.flags : from.flags + "g")) || []).length;
  if (hits !== 1) {
    failures.push(`${file}: expected 1 match for ${from}, found ${hits}`);
    return text;
  }
  return text.replace(from, to);
}

const SOCIAL_LABELS = { twitch: "Twitch", youtube: "YouTube", x: "X", tiktok: "TikTok", instagram: "Instagram", discord: "Discord" };

function channelJs(src) {
  // Every key Meoyumi's CHANNEL has must be answered by the brand.
  const body = src.match(/export const CHANNEL = \{([\s\S]*?)\n\};/);
  if (!body) {
    failures.push("src/lib/channel.js: CHANNEL object not found");
    return src;
  }
  const keys = [...body[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const values = { name: NAME, handle: B.handle, kana: B.kana, tagline: B.tagline, ...B.socials };
  const lines = keys
    .map((k) => {
      if (k in values) return `  ${k}: ${JSON.stringify(values[k])},`;
      if (k in SOCIAL_LABELS) return null; // a network this channel doesn't use
      failures.push(`src/lib/channel.js: brand has no value for CHANNEL.${k}`);
      return null;
    })
    .filter(Boolean);
  let out = src.replace(body[0], `export const CHANNEL = {\n${lines.join("\n")}\n};`);
  // Drop social buttons for networks the channel isn't on.
  out = edit(out, "src/lib/channel.js", /(\{ key: "discord", label: "Discord", url: CHANNEL\.discord \},\n)\];/, "$1].filter((s) => s.url);");
  // The Live2D artist credit is Meoyumi's.
  out = edit(out, "src/lib/channel.js", /\n {2}artist: \{[^}]*\},/, "\n  artist: null,");
  return out;
}

// File-specific edits, applied after rebrand().
const PATCHES = {
  "src/lib/channel.js": channelJs,
  "src/fx/KanaRain.jsx": (t, f) => edit(t, f, `[..."MEOYUI"]`, `[..."${LETTERS}"]`),
  "src/home/HeroWindow.jsx": (t, f) => {
    // The giant name is sized for MEOYUMI's 7 letters; scale it to this name's length.
    const k = 7 / Math.max(4, UPPER.length);
    const size = `text-[clamp(${(2.7 * k).toFixed(2)}rem,${(12.4 * k).toFixed(2)}cqw,10rem)]`;
    return edit(t, f, "text-[clamp(2.7rem,12.4cqw,10rem)]", size);
  },
  // Meoyumi's six socials fill two rows of three; four sit better as 2x2 than 3 + 1.
  "src/home/ProfileCard.jsx": (t, f) =>
    Object.keys(B.socials).length === 4 ? edit(t, f, `<div className="grid grid-cols-3 gap-2">`, `<div className="grid grid-cols-2 gap-2">`) : t,
  // Share image: the name sits left of the pfp, so longer names shrink to keep clear of it.
  "scripts/brand/og.html": (t, f) => edit(t, f, "font-size:110px;", `font-size:${Math.round(110 * Math.min(1, 7 / UPPER.length))}px;`),
  "src/shell/Footer.jsx": (t, f) =>
    edit(
      t,
      f,
      /( *)<li className="text-mute">\n( *)art by\{" "\}\n[\s\S]*?<\/li>\n/,
      (m, ind) => `${ind}{CREDITS.artist && (\n${m.replace(/^/gm, "  ").trimEnd()}\n${ind})}\n`
    ),
};

/* ───────────── file plan ───────────── */

// Copied from Meoyumi (and rebranded). Everything under src/ and scripts/brand/ too.
const ROOT_FILES = ["index.html", "vite.config.mjs", "eslint.config.mjs", "vercel.json", "netlify.toml", "pm2.config.json", ".node-version", "api/embed.js", "public/_redirects", "public/ads.txt", "public/robots.txt", "public/manifest.json"];
const TREES = ["src", "scripts/brand"];
// Fork-owned paths under src/ that survive the copy.
const KEEP_IN_SRC = new Set(["src/vods/data/vods.json", ...(B.keepSrc || [])]);
// Generated per brand afterwards (pfp from the fork's logo, thumbnails rendered from templates).
const SKIP = new Set(["src/assets/pfp.png", "src/assets/default_thumbnail.jpg", "src/vods/data/vods.json"]);
// Meoyumi's sample archive stays byte-identical (not colour-mapped).
const VERBATIM = new Set(["src/vods/data/vods.mock.json"]);
const TEXT = /\.(js|jsx|mjs|cjs|css|html|json|md|txt|toml)$|(^|\/)(_redirects|\.node-version|\.npmrc)$/;

const walk = (dir, base = dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p, base) : [path.relative(base, p).replaceAll("\\", "/")];
      })
    : [];

const written = [];
function put(rel, buf) {
  const dest = path.join(FORK, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  if (!prev || !prev.equals(buf)) written.push(rel);
  fs.writeFileSync(dest, buf);
}

// Work in LF (a Windows checkout of Meoyumi has CRLF); git's autocrlf handles the rest.
const lf = (s) => s.replace(/\r\n/g, "\n");

function port(rel) {
  if (SKIP.has(rel)) return;
  const raw = fs.readFileSync(path.join(MEO, rel));
  if (!TEXT.test(rel) || VERBATIM.has(rel)) return put(rel, raw);
  let text = lf(raw.toString("utf8"));
  text = rebrand(recolour(text));
  if (PATCHES[rel]) text = PATCHES[rel](text, rel);
  put(rel, Buffer.from(text, "utf8"));
}

// 1. Clear the fork's old frontend out of src/ (keeping its data + fork-only modules).
const removed = [];
for (const rel of walk(path.join(FORK, "src")).map((r) => `src/${r}`)) {
  if (KEEP_IN_SRC.has(rel) || fs.existsSync(path.join(HERE, "overlay", rel))) continue;
  if (!fs.existsSync(path.join(MEO, rel)) || SKIP.has(rel)) {
    if (SKIP.has(rel) && fs.existsSync(path.join(FORK, rel))) continue; // regenerated later
    fs.rmSync(path.join(FORK, rel));
    removed.push(rel);
  }
}
// Leftovers from the earlier port attempt that Meoyumi doesn't have.
const DEFAULT_REMOVE = [
  ".github/workflows/frontend.yml", "scripts/__tests__", "public/index.html", ".npmrc",
  // one-off scripts from an older rebrand that rewrite files which no longer exist
  "inspect_metadata.js", "make_dark_pink.js", "replace.js", "replace_colors.js", "tool_output_metadata.json", "readme.txt",
];
for (const p of [...DEFAULT_REMOVE, ...(B.remove || [])]) {
  const abs = path.join(FORK, p);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true });
    removed.push(p);
  }
}
// prune empty dirs left behind
const prune = (dir) => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const e of fs.readdirSync(dir)) prune(path.join(dir, e));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
};
prune(path.join(FORK, "src"));
prune(path.join(FORK, ".github"));
prune(path.join(FORK, "scripts"));

// 2. Copy + rebrand.
for (const rel of ROOT_FILES) port(rel);
for (const tree of TREES) for (const rel of walk(path.join(MEO, tree))) port(`${tree}/${rel}`);

// The forks' Vercel projects date from the Create React App days; pin the build here so the
// dashboard's old framework preset can't run the wrong command.
if (B.vercel) {
  const vercel = JSON.parse(fs.readFileSync(path.join(FORK, "vercel.json"), "utf8"));
  put("vercel.json", Buffer.from(JSON.stringify({ ...B.vercel, ...vercel }, null, 2) + "\n"));
}

// 3. package.json: Meoyumi's, renamed, plus the fork's extra scripts/deps.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(MEO, "package.json"), "utf8"));
  pkg.name = B.pkg;
  Object.assign(pkg.scripts, B.extraScripts || {});
  Object.assign(pkg.dependencies, B.extraDeps || {});
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  put("package.json", Buffer.from(JSON.stringify(pkg, null, 2) + "\n"));
  // Start from Meoyumi's lockfile so versions match hers; `npm install` then adds the extras.
  const lock = JSON.parse(fs.readFileSync(path.join(MEO, "package-lock.json"), "utf8"));
  lock.name = B.pkg;
  lock.packages[""].name = B.pkg;
  put("package-lock.json", Buffer.from(JSON.stringify(lock, null, 2) + "\n"));
}

// 4. README from Meoyumi's, rebranded (artist credit and repo name adjusted).
{
  let md = lf(fs.readFileSync(path.join(MEO, "README.md"), "utf8"));
  md = md.replace(/^- Live2D model art:.*\n/m, "");
  md = md.replace(/^# MeoyumiVOD$/m, `# ${KEY}`);
  md = md.replace(/^\*\*Archive site:\*\*.*$/m, `**Archive site:** <https://${B.site}>`);
  md = md.replace(/https:\/\/twitch\.tv\/meoyumii/g, B.socials.twitch);
  md = md.replace(/Edit the `ITEM_IDS` array[\s\S]*?once Meoyumi's upload naming is settled\./, "Edit the `ITEM_IDS` array at the top of [scripts/fetch-vods.js](scripts/fetch-vods.js), then re-run `npm run fetch-vods`.");
  md = rebrand(recolour(md));
  if (B.readmeBullets?.length) md = md.replace(/(## What it does\n\n(?:- .*\n)+)/, (m) => m + B.readmeBullets.map((b) => `- ${b}\n`).join(""));
  md = md.replace(
    /\n## Credits\n/,
    `
## Keeping in sync with Meoyumi

This site runs the same frontend as [MeoyumiVODS](https://github.com/Bonnniex3/MeoyumiVODS), re-branded. To pull in her latest changes, check out MeoyumiVODS next to this repo and run:

\`\`\`bash
node scripts/meoyumi-sync/sync.mjs ../MeoyumiVODS
\`\`\`

It copies Meoyumi's \`src/\`, configs and brand templates, swaps in the colours, name and socials from [scripts/meoyumi-sync/brand.json](scripts/meoyumi-sync/brand.json), re-applies this fork's own additions (\`scripts/meoyumi-sync/overlay/\`) and runs \`npm install\`. This repo's VOD data, \`scripts/fetch-vods.js\`, \`.env\` and pfp are left alone.

## Credits
`
  );
  put("README.md", Buffer.from(md));
}

// 5. Fork-only overlay (e.g. Minorikyun's chat replay) + its patches.
const overlay = path.join(HERE, "overlay");
for (const rel of walk(overlay)) put(rel, fs.readFileSync(path.join(overlay, rel)));
for (const [rel, edits] of Object.entries(B.patches || {})) {
  let t = lf(fs.readFileSync(path.join(FORK, rel), "utf8"));
  for (const [from, to] of edits) t = edit(t, rel, from, to);
  put(rel, Buffer.from(t));
}

// Leftover Meoyumi branding anywhere we wrote?
const leaks = [];
for (const rel of written) {
  if (!TEXT.test(rel) || VERBATIM.has(rel) || rel === "package-lock.json" || rel === "README.md") continue; // README links to Meoyumi on purpose
  const t = fs.readFileSync(path.join(FORK, rel), "utf8");
  for (const needle of ["meoyumi", "メオユミ", "79meow", "MYM"]) if (t.toLowerCase().includes(needle.toLowerCase())) leaks.push(`${rel}: ${needle}`);
}

console.log(JSON.stringify({ fork: KEY, written: written.length, removed, colours: colourStats, failures, leaks }, null, 2));
if (failures.length) {
  console.error("\nSome edits didn't apply: Meoyumi changed in a way this script doesn't know yet. Nothing was installed.");
  process.exit(1);
}

// The lockfile came from Meoyumi; let npm add this fork's extra packages.
const npm = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: FORK, stdio: "inherit", shell: true });
if (npm.status !== 0) process.exit(npm.status ?? 1);
console.log(`
Synced ${KEY} with Meoyumi. Next:
  npm test && npm run lint && npm run dev     check it locally
If Meoyumi's scripts/brand templates changed, re-render the share image + default thumbnail:
  npx -y -p playwright@1.56.1 -c "node scripts/brand/render.cjs"`);
