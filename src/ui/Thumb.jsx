import { useState } from "react";
import { cn } from "../lib/cn";
import FALLBACK from "../assets/default_thumbnail.jpg";

// VOD thumbnail that swaps to the branded fallback if the image is missing or fails.
export default function Thumb({ vod, className, alt = "", ...props }) {
  const [failed, setFailed] = useState(false);
  const src = !failed && vod?.thumbnail_url ? vod.thumbnail_url : FALLBACK;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("size-full object-cover", className)}
      {...props}
    />
  );
}
