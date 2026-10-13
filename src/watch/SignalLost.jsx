import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, House, TriangleAlert } from "lucide-react";
import Window from "../ui/Window";
import { Button } from "../ui/Button";
import { EASE } from "./tw";

// Test-card bars in her palette.
const BARS = ["#fff7fa", "#fbcfe8", "#c3a6ff", "#8f7ae6", "#f78fc4", "#ff6fb5", "#c25588"];
const STRIP = ["#c25588", "#0a0408", "#ff6fb5", "#0a0408", "#8f7ae6", "#0a0408", "#fff7fa"];
const PLUGE = ["#23111d", "#fff7fa", "#311829", "#0a0408", "#1a0c15", "#12070e"];

function TestCard() {
  return (
    <div className="relative aspect-video overflow-hidden bg-void" aria-hidden="true">
      <div className="absolute inset-x-0 top-0 flex h-[66%]">
        {BARS.map((c) => (
          <span key={c} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="absolute inset-x-0 top-[66%] flex h-[9%]">
        {STRIP.map((c, i) => (
          <span key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="absolute inset-x-0 top-[75%] bottom-0 flex">
        {PLUGE.map((c, i) => (
          <span key={i} className={i === 1 ? "flex-[1.4]" : "flex-1"} style={{ background: c }} />
        ))}
      </div>
      <div className="absolute inset-0 bg-void/30" />
      <div className="absolute inset-0 tv-static opacity-25 mix-blend-overlay" />
      <div className="absolute inset-0 scanlines opacity-80" />
      <div className="absolute inset-x-0 top-0 h-1/4 animate-roll bg-gradient-to-b from-transparent via-white/[0.08] to-transparent" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="rounded-xl border border-petal/50 bg-void/85 px-6 py-3.5 text-center shadow-[0_0_40px_-6px_rgb(247_143_196/0.6)]">
          <p className="font-dot text-[26px] leading-none tracking-[0.32em] text-petal text-glow sm:text-[32px]">NO SIGNAL</p>
          <p className="mt-2 font-dot text-[11px] tracking-[0.2em] text-mute">CH-404 ✦ (╥﹏╥)</p>
        </div>
      </div>
    </div>
  );
}

// Not-found state for /vod/:slug.
export default function SignalLost({ slug }) {
  useEffect(() => {
    document.title = "Signal lost - VOD not found";
  }, []);

  return (
    <main className="gutter-x grid flex-1 place-items-center py-8 sm:py-12">
      <motion.div
        className="w-full max-w-[600px]"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <Window title="error.log" icon={<TriangleAlert className="size-3.5" strokeWidth={2.4} />} className="holo-border">
          <TestCard />
          <div className="relative px-6 pt-6 pb-7 text-center sm:px-10">
            <p className="font-dot text-[12px] tracking-[0.18em] text-petal">!! ERR_VOD_NOT_FOUND</p>
            <h1 className="mt-2 font-display text-[28px] leading-tight font-bold tracking-tight text-cream sm:text-[34px]">signal lost</h1>
            <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-mute">
              This link may be broken or the VOD has been removed. Try finding it in the archive ♡
            </p>
            {slug && (
              <p className="mx-auto mt-4 w-fit max-w-full truncate rounded-lg border border-line bg-void/70 px-3 py-1.5 font-dot text-[12px] text-dim">
                /vod/<span className="text-blush/70">{slug}</span>
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button as={Link} to="/vods" viewTransition>
                <ArrowLeft className="size-4" strokeWidth={2.4} /> back to archive
              </Button>
              <Button as={Link} to="/" viewTransition variant="ghost">
                <House className="size-4" strokeWidth={2.2} /> home
              </Button>
            </div>
          </div>
        </Window>
      </motion.div>
    </main>
  );
}
