import { useEffect, useRef } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import "../styles/player.css";

/**
 * Thin Video.js mount, following the official React pattern: the player owns a
 * <video-js> element it creates inside our host div (so React never diffs
 * Video.js' DOM), and is disposed when this component unmounts. StrictMode's
 * mount → unmount → mount simply disposes the first player and builds a new one.
 *
 * Options are read once at mount; give the component a `key` (e.g. the VOD id)
 * to rebuild the player for a different source.
 */
export default function VideoJS({ options, onReady, onBeforeDispose, className }) {
  const hostRef = useRef(null);
  const latest = useRef({ options, onReady, onBeforeDispose });

  useEffect(() => {
    latest.current = { options, onReady, onBeforeDispose };
  });

  useEffect(() => {
    const host = hostRef.current;
    const el = document.createElement("video-js");
    el.classList.add("vjs-meo");
    host.appendChild(el);

    const player = videojs(el, latest.current.options, function handleReady() {
      latest.current.onReady?.(this);
    });

    return () => {
      if (player.isDisposed()) return;
      latest.current.onBeforeDispose?.(player);
      player.dispose();
    };
  }, []);

  return <div data-vjs-player ref={hostRef} className={className} />;
}
