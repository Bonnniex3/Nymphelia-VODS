// Nymphelia palette, shared by every effect. Keep in sync with the Tailwind theme.
export const PALETTE = {
  void: "#0a0408",
  ink: "#12070e",
  panel: "#1a0c15",
  panel2: "#23111d",
  panel3: "#311829",
  cream: "#fff7fa",
  blush: "#fbcfe8",
  petal: "#f78fc4",
  neon: "#ff6fb5",
  rose: "#c25588",
  sky: "#c3a6ff",
  lilac: "#8f7ae6",
};

/** "#rrggbb" -> [r, g, b] (0-255). */
export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r, g, b] + alpha -> "rgba(...)" */
export function rgba(rgb, a = 1) {
  return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
}

/** Linear mix of two [r, g, b] colours. */
export function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

let probe = null;

/**
 * Parse any CSS colour (hex, rgb(), hsl(), named...) into [r, g, b, a] with r/g/b 0-255 and
 * a 0-1, by letting a 2D context normalise it. Falls back to petal if unparseable.
 */
export function parseColor(css) {
  if (!probe) probe = document.createElement("canvas").getContext("2d");
  probe.fillStyle = "#f78fc4";
  probe.fillStyle = css;
  const v = probe.fillStyle;
  if (v[0] === "#") return [...hexToRgb(v), 1];
  const m = v.match(/[\d.]+/g);
  if (!m) return [247, 143, 196, 1];
  return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
}
