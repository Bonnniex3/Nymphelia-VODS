import { useState } from "react";
import { Gamepad2 } from "lucide-react";
import { cn } from "../lib/cn";
import { chapterArt } from "./data";

// Twitch box art for a chapter (3:4), with an on-theme tile when it's missing.
export default function ChapterArt({ image, className }) {
  const [failed, setFailed] = useState(false);
  const src = chapterArt(image);
  return (
    <span className={cn("relative block aspect-[3/4] shrink-0 overflow-hidden rounded-md border border-line bg-panel-3", className)}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center bg-[linear-gradient(160deg,rgb(143_122_230/0.28),rgb(247_143_196/0.12))]">
          <span aria-hidden="true" className="absolute inset-0 dot-grid-fine opacity-70" />
          <Gamepad2 className="relative size-[45%] text-blush/70" strokeWidth={1.8} />
        </span>
      )}
    </span>
  );
}
