import { createPortal } from "react-dom";

const pct = (t, duration) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

/**
 * Paints chapter notches and clip ranges straight onto Video.js' seek bar
 * (portalled into .vjs-progress-holder, styled in styles/player.css).
 *   ticks:  [seconds]                       → chapter boundaries
 *   ranges: [{ start, end, tone }]          → "sky" shared clip, "petal" clip in progress
 */
export default function ProgressMarks({ player, duration, ticks = [], ranges = [] }) {
  if (!player || player.isDisposed() || !(duration > 0)) return null;
  const host = player.el()?.querySelector(".vjs-progress-holder");
  if (!host) return null;

  const visibleTicks = ticks.filter((t) => t > 0 && t < duration);
  const visibleRanges = ranges.filter((r) => r.start < duration && r.start >= 0);
  if (!visibleTicks.length && !visibleRanges.length) return null;

  return createPortal(
    <div className="vjs-meo-marks" aria-hidden="true">
      {visibleRanges.map((r) => {
        const point = !(r.end > r.start);
        return (
          <span
            key={`${r.tone}-${r.start}-${r.end}`}
            className={`vjs-meo-range is-${r.tone}${point ? " is-point" : ""}`}
            style={point ? { left: pct(r.start, duration) } : { left: pct(r.start, duration), width: pct(Math.min(r.end, duration) - r.start, duration) }}
          />
        );
      })}
      {visibleTicks.map((t) => (
        <span key={t} className="vjs-meo-tick" style={{ left: pct(t, duration) }} />
      ))}
    </div>,
    host
  );
}
