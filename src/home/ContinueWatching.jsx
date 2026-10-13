import { useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { makeSlug, toHHMMSS } from "../lib/helpers";
import { ALL_VODS, durationSeconds, savedProgress } from "../lib/vods";
import { preloadWatch } from "../routes";
import Thumb from "../ui/Thumb";
import Window from "../ui/Window";

// "Pick up where you left off": VODs with saved watch progress. Renders nothing
// until the visitor has started watching something.
export default function ContinueWatching({ className }) {
  const [items] = useState(() =>
    ALL_VODS.map((vod) => ({ vod, progress: savedProgress(vod) }))
      .filter((r) => r.progress != null && r.progress < 0.97)
      .slice(0, 4)
  );
  if (items.length === 0) return null;

  return (
    <Window title="resume.dat" tone="sky" className={className} bodyClassName="flex flex-col p-3">
      <p className="px-2 pt-1 pb-3 font-dot text-[11px] tracking-[0.2em] text-dim">
        <RotateCcw className="mr-1.5 inline size-3 -translate-y-px text-sky" />
        PICK UP WHERE YOU LEFT OFF
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(({ vod, progress }) => {
          const left = Math.max(0, durationSeconds(vod) * (1 - progress));
          return (
            <li key={vod.id}>
              <Link
                to={`/vod/${makeSlug(vod)}`}
                viewTransition
                onPointerEnter={preloadWatch}
                className="group/r flex items-center gap-3 rounded-2xl border border-transparent p-2 transition-colors hover:border-line-strong hover:bg-panel-2"
              >
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-ink">
                  <Thumb vod={vod} />
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-void/70">
                    <div className="h-full holo-bg" style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm leading-snug font-bold transition-colors group-hover/r:text-sky">{vod.title}</p>
                  <p className="mt-1 font-dot text-[11px] text-mute">
                    {Math.round(progress * 100)}% <span className="text-dim">·</span> {toHHMMSS(left)} left
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Window>
  );
}
