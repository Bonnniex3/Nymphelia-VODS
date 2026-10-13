import { memo, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ChevronLeft, ChevronRight, Keyboard } from "lucide-react";
import { IconButton } from "../ui/Button";
import Window from "../ui/Window";
import { vodPath } from "./data";
import { EASE } from "./tw";

const KEYS = [
  [["space"], "play / pause"],
  [["←", "→"], "seek 5s"],
  [["↑", "↓"], "volume"],
  [["m"], "mute"],
  [["f"], "fullscreen"],
  [["0", "9"], "jump to 0–90%"],
];

function Kbd({ children }) {
  return (
    <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-md border border-line-strong bg-void px-1.5 font-dot text-[11px] leading-none text-petal shadow-[inset_0_-2px_0_rgb(251_207_232/0.08)]">
      {children}
    </kbd>
  );
}

function Hotkeys() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative hidden lg:block">
      <IconButton
        label="keyboard shortcuts"
        active={open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        tip={open ? "none" : "bottom"}
        tipAlign="end"
      >
        <Keyboard className="size-[18px]" strokeWidth={2} />
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Keyboard shortcuts"
            className="absolute top-full right-0 z-50 mt-2 w-72 origin-top-right"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <Window
              title="hotkeys.txt"
              icon={<Keyboard className="size-3.5" />}
              className="bg-panel/95 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.95),0_0_40px_-18px_rgb(247_143_196/0.5)] backdrop-blur-md"
            >
              <dl className="grid gap-2 p-4">
                {KEYS.map(([keys, action]) => (
                  <div key={action} className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1">
                      {keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && <span className="font-dot text-[11px] text-dim">{keys[0] === "0" ? "–" : "/"}</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="font-dot text-[12px] text-blush/80">{action}</dd>
                  </div>
                ))}
                <p className="mt-1 border-t border-dashed border-line pt-2.5 font-dot text-[11px] leading-relaxed text-mute">
                  click the video first ✦ double-click for fullscreen
                </p>
              </dl>
            </Window>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ to, label, tipAlign, className, children }) {
  if (!to) {
    return (
      <IconButton label={label} disabled tip="bottom" tipAlign={tipAlign} className={className}>
        {children}
      </IconButton>
    );
  }
  return (
    <IconButton as={Link} to={to} viewTransition label={label} tip="bottom" tipAlign={tipAlign} className={className}>
      {children}
    </IconButton>
  );
}

// Back button · breadcrumb (archive / title) · older / newer · hotkeys.
function WatchHeader({ vod, newer, older }) {
  return (
    <motion.div
      className="relative z-30 flex h-10 shrink-0 items-center gap-3"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <IconButton as={Link} to="/vods" viewTransition label="back to archive" tip="bottom">
        <ArrowLeft className="size-[18px]" strokeWidth={2.2} />
      </IconButton>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 font-dot text-[13px] leading-none">
          <li className="shrink-0">
            <Link
              to="/vods"
              viewTransition
              className="rounded-sm text-mute transition-colors hover:text-petal focus-visible:text-petal"
            >
              archive
            </Link>
          </li>
          <li aria-hidden="true" className="shrink-0 text-dim">
            /
          </li>
          <li aria-current="page" className="min-w-0 truncate text-blush/90" title={vod.title}>
            {vod.title}
          </li>
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <NavButton to={older && vodPath(older)} label={older ? "older vod" : "no older vod"}>
          <ChevronLeft className="size-[18px]" strokeWidth={2.2} />
        </NavButton>
        <NavButton to={newer && vodPath(newer)} label={newer ? "newer vod" : "no newer vod"}
          tipAlign="end"
          // Only the last control on narrow screens; re-centre once the hotkeys button follows it.
          className="lg:[&>[role=presentation]]:left-1/2 lg:[&>[role=presentation]]:right-auto lg:[&>[role=presentation]]:-translate-x-1/2"
        >
          <ChevronRight className="size-[18px]" strokeWidth={2.2} />
        </NavButton>
        <Hotkeys />
      </div>
    </motion.div>
  );
}

// Props only change per VOD, so skip the once-a-second clock re-renders.
export default memo(WatchHeader);
