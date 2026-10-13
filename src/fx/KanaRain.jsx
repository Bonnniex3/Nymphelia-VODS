import { useEffect, useRef } from "react";
import { getDpr, sizeCanvas } from "./dpr.js";
import { createLoop } from "./loop.js";
import { usePrefersReducedMotion } from "./media.js";
import { watchActivity } from "./observe.js";
import { PALETTE, hexToRgb, mixRgb, rgba } from "./palette.js";

/*
 * KanaRain: kawaii digital rain.
 *
 * A tiny cellular model (per-cell glyph + intensity) is stepped at 30fps and the whole panel is
 * redrawn from two pre-rendered glyph atlases (head glyphs with glow, trail glyphs in 4 colour
 * steps per hue). Redrawing from the model keeps the canvas truly transparent: no
 * "destination-out" fading, so no 8-bit alpha ghosts left behind.
 *
 * Trails cool petal -> rose (or sky -> lilac for the holo columns) as their intensity decays.
 */

const STEP_FPS = 30;
const HALF_KATA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";
const FULL_KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const FONT_SYMBOLS = "♡☆♪｡ﾟ˚";
const NAMES = ["NYMPHELIA", "ニンフェリア"];

// Symbols DotGothic16 doesn't have, drawn as pixel bitmaps on the font's own 16px grid so they
// match its pixel look. `dy` nudges the bitmap down (in font pixels).
const BITMAPS = {
  "✦": { dy: 0, rows: ["....#....", "....#....", "...###...", "..#####..", "#########", "..#####..", "...###...", "....#....", "....#...."] },
  "✧": { dy: 0, rows: ["....#....", "....#....", "...#.#...", "..#...#..", "##.....##", "..#...#..", "...#.#...", "....#....", "....#...."] },
  "⋆": { dy: 0, rows: ["..#..", ".###.", "#####", ".###.", ".#.#."] },
  "₊": { dy: 3, rows: ["..#..", "..#..", "#####", "..#..", "..#.."] },
};

const NAME_CHARS = [...new Set(NAMES.join(""))].join("");
const GLYPHS = [...new Set([...HALF_KATA, ...FULL_KATA, ...FONT_SYMBOLS, ...Object.keys(BITMAPS), ...NAME_CHARS])];
const GLYPH_INDEX = new Map(GLYPHS.map((g, i) => [g, i]));
const FONT_CHARS = GLYPHS.filter((g) => !BITMAPS[g]).join("");

// Weighted pool for random picks: mostly katakana, a sprinkle of kawaii symbols and letters.
const POOL = Uint16Array.from([
  ...[...HALF_KATA, ...HALF_KATA, ...FULL_KATA].map((g) => GLYPH_INDEX.get(g)),
  ...[...FONT_SYMBOLS, ...Object.keys(BITMAPS)].flatMap((g) => [GLYPH_INDEX.get(g), GLYPH_INDEX.get(g)]),
  ...[..."NYMPHELIA"].map((g) => GLYPH_INDEX.get(g)),
]);
const NAME_SEQS = NAMES.map((n) => [...n].map((g) => GLYPH_INDEX.get(g)));

const C = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hexToRgb(v)]));
// Trail colour steps (hot -> cold) for pink and sky columns.
const TRAIL_COLORS = [
  [mixRgb(C.petal, C.blush, 0.45), C.petal, mixRgb(C.petal, C.rose, 0.55), C.rose],
  [mixRgb(C.sky, C.cream, 0.35), C.sky, mixRgb(C.sky, C.lilac, 0.55), C.lilac],
];
const HEAD_GLOW = [C.neon, C.sky];
const TRAIL_STEPS = 4;
const PER_ROW = 16;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = () => POOL[(Math.random() * POOL.length) | 0];

const BASE_STYLE = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  display: "block",
};

export default function KanaRain({ className, fontSize = 16, density = 0.8, speed = 1 }) {
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;

    const f = Math.max(8, fontSize);
    const dens = Math.min(1, Math.max(0.02, density));
    const spd = Math.max(0.05, speed);
    const colW = f * 1.18; // column pitch, CSS px
    const rowH = f * 1.12;
    const family = `"DotGothic16", "MS Gothic", "Osaka", monospace`;

    let disposed = false;
    let fontReady = false;
    let dpr = 0;
    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let ox = 0;
    // atlases
    let headAtlas = null;
    let trailAtlas = null;
    let hs = 0; // head slot size, device px
    let ts = 0; // trail slot size
    // cells
    let inten = new Float32Array(0);
    let glyph = new Uint16Array(0);
    let hue = new Uint8Array(0);
    // columns
    let headY = new Float32Array(0);
    let colSpeed = new Float32Array(0);
    let headRow = new Int16Array(0);
    let wait = new Int32Array(0);
    let colHue = new Uint8Array(0);
    let sparse = new Float32Array(0);
    let decay = new Float32Array(0);
    let nameSeq = new Int8Array(0);
    let nameStep = new Uint8Array(0);
    let active = false;

    // Draw glyph `g` centred at (cx, cy) on `target` with its current fill/shadow settings.
    function drawGlyph(target, g, cx, cy, px) {
      const ch = GLYPHS[g];
      const bm = BITMAPS[ch];
      if (!bm) {
        target.fillText(ch, cx, cy);
        return;
      }
      const h = bm.rows.length;
      const w = bm.rows[0].length;
      const x0 = Math.round(cx - (w * px) / 2);
      const y0 = Math.round(cy - (h * px) / 2 + bm.dy * px);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          if (bm.rows[r][c] === "#") target.fillRect(x0 + c * px, y0 + r * px, px, px);
        }
      }
    }

    function buildAtlases() {
      const fontPx = f * dpr;
      const bitPx = Math.max(1, Math.round((f / 16) * dpr)); // one font pixel, device px
      hs = Math.ceil(fontPx * 1.9);
      ts = Math.ceil(fontPx * 1.15);
      const n = GLYPHS.length;

      headAtlas = document.createElement("canvas");
      headAtlas.width = PER_ROW * hs;
      headAtlas.height = Math.ceil((n * 2) / PER_ROW) * hs;
      let ctx2 = headAtlas.getContext("2d");
      ctx2.font = `${fontPx}px ${family}`;
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      for (let g = 0; g < n; g++) {
        for (let v = 0; v < 2; v++) {
          const slot = g * 2 + v;
          const cx = (slot % PER_ROW) * hs + hs / 2;
          const cy = ((slot / PER_ROW) | 0) * hs + hs / 2;
          ctx2.shadowColor = rgba(HEAD_GLOW[v], 0.95);
          ctx2.shadowBlur = fontPx * 0.55;
          ctx2.fillStyle = rgba(mixRgb(C.cream, HEAD_GLOW[v], 0.25));
          drawGlyph(ctx2, g, cx, cy, bitPx);
          ctx2.shadowBlur = 0;
          ctx2.fillStyle = rgba(C.cream);
          drawGlyph(ctx2, g, cx, cy, bitPx);
        }
      }

      trailAtlas = document.createElement("canvas");
      trailAtlas.width = PER_ROW * ts;
      trailAtlas.height = Math.ceil((n * 2 * TRAIL_STEPS) / PER_ROW) * ts;
      ctx2 = trailAtlas.getContext("2d");
      ctx2.font = `${fontPx}px ${family}`;
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      for (let g = 0; g < n; g++) {
        for (let v = 0; v < 2 * TRAIL_STEPS; v++) {
          const slot = g * 2 * TRAIL_STEPS + v;
          ctx2.fillStyle = rgba(TRAIL_COLORS[(v / TRAIL_STEPS) | 0][v % TRAIL_STEPS]);
          drawGlyph(
            ctx2,
            g,
            (slot % PER_ROW) * ts + ts / 2,
            ((slot / PER_ROW) | 0) * ts + ts / 2,
            bitPx,
          );
        }
      }
    }

    function respawn(c, initial) {
      const s = rand(0.16, 0.5) * spd; // rows per step
      colSpeed[c] = s;
      colHue[c] = Math.random() < 0.16 ? 1 : 0;
      sparse[c] = Math.random() < 0.3 ? rand(0.35, 0.65) : 0; // chance to skip a cell
      const trail = rand(7, 20); // rows until the trail has faded
      decay[c] = Math.pow(0.04, s / trail);
      nameSeq[c] = Math.random() < 0.07 ? (Math.random() * NAME_SEQS.length) | 0 : -1;
      nameStep[c] = 0;
      headY[c] = initial ? rand(-rows * 0.3, rows) : -rand(0, 3);
      headRow[c] = Math.floor(headY[c]);
      const fall = (rows + 4) / s;
      const meanWait = (fall * (1 - dens)) / dens;
      wait[c] = initial ? Math.round(rand(0, meanWait * 1.2)) : Math.round(meanWait * rand(0.4, 1.6) + rand(0, 12));
    }

    function step() {
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        let v = inten[i];
        if (!v) continue;
        v *= decay[i % cols];
        if (v < 0.03) v = 0;
        else if (v > 0.12 && Math.random() < 0.012) glyph[i] = pick(); // occasional mutation
        inten[i] = v;
      }
      for (let c = 0; c < cols; c++) {
        if (wait[c] > 0) {
          wait[c]--;
          continue;
        }
        headY[c] += colSpeed[c];
        const row = Math.floor(headY[c]);
        if (row !== headRow[c]) {
          headRow[c] = row;
          if (row >= 0 && row < rows) {
            const seq = nameSeq[c] >= 0 ? NAME_SEQS[nameSeq[c]] : null;
            let g = -1;
            if (seq && nameStep[c] < seq.length) g = seq[nameStep[c]++];
            else if (!(sparse[c] && Math.random() < sparse[c])) g = pick();
            if (g >= 0) {
              const idx = row * cols + c;
              glyph[idx] = g;
              inten[idx] = 1;
              hue[idx] = colHue[c];
            }
          }
        }
        if (row >= 0 && row < rows) {
          const idx = row * cols + c;
          if (inten[idx] > 0.9) inten[idx] = 1; // the head stays hot until it moves on
        }
        if (row > rows + 1) respawn(c, false);
      }
    }

    function draw(dim) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!trailAtlas) return;
      const cwD = colW * dpr;
      const rhD = rowH * dpr;
      const oxD = ox * dpr;
      const n = cols * rows;
      const stride = 2 * TRAIL_STEPS;
      for (let i = 0; i < n; i++) {
        const v = inten[i];
        if (!v) continue;
        const c = i % cols;
        const r = (i / cols) | 0;
        if (!dim && v === 1 && headRow[c] === r) continue; // heads are drawn last, on top
        const stepIdx = v > 0.78 ? 0 : v > 0.5 ? 1 : v > 0.27 ? 2 : 3;
        const slot = glyph[i] * stride + hue[i] * TRAIL_STEPS + stepIdx;
        ctx.globalAlpha = Math.min(1, v * 1.15) * (dim ? 0.55 : 1);
        ctx.drawImage(
          trailAtlas,
          (slot % PER_ROW) * ts,
          ((slot / PER_ROW) | 0) * ts,
          ts,
          ts,
          Math.round(oxD + (c + 0.5) * cwD - ts / 2),
          Math.round((r + 0.5) * rhD - ts / 2),
          ts,
          ts,
        );
      }
      if (!dim) {
        ctx.globalAlpha = 1;
        for (let c = 0; c < cols; c++) {
          const r = headRow[c];
          if (wait[c] > 0 || r < 0 || r >= rows) continue;
          const i = r * cols + c;
          if (inten[i] !== 1) continue;
          const slot = glyph[i] * 2 + hue[i];
          ctx.drawImage(
            headAtlas,
            (slot % PER_ROW) * hs,
            ((slot / PER_ROW) | 0) * hs,
            hs,
            hs,
            Math.round(oxD + (c + 0.5) * cwD - hs / 2),
            Math.round((r + 0.5) * rhD - hs / 2),
            hs,
            hs,
          );
        }
      }
      ctx.globalAlpha = 1;
    }

    function layout() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (!W || !H) return false;
      const nextDpr = getDpr(2);
      sizeCanvas(canvas, W, H, nextDpr);
      if (nextDpr !== dpr || !headAtlas) {
        dpr = nextDpr;
        buildAtlases();
      }
      const nextCols = Math.max(1, Math.ceil(W / colW));
      const nextRows = Math.max(1, Math.ceil(H / rowH));
      ox = (W - nextCols * colW) / 2;
      if (nextCols === cols && nextRows === rows) return true;
      cols = nextCols;
      rows = nextRows;
      const n = cols * rows;
      inten = new Float32Array(n);
      glyph = new Uint16Array(n);
      hue = new Uint8Array(n);
      headY = new Float32Array(cols);
      colSpeed = new Float32Array(cols);
      headRow = new Int16Array(cols);
      wait = new Int32Array(cols);
      colHue = new Uint8Array(cols);
      sparse = new Float32Array(cols);
      decay = new Float32Array(cols);
      nameSeq = new Int8Array(cols);
      nameStep = new Uint8Array(cols);
      for (let c = 0; c < cols; c++) respawn(c, true);
      for (let s = 0; s < 90; s++) step(); // warm up so trails exist on the first frame
      return true;
    }

    const loop = createLoop(() => {
      step();
      draw(false);
    }, STEP_FPS);

    const render = () => {
      if (!fontReady || disposed) return;
      if (!layout()) return;
      draw(reduced);
    };

    const sync = () => {
      if (active && fontReady && !reduced) loop.start();
      else loop.stop();
    };

    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    const unwatch = watchActivity(canvas, (a) => {
      active = a;
      sync();
    });

    // Wait for DotGothic16 (only the unicode-range chunks our glyphs need), but never forever.
    const fonts = document.fonts;
    const load = fonts?.load
      ? fonts.load(`${f}px "DotGothic16"`, FONT_CHARS).catch(() => null)
      : Promise.resolve();
    Promise.race([load, new Promise((r) => setTimeout(r, 2500))]).then(() => {
      if (disposed) return;
      fontReady = true;
      render();
      sync();
    });

    return () => {
      disposed = true;
      loop.stop();
      unwatch();
      ro.disconnect();
    };
  }, [fontSize, density, speed, reduced]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={BASE_STYLE} />;
}
