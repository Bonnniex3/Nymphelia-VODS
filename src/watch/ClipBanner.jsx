import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Scissors } from "lucide-react";
import { Button } from "../ui/Button";
import { Led } from "../ui/Tag";
import Sparkle from "../ui/Sparkle";
import { clock, span } from "./time";
import { EASE } from "./tw";

// Shown above the player when the page was opened from a clip link (?s=&e=&n=).
export default function ClipBanner({ clip, slug }) {
  return (
    <motion.section
      aria-label="Shared clip"
      className="relative shrink-0 overflow-hidden rounded-2xl border border-sky/30 bg-panel/80 shadow-[0_0_40px_-18px_rgb(195_166_255/0.7)]"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.05 }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(100deg,rgb(195_166_255/0.2),rgb(143_122_230/0.1)_42%,transparent_75%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 dot-grid-fine opacity-60 [mask-image:linear-gradient(90deg,#000,transparent_60%)]"
      />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px holo-bg opacity-70" />

      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2.5 px-3 py-2.5 sm:px-4">
        <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-sky text-void shadow-[inset_0_-2px_0_rgb(103_14_249/0.45),0_8px_22px_-8px_rgb(195_166_255/0.9)]">
          <span aria-hidden="true" className="absolute inset-x-1.5 top-[3px] h-[42%] rounded-full bg-gradient-to-b from-white/60 to-white/0" />
          <Scissors className="relative size-[18px]" strokeWidth={2.4} />
        </span>

        <div className="min-w-0 flex-1 basis-40">
          <p className="flex items-center gap-1.5 font-dot text-[10.5px] uppercase tracking-[0.24em] text-sky">
            <Sparkle className="size-2.5" /> shared clip
          </p>
          <p className="truncate select-text font-display text-[15px] font-semibold tracking-tight text-cream" title={clip.name || undefined}>
            {clip.name || "untitled clip"}
          </p>
        </div>

        <div className="flex items-center gap-2" aria-label={`from ${clock(clip.start)} to ${clock(clip.end)}`}>
          <Led tone="sky">{clock(clip.start)}</Led>
          <span aria-hidden="true" className="font-dot text-xs text-sky/70">
            →
          </span>
          <Led tone="sky">{clock(clip.end)}</Led>
          <span className="font-dot text-[11px] text-mute">{span(clip.end - clip.start)}</span>
        </div>

        <Button as={Link} to={`/vod/${slug}`} variant="sky" size="sm" className="h-10 w-full sm:ml-auto sm:h-8 sm:w-auto">
          watch full VOD <ArrowRight className="size-3.5" strokeWidth={2.6} />
        </Button>
      </div>
    </motion.section>
  );
}
