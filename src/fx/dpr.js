/** Device pixel ratio, capped (high-DPR phones don't need 3x backing stores for soft effects). */
export function getDpr(cap = 2) {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, cap));
}

/**
 * Size a canvas' backing store to `w`x`h` CSS px at `dpr`. Only touches width/height when they
 * actually change (assigning them clears the canvas). Returns true if the size changed.
 */
export function sizeCanvas(canvas, w, h, dpr) {
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width === bw && canvas.height === bh) return false;
  canvas.width = bw;
  canvas.height = bh;
  return true;
}
