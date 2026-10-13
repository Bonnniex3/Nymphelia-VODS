/**
 * Tiny requestAnimationFrame loop with an fps cap.
 *
 *   const loop = createLoop((now, dt) => { ...draw...; return keepGoing; }, 40);
 *   loop.start(); loop.stop();
 *
 * `onFrame(now, dt)` gets the rAF timestamp (ms) and the seconds since the previous rendered frame
 * (clamped to 0.1s so a resumed tab doesn't teleport physics). Returning `false` stops the loop.
 * Imperative on purpose: effects own a loop and stop it in cleanup, which keeps StrictMode's
 * double-mount trivially safe.
 */
export function createLoop(onFrame, fps = 60) {
  let raf = 0;
  let last = 0;
  let interval = 1000 / fps;

  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!last) last = now - interval;
    const elapsed = now - last;
    // 2ms slack absorbs vsync jitter so a 60fps cap doesn't drop frames on a 60Hz display.
    if (elapsed < interval - 2) return;
    last = elapsed >= interval && elapsed < interval * 3 ? now - (elapsed % interval) : now;
    if (onFrame(now, Math.min(elapsed, 100) / 1000) === false) stop();
  };

  function start() {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    start,
    stop,
    setFps(n) {
      interval = 1000 / n;
    },
    get running() {
      return raf !== 0;
    },
  };
}
