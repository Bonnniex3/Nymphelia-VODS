import { useEffect, useRef, useState } from "react";
import { getDpr, sizeCanvas } from "./dpr.js";
import {
  GLSL_NOISE,
  createProgram,
  detectWebGL,
  getGLContext,
  maxPointSize,
  releaseContextLater,
} from "./gl.js";
import { createLoop } from "./loop.js";
import { usePrefersReducedMotion } from "./media.js";
import { watchActivity } from "./observe.js";
import { getPointer, subscribePointer } from "./pointer.js";

/*
 * HalftoneField: the living dot-matrix behind the whole site.
 *
 * One GL point per grid cell. All the work happens in the vertex shader, once per dot:
 *   1. a domain-warped fbm field (simplex noise warped by more noise) gives slow, smoky
 *      tendrils; it drifts upward over time and parallaxes with scroll;
 *   2. a vignette mask keeps the centre / top-middle calm (content sits there) and lets the
 *      edges and corners get rich;
 *   3. pointer lens + click ripples + rare twinkles are layered on top;
 *   4. the result sets the dot radius (pinprick -> 45% of the cell), colour and alpha.
 * The fragment shader only draws an anti-aliased disc (plus a soft halo / 4-point glint), and
 * since points are only as big as their dot, fragment cost stays tiny even at 4K.
 */

const PARALLAX = 0.25;
const FPS = 40;
const MAX_DPR = 1.5;
const MAX_PIXELS = 3.5e6;
const RIPPLES = 4;
const RIPPLE_LIFE = 2.2; // s
const TIME_OFFSET = 60; // start mid-flow so the very first frame is already developed
const STATIC_TIME = 83.0; // the frame shown with prefers-reduced-motion

const VERTEX = /* glsl */ `
ATTR vec2 a_cell;

uniform vec2 u_view;       // viewport, CSS px
uniform vec2 u_origin;     // grid offset, CSS px
uniform float u_cell;      // grid pitch, CSS px
uniform float u_dpr;
uniform float u_time;      // s
uniform float u_scroll;    // scrollY * parallax, CSS px
uniform vec3 u_pointer;    // eased x, y (CSS px), strength 0-1
uniform vec4 u_ripples[${RIPPLES}]; // x, y, age (s), strength
uniform float u_intensity;
uniform float u_maxPoint;

VARYING vec4 v_color; // straight rgb + alpha
VARYING vec4 v_shape; // x: disc radius (device px), y: sprite size (device px), z: glint, w: halo

const vec3 ROSE  = vec3(0.761, 0.333, 0.533);
const vec3 PETAL = vec3(0.969, 0.561, 0.769);
const vec3 BLUSH = vec3(0.984, 0.812, 0.910);
const vec3 NEON  = vec3(1.000, 0.435, 0.710);
const vec3 SKY   = vec3(0.765, 0.651, 1.000);
const vec3 LILAC = vec3(0.561, 0.478, 0.902);
const vec3 CREAM = vec3(1.000, 0.969, 0.980);

${GLSL_NOISE}

float fbm4(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(p);
    p = vec3(p.xy * 2.03 + vec2(13.7, -7.3), p.z * 1.4);
    a *= 0.5;
  }
  return s;
}

float fbm2(vec3 p) {
  return 0.65 * snoise(p) + 0.3 * snoise(vec3(p.xy * 2.07 + vec2(4.1, 9.7), p.z * 1.5));
}

// Expanding rings from clicks/taps. Each ring decelerates, widens and fades.
float ripples(vec2 p) {
  float acc = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = u_ripples[i];
    if (r.w > 0.0) {
      float age = r.z;
      float radius = age * (560.0 - 130.0 * age);
      float width = 20.0 + age * 46.0;
      float d = (length(p - r.xy) - radius) / width;
      float fade = 1.0 - smoothstep(0.05, ${RIPPLE_LIFE.toFixed(1)} - 0.2, age);
      acc += exp(-d * d) * fade * r.w;
    }
  }
  return acc;
}

// Each cell re-rolls (per its own period) whether it sparkles this cycle; when it does, a
// short sin^2 envelope makes a brief cream glint. ~0.3% of cells are lit at any moment.
float twinkle(vec2 cell, float t, float rich) {
  float period = 4.0 + 7.0 * hash12(cell + 19.19);
  float x = t / period + hash12(cell);
  float cycle = floor(x);
  float ph = fract(x);
  float pick = hash12(cell + cycle * 7.31 + 3.7);
  float on = step(0.958 - 0.03 * rich, pick);
  float k = clamp(ph / 0.06, 0.0, 1.0);
  float env = sin(3.14159265 * k);
  return on * step(ph, 0.06) * env * env;
}

void main() {
  vec2 p = u_origin + (a_cell + 0.5) * u_cell; // dot centre, CSS px, y down
  float t = u_time;

  // Calm zone: an ellipse centred slightly above the middle, where headings/content live.
  vec2 uv = p / u_view;
  vec2 c = (uv - vec2(0.5, 0.36)) * vec2(2.0, 2.25);
  float rich = smoothstep(0.3, 1.45, length(c));

  // Smoke: fbm sampled through a slowly evolving warp, drifting upward, parallaxed by scroll.
  vec2 q = vec2(p.x, p.y + u_scroll) / 660.0;
  vec3 w = vec3(q * 0.85, t * 0.032);
  vec2 warp = vec2(fbm2(w), fbm2(w + vec3(5.2, 1.3, 7.1)));
  float n = fbm4(vec3(q * 1.55 + warp * 1.35 + vec2(0.0, t * 0.016), t * 0.045 + 3.0));
  n = n * 0.8 + 0.5;
  float field = n + (rich - 0.6) * 0.6;
  float s = smoothstep(0.46, 1.04, field);

  vec2 dp = p - u_pointer.xy;
  float lens = exp(-dot(dp, dp) * (1.0 / (2.0 * 88.0 * 88.0))) * u_pointer.z;
  float rip = ripples(p);
  float tw = twinkle(a_cell, t, rich);

  float grow = s + lens * 0.75 + rip * 0.7;
  float g = clamp(grow, 0.0, 1.0);
  float rFrac = mix(0.05, 0.45, g * g * (1.6 - 0.6 * g)) + max(grow - 1.0, 0.0) * 0.1;
  float r = max(rFrac * u_cell, 0.65);
  r = mix(r, max(r, u_cell * 0.2), tw);

  // Magnifier: dots under the lens are nudged outward a touch.
  p += dp * lens * 0.07;

  // Pinpricks stay faintly visible everywhere (the "dot matrix" texture); big dots top out
  // well below opaque so the field never competes with content.
  float alpha = mix(0.12, 0.42, s) * mix(0.72, 1.0, rich);
  alpha += lens * 0.38 + rip * 0.42;

  // Colour: rose -> petal with dot size; a slow low-frequency field drifts whole regions toward
  // lilac / sky for the holographic shimmer; lens and ripples heat toward blush/cream.
  float h = snoise(vec3(q * 0.36 + vec2(-t * 0.006, t * 0.004), t * 0.018 + 17.0)) * 0.5 + 0.5;
  float holo = smoothstep(0.6, 0.86, h); // distinct cool islands, not a pink-lilac (mauve) blend
  vec3 cool = mix(LILAC, SKY, smoothstep(0.68, 0.92, h));
  // (Low alpha over near-black desaturates fast, so the ramp leans on saturated petal/neon.)
  vec3 col = mix(mix(ROSE, NEON, 0.35), mix(PETAL, NEON, 0.4), smoothstep(0.0, 0.85, s));
  col = mix(col, cool, holo * 0.85);
  col = mix(col, NEON, clamp(lens * 0.45 + rip * 0.5, 0.0, 1.0));
  col = mix(col, BLUSH, clamp(lens * 0.4 + rip * 0.2, 0.0, 1.0));
  col = mix(col, CREAM, tw);
  alpha = mix(alpha, 0.95, tw);

  float rPx = r * u_dpr;
  float halo = clamp(lens * 0.55 + rip * 0.6, 0.0, 0.9);
  float size = 2.0 * rPx * (1.0 + halo * 1.5) + 2.0;
  size = max(size, tw * u_cell * 2.6 * u_dpr);
  size = min(size, u_maxPoint);

  gl_PointSize = size;
  v_shape = vec4(rPx, size, tw, halo);
  v_color = vec4(col, clamp(alpha * u_intensity, 0.0, 1.0));
  vec2 clip = p / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
VARYING vec4 v_color;
VARYING vec4 v_shape;

void main() {
  vec2 pc = (gl_PointCoord - 0.5) * v_shape.y; // device px from the dot centre
  float d = length(pc);
  float r = v_shape.x;
  float disc = clamp(r + 0.5 - d, 0.0, 1.0); // analytic 1px anti-aliasing
  float halo = v_shape.w * exp(-d * d / (r * r * 2.4 + 1.0)) * 0.5;
  float a = max(disc, halo) * v_color.a;
  vec3 col = v_color.rgb;
  if (v_shape.z > 0.001) {
    // Four-point glint: sqrt|x| + sqrt|y| < 1 is a concave sparkle (the shape of ✦).
    vec2 sq = sqrt(abs(pc) / (v_shape.y * 0.5));
    float star = (1.0 - smoothstep(0.6, 1.0, sq.x + sq.y)) * v_shape.z;
    a = max(a, star);
    col = mix(col, vec3(1.000, 0.969, 0.980), star);
  }
  if (a < 0.004) discard;
  FRAG_COLOR = vec4(col * a, a); // premultiplied
}
`;

const UNIFORMS = [
  "u_view",
  "u_origin",
  "u_cell",
  "u_dpr",
  "u_time",
  "u_scroll",
  "u_pointer",
  "u_ripples",
  "u_intensity",
  "u_maxPoint",
];

const BASE_STYLE = {
  position: "fixed",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

/**
 * Full-page WebGL dot-matrix background. Fixed, transparent, pointer-events none: put the page
 * background colour behind it and use `className` for z-index.
 */
export default function HalftoneField({ className, cell = 14, intensity = 1 }) {
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const [glSupport] = useState(detectWebGL);
  const pitch = Math.max(4, cell);

  useEffect(() => {
    if (!glSupport) return undefined;
    const canvas = canvasRef.current;
    const ctxInfo = canvas && getGLContext(canvas);
    if (!ctxInfo) return undefined;
    const { gl, webgl2 } = ctxInfo;

    let prog = null;
    let buffer = null;
    let maxPoint = 64;
    let count = 0;
    let gridCols = 0;
    let gridRows = 0;
    let originX = 0;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let lost = gl.isContextLost();
    let active = false;

    const t0 = performance.now();
    const rippleData = new Float32Array(RIPPLES * 4);
    const rippleStart = new Float64Array(RIPPLES).fill(-1);
    let rippleNext = 0;
    let px = -1e4;
    let py = -1e4;
    let pStrength = 0;
    let scroll = window.scrollY * PARALLAX;

    function setup() {
      prog = createProgram(gl, webgl2, VERTEX, FRAGMENT, UNIFORMS, ["a_cell"]);
      buffer = gl.createBuffer();
      maxPoint = maxPointSize(gl);
      gridCols = gridRows = 0;
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    function layout() {
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      dpr = getDpr(MAX_DPR);
      if (W * H * dpr * dpr > MAX_PIXELS) dpr = 1;
      sizeCanvas(canvas, W, H, dpr);

      // Grid is centred horizontally but anchored to the top, so mobile URL-bar resizes only
      // add/remove rows at the bottom instead of shifting every dot.
      const cols = Math.ceil(W / pitch) + 1;
      const rows = Math.ceil(H / pitch) + 1;
      originX = (W - cols * pitch) / 2;
      if (cols === gridCols && rows === gridRows) return;
      gridCols = cols;
      gridRows = rows;
      count = cols * rows;
      const cells = new Float32Array(count * 2);
      for (let y = 0, i = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++, i += 2) {
          cells[i] = x;
          cells[i + 1] = y;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
    }

    function render(now) {
      if (lost || !prog) return;
      const t = reduced ? STATIC_TIME : (now - t0) / 1000 + TIME_OFFSET;
      const u = prog.uniforms;
      const aCell = prog.attribs.a_cell;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(aCell);
      gl.vertexAttribPointer(aCell, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.u_view, W, H);
      gl.uniform2f(u.u_origin, originX, 0);
      gl.uniform1f(u.u_cell, pitch);
      gl.uniform1f(u.u_dpr, dpr);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_scroll, reduced ? 0 : scroll);
      gl.uniform3f(u.u_pointer, px, py, reduced ? 0 : pStrength);
      gl.uniform4fv(u.u_ripples, rippleData);
      gl.uniform1f(u.u_intensity, intensity);
      gl.uniform1f(u.u_maxPoint, maxPoint);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    function frame(now, dt) {
      if (lost) return false;
      const p = getPointer();
      const target = p.active ? 1 : 0;
      if (target && pStrength < 0.02) {
        px = p.x; // re-entering: snap, don't fly the lens across the screen
        py = p.y;
      }
      const follow = 1 - Math.exp(-dt * 9);
      px += (p.x - px) * follow;
      py += (p.y - py) * follow;
      pStrength += (target - pStrength) * (1 - Math.exp(-dt * (target ? 5 : 2.2)));
      scroll += (window.scrollY * PARALLAX - scroll) * (1 - Math.exp(-dt * 12));

      for (let i = 0; i < RIPPLES; i++) {
        const start = rippleStart[i];
        const age = (now - start) / 1000;
        if (start < 0 || age > RIPPLE_LIFE) {
          rippleStart[i] = -1;
          rippleData[i * 4 + 3] = 0;
        } else {
          rippleData[i * 4 + 2] = Math.max(0, age);
        }
      }
      render(now);
      return true;
    }

    const loop = createLoop(frame, FPS);

    const resume = () => {
      if (active && !lost && !reduced) loop.start();
      else loop.stop();
    };

    try {
      if (!lost) setup();
    } catch (err) {
      console.warn(err);
      return undefined;
    }

    const relayout = () => {
      if (lost) return;
      layout();
      render(performance.now()); // resizing clears the canvas: repaint before the browser does
    };
    relayout();

    const ro = new ResizeObserver(relayout);
    ro.observe(canvas);
    window.addEventListener("resize", relayout); // catches DPR changes (zoom, monitor swap)

    const onLost = (e) => {
      e.preventDefault(); // tell the browser we want a restore
      lost = true;
      prog = null;
      loop.stop();
    };
    const onRestored = () => {
      lost = false;
      try {
        setup();
      } catch (err) {
        console.warn(err);
        return;
      }
      relayout();
      resume();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const unsubPointer = reduced
      ? null
      : subscribePointer({
          down: (pt) => {
            const i = rippleNext++ % RIPPLES;
            rippleStart[i] = performance.now();
            rippleData.set([pt.x, pt.y, 0, 1], i * 4);
          },
        });

    const unwatch = watchActivity(
      null,
      (a) => {
        active = a;
        resume();
      },
      { pauseInFullscreen: true },
    );

    return () => {
      loop.stop();
      unwatch();
      unsubPointer?.();
      ro.disconnect();
      window.removeEventListener("resize", relayout);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (!gl.isContextLost()) {
        if (buffer) gl.deleteBuffer(buffer);
        if (prog) gl.deleteProgram(prog.program);
      }
      releaseContextLater(canvas, gl);
    };
  }, [glSupport, pitch, intensity, reduced]);

  if (!glSupport) {
    return (
      <div
        aria-hidden="true"
        className={className}
        style={{
          ...BASE_STYLE,
          backgroundImage:
            "radial-gradient(circle, rgba(247,143,196,0.1) 0 1.2px, transparent 1.7px)",
          backgroundSize: `${pitch}px ${pitch}px`,
          backgroundPosition: "center top",
        }}
      />
    );
  }
  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={BASE_STYLE} />;
}
