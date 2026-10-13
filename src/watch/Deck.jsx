import { AnimatePresence } from "motion/react";
import { Check, Download, Flag, FlagTriangleRight, Link2, LoaderCircle, Pause, Play, Square, X } from "lucide-react";
import { Button, IconButton } from "../ui/Button";
import { cn } from "../lib/cn";
import ChapterArt from "./ChapterArt";
import ClipTool, { SwapLabel } from "./ClipTool";
import { clock } from "./time";

function StatusGlyph({ status }) {
  if (status === "playing") {
    return (
      <span className="meo-eq text-petal" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  const Icon = { paused: Pause, buffering: LoaderCircle, ended: Square, error: X }[status] || Play;
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-3.5 text-petal/80", status === "buffering" && "animate-spin text-sky")}
      strokeWidth={2.6}
      fill={status === "paused" || status === "ended" || status === "idle" ? "currentColor" : "none"}
    />
  );
}

// LCD-style timecode with faint "8"s behind the lit digits.
function Timecode({ time, duration, status }) {
  const now = clock(time);
  return (
    <div
      className="relative flex h-10 shrink-0 items-center gap-2.5 rounded-xl border border-white/[0.06] bg-void/90 pr-3 pl-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),inset_0_0_22px_rgb(247_143_196/0.07)]"
      role="timer"
      aria-label={`current time ${now}${duration ? ` of ${clock(duration)}` : ""}`}
    >
      <span className="grid w-4 place-items-center">
        <StatusGlyph status={status} />
      </span>
      <span className="relative font-dot text-[18px] leading-none tracking-[0.06em] tabular-nums" aria-hidden="true">
        <span className="absolute inset-0 text-petal/[0.09]">{now.replace(/\d/g, "8")}</span>
        <span className="relative text-petal text-glow">{now}</span>
      </span>
      {duration > 0 && (
        <span className="hidden font-dot text-[12px] leading-none text-dim tabular-nums min-[420px]:inline" aria-hidden="true">
          / {clock(duration)}
        </span>
      )}
    </div>
  );
}

function NowChapter({ chapter, index, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Now playing: ${chapter.name ?? "Chapter 1"}. Show chapter list`}
      className="group flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-line bg-panel-2/60 py-1 pr-3.5 pl-1 text-left transition-colors hover:border-lilac/50 hover:bg-panel-3/70"
    >
      <ChapterArt image={chapter.image} className="w-6 rounded-[5px]" />
      <span className="min-w-0">
        <span className="block font-dot text-[10px] leading-3 uppercase tracking-[0.2em] text-lilac">
          ch {index + 1}/{count}
        </span>
        <span className="block truncate text-[13px] leading-4 font-bold text-cream group-hover:text-blush">{chapter.name ?? "Chapter 1"}</span>
      </span>
    </button>
  );
}

const divider = <span aria-hidden="true" className="mx-0.5 hidden h-6 w-px bg-line-strong sm:block" />;

/**
 * Control deck under the video: timecode · current chapter · copy timestamp ·
 * clip marks · download. The clip tool unfolds as a second row once a start is set.
 */
export default function Deck({
  time,
  duration,
  status,
  chapter,
  chapterIndex,
  chapterCount,
  onChapterClick,
  copied,
  onCopyTimestamp,
  clipMode,
  mark,
  onMarkStart,
  onMarkEnd,
  clip,
  download,
}) {
  const tsCopied = copied === "timestamp";
  return (
    <div className="relative shrink-0 border-t border-line bg-ink/85">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Timecode time={time} duration={duration} status={status} />
          {chapter && <NowChapter chapter={chapter} index={chapterIndex} count={chapterCount} onClick={onChapterClick} />}
        </div>

        <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopyTimestamp}
            aria-label="copy link to the current time"
            className={cn("h-10 flex-1 px-3.5 sm:flex-none", tsCopied && "border-petal/70 text-petal")}
          >
            {tsCopied ? <Check className="size-3.5" strokeWidth={3} /> : <Link2 className="size-3.5" strokeWidth={2.4} />}
            <SwapLabel on={tsCopied} idle="copy timestamp" done="copied ♡" />
          </Button>

          {!clipMode && (
            <>
              {divider}
              <div role="group" aria-label="Clip marks" className="flex items-center gap-1.5">
                <span aria-hidden="true" className="hidden pr-0.5 pl-1 font-dot text-[11px] text-mute 2xl:inline">
                  clip
                </span>
                <IconButton label="mark clip start" active={mark.start != null} onClick={onMarkStart}>
                  <Flag className="size-[17px]" strokeWidth={2.2} />
                </IconButton>
                <IconButton
                  label={mark.start == null ? "mark clip start first" : "mark clip end"}
                  active={mark.end != null}
                  disabled={mark.start == null}
                  onClick={onMarkEnd}
                  tipAlign={download ? "center" : "end"}
                >
                  <FlagTriangleRight className="size-[17px]" strokeWidth={2.2} />
                </IconButton>
              </div>
            </>
          )}

          {download && (
            <>
              {divider}
              <IconButton as="a" href={download} target="_blank" rel="noopener noreferrer" label="download vod" tone="sky" tipAlign="end">
                <Download className="size-[17px]" strokeWidth={2.2} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>{!clipMode && mark.start != null && <ClipTool key="clip" mark={mark} {...clip} />}</AnimatePresence>

      <p className="sr-only" aria-live="polite">
        {copied === "timestamp" ? "Timestamp link copied" : copied === "clip" ? "Clip link copied" : ""}
      </p>
    </div>
  );
}
