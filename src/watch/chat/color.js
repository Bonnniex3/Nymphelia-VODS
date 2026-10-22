/*
 * Twitch lets chatters pick near-black names, which vanish on the dark player chrome.
 * Pure and unit-tested in color.test.js.
 */

const HEX = /^#([0-9a-f]{6})$/i;
/** Below this relative luminance a name colour is lifted toward white. */
const MIN_LUMINANCE = 0.4;

/**
 * The colour to draw a chatter's name in, from the `#rrggbb` the sidecar carried (already
 * validated by replay.js's safeColor): unchanged when it reads on a dark surface, otherwise
 * blended toward white just far enough. Anything else gives null (use the palette fallback).
 */
export function readableColor(hex) {
  const match = typeof hex === "string" ? HEX.exec(hex) : null;
  if (!match) return null;
  const n = parseInt(match[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= MIN_LUMINANCE) return hex.toLowerCase();
  const k = Math.min(0.7, MIN_LUMINANCE - lum + 0.15);
  const lift = (v) => Math.round(v + (255 - v) * k);
  return `rgb(${lift(r)} ${lift(g)} ${lift(b)})`;
}
