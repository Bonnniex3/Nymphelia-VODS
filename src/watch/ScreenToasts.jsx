import { AnimatePresence, motion } from "motion/react";
import { History, VolumeX, X } from "lucide-react";
import { clock } from "./time";
import { EASE } from "./tw";

function Toast({ icon: Icon, children, action, onAction, onDismiss }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -10, scale: 0.96 }}
      transition={{ duration: 0.3, ease: EASE }}
      role="status"
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-line-strong bg-void/90 py-1 pr-1 pl-3 font-dot text-[12px] text-blush shadow-[0_10px_30px_-10px_rgb(0_0_0/0.9),0_0_20px_-8px_rgb(247_143_196/0.5)]"
    >
      <Icon className="size-3.5 shrink-0 text-petal" strokeWidth={2.4} />
      <span className="whitespace-nowrap">{children}</span>
      <button
        type="button"
        onClick={onAction}
        className="rounded-full bg-petal/15 px-2.5 py-1 text-petal transition-colors hover:bg-petal hover:text-void"
      >
        {action}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="dismiss"
        className="grid size-6 place-items-center rounded-full text-mute transition-colors hover:bg-panel-3 hover:text-cream"
      >
        <X className="size-3.5" strokeWidth={2.4} />
      </button>
    </motion.div>
  );
}

// Little notices pinned to the top-left of the screen ("resumed at…", "sound off").
export default function ScreenToasts({ resumeAt, muted, onStartOver, onUnmute, onDismiss }) {
  return (
    <div className="pointer-events-none absolute top-2.5 left-2.5 z-20 flex max-w-[calc(100%-1.25rem)] flex-col items-start gap-2 sm:top-3.5 sm:left-3.5">
      <AnimatePresence>
        {resumeAt != null && (
          <Toast key="resume" icon={History} action="start over" onAction={onStartOver} onDismiss={() => onDismiss("resume")}>
            resumed at <span className="text-petal">{clock(resumeAt)}</span>
          </Toast>
        )}
        {muted && (
          <Toast key="muted" icon={VolumeX} action="unmute" onAction={onUnmute} onDismiss={() => onDismiss("muted")}>
            sound off
          </Toast>
        )}
      </AnimatePresence>
    </div>
  );
}
