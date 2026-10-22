import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, Flower2, LocateFixed } from "lucide-react";
import { useLiteFx } from "../../fx/perf";
import { cn } from "../../lib/cn";
import { Tag } from "../../ui/Tag";
import Window from "../../ui/Window";
import { clock, span } from "../time";
import { RISE } from "../tw";
import { activeTriggerIndex, seekTimeOf } from "./triggers";
import "./triggers.css";

const OPEN_KEY = "nym-triggers-open";
/** After the viewer scrolls the list, auto-follow waits this long before taking over again. */
const HOLD_MS = 4000;
/** Where the followed row sits in the list: a third of the way down, so a few past triggers stay visible. */
const FOLLOW_AT = 1 / 3;

// Every colour lives here, so a re-theme only touches this block.
const SKIN = {
  row: "border-transparent hover:border-line hover:bg-panel-2",
  rowPast: "text-blush/60 hover:text-cream",
  rowNext: "text-blush/90 hover:text-cream",
  rowActive:
    "border-petal/40 bg-[linear-gradient(90deg,rgb(247_143_196/0.17),rgb(143_122_230/0.06))] text-cream shadow-[0_0_24px_-12px_rgb(247_143_196/0.9)]",
  chip: "border-line-strong bg-ink/60 text-mute group-hover:border-petal/50 group-hover:text-petal",
  chipActive: "border-transparent bg-petal text-void shadow-[0_0_12px_rgb(247_143_196/0.55)]",
  bar: "holo-bg",
  barButton: "border-line-strong bg-ink/60 text-mute hover:border-petal/60 hover:text-petal",
  status: "border-line text-mute",
  nowButton: "text-petal hover:text-cream",
};

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};
const saveOpen = (on) => {
  try {
    localStorage.setItem(OPEN_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: the preference is a nicety */
  }
};

/**
 * Keeps the active row in view inside the list's own scroller (never the page: it sets
 * scrollTop on the list, no scrollIntoView). It yields while the pointer is over the list or
 * a row has keyboard focus, and for HOLD_MS after the viewer scrolls the list themselves.
 */
function useFollow(listRef, activeIndex, enabled, still) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const timer = useRef(0);
  const placed = useRef(false);
  const held = hover || focus || browsing;

  useEffect(() => () => clearTimeout(timer.current), []);

  const browse = useCallback(() => {
    setBrowsing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBrowsing(false), HOLD_MS);
  }, []);

  const resume = useCallback(() => {
    clearTimeout(timer.current);
    setBrowsing(false);
    setFocus(false);
    setHover(false);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) {
      placed.current = false;
      return;
    }
    if (held) return;
    const row = activeIndex >= 0 ? list.children[activeIndex] : null;
    const max = list.scrollHeight - list.clientHeight;
    const top = row ? Math.min(max, Math.max(0, Math.round(row.offsetTop - (list.clientHeight - row.offsetHeight) * FOLLOW_AT))) : 0;
    if (Math.abs(list.scrollTop - top) < 2) {
      placed.current = true;
      return;
    }
    // First placement (mount / reopen) jumps; later moves glide unless effects are stilled.
    list.scrollTo({ top, behavior: still || !placed.current ? "auto" : "smooth" });
    placed.current = true;
  }, [listRef, activeIndex, enabled, held, still]);

  const mouse = (e) => e.pointerType === "mouse" || e.pointerType === "pen";
  const listProps = {
    onPointerEnter: (e) => mouse(e) && setHover(true),
    onPointerLeave: (e) => mouse(e) && setHover(false),
    // Grabbing the scrollbar (the list itself, not a row) is a manual scroll.
    onPointerDown: (e) => e.target === e.currentTarget && browse(),
    onWheel: browse,
    onTouchMove: browse,
    onKeyDown: browse,
    onFocus: (e) => {
      let keyboard = false;
      try {
        keyboard = e.target.matches(":focus-visible");
      } catch {
        /* old engine: treat as a click */
      }
      if (keyboard) setFocus(true);
    },
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false);
    },
  };

  return { held, resume, listProps };
}

const Row = memo(function Row({ trigger, active, past, onSeek }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSeek(seekTimeOf(trigger))}
        aria-current={active ? "true" : undefined}
        className={cn(
          "trigger-row group relative flex w-full items-start gap-2.5 overflow-hidden rounded-xl border py-2 pr-2.5 pl-3 text-left transition-colors duration-200 focus-visible:outline-offset-[-2px]",
          SKIN.row,
          active ? SKIN.rowActive : past ? SKIN.rowPast : SKIN.rowNext,
          active && "trigger-on"
        )}
      >
        {active && <span aria-hidden="true" className={cn("trigger-bar absolute inset-y-2 left-0 w-[3px] rounded-r-full", SKIN.bar)} />}
        <span
          className={cn(
            "mt-px flex h-5 shrink-0 items-center rounded-md border px-1.5 font-dot text-[10.5px] leading-none tabular-nums transition-colors",
            active ? SKIN.chipActive : SKIN.chip
          )}
        >
          {clock(trigger.at)}
        </span>
        <span className="sr-only">: </span>
        <span title={trigger.name} className={cn("line-clamp-2 min-w-0 flex-1 text-[13.5px] leading-snug [overflow-wrap:anywhere]", active ? "font-bold" : "font-semibold")}>
          {trigger.name}
          {trigger.who && <span className="font-medium text-mute"> · @{trigger.who}</span>}
        </span>
      </button>
    </li>
  );
});

/**
 * triggers.lst: every ASMR trigger the stream bot announced, as jump-to points.
 *   triggers: [{ id, at, name, who }] from useTriggers(chat), in play order
 *   time:     current player time in seconds
 *   onSeek:   (seconds) => void
 * Renders nothing when there are no triggers. Names are untrusted chat text: plain text only.
 */
export default function TriggerPanel({ triggers, time, onSeek, className }) {
  const [open, setOpen] = useState(readOpen);
  const still = useLiteFx();
  const listRef = useRef(null);
  const bodyId = useId();
  const activeIndex = activeTriggerIndex(triggers, time);
  const { held, resume, listProps } = useFollow(listRef, activeIndex, open && triggers.length > 0, still);

  if (triggers.length === 0) return null;

  const toggle = () => {
    setOpen((v) => {
      saveOpen(!v);
      return !v;
    });
  };
  const count = triggers.length;
  const next = triggers[activeIndex + 1];

  return (
    <Window
      as={motion.section}
      variants={RISE}
      tone="petal"
      title="triggers.lst"
      icon={<Flower2 className="size-3.5" strokeWidth={2.4} />}
      aria-label="ASMR triggers"
      actions={
        <>
          <Tag className="h-5 px-1.5 text-[11px] tabular-nums">
            {String(count).padStart(2, "0")}
            <span className="sr-only"> triggers</span>
          </Tag>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            className={cn("flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 font-dot text-[11px] transition-colors", SKIN.barButton)}
          >
            <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} strokeWidth={2.6} />
            {open ? "hide" : "show"}
          </button>
        </>
      }
      className={className}
      bodyClassName={cn("flex min-h-0 flex-col", !open && "hidden")}
    >
      <div id={bodyId} className="min-h-0">
        {open && (
          <ol
            ref={listRef}
            aria-label="Trigger timestamps"
            className="relative flex max-h-[clamp(12rem,40dvh,22rem)] flex-col gap-0.5 overflow-y-auto overscroll-contain p-1.5"
            {...listProps}
          >
            {triggers.map((t, i) => (
              <Row key={t.id ?? `${t.at}-${i}`} trigger={t} active={i === activeIndex} past={i < activeIndex} onSeek={onSeek} />
            ))}
          </ol>
        )}
      </div>
      {open && (
        <div className={cn("flex shrink-0 items-center gap-3 border-t px-3 py-1.5 font-dot text-[11px]", SKIN.status)}>
          <span className="tabular-nums">
            {activeIndex + 1}/{count}
            <span className="sr-only"> triggers played</span>
          </span>
          {next && Number.isFinite(time) && <span className="tabular-nums">next in {span(next.at - time)}</span>}
          {!next && <span>last one ♡</span>}
          {held && activeIndex >= 0 && (
            <button type="button" onClick={resume} className={cn("ml-auto flex items-center gap-1 rounded px-1 uppercase transition-colors", SKIN.nowButton)}>
              <LocateFixed className="size-3" strokeWidth={2.4} />
              now
              <span className="sr-only">: show the current trigger</span>
            </button>
          )}
        </div>
      )}
    </Window>
  );
}
