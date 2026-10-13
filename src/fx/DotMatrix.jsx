import { useEffect, useMemo, useRef } from "react";
import { DOT_FONT_ROWS, textToDotColumns } from "./dotFont.js";
import { getDpr, sizeCanvas } from "./dpr.js";
import { createLoop } from "./loop.js";
import { usePrefersReducedMotion } from "./media.js";
import { useFx } from "./perf.js";
import { watchActivity } from "./observe.js";
import { PALETTE, hexToRgb, mixRgb, parseColor, rgba } from "./palette.js";
import { getPointer, subscribePointer } from "./pointer.js";

// eslint-disable-next-line react-refresh/only-export-components
export { textToDotColumns };

/*
 * DotMatrix: an LED sign. Every grid cell has a dot; lit dots glow in `color`, the rest sit in
 * `offColor`, so you always see the full panel of dim LEDs behind the letters.
 *
 * Rendering (Canvas2D):
 *   - the unlit grid (and, for static/fit signs, the lit text too) is baked once per resize into
 *     an offscreen "background" canvas; a frame starts with a single drawImage of it;
 *   - lit dots are pre-rendered sprites (core + soft halo) blitted with "lighter" compositing,
 *     never per-frame shadowBlur;
 *   - marquee: the dots never move. Each frame the text pattern shifts by a fractional number
 *     of columns and every dot crossfades between "lit in column n" and "lit in column n+1".
 *     That temporal anti-aliasing reads as smooth scrolling while staying a true LED grid;
 *   - pointer: a decaying per-dot "heat" map. Lit dots heat to a cream core, unlit dots faintly
 *     light up, and the heat fades over ~0.3s, so the cursor leaves a painted trail.
 */

const TAU = Math.PI * 2;
const CREAM = hexToRgb(PALETTE.cream);
const BLACK = [0, 0, 0];
const FIT_PAD = 1; // dot columns of frame either side of a "fit" sign
const HEAT_DECAY = 0.32; // s
const SHEEN_PERIOD = 7; // s, fit mode: a highlight sweeps across the sign this often
const SHEEN_SWEEP = 1.5; // s

function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

export default function DotMatrix({
  text = "",
  mode = "marquee",
  pitch = 6,
  dotScale = 0.72,
  speed = 40,
  color = "#f78fc4",
  offColor = "rgba(247,143,196,0.07)",
  glow = true,
  padY = 1,
  gap = 1,
  align = "center",
  interactive = true,
  className,
  ariaLabel,
}) {
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const { lite } = useFx();
  const rows = DOT_FONT_ROWS + 2 * padY;
  const fitCols = useMemo(
    () => (mode === "fit" ? textToDotColumns(text, gap).length + 2 * FIT_PAD : 0),
    [mode, text, gap],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;

    const fit = mode === "fit";
    const marquee = mode === "marquee" && !reduced;
    const canInteract = interactive && !reduced && !lite;
    const sheenOn = fit && !reduced && !lite;
    // Marquee repeats the text with one space between copies (unless it already ends in one).
    const unitText = marquee && text && !/\s$/.test(text) ? `${text} ` : text;
    const unit = textToDotColumns(unitText, gap);
    const U = unit.length;
    const lit = parseColor(color).slice(0, 3);

    const bg = document.createElement("canvas");
    const bgCtx = bg.getContext("2d");
    let W = 0;
    let H = 0;
    let dpr = 1;
    let cols = 0;
    let pitchCss = pitch;
    let pd = 0; // pitch, device px
    let cw = 0;
    let ch = 0;
    let spriteSize = 0;
    let spriteLit = null;
    let spriteHot = null;
    let colX = new Float32Array(0); // sprite top-left per column / row, device px
    let rowY = new Float32Array(0);
    let heat = new Float32Array(0);
    let litMask = new Uint8Array(0); // static/fit: 1 where the text lights a dot
    let litCells = new Int32Array(0);
    let heatMax = 0;
    let offset = 0; // marquee scroll, in dot columns
    let rect = null;
    let active = false;
    let pointerNear = false;
    let sheenTimer = 0;
    const sheenStart = performance.now();

    function buildSprites() {
      const r = Math.max(0.7, (pitchCss * dotScale) / 2) * dpr;
      const glowR = glow ? Math.max(r * 2.2, pd * 1.55) : r + 1;
      spriteSize = Math.ceil(glowR * 2) + 2;
      const c = spriteSize / 2;

      // Lit LED: soft halo + a slightly hot, off-centre core so it reads as a little bulb.
      spriteLit = makeCanvas(spriteSize);
      let g = spriteLit.getContext("2d");
      if (glow) {
        const halo = g.createRadialGradient(c, c, r * 0.4, c, c, glowR);
        halo.addColorStop(0, rgba(lit, 0.3));
        halo.addColorStop(0.3, rgba(lit, 0.085));
        halo.addColorStop(1, rgba(lit, 0));
        g.fillStyle = halo;
        g.fillRect(0, 0, spriteSize, spriteSize);
      }
      let core = g.createRadialGradient(c - r * 0.3, c - r * 0.3, 0, c, c, r);
      core.addColorStop(0, rgba(mixRgb(lit, CREAM, 0.4)));
      core.addColorStop(0.6, rgba(lit));
      core.addColorStop(1, rgba(mixRgb(lit, BLACK, 0.1)));
      g.fillStyle = core;
      g.beginPath();
      g.arc(c, c, r, 0, TAU);
      g.fill();

      // Hot LED (under the cursor / sheen): cream core, warmer, wider halo.
      spriteHot = makeCanvas(spriteSize);
      g = spriteHot.getContext("2d");
      const hotHalo = mixRgb(lit, CREAM, 0.35);
      const halo = g.createRadialGradient(c, c, r * 0.4, c, c, glow ? glowR : r * 1.8);
      halo.addColorStop(0, rgba(hotHalo, 0.5));
      halo.addColorStop(0.35, rgba(hotHalo, 0.16));
      halo.addColorStop(1, rgba(hotHalo, 0));
      g.fillStyle = halo;
      g.fillRect(0, 0, spriteSize, spriteSize);
      core = g.createRadialGradient(c, c, 0, c, c, r);
      core.addColorStop(0, rgba(CREAM));
      core.addColorStop(0.7, rgba(mixRgb(CREAM, lit, 0.35)));
      core.addColorStop(1, rgba(mixRgb(CREAM, lit, 0.6)));
      g.fillStyle = core;
      g.beginPath();
      g.arc(c, c, r, 0, TAU);
      g.fill();

      return r;
    }

    function buildBackground(r) {
      bg.width = cw;
      bg.height = ch;
      // Unlit grid: one path of arcs, filled once.
      bgCtx.fillStyle = offColor;
      bgCtx.beginPath();
      const h = spriteSize / 2;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cx = colX[x] + h;
          const cy = rowY[y] + h;
          bgCtx.moveTo(cx + r, cy);
          bgCtx.arc(cx, cy, r, 0, TAU);
        }
      }
      bgCtx.fill();
      if (marquee) return;
      // Static / fit: bake the lit text in too.
      bgCtx.globalCompositeOperation = "lighter";
      for (let i = 0; i < litCells.length; i++) {
        const idx = litCells[i];
        bgCtx.drawImage(spriteLit, colX[idx % cols], rowY[(idx / cols) | 0]);
      }
      bgCtx.globalCompositeOperation = "source-over";
    }

    function layout() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (!W || !H) return false;
      dpr = getDpr(2);
      sizeCanvas(canvas, W, H, dpr);
      cw = canvas.width;
      ch = canvas.height;
      cols = fit ? U + 2 * FIT_PAD : Math.max(1, Math.floor(W / pitch));
      pitchCss = fit ? W / cols : pitch;
      pd = pitchCss * dpr;
      const r = buildSprites();

      const ox = (cw - cols * pd) / 2;
      const oy = (ch - rows * pd) / 2;
      colX = new Float32Array(cols);
      rowY = new Float32Array(rows);
      for (let x = 0; x < cols; x++) colX[x] = Math.round(ox + (x + 0.5) * pd - spriteSize / 2);
      for (let y = 0; y < rows; y++) rowY[y] = Math.round(oy + (y + 0.5) * pd - spriteSize / 2);
      heat = new Float32Array(cols * rows);
      heatMax = 0;

      if (!marquee) {
        // Left/right aligned text keeps a one-dot inset when there's room. Text that doesn't fit
        // always starts at the left edge and is clipped on the right, so it stays readable.
        const inset = cols - U >= 2 ? 1 : 0;
        let start;
        if (fit) start = FIT_PAD;
        else if (align === "left" || U > cols) start = inset;
        else if (align === "right") start = cols - U - inset;
        else start = Math.floor((cols - U) / 2);
        litMask = new Uint8Array(cols * rows);
        const cells = [];
        for (let x = 0; x < cols; x++) {
          const ux = x - start;
          if (ux < 0 || ux >= U) continue;
          const m = unit[ux];
          for (let y = 0; y < DOT_FONT_ROWS; y++) {
            if (m & (1 << y)) {
              const idx = (y + padY) * cols + x;
              litMask[idx] = 1;
              cells.push(idx);
            }
          }
        }
        litCells = Int32Array.from(cells);
      }
      buildBackground(r);
      rect = null;
      return true;
    }

    // How lit a dot is right now (0-1), counting the marquee crossfade.
    function litAmount(x, y) {
      if (!marquee) return litMask[y * cols + x];
      const ty = y - padY;
      if (ty < 0 || ty >= DOT_FONT_ROWS || !U) return 0;
      const base = Math.floor(offset);
      const f = offset - base;
      const ia = (base + x) % U;
      const bit = 1 << ty;
      const a = unit[ia] & bit ? 1 : 0;
      const b = unit[(ia + 1) % U] & bit ? 1 : 0;
      return a + (b - a) * f;
    }

    function drawMarquee() {
      if (!U) return;
      const base = Math.floor(offset);
      const f = offset - base;
      for (let x = 0; x < cols; x++) {
        const ia = (base + x) % U;
        const ma = unit[ia];
        const mb = unit[(ia + 1) % U];
        const m = ma | mb;
        if (!m) continue;
        const px = colX[x];
        for (let y = 0; y < DOT_FONT_ROWS; y++) {
          const bit = 1 << y;
          if (!(m & bit)) continue;
          ctx.globalAlpha = ma & bit ? (mb & bit ? 1 : 1 - f) : f;
          ctx.drawImage(spriteLit, px, rowY[y + padY]);
        }
      }
    }

    function drawSprite(sprite, x, y, scale, alpha) {
      ctx.globalAlpha = alpha;
      if (scale === 1) {
        ctx.drawImage(sprite, colX[x], rowY[y]);
        return;
      }
      const s = spriteSize * scale;
      const o = (s - spriteSize) / 2;
      ctx.drawImage(sprite, colX[x] - o, rowY[y] - o, s, s);
    }

    function drawHeat() {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const h = heat[y * cols + x];
          if (h < 0.01) continue;
          const l = litAmount(x, y);
          if (l > 0.01) drawSprite(spriteHot, x, y, 1 + 0.24 * h, h * l);
          if (l < 0.99) drawSprite(spriteLit, x, y, 1 + 0.12 * h, h * (1 - l) * 0.36);
        }
      }
    }

    function sheenPhase(now) {
      return ((now - sheenStart) / 1000) % SHEEN_PERIOD;
    }

    function drawSheen(now) {
      const ph = sheenPhase(now);
      if (ph > SHEEN_SWEEP) return;
      const k = ph / SHEEN_SWEEP;
      const slant = 0.55;
      const span = cols + rows * slant;
      const pos = -0.15 + k * 1.3; // band centre, 0-1 across the sign
      for (let i = 0; i < litCells.length; i++) {
        const idx = litCells[i];
        const x = idx % cols;
        const y = (idx / cols) | 0;
        const d = ((x + (rows - y) * slant) / span - pos) / 0.07;
        const a = Math.exp(-d * d);
        if (a > 0.02) drawSprite(spriteHot, x, y, 1, a * 0.6);
      }
    }

    function updateHeat(dt) {
      const decay = Math.exp(-dt / HEAT_DECAY);
      let max = 0;
      for (let i = 0; i < heat.length; i++) {
        let h = heat[i];
        if (!h) continue;
        h *= decay;
        if (h < 0.004) h = 0;
        heat[i] = h;
        if (h > max) max = h;
      }
      pointerNear = false;
      const p = getPointer();
      if (canInteract && p.active && pd) {
        if (!rect) rect = canvas.getBoundingClientRect();
        const R = Math.max(62, pitchCss * 2.4); // CSS px
        const lx = p.x - rect.left;
        const ly = p.y - rect.top;
        if (lx > -R && ly > -R && lx < rect.width + R && ly < rect.height + R) {
          pointerNear = true;
          const ox = (cw - cols * pd) / 2;
          const oy = (ch - rows * pd) / 2;
          const gx = (lx * dpr - ox) / pd - 0.5; // pointer in fractional cell coordinates
          const gy = (ly * dpr - oy) / pd - 0.5;
          const rc = (R * dpr) / pd;
          const x0 = Math.max(0, Math.ceil(gx - rc));
          const x1 = Math.min(cols - 1, Math.floor(gx + rc));
          const y0 = Math.max(0, Math.ceil(gy - rc));
          const y1 = Math.min(rows - 1, Math.floor(gy + rc));
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const dx = x - gx;
              const dy = y - gy;
              const d = Math.sqrt(dx * dx + dy * dy) / rc;
              if (d >= 1) continue;
              let v = 1 - d;
              v = v * v * (3 - 2 * v);
              const idx = y * cols + x;
              if (v > heat[idx]) heat[idx] = v;
              if (v > max) max = v;
            }
          }
        }
      }
      heatMax = max;
    }

    function draw(now) {
      if (!cw) return;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(bg, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      if (marquee) drawMarquee();
      if (heatMax > 0.004) drawHeat();
      if (sheenOn) drawSheen(now);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    function scheduleSheen() {
      clearTimeout(sheenTimer);
      if (!sheenOn || !active) return;
      const wait = (SHEEN_PERIOD - sheenPhase(performance.now())) * 1000;
      sheenTimer = setTimeout(() => active && loop.start(), wait + 16);
    }

    function frame(now, dt) {
      updateHeat(dt);
      if (marquee && U) offset = (offset + (speed * dt) / pitchCss) % U;
      draw(now);
      if (marquee) return true;
      // Static / fit signs only animate while something is happening, then sleep.
      const busy = heatMax > 0.004 || pointerNear || (sheenOn && sheenPhase(now) <= SHEEN_SWEEP);
      if (!busy) scheduleSheen();
      return busy;
    }

    const loop = createLoop(frame, lite ? 30 : 60);

    const relayout = () => {
      if (layout()) draw(performance.now());
    };
    relayout();
    const ro = new ResizeObserver(relayout);
    ro.observe(canvas);

    const invalidateRect = () => {
      rect = null;
    };
    window.addEventListener("scroll", invalidateRect, { passive: true, capture: true });
    window.addEventListener("resize", invalidateRect);

    const unsubPointer = canInteract
      ? subscribePointer({
          move: (p) => {
            if (!active || loop.running) return;
            if (!rect) rect = canvas.getBoundingClientRect();
            const R = Math.max(62, pitchCss * 2.4);
            if (
              p.x > rect.left - R &&
              p.x < rect.right + R &&
              p.y > rect.top - R &&
              p.y < rect.bottom + R
            ) {
              loop.start();
            }
          },
        })
      : null;

    const unwatch = watchActivity(canvas, (a) => {
      active = a;
      if (a) {
        if (marquee || sheenOn) loop.start();
      } else {
        loop.stop();
        clearTimeout(sheenTimer);
      }
    });

    return () => {
      loop.stop();
      clearTimeout(sheenTimer);
      unwatch();
      unsubPointer?.();
      ro.disconnect();
      window.removeEventListener("scroll", invalidateRect, { capture: true });
      window.removeEventListener("resize", invalidateRect);
    };
  }, [
    text,
    mode,
    pitch,
    dotScale,
    speed,
    color,
    offColor,
    glow,
    padY,
    gap,
    align,
    interactive,
    reduced,
    lite,
    rows,
  ]);

  const style =
    mode === "fit"
      ? { display: "block", width: "100%", aspectRatio: `${Math.max(1, fitCols)} / ${rows}` }
      : { display: "block", width: "100%", height: rows * pitch };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel ?? text}
      className={className}
      style={style}
    />
  );
}
