import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "../lib/hooks";

const W = 48;
const H = 27;

/**
 * "Ambient mode": samples the playing video a few times a second into a tiny
 * buffer (blended over the previous frame so colour drifts smoothly) and copies
 * it to every canvas registered with the returned ref callback. Blown up and
 * blurred with CSS, the stream's light spills onto the bezel and the page.
 * Shows the poster until playback starts. Cross-origin video only taints the
 * canvases (we never read pixels back), so it works for archive.org files too.
 *
 *   const glow = useAmbient(player, posterUrl);
 *   <canvas ref={glow} className="blur-3xl …" />
 */
export default function useAmbient(player, poster) {
  const reduced = useReducedMotion();
  const targets = useRef(new Set());
  const buffer = useRef(null);

  const getBuffer = () => {
    if (!buffer.current) {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      buffer.current = c.getContext("2d");
    }
    return buffer.current;
  };

  const flush = useCallback(() => {
    const src = buffer.current?.canvas;
    if (!src) return;
    for (const canvas of targets.current) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(src, 0, 0);
    }
  }, []);

  const register = useCallback(
    (canvas) => {
      if (!canvas) return;
      canvas.width = W;
      canvas.height = H;
      targets.current.add(canvas);
      flush();
      return () => targets.current.delete(canvas);
    },
    [flush]
  );

  useEffect(() => {
    const ctx = getBuffer();
    let cancelled = false;

    if (poster) {
      const img = new Image();
      img.onload = () => {
        if (cancelled || player?.hasStarted?.()) return;
        ctx.drawImage(img, 0, 0, W, H);
        flush();
      };
      img.src = poster;
    }

    if (!player || player.isDisposed()) {
      return () => {
        cancelled = true;
      };
    }

    const video = player.el().querySelector("video");
    const draw = (alpha) => {
      if (!video || video.readyState < 2 || !player.hasStarted()) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(video, 0, 0, W, H);
      ctx.globalAlpha = 1;
      flush();
    };
    const snap = () => draw(1);
    const tick = () => {
      if (player.paused() || player.isFullscreen() || document.hidden) return;
      draw(0.3);
    };

    const id = reduced ? 0 : setInterval(tick, 180);
    const events = ["seeked", "pause", "playing"];
    player.on(events, snap);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (!player.isDisposed()) player.off(events, snap);
    };
  }, [player, poster, reduced, flush]);

  return register;
}
