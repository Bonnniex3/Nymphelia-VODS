import { useId } from "react";
import { motion } from "motion/react";
import { Check, Link2, Scissors, X } from "lucide-react";
import { Button, IconButton } from "../ui/Button";
import { Led } from "../ui/Tag";
import { cn } from "../lib/cn";
import { CLIP_NAME_MAX } from "./data";
import { clock, span } from "./time";
import { EASE } from "./tw";

function LedButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="jump here"
      className="rounded-md transition-[filter,transform] duration-150 hover:brightness-125 active:scale-95"
    >
      <Led>{children}</Led>
    </button>
  );
}

// Swaps two labels in the same grid cell so the button never changes width.
export function SwapLabel({ on, idle, done }) {
  return (
    <span className="grid">
      <span className={cn("col-start-1 row-start-1", on && "invisible")}>{idle}</span>
      <span className={cn("col-start-1 row-start-1", !on && "invisible")}>{done}</span>
    </span>
  );
}

/**
 * Second row of the player deck while a clip is being made:
 * start → end (click either to jump there) · name ≤ 80 chars · copy link · clear.
 */
export default function ClipTool({ mark, title, onTitle, onCopy, copied, onClear, onSeek, hint }) {
  const inputId = useId();
  const ready = mark.end != null;

  return (
    <motion.div
      className="overflow-hidden"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <div
        role="group"
        aria-label="Clip tool"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-dashed border-petal/20 bg-[linear-gradient(90deg,rgb(247_143_196/0.09),transparent_70%)] px-3 py-2.5"
      >
        <span className="flex shrink-0 items-center gap-1.5 font-dot text-[12px] text-petal">
          <Scissors className="size-3.5" strokeWidth={2.4} /> clip.tool
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          <LedButton label={`jump to clip start, ${clock(mark.start)}`} onClick={() => onSeek(mark.start)}>
            {clock(mark.start)}
          </LedButton>
          <span aria-hidden="true" className="font-dot text-xs text-dim">
            →
          </span>
          {ready ? (
            <LedButton label={`jump to clip end, ${clock(mark.end)}`} onClick={() => onSeek(mark.end)}>
              {clock(mark.end)}
            </LedButton>
          ) : (
            <Led className="text-dim [text-shadow:none]">
              <span className="animate-blink">-:--:--</span>
            </Led>
          )}
          {ready && <span className="font-dot text-[11px] text-mute">{span(mark.end - mark.start)}</span>}
        </div>

        {ready ? (
          <div className="flex min-w-0 flex-1 basis-72 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <label htmlFor={inputId} className="sr-only">
                Clip name
              </label>
              <input
                id={inputId}
                type="text"
                value={title}
                maxLength={CLIP_NAME_MAX}
                onChange={(e) => onTitle(e.target.value.slice(0, CLIP_NAME_MAX))}
                placeholder="name your clip ♡"
                autoComplete="off"
                className="h-9 w-full rounded-full border border-line-strong bg-void/80 pr-14 pl-4 text-[13px] text-cream transition-[border-color,box-shadow] placeholder:text-dim focus:border-petal/70 focus:shadow-[0_0_0_3px_rgb(247_143_196/0.18)]"
              />
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-dot text-[10px] text-dim tabular-nums">
                {title.length}/{CLIP_NAME_MAX}
              </span>
            </div>
            <Button size="sm" onClick={onCopy} className="h-9" aria-label="copy clip link">
              {copied ? <Check className="size-3.5" strokeWidth={3} /> : <Link2 className="size-3.5" strokeWidth={2.6} />}
              <SwapLabel on={copied} idle="copy clip link" done="copied ♡" />
            </Button>
          </div>
        ) : (
          <p className="min-w-0 flex-1 basis-48 font-dot text-[12px] text-blush/70">
            {hint || (
              <>
                play to the end point, then hit <span className="text-petal">⚑ end</span>
              </>
            )}
          </p>
        )}
        {ready && hint && <p className="w-full font-dot text-[11px] text-neon">{hint}</p>}

        <IconButton size="sm" label="clear clip" onClick={onClear} tipAlign="end" className="ml-auto">
          <X className="size-4" strokeWidth={2.4} />
        </IconButton>
      </div>
    </motion.div>
  );
}
