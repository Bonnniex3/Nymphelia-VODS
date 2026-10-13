import { siDiscord, siInstagram, siTiktok, siTwitch, siX, siYoutube } from "simple-icons";
import { cn } from "../lib/cn";

const BRANDS = {
  twitch: siTwitch,
  youtube: siYoutube,
  x: siX,
  tiktok: siTiktok,
  instagram: siInstagram,
  discord: siDiscord,
};

export default function BrandIcon({ name, className, title }) {
  const icon = BRANDS[name];
  if (!icon) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("inline-block size-5 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={icon.path} />
    </svg>
  );
}
