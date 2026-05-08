import { useRef, useEffect, useState, useCallback } from "react";
import canAutoPlay from "can-autoplay";
import { Button, Box, Alert, Paper } from "@mui/material";
import VideoJS from "./VideoJS";
import "videojs-hotkeys";
import { toSeconds } from "../utils/helpers";

const CDN_BASE = "https://archive.org/download";

export default function Player(props) {
  const { playerRef, setCurrentTime, setPlaying, type, vod, timestamp, delay, setDelay, clipStart, clipEnd } = props;
  const timeUpdateRef = useRef(null);
  const [source, setSource] = useState(undefined);
  const [fileError, setFileError] = useState(undefined);
  const isClipMode = clipStart != null && clipEnd != null && clipStart < clipEnd;
  const clipModeRef = useRef(isClipMode);
  const clipStartRef = useRef(clipStart);
  const clipEndRef = useRef(clipEnd);
  useEffect(() => {
    clipModeRef.current = isClipMode;
    clipStartRef.current = clipStart;
    clipEndRef.current = clipEnd;
  }, [isClipMode, clipStart, clipEnd]);
  const videoJsOptions = {
    autoplay: true,
    controls: true,
    responsive: false,
    fluid: false,
    liveui: true,
    poster: vod.thumbnail_url,
  };

  // Save current position to localStorage
  const savePosition = useCallback(
    (player) => {
      if (!player) return;
      const currentTime = player.currentTime();
      localStorage.setItem(`video-position-${vod.id}`, currentTime);
    },
    [vod.id]
  );

  const clearPosition = () => {
    localStorage.removeItem(`video-position-${vod.id}`);
  };

  const onReady = (player) => {
    playerRef.current = player;

    player.hotkeys({
      alwaysCaptureHotkeys: true,
      volumeStep: 0.1,
      seekStep: 5,
      enableModifiersForNumbers: false,
      enableMute: true,
      enableFullscreen: true,
    });

    canAutoPlay.video().then(({ result }) => {
      if (!result) playerRef.current.muted(true);
    });

    // Restore last position after metadata is loaded
    player.on("loadedmetadata", function () {
      // Clip mode: always seek to clipStart and ignore saved position.
      if (clipModeRef.current) {
        player.currentTime(clipStartRef.current);
      } else if (timestamp) {
        // If a timestamp is provided, prefer it, else restore from localStorage
        player.currentTime(timestamp);
      } else {
        const savedPosition = localStorage.getItem(`video-position-${vod.id}`);
        if (savedPosition) {
          const position = parseFloat(savedPosition);
          if (!isNaN(position)) {
            player.currentTime(position);
          }
        }
      }
    });

    // Save position every 5 seconds without spamming storage
    let lastSavedTime = 0;
    player.on("timeupdate", () => {
      // Clip mode: enforce end boundary and skip saving progress.
      if (clipModeRef.current) {
        if (clipEndRef.current != null && player.currentTime() >= clipEndRef.current) {
          player.pause();
          player.currentTime(clipEndRef.current);
        }
        return;
      }
      const currentTime = Math.floor(player.currentTime());
      if (currentTime > 0 && currentTime % 5 === 0 && currentTime !== lastSavedTime) {
        lastSavedTime = currentTime;
        savePosition(player);
      }
    });

    player.on("play", () => {
      timeUpdate();
      loopTimeUpdate();
      setPlaying({ playing: true });
    });

    player.on("pause", () => {
      if (!clipModeRef.current) savePosition(player);
      clearTimeUpdate();
      setPlaying({ playing: false });
    });

    player.on("end", () => {
      clearPosition();
      clearTimeUpdate();
      setPlaying({ playing: false });
    });

    player.on("error", () => {
      const error = player.error();
      if (error && error.code === 4 && type === "cdn") {
        // Fallback or error handling for IA
        console.error("Video error:", error);
      }
    });

    if (type === "cdn") {
       if (vod.video_url) {
         setSource(vod.video_url);
       } else {
         // Fallback if we just have an ID, assuming a standard MP4 naming convention on IA
         setSource(`${CDN_BASE}/${vod.id}/${vod.id}.mp4`);
       }
    }
  };

  const timeUpdate = () => {
    if (!playerRef.current) return;
    if (playerRef.current.paused()) return;
    let currentTime = 0;
    currentTime += playerRef.current.currentTime();
    currentTime += delay;
    setCurrentTime(currentTime);
  };

  const loopTimeUpdate = () => {
    if (timeUpdateRef.current !== null) clearTimeout(timeUpdateRef.current);
    timeUpdateRef.current = setTimeout(() => {
      timeUpdate();
      loopTimeUpdate();
    }, 1000);
  };

  const clearTimeUpdate = () => {
    if (timeUpdateRef.current !== null) clearTimeout(timeUpdateRef.current);
  };

  const fileChange = (evt) => {
    setFileError(false);
    const file = evt.target.files[0];
    if (file.type.split("/")[0] !== "video") {
      return setFileError("It has to be a valid video file!");
    }

    setSource({ src: URL.createObjectURL(file), type: file.type });
  };

  useEffect(() => {
    if (!source || !playerRef.current) return;
    playerRef.current.src(source);

    // Delay/duration logic
    const set = async () => {
      let playerDuration = playerRef.current.duration();
      while (isNaN(playerDuration) || playerDuration === 0) {
        playerDuration = playerRef.current.duration();
        await sleep(100);
      }
      const vodDuration = toSeconds(vod.duration);
      const tmpDelay = vodDuration - playerDuration < 0 ? 0 : vodDuration - playerDuration;
      setDelay(tmpDelay);
    };
    set();
  }, [source, playerRef, vod, setDelay]);

  // On unmount, save position (skip in clip mode so a clip viewing doesn't
  // overwrite the user's main watch progress for this VOD).
  useEffect(() => {
    return () => {
      if (playerRef.current && !clipModeRef.current) {
        savePosition(playerRef.current);
      }
    };
  }, [vod.id, playerRef, savePosition]);

  return (
    <Box sx={{ height: "100%", width: "100%" }}>
      {type === "manual" && !source && (
        <Paper sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", flexDirection: "column" }}>
          {fileError && <Alert severity="error">{fileError}</Alert>}
          <Box sx={{ mt: 1 }}>
            <Button variant="contained" component="label">
              Select Video
              <input type="file" hidden onChange={fileChange} accept="video/*,.mkv" />
            </Button>
          </Box>
        </Paper>
      )}
      <Box style={{ visibility: !source ? "hidden" : "visible", height: "100%", width: "100%", outline: "none" }}>
        <VideoJS options={videoJsOptions} onReady={onReady} />
      </Box>
    </Box>
  );
}

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
