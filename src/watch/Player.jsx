import { useCallback, useEffect, useMemo, useRef } from "react";
import canAutoPlay from "can-autoplay";
import "videojs-hotkeys";
import VideoJS from "./VideoJS";
import { toSeconds } from "../lib/helpers";
import { clearPosition, readPosition, savePosition, sourceOf } from "./data";
import FALLBACK_POSTER from "../assets/default_thumbnail.jpg";

const HOTKEYS = {
  alwaysCaptureHotkeys: true,
  volumeStep: 0.1,
  seekStep: 5,
  enableModifiersForNumbers: false,
  enableMute: true,
  enableFullscreen: true,
};

const swallow = (maybePromise) => {
  if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
};

/**
 * Video.js player for one VOD. All playback rules live here:
 *  - start at the clip start (clip mode) → `?t=` timestamp → saved position
 *  - save the position every 5s / on pause / on unmount / on page hide
 *    (never in clip mode, so watching a clip doesn't clobber real progress)
 *  - clip mode stops at the clip end; pressing play there replays the clip
 *  - muted fallback when the browser blocks autoplay with sound
 *  - "delay" = manifest duration − file duration (VOD-timeline offset)
 *
 * Mount with `key={vod.id}`; everything is wired once when the player is ready.
 * Callbacks are read through a ref, so they can change freely between renders.
 */
export default function Player({ vod, startAt = 0, clip = null, className, ...callbacks }) {
  const cb = useRef(callbacks);
  useEffect(() => {
    cb.current = callbacks;
  });

  const clipRef = useRef(clip);
  useEffect(() => {
    clipRef.current = clip;
  }, [clip]);

  const options = useMemo(
    () => ({
      autoplay: true,
      controls: true,
      responsive: false,
      fluid: false,
      fill: true,
      liveui: true,
      playsinline: true,
      poster: vod.thumbnail_url || FALLBACK_POSTER,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      controlBar: {
        skipButtons: { backward: 10, forward: 10 },
        remainingTimeDisplay: false,
      },
    }),
    [vod.thumbnail_url]
  );

  const handleReady = useCallback(
    (player) => {
      const emit = (name, ...args) => cb.current[name]?.(...args);
      const persist = () => {
        if (clipRef.current || player.readyState() < 1) return;
        savePosition(vod.id, player.currentTime());
      };

      emit("onReady", player);
      player.hotkeys(HOTKEYS);

      canAutoPlay.video().then(({ result }) => {
        if (result || player.isDisposed()) return;
        player.muted(true);
        emit("onAutoMuted");
        if (!player.hasStarted()) swallow(player.play());
      });

      const reportDuration = () => {
        const duration = player.duration();
        if (!Number.isFinite(duration) || duration <= 0) return;
        emit("onDuration", duration);
        const listed = toSeconds(String(vod.duration || "0"));
        const delay = Number.isFinite(listed) ? Math.max(0, listed - duration) : 0;
        emit("onDelay", delay);
      };

      player.on("loadedmetadata", () => {
        const clipNow = clipRef.current;
        if (clipNow) {
          player.currentTime(clipNow.start);
        } else if (startAt) {
          player.currentTime(startAt);
        } else {
          const saved = readPosition(vod.id);
          const duration = player.duration();
          if (saved > 0 && !(duration > 0 && saved >= duration - 3)) {
            player.currentTime(saved);
            emit("onResume", saved);
          }
        }
        reportDuration();
      });
      player.on("durationchange", reportDuration);

      let lastSaved = 0;
      player.on("timeupdate", () => {
        const t = player.currentTime();
        const clipNow = clipRef.current;
        if (clipNow) {
          // Enforce the clip end. Only act while playing so the corrective seek
          // can't retrigger itself through the next timeupdate.
          if (t >= clipNow.end && !player.paused()) {
            player.pause();
            if (t > clipNow.end + 0.1) player.currentTime(clipNow.end);
          }
        } else {
          const whole = Math.floor(t);
          if (whole > 0 && whole % 5 === 0 && whole !== lastSaved) {
            lastSaved = whole;
            savePosition(vod.id, t);
          }
        }
        emit("onTime", t);
      });

      player.on("play", () => {
        const clipNow = clipRef.current;
        if (clipNow && player.currentTime() >= clipNow.end - 0.25) player.currentTime(clipNow.start);
        emit("onStatus", "playing");
      });
      player.on("playing", () => emit("onStatus", "playing"));
      player.on("waiting", () => emit("onStatus", "buffering"));
      player.on("pause", () => {
        persist();
        emit("onStatus", player.error() ? "error" : player.ended() ? "ended" : "paused");
      });
      player.on("ended", () => {
        if (!clipRef.current) clearPosition(vod.id);
        emit("onStatus", "ended");
      });
      player.on("error", () => {
        const error = player.error();
        if (error && error.code === 4) console.error("Video error:", error);
        emit("onStatus", "error");
      });

      window.addEventListener("pagehide", persist);
      player.on("dispose", () => window.removeEventListener("pagehide", persist));

      player.src(sourceOf(vod));
    },
    [vod, startAt]
  );

  // Last save before the player is torn down (navigating away / to another VOD).
  const handleBeforeDispose = useCallback(
    (player) => {
      if (clipRef.current || player.readyState() < 1) return;
      savePosition(vod.id, player.currentTime());
    },
    [vod.id]
  );

  return <VideoJS options={options} onReady={handleReady} onBeforeDispose={handleBeforeDispose} className={className} />;
}
