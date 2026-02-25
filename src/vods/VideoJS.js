import React, { useEffect } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import "@videojs/themes/dist/city/index.css";

export const VideoJS = (props) => {
  const videoRef = React.useRef(null);
  const playerRef = React.useRef(null);
  const { options, onReady } = props;

  useEffect(() => {
    if (!playerRef.current) {
      if (!videoRef.current) return;

      const player = (playerRef.current = videojs(videoRef.current, options, () => {
        // Explicitly add the theme class to the player instance wrapper
        player.addClass("vjs-theme-city");
        onReady && onReady(player);
      }));
    }
  }, [options, videoRef, onReady]);

  return (
    <div data-vjs-player>
      <video ref={videoRef} autoPlay playsInline className="video-js vjs-theme-city" style={{ height: "100%", width: "100%" }} />
    </div>
  );
};

export default VideoJS;
