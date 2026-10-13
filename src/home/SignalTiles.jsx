import dayjs from "dayjs";
import { CHANNEL } from "../lib/channel";
import { cn } from "../lib/cn";
import { toHHMMSS } from "../lib/helpers";
import DotMatrix from "../fx/DotMatrix";
import { Button, IconButton } from "../ui/Button";
import BrandIcon from "../ui/BrandIcon";
import Window from "../ui/Window";

export function OnAirTile({ className }) {
  return (
    <Window title="on_air.led" className={className} bodyClassName="flex flex-col gap-3 p-4">
      <div className="relative flex min-h-40 flex-1 flex-col justify-center gap-3 overflow-hidden rounded-xl border border-line bg-void px-3 py-3 shadow-[inset_0_0_40px_rgb(0_0_0/0.85)]">
        <div className="flex items-center justify-between font-dot text-[10px] tracking-[0.25em] text-dim">
          <span className="flex items-center gap-2">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-petal opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-petal" />
            </span>
            <span className="text-petal">REC</span>
          </span>
          <span>CH-01 ✦ TWITCH</span>
        </div>
        <DotMatrix text="TUNE IN" mode="fit" ariaLabel="Tune in on Twitch" />
        <DotMatrix
          text={`TWITCH.TV/${CHANNEL.handle.toUpperCase()} ✦ LIVE STREAMS ✦ COME HANG OUT ♥`}
          mode="marquee"
          pitch={3}
          speed={30}
          color="#c3a6ff"
          offColor="rgba(195,166,255,0.08)"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 scanlines opacity-60" />
      </div>
      <p className="text-[13px] leading-snug text-mute">every broadcast lands in the archive afterwards ♡</p>
      <div className="flex gap-2">
        <Button as="a" href={CHANNEL.twitch} target="_blank" rel="noopener noreferrer" variant="sky" className="flex-1">
          <BrandIcon name="twitch" className="size-4" /> open twitch ↗
        </Button>
        <IconButton as="a" href={CHANNEL.discord} target="_blank" rel="noopener noreferrer" label="Discord" tone="sky">
          <BrandIcon name="discord" className="size-[18px]" />
        </IconButton>
      </div>
    </Window>
  );
}

function Stat({ label, value, tone = "petal" }) {
  return (
    <div className="rounded-xl border border-line bg-void/60 px-3 py-2.5">
      <dd className={cn("font-dot text-[clamp(1.25rem,1.7vw,1.7rem)] leading-none tabular-nums", tone === "sky" ? "text-sky text-glow-sky" : "text-petal text-glow")}>{value}</dd>
      <dt className="mt-1.5 font-dot text-[10px] tracking-[0.25em] text-dim uppercase">{label}</dt>
    </div>
  );
}

const ROWS = 10;

// Streams-per-month histogram drawn as columns of LED dots; stretches to fill its box.
function DotBars({ months }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  return (
    <div className="grid h-full grid-cols-12 gap-1" role="img" aria-label={`Streams per month: ${months.map((m) => `${m.label} ${m.count}`).join(", ")}`}>
      {months.map((m) => {
        const lit = m.count ? Math.max(1, Math.round((m.count / max) * ROWS)) : 0;
        return (
          <div key={m.key} className="group/bar flex h-full flex-col items-center gap-1.5" title={`${m.label}: ${m.count}`}>
            <div className="flex min-h-[78px] flex-1 flex-col-reverse justify-between">
              {Array.from({ length: ROWS }, (_, r) => (
                <span
                  key={r}
                  className={cn(
                    "size-[clamp(5px,0.42vw,8px)] rounded-full transition-colors",
                    r < lit
                      ? r === lit - 1
                        ? "bg-cream shadow-[0_0_8px_rgb(255_247_250/0.9)]"
                        : "bg-petal shadow-[0_0_6px_rgb(247_143_196/0.7)] group-hover/bar:bg-neon"
                      : "bg-panel-3"
                  )}
                />
              ))}
            </div>
            <span className="font-dot text-[8px] leading-none text-dim">{m.label[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StatsTile({ stats, className }) {
  const fmt = (secs) => (secs ? toHHMMSS(Math.round(secs)) : "--:--");
  return (
    <Window title="archive.sys" tone="lilac" className={className} bodyClassName="flex flex-col gap-3 p-4">
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="vods" value={String(stats.count).padStart(3, "0")} />
        <Stat label="hours" value={String(Math.round(stats.hours)).padStart(3, "0")} tone="sky" />
        <Stat label="latest" value={stats.latest ? dayjs(stats.latest).format("MM.DD") : "--.--"} />
      </dl>
      <dl className="grid grid-cols-2 gap-2 font-dot text-[12px]">
        {[
          ["avg", fmt(stats.avgSeconds)],
          ["longest", fmt(stats.longestSeconds)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-line bg-void/40 px-2.5 py-1.5">
            <dt className="tracking-[0.2em] text-dim uppercase">{label}</dt>
            <dd className="tabular-nums text-blush">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-1 flex-col rounded-xl border border-line bg-void/60 p-3">
        <div className="mb-2.5 flex items-center justify-between font-dot text-[10px] tracking-[0.2em] text-dim uppercase">
          <span>streams / month</span>
          <span className={stats.count ? "text-petal/80" : "text-mute"}>{stats.count ? "last 12" : "awaiting data ♡"}</span>
        </div>
        <div className="min-h-0 flex-1">
          <DotBars months={stats.perMonth} />
        </div>
      </div>
    </Window>
  );
}

export function Ticker({ className }) {
  return (
    <div className={cn("flex items-center gap-3 overflow-hidden rounded-2xl border border-line bg-ink/85 px-3 py-2", className)}>
      <span className="hidden shrink-0 rounded-md bg-petal px-2 py-0.5 font-dot text-[11px] tracking-widest text-void sm:inline">♪ NOW</span>
      <div className="min-w-0 flex-1">
        <DotMatrix
          text={`${CHANNEL.name} ✦ VOD ARCHIVE ✦ EVERY STREAM SAVED ♥ RESUME WHERE YOU LEFT OFF ✦ CLIP & SHARE YOUR FAVOURITE MOMENTS ✦ TWITCH.TV/${CHANNEL.handle} ✦ STAY COZY ♡`}
          mode="marquee"
          pitch={3}
          speed={44}
        />
      </div>
      <span className="hidden shrink-0 font-dot text-[11px] tracking-widest text-sky md:inline">◉ 24/7</span>
    </div>
  );
}
