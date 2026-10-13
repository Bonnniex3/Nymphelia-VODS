import { useSyncExternalStore } from "react";

// One MediaQueryList + subscribe function per query, shared by every hook instance.
const stores = new Map();

function getStore(query) {
  let store = stores.get(query);
  if (!store) {
    const mql = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
    store = {
      subscribe(onChange) {
        mql?.addEventListener("change", onChange);
        return () => mql?.removeEventListener("change", onChange);
      },
      getSnapshot: () => !!mql?.matches,
    };
    stores.set(query, store);
  }
  return store;
}

const getServerSnapshot = () => false;

/** Live `matchMedia(query).matches` (false during SSR / when matchMedia is missing). */
export function useMediaQuery(query) {
  const store = getStore(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the user asked the OS for reduced motion. */
export function usePrefersReducedMotion() {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
