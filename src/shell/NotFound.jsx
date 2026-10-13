import { useEffect } from "react";
import { Link } from "react-router-dom";
import { CHANNEL } from "../lib/channel";
import DotMatrix from "../fx/DotMatrix";
import KanaRain from "../fx/KanaRain";
import { Button } from "../ui/Button";
import Window from "../ui/Window";

export default function NotFound() {
  useEffect(() => {
    document.title = `Not Found - ${CHANNEL.name}`;
  }, []);

  return (
    <main className="gutter-x grid flex-1 place-items-center py-12">
      <Window title="error_404.sys" tone="sky" className="w-full max-w-3xl" bodyClassName="overflow-hidden">
        <KanaRain className="opacity-40" />
        <div className="relative flex flex-col items-center gap-6 px-6 py-12 text-center md:px-12 md:py-16">
          <div className="w-full max-w-md rounded-2xl border border-line bg-void/90 p-4 shadow-[inset_0_0_40px_rgb(0_0_0/0.9)]">
            <DotMatrix text="404" mode="fit" ariaLabel="404" />
          </div>
          <div>
            <p className="font-dot text-sm tracking-[0.3em] text-sky">// SIGNAL LOST</p>
            <h1 className="mt-3 font-display text-3xl font-black tracking-tight md:text-4xl">this page wandered off (╥﹏╥)</h1>
            <p className="mx-auto mt-3 max-w-[44ch] text-mute">The link might be broken, or the VOD was moved. Let&apos;s get you back somewhere cozy.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button as={Link} to="/" viewTransition>
              go home
            </Button>
            <Button as={Link} to="/vods" viewTransition variant="ghost">
              browse the archive
            </Button>
          </div>
        </div>
      </Window>
    </main>
  );
}
