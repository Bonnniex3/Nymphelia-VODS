import { useId, useState } from "react";
import { cn } from "../lib/cn";
import Sparkle from "./Sparkle";

const TONES = {
  petal: { icon: "text-petal", bar: "from-petal/[0.09]" },
  sky: { icon: "text-sky", bar: "from-sky/[0.09]" },
  lilac: { icon: "text-lilac", bar: "from-lilac/[0.1]" },
};

// Title-bar button. Small like the rest of the chrome, with a wider invisible hit area.
const CONTROL =
  "relative grid size-5 place-items-center rounded-[5px] border font-dot text-[12px] leading-none transition-colors duration-150 after:absolute after:-inset-1.5 after:content-['']";

const foldKey = (title) => `window-folded:${title}`;

function readFolded(title) {
  try {
    return localStorage.getItem(foldKey(title)) === "1";
  } catch {
    return false;
  }
}

function saveFolded(title, folded) {
  try {
    if (folded) localStorage.setItem(foldKey(title), "1");
    else localStorage.removeItem(foldKey(title));
  } catch {
    /* storage unavailable: the window just won't remember */
  }
}

// Windows without a real action get this instead of buttons: a quiet flourish, not a control.
function TitleDots() {
  return (
    <span className="flex items-center gap-1 px-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-[5px] rounded-full bg-mute/30" />
      ))}
    </span>
  );
}

/**
 * Y2K OS window: title bar (icon · title · actions · controls) over a panel body.
 * `title={null}` renders a bare panel with the same chrome-less frame.
 *
 * Title-bar controls are only ever real: `foldable` adds a – / + button that folds the body
 * away (remembered per window title), `onClose` adds a × that calls it. Windows with neither
 * show three dim dots. `controls={false}` hides the right-hand chrome entirely.
 */
export default function Window({
  as: Tag = "section",
  title,
  icon,
  actions,
  controls = true,
  foldable = false,
  onClose,
  tone = "petal",
  className,
  bodyClassName,
  children,
  ...props
}) {
  const t = TONES[tone] || TONES.petal;
  const bodyId = useId();
  const [folded, setFolded] = useState(() => foldable && title != null && readFolded(title));
  const name = props["aria-label"] || title;
  const isFolded = foldable && folded;

  const toggleFold = () => {
    setFolded(!folded);
    saveFolded(title, !folded);
  };

  return (
    <Tag
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-panel/[0.88]",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_24px_60px_-28px_rgb(0_0_0/0.9)]",
        className
      )}
      {...props}
    >
      {title != null && (
        <header
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 border-line bg-gradient-to-r to-transparent px-3",
            !isFolded && "border-b",
            t.bar
          )}
        >
          <span className={cn("flex shrink-0 items-center", t.icon)}>{icon ?? <Sparkle className="size-3" />}</span>
          <span className="truncate font-dot text-[13px] tracking-wide text-blush/85">{title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
            {controls && (foldable || onClose) && (
              <span className="flex items-center gap-1.5">
                {foldable && (
                  <button
                    type="button"
                    onClick={toggleFold}
                    aria-expanded={!isFolded}
                    aria-controls={bodyId}
                    aria-label={`${isFolded ? "Expand" : "Fold"} ${name}`}
                    title={isFolded ? "expand" : "fold"}
                    className={cn(CONTROL, "border-line-strong bg-ink/60 text-mute hover:border-petal/60 hover:bg-panel-2 hover:text-petal")}
                  >
                    {isFolded ? "+" : "–"}
                  </button>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={`Close ${name}`}
                    title="close"
                    className={cn(CONTROL, "border-petal/40 bg-ink/60 text-petal hover:border-petal hover:bg-petal hover:text-void")}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
            {controls && !foldable && !onClose && <TitleDots />}
          </span>
        </header>
      )}
      {/* Folded bodies stay mounted (hidden) so aria-controls always points at something. */}
      <div id={bodyId} hidden={isFolded} className={cn("relative min-h-0 flex-1", bodyClassName)}>
        {children}
      </div>
    </Tag>
  );
}
