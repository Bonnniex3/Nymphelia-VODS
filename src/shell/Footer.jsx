import { Link } from "react-router-dom";
import { ArrowUp } from "lucide-react";
import PFP from "../assets/pfp.png";
import { CHANNEL, CREDITS, SOCIALS } from "../lib/channel";
import DotMatrix from "../fx/DotMatrix";
import BrandIcon from "../ui/BrandIcon";

function Col({ title, children }) {
  return (
    <div>
      <h2 className="mb-4 font-dot text-[11px] tracking-[0.3em] text-dim uppercase">// {title}</h2>
      <ul className="flex flex-col gap-2.5 text-sm">{children}</ul>
    </div>
  );
}

const linkCls = "inline-flex items-center gap-2 text-blush/75 transition-colors hover:text-petal";

export default function Footer() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-line bg-ink/70">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 halftone-fade opacity-25" />
      <div className="gutter-x relative pt-14 pb-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1.2fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <img src={PFP} alt="" className="size-12 rounded-full border-2 border-petal/60 shadow-[0_0_24px_rgb(247_143_196/0.4)]" />
              <div className="leading-tight">
                <div className="font-display text-xl font-bold lowercase">
                  {CHANNEL.name}
                  <span className="font-dot text-sm font-normal text-petal">.exe</span>
                </div>
                <div className="font-dot text-xs text-mute">{CHANNEL.kana} ✦ vod archive</div>
              </div>
            </div>
            <p className="mt-5 max-w-[44ch] text-sm leading-relaxed text-mute">
              An unofficial, fan-made archive of {CHANNEL.name}&apos;s streams. Not affiliated with {CHANNEL.name} — all VODs and likeness belong to her.
            </p>
          </div>
          <Col title="navigate">
            <li>
              <Link to="/" viewTransition className={linkCls}>
                home
              </Link>
            </li>
            <li>
              <Link to="/vods" viewTransition className={linkCls}>
                archive
              </Link>
            </li>
            <li>
              <a href={CHANNEL.twitch} target="_blank" rel="noopener noreferrer" className={linkCls}>
                watch live ↗
              </a>
            </li>
          </Col>
          <Col title="socials">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {SOCIALS.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                    <BrandIcon name={s.key} className="size-4" /> {s.label}
                  </a>
                </li>
              ))}
            </div>
          </Col>
          <Col title="credits">
            <li className="text-mute">
              site by{" "}
              <a href={CREDITS.maintainer.url} target="_blank" rel="noopener noreferrer" className="text-blush/85 hover:text-petal">
                {CREDITS.maintainer.name}
              </a>
            </li>
            {CREDITS.artist && (
              <li className="text-mute">
                art by{" "}
                <a href={CREDITS.artist.url} target="_blank" rel="noopener noreferrer" className="text-blush/85 hover:text-petal">
                  {CREDITS.artist.name}
                </a>
              </li>
            )}
            <li className="text-mute">
              videos via{" "}
              <a href="https://archive.org" target="_blank" rel="noopener noreferrer" className="text-blush/85 hover:text-petal">
                Internet Archive
              </a>
            </li>
          </Col>
        </div>

        <div className="mt-14">
          <DotMatrix text={CHANNEL.name} mode="fit" ariaLabel={CHANNEL.name} />
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-line pt-5 font-dot text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {CHANNEL.name} ✦ made with <span className="text-petal">♡</span> by {CREDITS.maintainer.name}
          </span>
          <span className="hidden md:inline">
            C:\{CHANNEL.name.toUpperCase()}\ARCHIVE&gt; stay cozy<span className="animate-blink">_</span>
          </span>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="inline-flex items-center gap-1.5 self-start text-mute transition-colors hover:text-petal sm:self-auto"
          >
            back to top <ArrowUp className="size-3.5" />
          </button>
        </div>
      </div>
    </footer>
  );
}
