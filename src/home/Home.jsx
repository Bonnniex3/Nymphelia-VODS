import { useEffect } from "react";
import { CHANNEL } from "../lib/channel";
import { ALL_VODS, archiveStats } from "../lib/vods";
import Archive from "../archive/Archive";
import Footer from "../shell/Footer";
import HeroWindow from "./HeroWindow";
import ProfileCard from "./ProfileCard";
import { OnAirTile, StatsTile, Ticker } from "./SignalTiles";
import ContinueWatching from "./ContinueWatching";

const STATS = archiveStats(ALL_VODS);

export default function Home() {
  useEffect(() => {
    document.title = `${CHANNEL.name} VODs`;
  }, []);

  return (
    <>
      <main className="gutter-x flex flex-1 flex-col gap-4 pt-5 pb-20 3xl:gap-5">
        {/* Bento: fills the first screen on desktop */}
        <section
          aria-label="Profile"
          className="grid gap-4 md:grid-cols-6 xl:h-[clamp(640px,calc(100dvh-var(--topbar-h)-6.25rem),940px)] xl:grid-cols-12 xl:grid-rows-2 3xl:gap-5"
        >
          <HeroWindow className="min-h-[560px] md:col-span-6 xl:col-span-6 xl:col-start-4 xl:row-span-2 xl:row-start-1 xl:min-h-0" />
          <ProfileCard className="md:col-span-3 md:row-span-2 xl:col-span-3 xl:col-start-1 xl:row-span-2 xl:row-start-1" />
          <OnAirTile className="md:col-span-3 xl:col-span-3 xl:col-start-10 xl:row-start-1" />
          <StatsTile stats={STATS} className="md:col-span-3 xl:col-span-3 xl:col-start-10 xl:row-start-2" />
        </section>

        <Ticker />
        <ContinueWatching className="reveal mt-6" />
        <Archive className="mt-10" />
      </main>
      <Footer />
    </>
  );
}
