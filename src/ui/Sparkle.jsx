import { cn } from "../lib/cn";

// Concave four-point star — the site's signature ornament.
export default function Sparkle({ className, title, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("inline-block shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      <path d="M12 0c.7 6.6 4.8 10.9 12 12-7.2 1.1-11.3 5.4-12 12-.7-6.6-4.8-10.9-12-12C7.2 10.9 11.3 6.6 12 0Z" />
    </svg>
  );
}
