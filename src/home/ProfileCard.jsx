import { Link } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import PFP from "../assets/pfp.png";
import { CHANNEL, SOCIALS } from "../lib/channel";
import { makeSlug } from "../lib/helpers";
import { ALL_VODS } from "../lib/vods";
import { preloadWatch } from "../routes";
import Thumb from "../ui/Thumb";
import { cn } from "../lib/cn";
import BrandIcon from "../ui/BrandIcon";
import Sparkle from "../ui/Sparkle";
import { Tag } from "../ui/Tag";
import Window from "../ui/Window";

dayjs.extend(relativeTime);

// Up to three latest streams; extra rows only appear when the viewport is tall enough.
const RECENT_VISIBILITY = ["flex", "hidden xl:[@media(min-height:960px)]:flex", "hidden xl:[@media(min-height:1080px)]:flex"];

function RecentStreams({ className }) {
  const recent = ALL_VODS.slice(0, 3);
  return (
    <div className={cn("w-full text-left", className)}>
      <div className="mb-2 font-dot text-[10px] tracking-[0.28em] text-dim">// LATEST STREAMS</div>
      {recent.length ? (
        <ul className="flex flex-col gap-1.5">
          {recent.map((vod, i) => (
            <li key={vod.id} className={RECENT_VISIBILITY[i]}>
              <Link
                to={`/vod/${makeSlug(vod)}`}
                viewTransition
                onPointerEnter={preloadWatch}
                className="group/ls flex w-full items-center gap-3 rounded-2xl border border-line bg-void/50 p-2 transition-colors hover:border-petal/50 hover:bg-panel-2"
              >
                <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-ink">
                  <Thumb vod={vod} />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[13px] leading-snug font-bold transition-colors group-hover/ls:text-petal">{vod.title}</p>
                  <p className="mt-1 font-dot text-[11px] text-mute">{dayjs(vod.createdAt).fromNow()}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-line-strong px-3 py-3 font-dot text-[12px] text-mute">no streams archived yet ♡</div>
      )}
    </div>
  );
}

// Deterministic barcode generated from her handle.
function Barcode({ seed, className }) {
  const bars = [...seed.repeat(3)].flatMap((ch, i) => {
    const c = ch.charCodeAt(0) + i;
    return [{ w: (c % 3) + 1, gap: ((c >> 2) % 2) + 1 }];
  });
  return (
    <div className={cn("flex h-7 items-stretch", className)} aria-hidden="true">
      {bars.map((b, i) => (
        <span key={i} className="bg-blush/70" style={{ width: b.w, marginRight: b.gap }} />
      ))}
    </div>
  );
}

function Keycap({ social }) {
  return (
    <a
      href={social.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={social.label}
      className={cn(
        "group/key relative flex h-[3.4rem] flex-col items-center justify-center gap-1 rounded-xl border border-line-strong",
        "bg-gradient-to-b from-panel-3 to-panel-2 text-blush/85",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.09),0_4px_0_#0d050a,0_8px_16px_-6px_rgb(0_0_0/0.8)]",
        "transition-all duration-150 ease-snap hover:-translate-y-0.5 hover:border-petal/60 hover:text-petal hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.09),0_5px_0_#0d050a,0_0_24px_-6px_rgb(247_143_196/0.7)]",
        "active:translate-y-1 active:shadow-[inset_0_1px_0_rgb(255_255_255/0.09),0_0_0_#0d050a]"
      )}
    >
      <BrandIcon name={social.key} className="size-[18px]" />
      <span className="font-dot text-[10px] leading-none tracking-wide text-mute transition-colors group-hover/key:text-petal/80">{social.label}</span>
    </a>
  );
}

export default function ProfileCard({ className }) {
  return (
    <Window title="profile.id" tone="sky" className={className} bodyClassName="flex flex-col overflow-hidden">
      {/* holographic foil header */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 holo-bg opacity-[0.13] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 dot-grid-fine [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="relative flex flex-1 flex-col items-center px-5 pt-4 pb-5 text-center">
        <div className="flex w-full justify-between font-dot text-[10px] tracking-[0.28em] text-mute">
          <span>MEMBER CARD</span>
          <span>№ 0001</span>
        </div>

        <div className="relative mt-5 size-[clamp(6.5rem,min(10vw,16vh),11rem)]">
          <div aria-hidden="true" className="absolute -inset-3 rounded-full fx-glow opacity-50 blur-2xl [background:conic-gradient(from_0deg,#f78fc4,#c3a6ff,#8f7ae6,#ff6fb5,#f78fc4)]" />
          <div aria-hidden="true" className="absolute -inset-[5px] animate-spin-slow rounded-full [background:conic-gradient(from_0deg,#f78fc4,#fff7fa,#c3a6ff,#8f7ae6,#ff6fb5,#f78fc4)]" />
          <img src={PFP} alt={`${CHANNEL.name}'s avatar`} className="relative size-full rounded-full border-[3px] border-panel object-cover" />
          <span className="absolute -right-3 bottom-1 rotate-[10deg] rounded-lg border border-white/30 bg-petal px-2 py-0.5 font-dot text-[11px] text-void shadow-[0_6px_16px_-4px_rgb(247_143_196/0.8)]">
            ♡ asmrtist
          </span>
          <Sparkle className="absolute -top-2 -left-1 size-5 animate-twinkle text-cream" />
          <Sparkle className="absolute top-3 -right-4 size-3 animate-twinkle text-sky [animation-delay:1.1s]" />
        </div>

        <h2 className="mt-5 font-display text-[clamp(1.6rem,2.2vw,2.1rem)] leading-none font-black tracking-tight lowercase">{CHANNEL.name}</h2>
        <p className="mt-2 font-dot text-sm text-petal">
          @{CHANNEL.handle} <span className="text-dim">✦</span> {CHANNEL.kana}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <Tag tone="sky">asmrtist</Tag>
          <Tag>streamer</Tag>
          <Tag tone="lilac">twitch</Tag>
        </div>

        <RecentStreams className="mt-5 xl:[@media(max-height:700px)]:hidden" />

        <div className="mt-auto w-full pt-5">
          <div className="mb-2 text-left font-dot text-[10px] tracking-[0.28em] text-dim">// FIND HER</div>
          <div className="grid grid-cols-2 gap-2">
            {SOCIALS.map((s) => (
              <Keycap key={s.key} social={s} />
            ))}
          </div>
          <div className="mt-5 flex items-end justify-between gap-3 border-t border-dashed border-line-strong pt-4 xl:[@media(max-height:800px)]:hidden">
            <Barcode seed={CHANNEL.handle} />
            <span className="font-dot text-[10px] tracking-[0.2em] text-mute">NYM ✦ 2026</span>
          </div>
        </div>
      </div>
    </Window>
  );
}
