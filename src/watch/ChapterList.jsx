import { motion } from "motion/react";
import { ListVideo, Play } from "lucide-react";
import Window from "../ui/Window";
import { Tag } from "../ui/Tag";
import { cn } from "../lib/cn";
import ChapterArt from "./ChapterArt";
import { clock, span } from "./time";
import { RISE } from "./tw";

const TINTS = [
  "bg-petal shadow-[0_0_12px_rgb(247_143_196/0.8)]",
  "bg-sky shadow-[0_0_12px_rgb(195_166_255/0.8)]",
  "bg-lilac shadow-[0_0_12px_rgb(143_122_230/0.8)]",
  "bg-neon shadow-[0_0_12px_rgb(255_111_181/0.8)]",
];

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Proportional strip of every chapter with a playhead (mouse shortcut; the list is the accessible control).
function Timeline({ chapters, activeIndex, total, vodTime, onSeek }) {
  return (
    <div aria-hidden="true">
      <div className="relative flex h-2.5 gap-[3px]">
        {chapters.map((ch, i) => (
          <button
            key={`${ch.gameId}-${ch.start}`}
            type="button"
            tabIndex={-1}
            title={ch.name ?? "Chapter 1"}
            onClick={() => onSeek(ch.start)}
            style={{ flexGrow: Math.max(ch.end, total * 0.012) }}
            className={cn(
              "h-full min-w-1 basis-0 rounded-full transition-[opacity,transform] duration-300 hover:opacity-100 hover:scale-y-[1.35]",
              TINTS[i % TINTS.length],
              i === activeIndex ? "opacity-100" : "opacity-30 shadow-none"
            )}
          />
        ))}
        <span
          className="pointer-events-none absolute -top-1 -bottom-1 w-[3px] -translate-x-1/2 rounded-full bg-cream shadow-[0_0_10px_rgb(255_247_250/0.9)] transition-[left] duration-700 ease-linear"
          style={{ left: `${clamp01(vodTime / total) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between font-dot text-[10px] text-dim tabular-nums">
        <span>{clock(0)}</span>
        <span>{clock(total)}</span>
      </div>
    </div>
  );
}

// Sidebar "chapters.lst": game chapters, highlighting the one playing; click to seek.
export default function ChapterList({ id, chapters, activeIndex, total, vodTime, playing, onSeek }) {
  return (
    <Window
      as={motion.section}
      variants={RISE}
      id={id}
      tone="lilac"
      title="chapters.lst"
      foldable
      icon={<ListVideo className="size-3.5" strokeWidth={2.4} />}
      actions={
        <Tag tone="lilac" className="h-5 px-1.5 text-[11px]">
          {String(chapters.length).padStart(2, "0")}
        </Tag>
      }
      aria-label="Chapters"
      className="scroll-mt-[calc(var(--topbar-h)+1rem)] md:sticky md:top-[calc(var(--topbar-h)+1rem)] lg:static lg:scroll-mt-0"
    >
      <div className="px-4 pt-4 pb-2">
        <Timeline chapters={chapters} activeIndex={activeIndex} total={total} vodTime={vodTime} onSeek={onSeek} />
      </div>

      <ol className="flex flex-col gap-1 p-2">
        {chapters.map((ch, i) => {
          const active = i === activeIndex;
          const within = active ? clamp01((vodTime - ch.start) / (ch.end || 1)) : 0;
          return (
            <li key={`${ch.gameId}-${ch.start}`}>
              <button
                type="button"
                onClick={() => onSeek(ch.start)}
                aria-current={active ? "true" : undefined}
                aria-label={`${ch.name ?? "Chapter 1"}, starts at ${clock(ch.start)}, ${span(ch.end)} long`}
                className={cn(
                  "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border p-2 pr-3 text-left transition-colors duration-200 focus-visible:outline-offset-[-2px]",
                  active
                    ? "border-lilac/45 bg-[linear-gradient(90deg,rgb(143_122_230/0.18),rgb(247_143_196/0.06))] shadow-[0_0_24px_-12px_rgb(143_122_230/0.9)]"
                    : "border-transparent hover:border-line hover:bg-panel-2"
                )}
              >
                {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full holo-bg" />}
                <ChapterArt image={ch.image} className="w-9" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[14px] font-bold", active ? "text-cream" : "text-blush/85 group-hover:text-cream")}>
                    {ch.name ?? "Chapter 1"}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 font-dot text-[11px] text-mute tabular-nums">
                    <span className={active ? "text-petal" : "text-blush/70"}>{clock(ch.start)}</span>
                    <span className="text-dim">·</span>
                    {span(ch.end)}
                  </span>
                  {active && (
                    <span aria-hidden="true" className="mt-2 block h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
                      <span className="block h-full rounded-full bg-gradient-to-r from-lilac to-petal transition-[width] duration-700" style={{ width: `${within * 100}%` }} />
                    </span>
                  )}
                </span>
                {active ? (
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Tag tone="lilac" className="h-5 px-1.5 text-[10px]">
                      now
                    </Tag>
                    {playing && (
                      <span className="meo-eq text-lilac" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-blush/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Play className="size-3 translate-x-[1px]" fill="currentColor" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </Window>
  );
}
