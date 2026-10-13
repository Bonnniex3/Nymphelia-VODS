import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Clapperboard, Play } from "lucide-react";
import Window from "../ui/Window";
import Thumb from "../ui/Thumb";
import { Button } from "../ui/Button";
import { ALL_VODS, categoryOf, durationSeconds, neighbours } from "../lib/vods";
import { cn } from "../lib/cn";
import { readPosition, vodPath } from "./data";
import { shortDate } from "./time";
import { RISE } from "./tw";

const MORE = 8;

function VodRow({ vod, label, labelTone = "sky", progress = 0 }) {
  return (
    <li>
      <Link
        to={vodPath(vod)}
        viewTransition
        className="group flex items-start gap-3 rounded-xl p-2 transition-colors duration-200 hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-offset-[-2px]"
      >
        <span className="relative block aspect-video w-[118px] shrink-0 overflow-hidden rounded-lg border border-line bg-panel-3 transition-[border-color,box-shadow] duration-300 group-hover:border-petal/50 group-hover:shadow-[0_0_22px_-6px_rgb(247_143_196/0.7)]">
          <Thumb vod={vod} className="transition-transform duration-500 ease-snap group-hover:scale-[1.06]" />
          <span aria-hidden="true" className="absolute inset-0 scanlines opacity-40" />
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-void/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <span className="grid size-8 place-items-center rounded-full bg-petal text-void shadow-[0_0_18px_rgb(247_143_196/0.9)]">
              <Play className="size-3.5 translate-x-[1px]" fill="currentColor" />
            </span>
          </span>
          {vod.duration && (
            <span className="absolute right-1 bottom-1 rounded-[5px] bg-void/85 px-1.5 py-px font-dot text-[10px] leading-4 text-blush tabular-nums">
              {vod.duration}
            </span>
          )}
          {progress > 0.01 && (
            <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
              <span className="block h-full bg-gradient-to-r from-petal to-sky" style={{ width: `${Math.min(1, progress) * 100}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          {label && (
            <span className={cn("mb-1 block font-dot text-[10px] uppercase tracking-[0.2em]", labelTone === "sky" ? "text-sky" : "text-petal")}>
              {label}
            </span>
          )}
          <span className="line-clamp-2 text-[13px] leading-snug font-bold text-blush/90 transition-colors group-hover:text-cream">{vod.title}</span>
          <span className="mt-1 block font-dot text-[11px] text-mute">
            {shortDate(vod.createdAt)} · {categoryOf(vod)}
          </span>
        </span>
      </Link>
    </li>
  );
}

// Sidebar "up_next.lst": the neighbouring streams, then the most recent others.
function MoreVods({ vod, wide = false, className }) {
  const { newer, older } = neighbours(vod);
  const taken = new Set([vod.id, newer?.id, older?.id]);
  const recent = ALL_VODS.filter((v) => !taken.has(v.id)).slice(0, MORE);
  const all = [newer, older, ...recent].filter(Boolean);

  // Resume progress per VOD, read once when the list mounts.
  const [progress] = useState(() => {
    const map = {};
    for (const v of all) {
      const total = durationSeconds(v);
      const saved = readPosition(v.id);
      map[v.id] = total > 0 && saved > 0 ? saved / total : 0;
    }
    return map;
  });

  if (!all.length) return null;

  return (
    <Window
      as={motion.section}
      variants={RISE}
      tone="sky"
      title="up_next.lst"
      icon={<Clapperboard className="size-3.5" strokeWidth={2.4} />}
      aria-label="More VODs"
      className={className}
    >
      <ul className={cn("flex flex-col gap-0.5 p-2", wide && "md:grid md:grid-cols-2 lg:flex")}>
        {newer && <VodRow vod={newer} label="next stream ▸" labelTone="petal" progress={progress[newer.id]} />}
        {older && <VodRow vod={older} label="◂ previous stream" progress={progress[older.id]} />}
      </ul>

      {recent.length > 0 && (
        <>
          <p className="flex items-center gap-2 px-4 pt-1 pb-1 font-dot text-[10.5px] uppercase tracking-[0.22em] text-mute">
            <span>more from the archive</span>
            <span aria-hidden="true" className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-line-strong)_0_4px,transparent_4px_8px)]" />
          </p>
          <ul className={cn("flex flex-col gap-0.5 p-2 pt-1", wide && "md:grid md:grid-cols-2 lg:flex")}>
            {recent.map((v) => (
              <VodRow key={v.id} vod={v} progress={progress[v.id]} />
            ))}
          </ul>
        </>
      )}

      <div className="p-3 pt-1">
        <Button as={Link} to="/vods" viewTransition variant="ghost" size="sm" className="w-full">
          browse all {ALL_VODS.length} vods <ArrowRight className="size-3.5" strokeWidth={2.6} />
        </Button>
      </div>
    </Window>
  );
}

// Props only change per VOD, so skip the once-a-second clock re-renders.
export default memo(MoreVods);
