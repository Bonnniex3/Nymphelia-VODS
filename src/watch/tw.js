// Shared class strings for the watch page.

// Small dot-matrix eyebrow label.
export const EYEBROW = "font-dot text-[10.5px] uppercase tracking-[0.22em] text-mute";

// Motion: sidebar windows rise in one after another.
export const EASE = [0.2, 0.8, 0.2, 1];
export const STAGGER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
};
export const RISE = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
