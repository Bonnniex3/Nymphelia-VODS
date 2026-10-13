import { useEffect, useRef, useState } from "react";
import { getDpr, sizeCanvas } from "./dpr.js";
import {
  createProgram,
  detectWebGL,
  getGLContext,
  maxPointSize,
  releaseContextLater,
} from "./gl.js";
import { createLoop } from "./loop.js";
import { useLiteFx } from "./perf.js";
import { watchActivity } from "./observe.js";
import { PALETTE, hexToRgb } from "./palette.js";

/*
 * PfpMatrix: the avatar re-printed as a halftone dot matrix.
 *
 * The image is box-sampled once per layout into a grid. Each cell's luminance is contrast-
 * stretched (2nd-98th percentile), sharpened against a local blur (so eyes, brows and hair
 * strands survive at ~45 cells across) and gamma'd into a dot radius. Pink tint maps luminance
 * onto rose -> petal -> cream, letting genuinely blue pixels (her eyes) keep a sky accent.
 *
 * Dots are WebGL points: static attributes (position, colour, radius, intro delay) plus a small
 * dynamic buffer of spring offsets for the pointer "repel". Intro, breathing and pointer swell
 * are computed in the vertex shader; only the springs run on the CPU (typed arrays, no allocs),
 * and they go to sleep once everything settles.
 */

const INTRO_TOTAL = 1.25; // s
const REPEL_RADIUS = 78; // CSS px
const IMPULSE_RADIUS = 150;
const SPRING_K = 170;
const SPRING_C = 13;
const MAX_DPR = 2;

const VERTEX = /* glsl */ `
ATTR vec2 a_pos;    // dot centre, CSS px
ATTR vec2 a_off;    // spring offset, CSS px
ATTR vec4 a_col;    // rgb + radius (fraction of half a cell)
ATTR float a_delay; // intro delay, s

uniform vec2 u_view;
uniform float u_dpr;
uniform float u_cell;
uniform float u_time;
uniform float u_intro;   // s since the intro began
uniform vec3 u_pointer;  // x, y (CSS px), strength
uniform float u_maxPoint;

VARYING vec3 v_col;
VARYING vec2 v_shape;  // disc radius, sprite size (device px)
VARYING float v_alpha;

float easeOutBack(float x) {
  float m = x - 1.0;
  return 1.0 + 2.2 * m * m * m + 1.2 * m * m; // gentle overshoot (~6%)
}

void main() {
  float k = clamp((u_intro - a_delay) / 0.62, 0.0, 1.0);
  float grow = k > 0.0 ? easeOutBack(k) : 0.0;
  vec2 p = a_pos + a_off;

  // A slow diagonal wave: dots swell and settle as it passes, like breathing.
  float wave = sin(u_time * 1.25 - (a_pos.x * 0.8 + a_pos.y) * 0.02);
  float breath = 1.0 + 0.055 * wave;

  vec2 dp = p - u_pointer.xy;
  float prox = exp(-dot(dp, dp) * (1.0 / (2.0 * 46.0 * 46.0))) * u_pointer.z;

  float r = a_col.a * 0.5 * u_cell * grow * breath * (1.0 + 0.32 * prox);
  float rPx = r * u_dpr;
  float size = min(ceil(rPx * 2.0 + 2.0), u_maxPoint);
  gl_PointSize = size;
  v_shape = vec2(rPx, size);
  v_col = mix(a_col.rgb, vec3(1.000, 0.969, 0.980), prox * 0.38 + max(wave, 0.0) * 0.035);
  v_alpha = smoothstep(0.0, 0.35, k);
  vec2 clip = p / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
VARYING vec3 v_col;
VARYING vec2 v_shape;
VARYING float v_alpha;

void main() {
  vec2 pc = (gl_PointCoord - 0.5) * v_shape.y;
  float a = clamp(v_shape.x + 0.5 - length(pc), 0.0, 1.0) * v_alpha;
  if (a <= 0.003) discard;
  FRAG_COLOR = vec4(v_col * a, a);
}
`;

const UNIFORMS = ["u_view", "u_dpr", "u_cell", "u_time", "u_intro", "u_pointer", "u_maxPoint"];
const ATTRIBS = ["a_pos", "a_off", "a_col", "a_delay"];

const ROSE = hexToRgb(PALETTE.rose).map((v) => v / 255);
const PETAL = hexToRgb(PALETTE.petal).map((v) => v / 255);
const BLUSH = hexToRgb(PALETTE.blush).map((v) => v / 255);
const PETAL_BLUSH = PETAL.map((v, i) => v + (BLUSH[i] - v) * 0.55);
const CREAM = hexToRgb(PALETTE.cream).map((v) => v / 255);
const SKY = hexToRgb(PALETTE.sky).map((v) => v / 255);
const NEON = hexToRgb(PALETTE.neon).map((v) => v / 255);
const LILAC = hexToRgb(PALETTE.lilac).map((v) => v / 255);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Decoded pixels per src, shared across mounts (StrictMode, route changes).
const imageCache = new Map();

function loadPixels(src) {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        try {
          const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0, w, h);
          resolve({ data: g.getImageData(0, 0, w, h).data, w, h });
        } catch (err) {
          reject(err); // e.g. a tainted cross-origin image
        }
      };
      img.onerror = reject;
      img.src = src;
    });
    p.catch(() => imageCache.delete(src));
    imageCache.set(src, p);
  }
  return p;
}

/**
 * Alpha-weighted box blur of `src` over a (2r+1)^2 window, on a cols x rows grid.
 */
function boxBlur(src, alpha, cols, rows, r) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      let w = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(rows - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(cols - 1, x + r); xx++) {
          const j = yy * cols + xx;
          s += src[j] * alpha[j];
          w += alpha[j];
        }
      }
      const i = y * cols + x;
      out[i] = w ? s / w : src[i];
    }
  }
  return out;
}

/**
 * Sample the image into dots for a W x H canvas. Returns
 * { n, pitch, attrs: Float32Array(n*7) [x, y, r, g, b, radius, delay] }.
 *
 * Tone pipeline (per grid cell):
 *   1. box-average the footprint, but blend 35% toward the darkest pixel so thin dark line art
 *      (lashes, outlines, hair strands) survives the downsample instead of averaging away;
 *   2. 50/50 percentile stretch + histogram equalisation: her art is bright overall, and a plain
 *      stretch crushes the whole face into "max dot";
 *   3. two-scale unsharp mask (3x3 + 7x7) so eyes and strands separate from their surroundings;
 *   4. radius = gamma'd tone, capped below touching so there's always a gap between dots;
 *   5. colour: rose -> petal -> blush by tone. Cream is reserved for *local* highlights (bright
 *      AND brighter than the neighbourhood: eye glints, the hair clip, rim light), so the big
 *      bright plateau of the face stays pink. Blue/violet source pixels (her eyes) -> sky/lilac.
 */
function buildDots(img, W, H, cell, tint, round) {
  const { data, w: iw, h: ih } = img;
  const cols = Math.max(4, Math.floor(W / cell));
  const rows = Math.max(4, Math.floor(H / cell));
  const pitch = Math.min(W / cols, H / rows);
  const gx0 = (W - cols * pitch) / 2;
  const gy0 = (H - rows * pitch) / 2;
  const scale = Math.max(W / iw, H / ih); // cover-fit
  const ix0 = (W - iw * scale) / 2;
  const iy0 = (H - ih * scale) / 2;
  const fp = pitch / scale; // cell footprint in image px
  const n = cols * rows;

  const lum = new Float32Array(n);
  const alpha = new Float32Array(n);
  const rgb = new Float32Array(n * 3);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = (gx0 + (x + 0.5) * pitch - ix0) / scale;
      const cy = (gy0 + (y + 0.5) * pitch - iy0) / scale;
      const sx0 = Math.max(0, Math.floor(cx - fp / 2));
      const sx1 = Math.min(iw - 1, Math.max(sx0, Math.ceil(cx + fp / 2) - 1));
      const sy0 = Math.max(0, Math.floor(cy - fp / 2));
      const sy1 = Math.min(ih - 1, Math.max(sy0, Math.ceil(cy + fp / 2) - 1));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let cnt = 0;
      let minL = 1;
      for (let sy = sy0; sy <= sy1; sy++) {
        for (let sx = sx0; sx <= sx1; sx++) {
          const o = (sy * iw + sx) * 4;
          const pa = data[o + 3] / 255;
          r += data[o] * pa;
          g += data[o + 1] * pa;
          b += data[o + 2] * pa;
          a += pa;
          cnt++;
          if (pa > 0.5) {
            const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
            if (l < minL) minL = l;
          }
        }
      }
      const i = y * cols + x;
      if (!cnt || a <= 0) continue;
      alpha[i] = a / cnt;
      r /= a * 255;
      g /= a * 255;
      b /= a * 255;
      rgb[i * 3] = r;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = b;
      const mean = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = mix(mean, Math.min(mean, minL), 0.35);
    }
  }

  // Percentile stretch + histogram equalisation, over opaque cells.
  const sample = [];
  for (let i = 0; i < n; i++) if (alpha[i] > 0.5) sample.push(lum[i]);
  sample.sort((p, q) => p - q);
  const m = sample.length;
  const lo = m ? sample[Math.floor(m * 0.02)] : 0;
  const hi = m ? sample[Math.floor(m * 0.98)] : 1;
  const span = Math.max(0.05, hi - lo);
  const rank = (v) => {
    let l = 0;
    let h = m;
    while (l < h) {
      const mid = (l + h) >> 1;
      if (sample[mid] < v) l = mid + 1;
      else h = mid;
    }
    return m ? l / m : v;
  };
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lin = Math.min(1, Math.max(0, (lum[i] - lo) / span));
    t[i] = 0.5 * lin + 0.5 * rank(lum[i]);
  }
  const fine = boxBlur(t, alpha, cols, rows, 1);
  const coarse = boxBlur(t, alpha, cols, rows, 3);

  const out = new Float32Array(n * 7);
  const cxC = W / 2;
  const cyC = H / 2;
  const R = Math.min(W, H) / 2;
  let k = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (alpha[i] < 0.12) continue; // transparent: no dot
      const px = gx0 + (x + 0.5) * pitch;
      const py = gy0 + (y + 0.5) * pitch;
      const dist = Math.hypot(px - cxC, py - cyC);
      if (round && dist > R - pitch * 0.4) continue;

      const detail = t[i] - coarse[i]; // > 0: brighter than the neighbourhood
      let v = t[i] + 0.7 * (t[i] - fine[i]) + 0.55 * detail;
      v = Math.min(1, Math.max(0, v));

      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];

      // Blue-ness. Her irises measure hue 215-280 at only 13-50% saturation, so the window is
      // generous on the violet side; skin/hair sit around 330-360 and never qualify.
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      let hue = 0;
      if (max !== min) {
        if (max === r) hue = ((g - b) / (max - min)) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        hue = (hue * 60 + 360) % 360;
      }
      const blue =
        smoothstep(175, 200, hue) * (1 - smoothstep(285, 302, hue)) * smoothstep(0.07, 0.18, sat);
      // Irises are mid/dark in luminance; lift them so the accent actually shows.
      if (blue > 0) v = mix(v, Math.max(v, 0.66 + 0.3 * v), blue);

      // Gamma'd radius, capped at 82% of the cell so there's always a visible gap.
      let radius = (0.1 + 0.72 * Math.pow(v, 1.25)) * Math.min(1, alpha[i] * 1.15);
      if (round) radius *= 0.55 + 0.45 * smoothstep(R, R - pitch * 2.5, dist); // soft rim

      let cr;
      let cg;
      let cb;
      if (tint === "color") {
        // Sampled colour, lifted a little so it reads on the dark page.
        // Sampled colour with a touch more saturation (the art is pastel) and a slight lift.
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        cr = mix(mix(l, r, 1.3), 1, 0.08);
        cg = mix(mix(l, g, 1.3), 1, 0.08);
        cb = mix(mix(l, b, 1.3), 1, 0.08);
      } else {
        let c0;
        let c1;
        let q;
        // Blush on a dark page reads as near-white, so the ramp tops out half way to it.
        if (v < 0.72) {
          c0 = ROSE;
          c1 = PETAL;
          q = v / 0.72;
        } else {
          c0 = PETAL;
          c1 = PETAL_BLUSH;
          q = (v - 0.72) / 0.28;
        }
        q = q * q * (3 - 2 * q);
        cr = mix(c0[0], c1[0], q);
        cg = mix(c0[1], c1[1], q);
        cb = mix(c0[2], c1[2], q);
        // Saturated pink in the source (cheek blush, ribbon, the avatar ring) leans neon.
        const pink =
          (smoothstep(300, 330, hue) + (1 - smoothstep(8, 25, hue))) * smoothstep(0.16, 0.38, sat);
        if (pink > 0) {
          const pq = Math.min(1, pink) * 0.45;
          cr = mix(cr, NEON[0], pq);
          cg = mix(cg, NEON[1], pq);
          cb = mix(cb, NEON[2], pq);
        }
        const glint = smoothstep(0.13, 0.3, detail) * smoothstep(0.88, 1, v);
        if (blue > 0) {
          const vi = smoothstep(238, 272, hue);
          cr = mix(cr, mix(SKY[0], LILAC[0], vi), blue);
          cg = mix(cg, mix(SKY[1], LILAC[1], vi), blue);
          cb = mix(cb, mix(SKY[2], LILAC[2], vi), blue);
        }
        cr = mix(cr, CREAM[0], glint);
        cg = mix(cg, CREAM[1], glint);
        cb = mix(cb, CREAM[2], glint);
      }

      out[k++] = px;
      out[k++] = py;
      out[k++] = cr;
      out[k++] = cg;
      out[k++] = cb;
      out[k++] = radius;
      out[k++] = (dist / R) * 0.55 + Math.random() * 0.07; // radial stagger from the centre
    }
  }
  return { n: k / 7, pitch, attrs: out.subarray(0, k) };
}

/**
 * The pfp as an interactive halftone. Fills its container's width and stays square unless the
 * container (via `className`) sets both dimensions.
 */
export default function PfpMatrix({
  src,
  className,
  cell = 8,
  tint = "pink",
  round = true,
  interactive = true,
  alt = "Nymphelia",
}) {
  const canvasRef = useRef(null);
  const reduced = useLiteFx(); // still frame: reduced motion or lite effects
  const [glSupport] = useState(detectWebGL);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return undefined;
    const pitchCss = Math.max(3, cell);
    const canInteract = interactive && !reduced;

    let disposed = false;
    let pixels = null;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let dots = null;
    let active = false;

    // GL state
    const ctxInfo = glSupport ? getGLContext(canvas) : null;
    const gl = ctxInfo?.gl;
    let prog = null;
    let attrBuf = null;
    let offBuf = null;
    let maxPoint = 64;
    let lost = gl ? gl.isContextLost() : false;

    // springs
    let n = 0;
    let off = new Float32Array(0);
    let vel = new Float32Array(0);
    let settled = true;
    let introStart = reduced ? -1e9 : -1;
    const t0 = performance.now();

    // pointer (canvas-local CSS px)
    let px = -1e4;
    let py = -1e4;
    let pStr = 0;
    let pTarget = 0;

    function setupGL() {
      prog = createProgram(gl, ctxInfo.webgl2, VERTEX, FRAGMENT, UNIFORMS, ATTRIBS);
      attrBuf = gl.createBuffer();
      offBuf = gl.createBuffer();
      maxPoint = maxPointSize(gl);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    function uploadDots() {
      if (!gl || lost || !dots) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf);
      gl.bufferData(gl.ARRAY_BUFFER, dots.attrs, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
      gl.bufferData(gl.ARRAY_BUFFER, off, gl.DYNAMIC_DRAW);
    }

    function layout() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (!W || !H || !pixels) return false;
      dpr = getDpr(MAX_DPR);
      sizeCanvas(canvas, W, H, dpr);
      dots = buildDots(pixels, W, H, pitchCss, tint, round);
      n = dots.n;
      off = new Float32Array(n * 2);
      vel = new Float32Array(n * 2);
      settled = true;
      uploadDots();
      return true;
    }

    function renderGL(now) {
      if (lost || !prog || !dots) return;
      const u = prog.uniforms;
      const a = prog.attribs;
      const introT = introStart < 0 && !reduced ? 0 : (now - introStart) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf);
      gl.enableVertexAttribArray(a.a_pos);
      gl.vertexAttribPointer(a.a_pos, 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(a.a_col);
      gl.vertexAttribPointer(a.a_col, 4, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(a.a_delay);
      gl.vertexAttribPointer(a.a_delay, 1, gl.FLOAT, false, 28, 24);
      gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
      gl.enableVertexAttribArray(a.a_off);
      gl.vertexAttribPointer(a.a_off, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.u_view, W, H);
      gl.uniform1f(u.u_dpr, dpr);
      gl.uniform1f(u.u_cell, dots.pitch);
      gl.uniform1f(u.u_time, reduced ? 0 : (now - t0) / 1000);
      gl.uniform1f(u.u_intro, reduced ? 100 : introT);
      gl.uniform3f(u.u_pointer, px, py, pStr);
      gl.uniform1f(u.u_maxPoint, maxPoint);
      gl.drawArrays(gl.POINTS, 0, n);
    }

    // Canvas2D fallback (no WebGL): a static print of the final frame.
    function render2D() {
      const g = canvas.getContext("2d");
      if (!g || !dots) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const at = dots.attrs;
      for (let i = 0; i < n; i++) {
        const o = i * 7;
        g.fillStyle = `rgb(${(at[o + 2] * 255) | 0},${(at[o + 3] * 255) | 0},${(at[o + 4] * 255) | 0})`;
        g.beginPath();
        g.arc(at[o], at[o + 1], at[o + 5] * 0.5 * dots.pitch, 0, Math.PI * 2);
        g.fill();
      }
    }

    function render(now) {
      if (gl) renderGL(now);
      else render2D();
    }

    // Semi-implicit spring step toward a "pushed away from the pointer" target.
    function stepSprings(dt) {
      if (settled && pStr < 0.002) return false;
      const h = Math.min(dt, 1 / 30);
      const at = dots.attrs;
      const maxDisp = Math.max(9, pitchCss * 1.7);
      const R2 = REPEL_RADIUS * REPEL_RADIUS;
      const damp = Math.exp(-SPRING_C * h);
      let energy = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 7;
        const j = i * 2;
        let tx = 0;
        let ty = 0;
        if (pStr > 0.002) {
          const dx = at[o] - px;
          const dy = at[o + 1] - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            const d = Math.sqrt(d2) + 0.001;
            let fo = 1 - d / REPEL_RADIUS;
            fo = fo * fo * pStr * maxDisp;
            tx = (dx / d) * fo;
            ty = (dy / d) * fo;
          }
        }
        let vx = (vel[j] + (tx - off[j]) * SPRING_K * h) * damp;
        let vy = (vel[j + 1] + (ty - off[j + 1]) * SPRING_K * h) * damp;
        vel[j] = vx;
        vel[j + 1] = vy;
        off[j] += vx * h;
        off[j + 1] += vy * h;
        const e = Math.abs(vx) + Math.abs(vy) + Math.abs(off[j] - tx) + Math.abs(off[j + 1] - ty);
        if (e > energy) energy = e;
      }
      if (energy < 0.02 && pStr < 0.002) {
        off.fill(0);
        vel.fill(0);
        settled = true;
      } else {
        settled = false;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, off);
      return !settled;
    }

    const loop = createLoop((now, dt) => {
      if (lost || !dots) return true;
      if (introStart < 0) introStart = now; // intro plays the first time it's on screen
      pStr += (pTarget - pStr) * (1 - Math.exp(-dt * 8));
      if (pTarget === 0 && pStr < 0.002) pStr = 0;
      const moving = stepSprings(dt);
      render(now);
      const intro = (now - introStart) / 1000 < INTRO_TOTAL;
      loop.setFps(intro || moving || pTarget ? 60 : 30); // idle breathing doesn't need 60
      return true;
    }, 60);

    const sync = () => {
      if (active && gl && !lost && !reduced && dots) loop.start();
      else loop.stop();
    };

    const relayout = () => {
      if (disposed || lost) return;
      if (layout()) render(performance.now());
      sync();
    };

    if (gl && !lost) {
      try {
        setupGL();
      } catch (err) {
        console.warn(err);
        return undefined;
      }
    }

    loadPixels(src)
      .then((px0) => {
        if (disposed) return;
        pixels = px0;
        relayout();
      })
      .catch(() => {});

    const ro = new ResizeObserver(relayout);
    ro.observe(canvas);

    const unwatch = watchActivity(canvas, (a) => {
      active = a;
      sync();
    });

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
    };
    const onMove = (e) => {
      local(e);
      if (pStr < 0.01) pStr = 0.01;
      pTarget = 1;
      settled = false;
    };
    const onLeave = () => {
      pTarget = 0;
    };
    const onDown = (e) => {
      local(e);
      pTarget = 1;
      if (!dots) return;
      // A little "boop": kick nearby dots outward.
      const at = dots.attrs;
      for (let i = 0; i < n; i++) {
        const dx = at[i * 7] - px;
        const dy = at[i * 7 + 1] - py;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        if (d > IMPULSE_RADIUS) continue;
        let fo = 1 - d / IMPULSE_RADIUS;
        fo = fo * fo * 420;
        vel[i * 2] += (dx / d) * fo;
        vel[i * 2 + 1] += (dy / d) * fo;
      }
      settled = false;
    };
    if (canInteract && gl) {
      canvas.addEventListener("pointermove", onMove, { passive: true });
      canvas.addEventListener("pointerdown", onDown, { passive: true });
      canvas.addEventListener("pointerleave", onLeave, { passive: true });
      canvas.addEventListener("pointercancel", onLeave, { passive: true });
    }

    const onLost = (e) => {
      e.preventDefault();
      lost = true;
      prog = null;
      loop.stop();
    };
    const onRestored = () => {
      lost = false;
      try {
        setupGL();
      } catch (err) {
        console.warn(err);
        return;
      }
      uploadDots();
      render(performance.now());
      sync();
    };
    if (gl) {
      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);
    }

    return () => {
      disposed = true;
      loop.stop();
      unwatch();
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointercancel", onLeave);
      if (gl) {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        if (!gl.isContextLost()) {
          if (attrBuf) gl.deleteBuffer(attrBuf);
          if (offBuf) gl.deleteBuffer(offBuf);
          if (prog) gl.deleteProgram(prog.program);
        }
        releaseContextLater(canvas, gl);
      }
    };
  }, [src, cell, tint, round, interactive, reduced, glSupport]);

  return (
    <div className={className} style={{ position: "relative", aspectRatio: "1 / 1" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
