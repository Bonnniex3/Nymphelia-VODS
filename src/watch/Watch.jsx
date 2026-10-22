import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { motion, MotionConfig } from "motion/react";
import { MonitorPlay, Scissors } from "lucide-react";
import Window from "../ui/Window";
import Thumb from "../ui/Thumb";
import { Tag } from "../ui/Tag";
import { convertTimestamp, toHMS } from "../lib/helpers";
import { durationSeconds, neighbours } from "../lib/vods";
import { useReducedMotion } from "../lib/hooks";
import { cn } from "../lib/cn";
import Player from "./Player";
import ProgressMarks from "./ProgressMarks";
import ScreenToasts from "./ScreenToasts";
import WatchHeader from "./WatchHeader";
import ClipBanner from "./ClipBanner";
import Deck from "./Deck";
import NowPlaying from "./NowPlaying";
import ChapterList from "./ChapterList";
import MoreVods from "./MoreVods";
import ChatPanel from "./chat/ChatPanel";
import TriggerPanel from "./chat/TriggerPanel";
import useChatReplay from "./chat/useChatReplay";
import useTriggers from "./chat/useTriggers";
import SignalLost from "./SignalLost";
import useCopy from "./useCopy";
import useAmbient from "./useAmbient";
import { activeChapterIndex, driveLink, findVod, parseClip } from "./data";
import { STAGGER } from "./tw";

const STATUS = {
  idle: { label: "standby", dot: "bg-mute" },
  playing: { label: "playing", dot: "bg-petal shadow-[0_0_8px_var(--color-petal)] animate-blink", text: "text-petal" },
  paused: { label: "paused", dot: "bg-blush/60" },
  buffering: { label: "buffering", dot: "bg-sky animate-blink", text: "text-sky" },
  ended: { label: "ended", dot: "bg-lilac" },
  error: { label: "no signal", dot: "bg-neon", text: "text-neon" },
};

function StatusPill({ status, clipMode }) {
  const s = STATUS[status] || STATUS.idle;
  return (
    <span className="flex items-center gap-2.5">
      {clipMode && (
        <Tag tone="sky" className="h-5 gap-1 px-1.5 text-[11px]">
          <Scissors className="size-3" strokeWidth={2.4} /> clip
        </Tag>
      )}
      <span className={cn("hidden items-center gap-1.5 font-dot text-[11px] uppercase tracking-[0.18em] text-mute min-[400px]:flex", s.text)}>
        <span className={cn("size-1.5 rounded-full", s.dot)} />
        {s.label}
      </span>
    </span>
  );
}

// Viewfinder brackets in the corners of the letterbox bezel (desktop).
function Corners() {
  const base = "absolute size-3.5 border-petal/40";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
      <span className={cn(base, "top-1.5 left-1.5 rounded-tl-md border-t border-l")} />
      <span className={cn(base, "top-1.5 right-1.5 rounded-tr-md border-t border-r")} />
      <span className={cn(base, "bottom-1.5 left-1.5 rounded-bl-md border-b border-l")} />
      <span className={cn(base, "right-1.5 bottom-1.5 rounded-br-md border-r border-b")} />
    </div>
  );
}

export default function Watch() {
  const { slug } = useParams();
  const vod = findVod(slug);
  if (!vod) return <SignalLost slug={slug} />;
  // Keyed by VOD: hopping to another VOD (up next, older/newer) rebuilds the
  // player with the new source and resets every bit of page state.
  return <WatchView key={vod.id} vod={vod} slug={slug} />;
}

function WatchView({ vod, slug }) {
  const { search } = useLocation();
  const reduced = useReducedMotion();
  const clip = useMemo(() => parseClip(new URLSearchParams(search)), [search]);
  // Where playback starts, frozen at mount (clip start → ?t= → saved position in Player).
  const [startAt] = useState(() => {
    if (clip) return clip.start;
    const t = new URLSearchParams(search).get("t");
    return t !== null ? convertTimestamp(t) : 0;
  });

  const [player, setPlayer] = useState(null);
  const [time, setTime] = useState(startAt);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("idle");
  const [delay, setDelay] = useState(0);
  const [resumeAt, setResumeAt] = useState(null);
  const [muted, setMuted] = useState(false);
  const [mark, setMark] = useState({ start: null, end: null });
  const [clipTitle, setClipTitle] = useState("");
  const [hint, setHint] = useState(null);
  const [copied, copy] = useCopy();
  const glow = useAmbient(player, vod.thumbnail_url);
  const chat = useChatReplay(vod);
  const triggers = useTriggers(chat);

  const { newer, older } = useMemo(() => neighbours(vod), [vod]);
  const chapters = vod.chapters?.length ? vod.chapters : null;
  const download = driveLink(vod);
  const clipMode = clip != null;

  useEffect(() => {
    document.title = clip ? (clip.name ? `${clip.name} - Clip` : `Clip - ${vod.title}`) : `${vod.title} - VOD`;
  }, [vod.title, clip]);

  useEffect(() => {
    if (delay) console.info(`VOD delay: ${delay} seconds`);
  }, [delay]);

  useEffect(() => {
    if (resumeAt == null) return;
    const id = setTimeout(() => setResumeAt(null), 7000);
    return () => clearTimeout(id);
  }, [resumeAt]);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(id);
  }, [hint]);

  // Drop the "sound off" notice as soon as the viewer unmutes from anywhere.
  useEffect(() => {
    if (!player || !muted) return;
    const onVolume = () => {
      if (!player.muted()) setMuted(false);
    };
    player.on("volumechange", onVolume);
    return () => {
      if (!player.isDisposed()) player.off("volumechange", onVolume);
    };
  }, [player, muted]);

  // ── player wiring ──────────────────────────────────────────────────────────
  const onReady = useCallback((p) => setPlayer(p), []);
  const onTime = useCallback((t) => setTime(Math.floor(t)), []);
  const onResume = useCallback((t) => setResumeAt(t), []);
  const onAutoMuted = useCallback(() => setMuted(true), []);

  const live = player && !player.isDisposed() ? player : null;
  const nowSeconds = () => Math.floor(live ? live.currentTime() : time);

  const seek = useCallback(
    (t) => {
      if (!player || player.isDisposed()) return;
      player.currentTime(t);
      setTime(Math.floor(t));
      const p = player.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    },
    [player]
  );

  // ── actions ────────────────────────────────────────────────────────────────
  const copyTimestamp = () => {
    copy("timestamp", `${window.location.origin}${window.location.pathname}?t=${toHMS(nowSeconds())}`);
  };

  const markStart = () => {
    const t = nowSeconds();
    setMark((m) => ({ start: t, end: m.end != null && m.end > t ? m.end : null }));
    setHint(null);
  };

  const markEnd = () => {
    if (mark.start == null) return;
    const t = nowSeconds();
    if (t <= mark.start) {
      setHint("the end has to come after the start ✦");
      return;
    }
    setMark((m) => ({ ...m, end: t }));
    setHint(null);
  };

  const clearClip = () => {
    setMark({ start: null, end: null });
    setClipTitle("");
    setHint(null);
  };

  const copyClip = () => {
    if (mark.start == null || mark.end == null) return;
    const params = new URLSearchParams();
    params.set("s", toHMS(mark.start));
    params.set("e", toHMS(mark.end));
    const name = clipTitle.trim();
    if (name) params.set("n", name);
    copy("clip", `${window.location.origin}/vod/${slug}?${params.toString()}`);
  };

  const showChapters = () => {
    document.getElementById("chapters")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  };

  // ── derived ────────────────────────────────────────────────────────────────
  // Chapters live on the VOD timeline: player time + delay (as before).
  const vodTime = time + delay;
  const activeIndex = chapters ? activeChapterIndex(chapters, vodTime) : -1;
  const total = chapters ? Math.max(durationSeconds(vod), ...chapters.map((c) => c.start + c.end), 1) : 0;
  const ticks = chapters ? chapters.slice(1).map((c) => c.start) : [];
  const ranges = clip
    ? [{ start: clip.start, end: clip.end, tone: "sky" }]
    : mark.start != null
      ? [{ start: mark.start, end: mark.end ?? mark.start, tone: "petal" }]
      : [];

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative flex-1 lg:h-[calc(100dvh-var(--topbar-h))] lg:min-h-0 lg:flex-none lg:overflow-hidden">
        <div className="gutter-x flex flex-col gap-4 py-3 sm:py-4 lg:h-full lg:flex-row lg:gap-5">
          {/* ── main column ── */}
          <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1">
            <WatchHeader vod={vod} newer={newer} older={older} />
            {clip && <ClipBanner clip={clip} slug={slug} />}

            <div className="relative flex flex-col lg:min-h-0 lg:flex-1">
              {/* Ambient light spilling around the player window. */}
              <canvas
                ref={glow}
                aria-hidden="true"
                className="pointer-events-none absolute -top-4 -left-6 z-0 hidden h-[calc(100%+2rem)] w-[calc(100%+3rem)] fx-glow opacity-50 blur-[56px] saturate-[1.4] lg:block"
              />
              <Window
                title="vod_player.exe"
                icon={<MonitorPlay className="size-3.5" strokeWidth={2.4} />}
                actions={<StatusPill status={status} clipMode={clipMode} />}
                className="relative z-10 bg-panel/80 lg:min-h-0 lg:flex-1"
                bodyClassName="flex flex-col"
                aria-label="Video player"
              >
                <div className="vod-stage relative bg-void/60 lg:p-3">
                  {/* …and onto the letterbox bezel, under a fine dot screen. */}
                  <canvas ref={glow} aria-hidden="true" className="pointer-events-none absolute inset-0 hidden size-full fx-glow opacity-60 blur-[44px] saturate-[1.5] lg:block" />
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden dot-grid-fine opacity-60 lg:block" />
                  <Corners />
                  <div
                    className="vod-screen relative overflow-hidden bg-void lg:rounded-[14px] lg:shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_24px_60px_-24px_rgb(0_0_0/0.95)]"
                    style={{ viewTransitionName: "vod-media" }}
                  >
                    {/* Poster underlay: what the view-transition snapshot sees before Video.js boots. */}
                    <Thumb vod={vod} loading="eager" className="absolute inset-0" />
                    <Player
                      key={vod.id}
                      vod={vod}
                      startAt={startAt}
                      clip={clip}
                      className="absolute inset-0"
                      onReady={onReady}
                      onTime={onTime}
                      onDuration={setDuration}
                      onStatus={setStatus}
                      onDelay={setDelay}
                      onResume={onResume}
                      onAutoMuted={onAutoMuted}
                    />
                    <ScreenToasts
                      resumeAt={status === "error" ? null : resumeAt}
                      muted={muted && status !== "error"}
                      onStartOver={() => {
                        setResumeAt(null);
                        seek(0);
                      }}
                      onUnmute={() => {
                        live?.muted(false);
                        setMuted(false);
                      }}
                      onDismiss={(which) => (which === "resume" ? setResumeAt(null) : setMuted(false))}
                    />
                  </div>
                </div>

                <Deck
                  time={time}
                  duration={duration}
                  status={status}
                  chapter={chapters ? chapters[activeIndex] : null}
                  chapterIndex={activeIndex}
                  chapterCount={chapters?.length ?? 0}
                  onChapterClick={showChapters}
                  copied={copied}
                  onCopyTimestamp={copyTimestamp}
                  clipMode={clipMode}
                  mark={mark}
                  onMarkStart={markStart}
                  onMarkEnd={markEnd}
                  download={download}
                  clip={{
                    title: clipTitle,
                    onTitle: setClipTitle,
                    onCopy: copyClip,
                    copied: copied === "clip",
                    onClear: clearClip,
                    onSeek: seek,
                    hint,
                  }}
                />
              </Window>
            </div>
          </div>

          {/* ── sidebar ── */}
          <motion.div
            variants={STAGGER}
            initial="hidden"
            animate="show"
            className="watch-aside relative z-10 flex flex-col gap-4 *:shrink-0 md:grid md:grid-cols-2 md:items-start lg:flex lg:items-stretch lg:-mr-2.5 lg:w-[344px] lg:shrink-0 lg:overflow-y-auto lg:pr-2.5 lg:pb-3 xl:w-[392px] 2xl:w-[432px]"
          >
            <ChatPanel player={live} chat={chat} onSeek={seek} className="md:col-span-2" />
            <TriggerPanel triggers={triggers} time={time} onSeek={seek} className="md:col-span-2" />
            <NowPlaying vod={vod} time={time} duration={duration} status={status} chapterCount={chapters?.length ?? 0} className="md:col-span-2" />
            {chapters && (
              <ChapterList
                id="chapters"
                chapters={chapters}
                activeIndex={activeIndex}
                total={total}
                vodTime={vodTime}
                playing={status === "playing"}
                onSeek={seek}
              />
            )}
            <MoreVods vod={vod} wide={!chapters} className={chapters ? undefined : "md:col-span-2"} />
          </motion.div>
        </div>
      </main>

      <ProgressMarks player={player} duration={duration} ticks={ticks} ranges={ranges} />
    </MotionConfig>
  );
}
