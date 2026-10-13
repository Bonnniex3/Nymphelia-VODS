import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Play } from "lucide-react";
import PFP from "../assets/pfp.png";
import { CHANNEL } from "../lib/channel";
import KanaRain from "../fx/KanaRain";
import PfpMatrix from "../fx/PfpMatrix";
import { Button } from "../ui/Button";
import BrandIcon from "../ui/BrandIcon";
import Sparkle from "../ui/Sparkle";
import { Tag } from "../ui/Tag";
import Window from "../ui/Window";

const rise = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] } },
};

export default function HeroWindow({ className }) {
  return (
    <Window
      title="nymphelia.exe"
      className={className}
      actions={
        <span className="hidden items-center gap-1.5 font-dot text-[11px] text-mute sm:flex">
          v2.0 <span className="text-dim">✦</span> <span className="size-1.5 rounded-full bg-petal shadow-[0_0_8px_#f78fc4]" /> running
        </span>
      }
      bodyClassName="@container overflow-hidden"
    >
      {/* background: rain, fine dots, glow, the pfp as a halftone portrait */}
      <div aria-hidden="true" className="absolute inset-0">
        <KanaRain className="opacity-70 [mask-image:linear-gradient(to_left,black_25%,transparent_85%)]" />
        <div className="absolute inset-0 dot-grid-fine opacity-30" />
        <div className="absolute top-1/2 right-[-12%] aspect-square h-[130%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(247_143_196/0.22),rgb(143_122_230/0.08)_45%,transparent_68%)]" />
      </div>
      <div className="absolute top-1/2 right-[-3%] hidden aspect-square h-[min(104%,48cqw)] -translate-y-1/2 opacity-90 [mask-image:linear-gradient(to_right,transparent_2%,black_42%)] @2xl:block">
        <PfpMatrix src={PFP} className="size-full" />
      </div>

      <motion.div
        className="relative z-10 flex h-full flex-col justify-between gap-8 p-6 @lg:p-9 @4xl:p-12"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } }}
      >
        <motion.div variants={rise} className="flex flex-wrap items-center gap-2">
          <Tag tone="solid">★ vod archive</Tag>
          <Tag tone="mute">配信アーカイブ</Tag>
        </motion.div>

        <div>
          <motion.h1 variants={rise} className="relative">
            <span className="sr-only">{CHANNEL.name} VOD archive</span>
            <span
              aria-hidden="true"
              data-text={CHANNEL.name.toUpperCase()}
              className="glitch block font-display text-[clamp(2.10rem,9.64cqw,10rem)] leading-[0.8] font-black tracking-[-0.045em] holo-text text-chrome"
            >
              {CHANNEL.name.toUpperCase()}
            </span>
          </motion.h1>
          <motion.div variants={rise} className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-dot text-[clamp(1rem,2.3cqw,1.55rem)]">
            <span className="text-petal text-glow">{CHANNEL.kana}</span>
            <span className="h-px w-10 bg-petal/50" aria-hidden="true" />
            <span className="text-blush/85">{CHANNEL.tagline}</span>
            <Sparkle className="size-4 animate-twinkle text-sky" />
          </motion.div>
          <motion.p variants={rise} className="mt-5 max-w-[38ch] text-[clamp(0.95rem,1.55cqw,1.12rem)] leading-relaxed text-blush/75">
            Every stream, saved and rewatchable. Pick up right where you left off, or clip your favourite moments and share them ✂
          </motion.p>
          <motion.div variants={rise} className="mt-7 flex flex-wrap gap-3">
            <Button as={Link} to="/vods" viewTransition size="lg">
              <Play className="size-4" fill="currentColor" /> browse the archive
            </Button>
            <Button as="a" href={CHANNEL.twitch} target="_blank" rel="noopener noreferrer" variant="ghost" size="lg">
              <BrandIcon name="twitch" className="size-4" /> watch live
            </Button>
          </motion.div>
        </div>

        <motion.div variants={rise} className="flex items-center gap-4 font-dot text-[12px] text-dim">
          <span className="truncate">
            C:\{CHANNEL.name.toUpperCase()}&gt; <span className="text-petal/90">run archive.exe</span>
            <span className="animate-blink text-petal">_</span>
          </span>
          <span className="ml-auto hidden shrink-0 @xl:inline">SYS ♡ OK</span>
        </motion.div>
      </motion.div>
    </Window>
  );
}
