/**
 * Report whether an effect should be animating: element near the viewport (IntersectionObserver),
 * tab visible, and optionally nothing in fullscreen (so the video player gets the GPU).
 * Calls `onChange(active)` only when the combined state flips. Returns a cleanup function.
 *
 * Pass `el = null` for fixed, always-on-screen layers (e.g. the page background).
 */
export function watchActivity(el, onChange, { rootMargin = "120px", pauseInFullscreen = false } = {}) {
  const hasIO = typeof IntersectionObserver !== "undefined";
  let inView = !el || !hasIO; // IO reports asynchronously; assume offscreen until it does
  let visible = !document.hidden;
  let notFullscreen = true;
  let current = null;

  const emit = () => {
    const active = inView && visible && notFullscreen;
    if (active !== current) {
      current = active;
      onChange(active);
    }
  };

  let io = null;
  if (el && hasIO) {
    io = new IntersectionObserver(
      (entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        emit();
      },
      { rootMargin },
    );
    io.observe(el);
  }

  const onVisibility = () => {
    visible = !document.hidden;
    emit();
  };
  const onFullscreen = () => {
    notFullscreen = !document.fullscreenElement;
    emit();
  };

  document.addEventListener("visibilitychange", onVisibility);
  if (pauseInFullscreen) {
    document.addEventListener("fullscreenchange", onFullscreen);
    notFullscreen = !document.fullscreenElement;
  }
  emit();

  return () => {
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("fullscreenchange", onFullscreen);
  };
}
