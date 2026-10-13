import { useSyncExternalStore } from "react";
import { usePrefersReducedMotion } from "./media.js";

/*
 * Effects mode: "full" or "lite".
 *
 * Lite keeps the look but freezes the costly effects on a still frame (the same paths the
 * effects use for prefers-reduced-motion) and drops blur, sparkles and looping decoration.
 * It is picked automatically when the browser has no hardware acceleration, or when the page
 * keeps running under ~30 fps; the visitor's own choice (the "fx" toggle) always wins.
 * `<html data-fx="full|lite">` mirrors the mode for the CSS side.
 */

const MODE_KEY = "fx-mode"; // the visitor's choice: "full" | "lite"
const AUTO_KEY = "fx-auto"; // this session's frame-rate verdict: "lite"

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

/** True for renderer names of CPU-only WebGL implementations. */
export const isSoftwareRenderer = (name) => SOFTWARE.test(String(name || ""));

/** Median frame interval over the limit (ms) = the page is struggling. Needs enough samples. */
export function isSlow(frameTimes, limit = 34) {
  if (frameTimes.length < 60) return false;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] > limit;
}

/** The visitor's choice beats anything automatic. */
export function resolveFx({ user, software, slow }) {
  if (user === "full" || user === "lite") return { lite: user === "lite", source: "user", reason: null };
  if (software) return { lite: true, source: "auto", reason: "no graphics acceleration" };
  if (slow) return { lite: true, source: "auto", reason: "running slowly" };
  return { lite: false, source: "auto", reason: null };
}

/**
 * No hardware acceleration? A context with failIfMajorPerformanceCaveat is refused when the
 * only WebGL on offer is a software one; no WebGL at all counts too.
 */
export function detectSoftwareRendering() {
  try {
    const gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = `${gl.getParameter(gl.RENDERER)} ${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ""}`;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return isSoftwareRenderer(name);
  } catch {
    return true;
  }
}

function read(area, key) {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

function write(area, key, value) {
  try {
    window[area].setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
}

let software = false;
let state = resolveFx({ user: null, software: false, slow: false });
const listeners = new Set();

function update() {
  state = resolveFx({ user: read("localStorage", MODE_KEY), software, slow: read("sessionStorage", AUTO_KEY) === "lite" });
  document.documentElement.dataset.fx = state.lite ? "lite" : "full";
  for (const listener of listeners) listener();
}

/**
 * Watch the frame rate once per session, after the page has settled. Two slow windows in a
 * row switch to lite (unless the visitor picked a mode themselves).
 */
function startFrameWatchdog() {
  if (state.source === "user" || state.lite) return;
  let strikes = 0;

  const sample = () => {
    const frames = [];
    let last = 0;
    const step = (now) => {
      const dt = now - last;
      // Skip the gap after a hidden tab comes back; rAF doesn't run while it's hidden.
      if (last && dt < 1000) frames.push(dt);
      last = now;
      if (frames.length < 90) requestAnimationFrame(step);
      else judge(frames);
    };
    requestAnimationFrame(step);
  };

  const judge = (frames) => {
    if (state.source === "user" || state.lite || !isSlow(frames)) return;
    strikes += 1;
    if (strikes < 2) return sample();
    write("sessionStorage", AUTO_KEY, "lite");
    update();
  };

  const begin = () => setTimeout(sample, 4000);
  if (document.readyState === "complete") begin();
  else window.addEventListener("load", begin, { once: true });
}

/** Call once before the first render, so the page never flashes the wrong mode. */
export function initFx() {
  if (typeof window === "undefined") return;
  software = detectSoftwareRendering();
  update();
  startFrameWatchdog();
}

/** The visitor's choice; remembered across visits. */
export function setFxMode(mode) {
  write("localStorage", MODE_KEY, mode);
  update();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => state;

/** `{ lite, source: "user" | "auto", reason, toggle }` */
export function useFx() {
  const fx = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...fx, toggle: () => setFxMode(fx.lite ? "full" : "lite") };
}

/** Effects show their still frame when lite is on or the OS asks for reduced motion. */
export function useLiteFx() {
  const { lite } = useFx();
  const reduced = usePrefersReducedMotion();
  return lite || reduced;
}
