import { cn } from "../lib/cn";
import Sparkle from "./Sparkle";

const TONES = {
  petal: { icon: "text-petal", bar: "from-petal/[0.09]" },
  sky: { icon: "text-sky", bar: "from-sky/[0.09]" },
  lilac: { icon: "text-lilac", bar: "from-lilac/[0.1]" },
};

// Decorative minimise / maximise / close buttons.
function WindowControls() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {["–", "□", "×"].map((glyph, i) => (
        <span
          key={glyph}
          className={cn(
            "grid size-[18px] place-items-center rounded-[5px] border border-line-strong bg-ink/60 font-dot text-[11px] leading-none text-mute",
            i === 2 && "border-petal/40 text-petal"
          )}
        >
          {glyph}
        </span>
      ))}
    </span>
  );
}

/**
 * Y2K OS window: title bar (icon · title · actions · controls) over a panel body.
 * `title={null}` renders a bare panel with the same chrome-less frame.
 */
export default function Window({
  as: Tag = "section",
  title,
  icon,
  actions,
  controls = true,
  tone = "petal",
  className,
  bodyClassName,
  children,
  ...props
}) {
  const t = TONES[tone] || TONES.petal;
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
            "flex h-9 shrink-0 items-center gap-2 border-b border-line bg-gradient-to-r to-transparent px-3",
            t.bar
          )}
        >
          <span className={cn("flex shrink-0 items-center", t.icon)}>{icon ?? <Sparkle className="size-3" />}</span>
          <span className="truncate font-dot text-[13px] tracking-wide text-blush/85">{title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
            {controls && <WindowControls />}
          </span>
        </header>
      )}
      <div className={cn("relative min-h-0 flex-1", bodyClassName)}>{children}</div>
    </Tag>
  );
}
