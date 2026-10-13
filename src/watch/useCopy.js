import { useCallback, useEffect, useRef, useState } from "react";

function legacyCopy(text) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Clipboard helper with a short-lived "copied" flag.
 *   const [copied, copy] = useCopy();
 *   copy("timestamp", url)  →  copied === "timestamp" for ~1.5s
 */
export default function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(null);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (key, text) => {
      let ok;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = legacyCopy(text);
      }
      if (!ok) return false;
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), resetMs);
      return true;
    },
    [resetMs]
  );

  return [copied, copy];
}
