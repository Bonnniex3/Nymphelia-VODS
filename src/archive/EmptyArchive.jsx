import { Radio } from "lucide-react";
import { CHANNEL } from "../lib/channel";
import { cn } from "../lib/cn";
import { Button } from "../ui/Button";
import BrandIcon from "../ui/BrandIcon";
import Window from "../ui/Window";

// Test-card bars in her palette.
const BARS = ["#fff7fa", "#fbcfe8", "#f78fc4", "#c3a6ff", "#8f7ae6", "#c25588", "#3c222a"];

function NoSignal({ className }) {
  return (
    <Window title="signal.err" tone="sky" className={cn("min-h-full", className)} bodyClassName="flex flex-col">
      <div className="relative aspect-[16/8] overflow-hidden border-b border-line bg-void">
        <div className="absolute inset-x-0 top-0 grid h-[72%] grid-cols-7">
          {BARS.map((c) => (
            <div key={c} style={{ background: c }} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 grid h-[28%] grid-cols-7">
          {[...BARS].reverse().map((c, i) => (
            <div key={c} style={{ background: i % 2 ? "#12070e" : c, opacity: 0.85 }} />
          ))}
        </div>
        <div className="fx-pausable absolute inset-0 tv-static opacity-30 mix-blend-overlay" />
        <div className="absolute inset-0 bg-void/30 scanlines" />
        <div className="fx-pausable absolute inset-x-0 top-0 h-1/5 animate-roll bg-gradient-to-b from-transparent via-white/15 to-transparent" />
        <div className="absolute inset-0 grid place-items-center">
          <div className="rounded-xl border border-petal/50 bg-void/90 px-5 py-3 text-center shadow-[0_0_40px_rgb(247_143_196/0.35)]">
            <div className="font-dot text-[clamp(1.4rem,4cqw,2.6rem)] leading-none tracking-[0.18em] text-petal text-glow">NO SIGNAL</div>
            <div className="mt-2 font-dot text-[11px] tracking-[0.3em] text-mute">CH-01 ✦ {CHANNEL.kana}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3 p-6 md:p-8">
        <p className="font-dot text-xs tracking-[0.25em] text-sky">// TRANSMISSION PENDING</p>
        <h3 className="font-display text-2xl font-bold tracking-tight md:text-3xl">no vods archived yet ♡</h3>
        <p className="max-w-[52ch] text-mute">
          {CHANNEL.name}&apos;s streams will appear here as soon as they&apos;re archived. Until then, catch her live — every broadcast lands here afterwards.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button as="a" href={CHANNEL.twitch} target="_blank" rel="noopener noreferrer">
            <BrandIcon name="twitch" className="size-4" /> watch live on twitch
          </Button>
          <Button as="a" href={CHANNEL.youtube} target="_blank" rel="noopener noreferrer" variant="ghost">
            <Radio className="size-4" /> youtube
          </Button>
        </div>
      </div>
    </Window>
  );
}

// Visibility per slot so the placeholder grid always ends on a full row.
const SLOT_VISIBILITY = [
  "flex", "flex",
  "hidden sm:flex", "hidden sm:flex",
  "hidden lg:flex", "hidden lg:flex", "hidden lg:flex", "hidden lg:flex",
  "hidden 3xl:flex", "hidden 3xl:flex", "hidden 3xl:flex",
  "hidden 4xl:flex", "hidden 4xl:flex", "hidden 4xl:flex",
];

function GhostSlot({ n, className }) {
  return (
    <div className={cn("flex-col rounded-[20px] border border-dashed border-line-strong bg-panel/40 p-2", className)} aria-hidden="true">
      <div className="relative aspect-video flex-1 overflow-hidden rounded-[14px] bg-ink/70 dot-grid">
        <div className="fx-pausable absolute inset-0 sheen" style={{ animationDelay: `${n * 0.18}s` }} />
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="font-dot text-[11px] tracking-[0.3em] text-dim">EMPTY SLOT</div>
            <div className="mt-1 font-display text-4xl font-black text-panel-3">{String(n).padStart(2, "0")}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 px-2 pt-3 pb-2">
        <div className="h-2.5 w-20 rounded-full bg-panel-3/80" />
        <div className="h-3 w-4/5 rounded-full bg-panel-2" />
      </div>
    </div>
  );
}

export default function EmptyArchive() {
  return (
    <div className="@container mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6">
      <NoSignal className="sm:col-span-2 lg:row-span-2" />
      {SLOT_VISIBILITY.map((vis, i) => (
        <GhostSlot key={i} n={i + 1} className={vis} />
      ))}
    </div>
  );
}
