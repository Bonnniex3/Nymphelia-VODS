import { useEffect, useMemo, useSyncExternalStore } from "react";
import { chatTime, countUpTo } from "./replay";

/** Subscribe to the real Video.js clock. A new store never inherits an old cursor. */
export function createChatCursorStore(player, messages, offset, onSeeked) {
  let loadingSource = false;
  const alive = () => player && !player.isDisposed();
  const getSnapshot = () => alive() && !loadingSource ? countUpTo(messages, chatTime(player.currentTime(), offset)) : 0;
  const subscribe = (notify) => {
    if (!alive() || messages.length === 0) return () => {};
    let raf = 0;
    let active = true;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const tick = () => {
      raf = 0;
      if (!active || !alive()) return;
      notify();
      if (!player.paused() && !player.ended()) raf = requestAnimationFrame(tick);
    };
    const start = () => {
      stop();
      if (!active || !alive()) return;
      notify();
      if (!player.paused() && !player.ended()) raf = requestAnimationFrame(tick);
    };
    const pause = () => { stop(); notify(); };
    const seeked = () => { notify(); onSeeked?.(); };
    const load = () => { loadingSource = true; stop(); notify(); };
    const ready = () => { loadingSource = false; start(); };
    const dispose = () => { active = false; stop(); notify(); };
    const events = [
      ["playing", start], ["play", start], ["pause", pause], ["ended", pause],
      ["seeking", notify], ["seeked", seeked], ["ratechange", notify],
      ["loadedmetadata", ready], ["timeupdate", notify], ["loadstart", load],
      ["emptied", load], ["dispose", dispose],
    ];
    for (const [name, fn] of events) player.on(name, fn);
    start();
    return () => {
      active = false;
      stop();
      if (alive()) for (const [name, fn] of events) player.off(name, fn);
    };
  };
  return { subscribe, getSnapshot, setOnSeeked: callback => { onSeeked = callback; } };
}

const serverSnapshot = () => 0;

/** Playback rate, pause and seeks all use currentTime() + offset; no second clock. */
export default function useChatCursor(player, messages, offset, onSeeked) {
  const store = useMemo(() => createChatCursorStore(player, messages, offset), [player, messages, offset]);
  useEffect(() => { store.setOnSeeked(onSeeked); }, [store, onSeeked]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
}
