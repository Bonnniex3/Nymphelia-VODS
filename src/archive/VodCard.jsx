import { useRef } from "react";
import { Link, useViewTransitionState } from "react-router-dom";
import dayjs from "dayjs";
import { Play, ListVideo } from "lucide-react";
import { makeSlug } from "../lib/helpers";
import { categoryOf, isNew, savedProgress, vodNumber } from "../lib/vods";
import { cn } from "../lib/cn";
import { preloadWatch } from "../routes";
import Thumb from "../ui/Thumb";
import { Led, Tag } from "../ui/Tag";

// Holographic trading-card style VOD tile: tilts toward the pointer, foil sheen,
// and morphs into the player via the View Transitions API.
export default function VodCard({ vod, className }) {
  const to = `/vod/${makeSlug(vod)}`;
  const morphing = useViewTransitionState(to);
  const ref = useRef(null);
  const progress = savedProgress(vod);
  const chapters = vod.chapters?.length || 0;

  const onPointerMove = (e) => {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", x.toFixed(3));
    el.style.setProperty("--my", y.toFixed(3));
    el.style.setProperty("--rx", `${((0.5 - y) * 7).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 9).toFixed(2)}deg`);
  };
  const onPointerLeave = () => {
    const el = ref.current;
    for (const v of ["--mx", "--my", "--rx", "--ry"]) el.style.removeProperty(v);
  };

  return (
    <Link
      to={to}
      viewTransition
      ref={ref}
      onPointerEnter={preloadWatch}
      onFocus={preloadWatch}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn("group/card block rounded-[20px] [perspective:1000px] focus-visible:outline-offset-4", className)}
    >
      <article
        className={cn(
          "relative flex h-full flex-col rounded-[20px] border border-line bg-panel/90 p-2",
          "transition-[transform,border-color,box-shadow] duration-200 ease-out will-change-transform",
          "[transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))]",
          "group-hover/card:border-petal/45 group-hover/card:shadow-[0_24px_50px_-24px_rgb(247_143_196/0.5),0_0_0_1px_rgb(247_143_196/0.1)]",
          "motion-reduce:[transform:none]"
        )}
      >
        {/* Thumbnail */}
        <div
          className="relative aspect-video overflow-hidden rounded-[14px] bg-ink"
          style={{ viewTransitionName: morphing ? "vod-media" : undefined }}
        >
          <Thumb
            vod={vod}
            className="transition-[transform,filter] duration-500 ease-snap group-hover/card:scale-[1.06] group-hover/card:brightness-[0.72] group-hover/card:saturate-[1.15]"
          />
          {/* holographic foil that follows the pointer */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 mix-blend-color-dodge transition-opacity duration-300 group-hover/card:opacity-70"
            style={{
              backgroundImage:
                "linear-gradient(115deg, transparent 22%, rgb(247 143 196 / 0.35) 36%, rgb(195 166 255 / 0.35) 50%, rgb(143 122 230 / 0.3) 60%, transparent 76%)",
              backgroundSize: "260% 260%",
              backgroundPosition: "calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%)",
            }}
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 scanlines opacity-0 transition-opacity group-hover/card:opacity-100" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-void/80 to-transparent" />

          {/* play */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="relative grid size-14 scale-50 place-items-center rounded-full bg-petal text-void opacity-0 shadow-[0_0_0_6px_rgb(247_143_196/0.18),0_0_40px_rgb(247_143_196/0.7)] transition duration-300 ease-bounce group-hover/card:scale-100 group-hover/card:opacity-100 before:absolute before:inset-x-2.5 before:top-1 before:h-[42%] before:rounded-full before:bg-gradient-to-b before:from-white/60 before:to-white/0">
              <Play className="ml-0.5 size-6" fill="currentColor" />
            </span>
          </div>

          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
            {isNew(vod) ? <Tag tone="solid" className="shadow-[0_0_16px_rgb(247_143_196/0.7)]">new ✦</Tag> : <span />}
            <Tag tone="mute" className="bg-void/75 text-blush/90">{categoryOf(vod)}</Tag>
          </div>
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
            {chapters > 1 ? (
              <Tag tone="mute" className="bg-void/75 text-blush/90">
                <ListVideo className="size-3" /> {chapters}
              </Tag>
            ) : (
              <span />
            )}
            <Led>{vod.duration}</Led>
          </div>
          {progress != null && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-void/70" title={`${Math.round(progress * 100)}% watched`}>
              <div className="h-full holo-bg" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-1 flex-col gap-1.5 px-2 pt-3 pb-2">
          <div className="flex items-center gap-2 font-dot text-[12px] tracking-wide text-mute">
            <span className="text-petal/80">№{vodNumber(vod)}</span>
            <span className="text-dim">✦</span>
            <time dateTime={vod.createdAt}>{dayjs(vod.createdAt).format("MMM D, YYYY")}</time>
          </div>
          <h3 className="line-clamp-2 text-[15px] leading-snug font-bold text-cream transition-colors group-hover/card:text-petal">
            {vod.title}
          </h3>
        </div>
      </article>
    </Link>
  );
}
