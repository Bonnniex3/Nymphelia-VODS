import { cn } from "../lib/cn";

const TONES = {
  petal: "border-petal/35 text-petal bg-petal/[0.07]",
  sky: "border-sky/40 text-sky bg-sky/[0.08]",
  lilac: "border-lilac/40 text-lilac bg-lilac/[0.08]",
  mute: "border-line-strong text-mute bg-ink/60",
  solid: "border-transparent bg-petal text-void",
};

// Small dot-matrix label, e.g. <Tag>gaming</Tag> or <Tag tone="sky">new</Tag>.
export function Tag({ as: Tag = "span", tone = "petal", className, children, ...props }) {
  return (
    <Tag
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 font-dot text-[12px] leading-none tracking-wide whitespace-nowrap",
        TONES[tone],
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

// Glowing LED readout for timecodes / counters: <Led>02:41:09</Led>.
export function Led({ className, children, tone = "petal", ...props }) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center rounded-md border border-white/[0.06] bg-void/85 px-2 py-0.5 font-dot text-[13px] leading-5 tabular-nums tracking-wider",
        tone === "sky" ? "text-sky text-glow-sky" : "text-petal text-glow",
        className
      )}
    >
      {children}
    </span>
  );
}
