import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowDown, ChevronDown, Clock, Heart, MessageSquareText, RotateCw, TriangleAlert } from "lucide-react";
import { CHANNEL } from "../../lib/channel";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/Button";
import Window from "../../ui/Window";
import { clock } from "../time";
import { EYEBROW, RISE } from "../tw";
import { readableColor } from "./color";
import { TWITCH_ID } from "./config";
import { colorIndex, videoTimeOf, windowStart } from "./replay";
import { enrichFragments } from "./sevenTv";
import useChatCursor from "./useChatCursor";
import useSevenTvEmotes from "./useSevenTvEmotes";
import "./chat.css";

const EMPTY = [];
// Fallback name colours for chatters without one of their own; the dot beside the name carries the same hue.
const NAME_COLORS = ["text-petal", "text-sky", "text-blush", "text-lilac", "text-neon"];
const DOT_COLORS = ["bg-petal", "bg-sky", "bg-blush", "bg-lilac", "bg-neon"];
const OPEN_KEY = "nym-chat-open";
const TIMES_KEY = "nym-chat-times";
const AT_BOTTOM_PX = 24;
const HANDLE = CHANNEL.handle.toLowerCase();

const readFlag = (key) => {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
};
const saveFlag = (key, on) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* storage blocked: the preference is a nicety */
  }
};

// An emote that fails to load (blocked CDN, deleted emote) falls back to its readable code.
function Emote({ url, text }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span>{text}</span>;
  return (
    <img src={url} alt={text} title={text} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="mx-px inline-block h-6 w-auto align-middle" />
  );
}

// Badge images are sidecar-embedded PNG data URLs, already validated by replay.js. A badge that
// fails to decode just disappears (no alt text spilling into the line); the title is the hover label.
function Badge({ badge }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={badge.imageUrl}
      alt={badge.title}
      title={badge.title}
      width={18}
      height={18}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="mr-0.5 inline-block size-[18px] align-text-bottom"
    />
  );
}

// React text nodes only (never HTML), so a message can't inject markup.
// Emote URLs were already narrowed to plain https by the parser (Twitch) or sevenTv.js (7TV).
// 7TV words are split out here, for the rows on screen only; the stored message is untouched.
const Fragments = memo(function Fragments({ fragments, emotes }) {
  const shown = useMemo(() => enrichFragments(fragments, emotes), [fragments, emotes]);
  return shown.map((f, i) => (f.emoteUrl ? <Emote key={`${i}:${f.emoteUrl}`} url={f.emoteUrl} text={f.text} /> : <span key={i}>{f.text}</span>));
});

/**
 * One chat line. The timestamp is a seek button, drawn only on the first line of each
 * second (lines in the same second share it), which keeps the gutter calm and the tab
 * order short. Lines that mention the streamer are tinted.
 */
const Row = memo(function Row({ message, offset, onSeek, stamp, times, enter, emotes }) {
  const at = videoTimeOf(message.offsetSeconds, offset);
  const mention = message.text.toLowerCase().includes(HANDLE);
  const hue = colorIndex(message.user, NAME_COLORS.length);
  const ink = readableColor(message.color);
  return (
    <li
      className={cn(
        "flex gap-2 rounded-lg px-2.5 py-1 text-[13px] leading-snug text-cream/90 hover:bg-panel-2",
        stamp && "mt-0.5",
        mention && "border-l-2 border-l-petal bg-petal/[0.09] pl-2 hover:bg-petal/[0.14]",
        enter && "chat-in"
      )}
    >
      {times && (
        <span className="w-11 shrink-0 pt-[3px]">
          {stamp && (
            <button
              type="button"
              onClick={() => onSeek(at)}
              title="jump the video here"
              aria-label={`jump to ${clock(at)}`}
              className="rounded font-dot text-[10px] leading-none text-mute tabular-nums transition-colors hover:text-petal hover:underline focus-visible:outline-offset-2"
            >
              {clock(at)}
            </button>
          )}
        </span>
      )}
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span aria-hidden="true" className={cn("mr-1.5 inline-block size-1.5 rounded-full align-[2px]", DOT_COLORS[hue])} />
        {message.badges?.map((badge) => (
          <Badge key={`${badge.id}/${badge.version}`} badge={badge} />
        ))}
        <b className={cn("font-bold", !ink && NAME_COLORS[hue])} style={ink ? { color: ink } : undefined}>
          {message.user}
        </b>
        <span className="text-mute">: </span>
        <Fragments fragments={message.fragments} emotes={emotes} />
      </p>
    </li>
  );
});

function Note({ icon: Icon = MessageSquareText, title, children, action }) {
  return (
    <div role="status" className="grid h-full place-items-center p-5 text-center">
      <div className="flex max-w-64 flex-col items-center gap-2">
        <span className="grid size-12 place-items-center rounded-2xl border border-line-strong bg-ink/60 text-petal">
          <Icon className="size-5" strokeWidth={2.2} />
        </span>
        <p className="mt-1 text-[15px] font-bold text-cream">{title}</p>
        {children && <p className="text-[13px] leading-snug text-mute">{children}</p>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading chat" className="flex h-full flex-col justify-end gap-2.5 p-3">
      {[64, 42, 80, 30, 72, 54].map((w, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-2">
          <span className="h-2.5 w-11 shrink-0 rounded-full bg-panel-3" />
          <span className="size-1.5 shrink-0 rounded-full bg-lilac/60" />
          <span className="h-3 animate-pulse rounded-full bg-petal/20" style={{ width: `${w}%`, animationDelay: `${i * 0.15}s` }} />
        </div>
      ))}
      <p className={cn(EYEBROW, "mt-1")}>
        downloading chat<span className="animate-blink">…</span>
      </p>
    </div>
  );
}

/** The scrolling message list: newest rows, follows the live edge unless scrolled up. */
function Feed({ messages, end, offset, onSeek, times, emotes }) {
  const ref = useRef(null);
  const [follow, setFollow] = useState(true);
  const [leftAt, setLeftAt] = useState(0);
  // Rows already there when the feed mounted (first load / after a seek) don't animate in.
  const [mountEnd] = useState(end);
  const start = windowStart(end);
  const rows = messages.slice(start, end);

  // Stick to the newest row while following.
  useLayoutEffect(() => {
    const el = ref.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, end, times, emotes]);

  // Late-loading emote images can change a line's height: keep following, but never move a reader who scrolled up.
  const onImageLoad = () => {
    const el = ref.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  };

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    if (atBottom !== follow) {
      setFollow(atBottom);
      if (!atBottom) setLeftAt(end);
    }
  };

  const latest = () => {
    setFollow(true);
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  const fresh = Math.max(0, end - leftAt);

  let prevSecond = -1;
  return (
    <div className="relative h-full min-h-0">
      <ol
        ref={ref}
        onScroll={onScroll}
        onLoadCapture={onImageLoad}
        aria-label="Chat messages"
        tabIndex={0}
        className="h-full overflow-y-auto overscroll-contain p-1.5 [overflow-anchor:auto] focus-visible:outline-offset-[-3px]"
      >
        {rows.length === 0 ? (
          <li className="grid h-full place-items-center p-4 text-center">
            <span className="flex flex-col items-center gap-1.5 text-[13px] text-mute">
              <Heart className="size-4 text-petal" strokeWidth={2.2} />
              chat hasn't said anything yet
              <span className={EYEBROW}>messages appear as the stream plays</span>
            </span>
          </li>
        ) : (
          rows.map((m, i) => {
            const second = Math.floor(videoTimeOf(m.offsetSeconds, offset));
            const stamp = second !== prevSecond;
            prevSecond = second;
            const index = start + i;
            return <Row key={index} message={m} offset={offset} onSeek={onSeek} stamp={stamp} times={times} enter={index >= mountEnd} emotes={emotes} />;
          })
        )}
      </ol>
      {!follow && (
        <Button size="sm" onClick={latest} className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <ArrowDown className="size-3.5" strokeWidth={2.6} />
          {fresh > 0 ? `${fresh > 99 ? "99+" : fresh} new · latest` : "jump to latest"}
        </Button>
      )}
    </div>
  );
}

const barButton =
  "flex h-6 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-ink/60 px-2 font-dot text-[11px] text-mute transition-colors hover:border-petal/60 hover:text-petal";

/**
 * chat_replay.log: the stream's chat, in step with the video.
 *   chat: { status: none | loading | ready | error, messages, offset, error, retry }
 * The cursor reads the real Video.js clock (see useChatCursor), so pause, seeking either way,
 * playback speed and switching VODs (Watch is keyed by VOD, so a new panel starts clean) all hold.
 */
export default function ChatPanel({ player, chat, onSeek, className }) {
  const { status, messages, offset, error, retry } = chat;
  const [open, setOpen] = useState(() => readFlag(OPEN_KEY));
  const [times, setTimes] = useState(() => readFlag(TIMES_KEY));
  const [snap, setSnap] = useState(0);
  const bodyId = useId();

  // Every seek remounts the feed, which snaps it back to the live edge.
  const onSeeked = useCallback(() => setSnap((n) => n + 1), []);
  const end = useChatCursor(player, status === "ready" && open ? messages : EMPTY, offset, onSeeked);

  const toggle = () => {
    setOpen((v) => {
      saveFlag(OPEN_KEY, !v);
      return !v;
    });
  };
  const toggleTimes = () => {
    setTimes((v) => {
      saveFlag(TIMES_KEY, !v);
      return !v;
    });
  };

  // Optional extra: 7TV emotes load only once chat is on screen, and chat never waits for them.
  const emotes = useSevenTvEmotes(status === "ready" && open && messages.length > 0, TWITCH_ID);

  const empty = status === "ready" && messages.length === 0;
  const feed = status === "ready" && !empty;
  let body;
  if (status === "loading") body = <Skeleton />;
  else if (status === "error")
    body = (
      <Note
        icon={TriangleAlert}
        title="chat won't load"
        action={
          <Button size="sm" variant="ghost" onClick={retry}>
            <RotateCw className="size-3.5" strokeWidth={2.4} /> try again
          </Button>
        }
      >
        {error}
      </Note>
    );
  else if (empty) body = <Note title="chat was quiet">the archive has no messages for this stream.</Note>;
  else body = <Feed key={snap} messages={messages} end={end} offset={offset} onSeek={onSeek} times={times} emotes={emotes} />;

  // Chat only exists for streams after the cutoff; older VODs show no panel at all.
  if (status === "none") return null;

  return (
    <Window
      as={motion.section}
      variants={RISE}
      tone="sky"
      title="chat_replay.log"
      icon={<MessageSquareText className="size-3.5" strokeWidth={2.4} />}
      aria-label="Chat replay"
      actions={
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId} className={barButton}>
          <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} strokeWidth={2.6} />
          {open ? "hide" : "show"}
        </button>
      }
      className={cn(
        open && (feed || status === "loading") && "h-[clamp(18rem,55dvh,30rem)] lg:h-[clamp(20rem,62dvh,40rem)]",
        open && !(feed || status === "loading") && "h-auto min-h-48",
        className
      )}
      bodyClassName={cn("flex min-h-0 flex-1 flex-col", !open && "hidden")}
    >
      <div id={bodyId} className="min-h-0 flex-1">
        {open && body}
      </div>
      {open && feed && (
        <div className="flex shrink-0 items-center gap-3 border-t border-line px-3 py-1.5 font-dot text-[11px] text-mute">
          <span className="flex items-center gap-1.5" title="chat follows the video clock">
            <span aria-hidden="true" className="size-1.5 animate-blink rounded-full bg-petal" />
            synced
          </span>
          <span className="tabular-nums">
            {end.toLocaleString("en-US")}/{messages.length.toLocaleString("en-US")}
            <span className="sr-only"> messages shown so far</span>
          </span>
          {offset !== 0 && (
            <span className="tabular-nums">
              offset {offset > 0 ? "+" : ""}
              {offset}s
            </span>
          )}
          <button
            type="button"
            onClick={toggleTimes}
            aria-pressed={times}
            className="ml-auto flex items-center gap-1 rounded px-1 uppercase transition-colors hover:text-petal aria-pressed:text-petal"
          >
            <Clock className="size-3" strokeWidth={2.4} />
            times {times ? "on" : "off"}
          </button>
        </div>
      )}
    </Window>
  );
}
