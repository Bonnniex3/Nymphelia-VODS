import { cn } from "../lib/cn";

const VARIANTS = {
  // Glossy "aqua" pill in her pink.
  primary:
    "bg-petal text-void shadow-[inset_0_-2px_0_rgb(194_85_136/0.55),0_10px_30px_-8px_rgb(247_143_196/0.7)] hover:bg-neon hover:shadow-[inset_0_-2px_0_rgb(194_85_136/0.55),0_12px_36px_-6px_rgb(255_111_181/0.85)] before:absolute before:inset-x-3 before:top-[3px] before:h-[42%] before:rounded-full before:bg-gradient-to-b before:from-white/55 before:to-white/0",
  sky: "bg-sky text-void shadow-[inset_0_-2px_0_rgb(103_14_249/0.45),0_10px_30px_-8px_rgb(195_166_255/0.6)] hover:brightness-110 before:absolute before:inset-x-3 before:top-[3px] before:h-[42%] before:rounded-full before:bg-gradient-to-b before:from-white/55 before:to-white/0",
  ghost: "border border-line-strong bg-ink/70 text-cream hover:border-petal/70 hover:text-petal hover:bg-panel-2",
  quiet: "text-mute hover:text-cream hover:bg-panel-2",
};

const SIZES = {
  sm: "h-8 gap-1.5 px-3.5 text-xs",
  md: "h-10 gap-2 px-5 text-sm",
  lg: "h-12 gap-2.5 px-7 text-[15px]",
};

export function Button({ as: Tag = "button", variant = "primary", size = "md", className, children, ...props }) {
  return (
    <Tag
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold whitespace-nowrap",
        "transition-[background-color,box-shadow,color,border-color,transform,filter] duration-200 ease-snap active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...(Tag === "button" && !props.type ? { type: "button" } : null)}
      {...props}
    >
      {children}
    </Tag>
  );
}

const TIP_SIDE = {
  top: "bottom-full mb-2 translate-y-1",
  bottom: "top-full mt-2 -translate-y-1",
};
const TIP_ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

/**
 * Square icon button with a CSS tooltip. Always pass `label` (aria-label + tooltip text).
 * `tip` places the tooltip ("top" | "bottom" | "none"); `tipAlign` anchors it ("center" | "end").
 */
export function IconButton({
  as: Tag = "button",
  label,
  active = false,
  tone = "petal",
  size = "md",
  tip = "top",
  tipAlign = "center",
  className,
  children,
  ...props
}) {
  return (
    <Tag
      aria-label={label}
      className={cn(
        "group/ib relative inline-grid shrink-0 place-items-center rounded-xl border bg-ink/70 transition-all duration-200 ease-snap active:scale-95",
        size === "sm" ? "size-8" : "size-10",
        active
          ? tone === "sky"
            ? "border-sky/70 text-sky shadow-[0_0_18px_-4px_rgb(195_166_255/0.7)]"
            : "border-petal/70 text-petal shadow-[0_0_18px_-4px_rgb(247_143_196/0.7)]"
          : "border-line-strong text-blush/80 hover:border-petal/60 hover:text-petal hover:bg-panel-2",
        "disabled:pointer-events-none disabled:opacity-35",
        className
      )}
      {...(Tag === "button" && !props.type ? { type: "button" } : null)}
      {...props}
    >
      {children}
      {label && tip !== "none" && (
        <span
          role="presentation"
          className={cn(
            "pointer-events-none absolute z-50 rounded-md border border-line-strong bg-ink px-2 py-1 font-dot text-[11px] whitespace-nowrap text-blush opacity-0 shadow-lg transition duration-150",
            "group-hover/ib:translate-y-0 group-hover/ib:opacity-100 group-focus-visible/ib:translate-y-0 group-focus-visible/ib:opacity-100",
            TIP_SIDE[tip] || TIP_SIDE.top,
            TIP_ALIGN[tipAlign] || TIP_ALIGN.center
          )}
        >
          {label}
        </span>
      )}
    </Tag>
  );
}
