import { motion } from "motion/react";
import { ArrowUpRight, Disc3 } from "lucide-react";
import PFP from "../assets/pfp.png";
import Window from "../ui/Window";
import BrandIcon from "../ui/BrandIcon";
import Sparkle from "../ui/Sparkle";
import { Button } from "../ui/Button";
import { Led, Tag } from "../ui/Tag";
import { CHANNEL } from "../lib/channel";
import { useNow } from "../lib/hooks";
import { ALL_VODS, categoryOf } from "../lib/vods";
import { cn } from "../lib/cn";
import { streamNumber } from "./data";
import { ago, dateParts } from "./time";
import { EYEBROW, RISE } from "./tw";

const SEGMENTS = 12;

// Dot-matrix meter: lit segments for how much of this VOD has played.
function Meter({ value }) {
  const lit = Math.round(value * SEGMENTS);
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-3 w-[5px] rounded-[2px] transition-colors duration-500",
            i < lit ? (i < SEGMENTS * 0.5 ? "bg-petal" : i < SEGMENTS * 0.8 ? "bg-lilac" : "bg-sky") : "bg-white/[0.07]",
            i < lit && "shadow-[0_0_6px_rgb(247_143_196/0.6)]"
          )}
        />
      ))}
    </span>
  );
}

// A leading 【tag】 (歌枠, MINECRAFT…) gets the holographic treatment.
function Title({ text = "" }) {
  const m = text.match(/^(\s*【[^】]{1,24}】)(.+)$/);
  if (!m) return text;
  return (
    <>
      <span className="holo-text">{m[1]}</span>
      {m[2]}
    </>
  );
}

function Stat({ label, children, className }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-ink/60 px-3 py-2.5", className)}>
      <dt className={EYEBROW}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// Sidebar "now_playing.vod": the page <h1>, date, length, progress, channel.
export default function NowPlaying({ vod, time, duration, status, chapterCount, className }) {
  const now = useNow(60_000);
  const when = dateParts(vod.createdAt);
  const number = streamNumber(vod);
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const live = status === "playing";

  return (
    <Window
      as={motion.section}
      variants={RISE}
      title="now_playing.vod"
      icon={<Disc3 className={cn("size-3.5", live && "animate-spin-slow")} strokeWidth={2.4} />}
      actions={
        number && (
          <span className="font-dot text-[11px] tracking-wider text-mute tabular-nums">
            #{String(number).padStart(3, "0")}/{String(ALL_VODS.length).padStart(3, "0")}
          </span>
        )
      }
      aria-labelledby="vod-title"
      className={className}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-petal/10 blur-3xl" />
      <div className="relative p-5">
        <p className="flex items-center gap-2 font-dot text-[11px] tracking-[0.18em] text-petal/90 uppercase">
          <span className={cn("size-1.5 rounded-full bg-petal shadow-[0_0_8px_var(--color-petal)]", live && "animate-blink")} />
          {live ? "now playing" : status === "paused" ? "paused" : "stream replay"}
          <span className="text-dim">✦</span>
          <span className="text-mute normal-case tracking-normal">{CHANNEL.kana}</span>
        </p>

        <h1 id="vod-title" className="mt-3 select-text font-display text-[21px] leading-[1.22] font-semibold tracking-tight text-balance break-words text-cream xl:text-[22px]">
          <Title text={vod.title} />
        </h1>

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <Tag tone="petal">{categoryOf(vod)}</Tag>
          {when && (
            <Tag tone="mute">
              <time dateTime={vod.createdAt}>
                {when.day} {when.date}
              </time>
            </Tag>
          )}
          <Tag tone="lilac">{ago(vod.createdAt, now)}</Tag>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
          <Stat label="length">
            <Led>{vod.duration || "--:--:--"}</Led>
          </Stat>
          <Stat label={chapterCount ? "chapters" : "aired"}>
            <Led tone="sky">{chapterCount ? String(chapterCount).padStart(2, "0") : when?.time ?? "--:--"}</Led>
          </Stat>
          <Stat label="watched" className="col-span-2 sm:col-span-1 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <Meter value={progress} />
              <span className="font-dot text-[13px] text-blush tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
          </Stat>
        </dl>

        <div className="mt-4 flex items-center gap-3 border-t border-dashed border-line pt-4">
          <span className="relative grid size-11 shrink-0 place-items-center">
            <span aria-hidden="true" className="absolute inset-0 animate-spin-slow rounded-full [background-image:conic-gradient(from_0deg,#f78fc4,#c3a6ff,#8f7ae6,#ff6fb5,#f78fc4)]" />
            <img src={PFP} alt="" className="relative size-[38px] rounded-full border-2 border-panel" />
            <Sparkle className="absolute -top-0.5 -right-0.5 size-3 animate-twinkle text-cream" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[14px] font-bold text-cream lowercase">{CHANNEL.name}</p>
            <p className="truncate font-dot text-[11px] text-mute">
              @{CHANNEL.handle} · {CHANNEL.tagline}
            </p>
          </div>
          <Button as="a" href={CHANNEL.twitch} target="_blank" rel="noopener noreferrer" variant="ghost" size="sm" className="hover:text-[#bf94ff]">
            <BrandIcon name="twitch" className="size-3.5" />
            twitch
            <ArrowUpRight className="size-3" strokeWidth={2.6} />
          </Button>
        </div>
      </div>
    </Window>
  );
}
