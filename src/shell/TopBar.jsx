import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Archive, House, Menu, Radio, X } from "lucide-react";
import PFP from "../assets/pfp.png";
import { CHANNEL, SOCIALS } from "../lib/channel";
import { useNow } from "../lib/hooks";
import { cn } from "../lib/cn";
import BrandIcon from "../ui/BrandIcon";
import Sparkle from "../ui/Sparkle";

const NAV = [
  { to: "/", label: "home", icon: House, end: true },
  { to: "/vods", label: "archive", icon: Archive },
];

function Clock({ compact = false }) {
  const now = useNow(1000);
  const parts = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "2-digit", month: "short" }).format(now);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-ink/70 px-3 py-1.5" title={now.toLocaleString()}>
      {!compact && <span className="hidden font-dot text-[11px] uppercase tracking-wider text-mute 2xl:inline">{date}</span>}
      <time dateTime={now.toISOString()} className="font-dot text-[15px] tabular-nums text-petal text-glow">
        {parts.map((p, i) =>
          p.type === "literal" && p.value.includes(":") ? (
            <span key={i} className="animate-blink">
              :
            </span>
          ) : (
            <span key={i}>{p.value}</span>
          )
        )}
      </time>
    </div>
  );
}

function StartButton() {
  return (
    <Link to="/" viewTransition className="group flex shrink-0 items-center gap-2.5 rounded-xl pr-2" aria-label={`${CHANNEL.name} VODs home`}>
      <span className="relative grid size-9 place-items-center">
        <span className="absolute inset-0 animate-spin-slow rounded-full holo-bg opacity-90 [background-image:conic-gradient(from_0deg,#f78fc4,#c3a6ff,#8f7ae6,#ff6fb5,#f78fc4)]" />
        <img src={PFP} alt="" className="relative size-[30px] rounded-full border-2 border-void" />
        <Sparkle className="absolute -top-1 -right-1 size-3 animate-twinkle text-cream" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[15px] font-bold tracking-tight text-cream lowercase transition-colors group-hover:text-petal">
          {CHANNEL.name}
        </span>
        <span className="mt-1 font-dot text-[10px] tracking-[0.2em] text-mute">VOD.ARCHIVE</span>
      </span>
    </Link>
  );
}

function NavTabs({ onNavigate, vertical = false }) {
  return (
    <nav aria-label="Main" className={cn("flex gap-1", vertical && "flex-col gap-2")}>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          viewTransition
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "relative flex items-center gap-2 rounded-xl font-dot tracking-wide transition-colors",
              vertical ? "h-14 px-4 text-xl" : "h-9 px-3.5 text-[14px]",
              isActive
                ? "bg-petal/[0.12] text-petal shadow-[inset_0_0_0_1px_rgb(247_143_196/0.35),0_0_20px_-6px_rgb(247_143_196/0.6)]"
                : "text-blush/75 hover:bg-panel-2 hover:text-cream"
            )
          }
        >
          <Icon className={vertical ? "size-5" : "size-4"} strokeWidth={2.2} />
          {label}
        </NavLink>
      ))}
      <a
        href={CHANNEL.twitch}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex items-center gap-2 rounded-xl font-dot tracking-wide text-blush/75 transition-colors hover:bg-panel-2 hover:text-sky",
          vertical ? "h-14 px-4 text-xl" : "h-9 px-3.5 text-[14px]"
        )}
      >
        <Radio className={vertical ? "size-5" : "size-4"} strokeWidth={2.2} />
        live ↗
      </a>
    </nav>
  );
}

export default function TopBar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const [menuPath, setMenuPath] = useState(pathname);

  // Close the mobile menu whenever the route changes (incl. back/forward).
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-40 h-[var(--topbar-h)] shrink-0 border-b border-line bg-void/75 backdrop-blur-md">
        <div className="gutter-x flex h-full items-center gap-3 md:gap-5">
          <StartButton />
          <span className="hidden h-6 w-px bg-line-strong md:block" aria-hidden="true" />
          <div className="hidden md:block">
            <NavTabs />
          </div>

          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <ul className="hidden items-center gap-0.5 lg:flex" aria-label="Socials">
              {SOCIALS.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    title={s.label}
                    className="grid size-9 place-items-center rounded-lg text-blush/60 transition-all hover:-translate-y-0.5 hover:bg-panel-2 hover:text-petal"
                  >
                    <BrandIcon name={s.key} className="size-[17px]" />
                  </a>
                </li>
              ))}
            </ul>
            <Clock compact />
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              className="grid size-10 place-items-center rounded-xl border border-line-strong bg-ink/70 text-petal md:hidden"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            key="sheet"
            className="fixed inset-0 z-50 flex flex-col bg-void/95 backdrop-blur-xl md:hidden"
            initial={{ opacity: 0, clipPath: "circle(0% at 100% 0%)" }}
            animate={{ opacity: 1, clipPath: "circle(150% at 100% 0%)" }}
            exit={{ opacity: 0, clipPath: "circle(0% at 100% 0%)" }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="gutter-x flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-line">
              <StartButton />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-10 place-items-center rounded-xl border border-line-strong bg-ink/70 text-petal"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="gutter-x flex flex-1 flex-col gap-8 overflow-y-auto py-8">
              <div className="font-dot text-xs tracking-[0.3em] text-mute">// NAVIGATE</div>
              <NavTabs vertical onNavigate={() => setOpen(false)} />
              <div className="font-dot text-xs tracking-[0.3em] text-mute">// SOCIALS</div>
              <ul className="grid grid-cols-3 gap-2">
                {SOCIALS.map((s) => (
                  <li key={s.key}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-panel text-blush/85 transition-colors hover:border-petal/60 hover:text-petal"
                    >
                      <BrandIcon name={s.key} className="size-6" />
                      <span className="font-dot text-xs">{s.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-auto font-dot text-xs text-dim">{CHANNEL.kana} ✦ every stream, archived ♡</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
