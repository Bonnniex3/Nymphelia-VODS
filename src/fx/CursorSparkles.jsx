import { useEffect, useRef } from "react";
import { getDpr, sizeCanvas } from "./dpr.js";
import { createLoop } from "./loop.js";
import { useMediaQuery, usePrefersReducedMotion } from "./media.js";
import { PALETTE, hexToRgb, rgba } from "./palette.js";

/*
 * CursorSparkles: a light trail of ✦ sparkles (and the odd heart) behind a mouse/pen pointer.
 * Spawning is throttled by distance travelled, particles live in a fixed pool of typed arrays,
 * sprites are pre-rendered with their glow, and the rAF loop only runs while particles exist.
 */

const MAX = 60;
const SPAWN_EVERY = 20; // CSS px of pointer travel per sparkle
const SPRITE_CSS = 28; // sprite box (CSS px); particles are drawn smaller than this

const COLORS = [PALETTE.petal, PALETTE.cream, PALETTE.sky, PALETTE.lilac, PALETTE.neon].map(hexToRgb);
// Weighted colour picks for sparkles (indices into COLORS); hearts are always petal/neon.
const SPARKLE_PICKS = [0, 0, 0, 1, 1, 2, 2, 3];
const HEART_PICKS = [0, 4];

function sparklePath(g, r) {
  // Concave four-point star: quadratic curves pulled toward the centre.
  const k = r * 0.16;
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(k, -k, r, 0);
  g.quadraticCurveTo(k, k, 0, r);
  g.quadraticCurveTo(-k, k, -r, 0);
  g.quadraticCurveTo(-k, -k, 0, -r);
  g.closePath();
}

function heartPath(g, r) {
  g.beginPath();
  g.moveTo(0, r * 0.85);
  g.bezierCurveTo(-r * 1.25, r * 0.05, -r * 0.7, -r * 0.95, 0, -r * 0.38);
  g.bezierCurveTo(r * 0.7, -r * 0.95, r * 1.25, r * 0.05, 0, r * 0.85);
  g.closePath();
}

function makeSprites(dpr) {
  const size = Math.ceil(SPRITE_CSS * dpr);
  const sprites = [];
  for (let shape = 0; shape < 2; shape++) {
    for (let c = 0; c < COLORS.length; c++) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const g = cv.getContext("2d");
      g.translate(size / 2, size / 2);
      const r = size * 0.3;
      g.shadowColor = rgba(COLORS[c], 0.9);
      g.shadowBlur = size * 0.16;
      g.fillStyle = rgba(COLORS[c]);
      if (shape === 0) sparklePath(g, r);
      else heartPath(g, r * 0.78);
      g.fill();
      // Crisp pass + a tiny cream core for sparkle.
      g.shadowBlur = 0;
      g.fill();
      if (shape === 0) {
        g.fillStyle = rgba(hexToRgb(PALETTE.cream), 0.9);
        sparklePath(g, r * 0.42);
        g.fill();
      }
      sprites.push(cv);
    }
  }
  return { sprites, size };
}

export default function CursorSparkles() {
  const fine = useMediaQuery("(pointer: fine)");
  const reduced = usePrefersReducedMotion();
  const enabled = fine && !reduced;
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;

    let dpr = getDpr(2);
    let { sprites, size } = makeSprites(dpr);
    const x = new Float32Array(MAX);
    const y = new Float32Array(MAX);
    const vx = new Float32Array(MAX);
    const vy = new Float32Array(MAX);
    const rot = new Float32Array(MAX);
    const vr = new Float32Array(MAX);
    const scale = new Float32Array(MAX);
    const age = new Float32Array(MAX);
    const life = new Float32Array(MAX); // 0 = slot free
    const sprite = new Uint8Array(MAX);
    const heart = new Uint8Array(MAX);
    let live = 0;
    let cursor = 0;
    let lastX = null;
    let lastY = 0;
    let travel = 0;

    const resize = () => {
      const next = getDpr(2);
      if (next !== dpr) {
        dpr = next;
        ({ sprites, size } = makeSprites(dpr));
      }
      sizeCanvas(canvas, window.innerWidth, window.innerHeight, dpr);
    };
    resize();

    function spawn(px, py, burst) {
      const i = cursor;
      cursor = (cursor + 1) % MAX; // full pool: recycle the oldest
      if (!life[i]) live++;
      const isHeart = !burst && Math.random() < 0.14;
      heart[i] = isHeart ? 1 : 0;
      const picks = isHeart ? HEART_PICKS : SPARKLE_PICKS;
      sprite[i] = (isHeart ? COLORS.length : 0) + picks[(Math.random() * picks.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const sp = burst ? 70 + Math.random() * 60 : 10 + Math.random() * 28;
      x[i] = px + (burst ? 0 : (Math.random() - 0.5) * 8);
      y[i] = py + (burst ? 0 : (Math.random() - 0.5) * 8);
      vx[i] = Math.cos(a) * sp;
      vy[i] = Math.sin(a) * sp + (isHeart ? -14 : 6);
      rot[i] = isHeart ? (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI;
      vr[i] = isHeart ? 0 : (Math.random() - 0.5) * 3.2;
      // Sprite shape radius is 0.3 * SPRITE_CSS; scale so particles land at ~5-11px across.
      scale[i] = (isHeart ? 0.5 : 0.36) + Math.random() * (isHeart ? 0.18 : 0.34);
      age[i] = 0;
      life[i] = 0.6 + Math.random() * 0.3;
    }

    const loop = createLoop((_now, dt) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const half = size / 2;
      for (let i = 0; i < MAX; i++) {
        if (!life[i]) continue;
        const a = (age[i] += dt);
        const t = a / life[i];
        if (t >= 1) {
          life[i] = 0;
          live--;
          continue;
        }
        const drag = Math.exp(-dt * 2.4);
        vx[i] *= drag;
        vy[i] = vy[i] * drag + (heart[i] ? -22 : 16) * dt; // hearts float up, sparkles sink
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        rot[i] += vr[i] * dt;
        // Pop in (back-out) over the first 18%, then shrink away; fade out over the second half.
        let s;
        if (t < 0.18) {
          const q = t / 0.18 - 1;
          s = 1 + 2.4 * q * q * q + 1.4 * q * q;
        } else {
          const q = (t - 0.18) / 0.82;
          s = 1 - q * q;
        }
        const k = scale[i] * s * dpr;
        if (k <= 0.01) continue;
        const wobble = heart[i] ? Math.sin(a * 9) * 0.25 : 0;
        const c = Math.cos(rot[i] + wobble) * k;
        const sn = Math.sin(rot[i] + wobble) * k;
        ctx.globalAlpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
        ctx.setTransform(c, sn, -sn, c, x[i] * dpr, y[i] * dpr);
        ctx.drawImage(sprites[sprite[i]], -half, -half);
      }
      ctx.globalAlpha = 1;
      return live > 0;
    }, 60);

    const onMove = (e) => {
      if (e.pointerType === "touch") return;
      const px = e.clientX;
      const py = e.clientY;
      if (lastX === null) {
        lastX = px;
        lastY = py;
        return;
      }
      const dx = px - lastX;
      const dy = py - lastY;
      const d = Math.hypot(dx, dy);
      if (d > 300) {
        // pointer teleported (e.g. re-entered the window): don't streak a line of sparkles
        lastX = px;
        lastY = py;
        travel = 0;
        return;
      }
      travel += d;
      let spawned = 0;
      while (travel >= SPAWN_EVERY && spawned < 2) {
        travel -= SPAWN_EVERY;
        const f = 1 - travel / Math.max(d, 1);
        spawn(lastX + dx * Math.min(1, f), lastY + dy * Math.min(1, f), false);
        spawned++;
      }
      if (travel > SPAWN_EVERY) travel = SPAWN_EVERY * 0.5;
      lastX = px;
      lastY = py;
      if (spawned) loop.start();
    };

    const onDown = (e) => {
      if (e.pointerType === "touch") return;
      for (let k = 0; k < 6; k++) spawn(e.clientX, e.clientY, true);
      loop.start();
    };

    const onLeave = (e) => {
      if (!e.relatedTarget) lastX = null;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerout", onLeave, { passive: true });
    window.addEventListener("resize", resize);

    return () => {
      loop.stop();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerout", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 60,
      }}
    />
  );
}
