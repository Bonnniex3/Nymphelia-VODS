import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatCursorStore } from "./useChatCursor";

function fakePlayer() {
  const events = new Map();
  return {
    time: 0, stopped: true, disposed: false,
    currentTime() { if (this.disposed) throw new Error("disposed clock"); return this.time; },
    paused() { if (this.disposed) throw new Error("disposed player"); return this.stopped; },
    ended: () => false,
    isDisposed() { return this.disposed; },
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    off(name, fn) { events.get(name)?.delete(fn); },
    emit(name) { for (const fn of events.get(name) || []) fn(); },
    listeners() { return [...events.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

describe("Video.js chat cursor", () => {
  let frames;
  beforeEach(() => {
    frames = new Map();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", fn => { frames.set(++id, fn); return id; });
    vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  });
  afterEach(() => vi.unstubAllGlobals());
  const messages = [0, 10, 20, 40].map(offsetSeconds => ({ offsetSeconds }));
  it("uses clock + offset on initial paused mount, play, pause, rate change and backward seek", () => {
    const player = fakePlayer();
    player.time = 10;
    const seek = vi.fn();
    const store = createChatCursorStore(player, messages, 10, seek);
    const counts = [];
    const cleanup = store.subscribe(() => counts.push(store.getSnapshot()));
    expect(counts.at(-1)).toBe(3);
    expect(frames.size).toBe(0);
    player.stopped = false;
    player.emit("play"); player.emit("playing");
    expect(frames.size).toBe(1);
    player.time = 30;
    player.emit("ratechange");
    expect(counts.at(-1)).toBe(4);
    player.stopped = true; player.emit("pause");
    expect(frames.size).toBe(0);
    player.time = 0; player.emit("seeking"); player.emit("seeked");
    expect(counts.at(-1)).toBe(2);
    expect(seek).toHaveBeenCalledOnce();
    cleanup();
    expect(player.listeners()).toBe(0);
  });
  it("clears on source change and resynchronizes from the new clock", () => {
    const player = fakePlayer(); player.time = 50;
    const store = createChatCursorStore(player, messages, 0);
    const cleanup = store.subscribe(() => {});
    expect(store.getSnapshot()).toBe(4);
    player.emit("loadstart");
    expect(store.getSnapshot()).toBe(0);
    player.time = 0; player.emit("loadedmetadata");
    expect(store.getSnapshot()).toBe(1);
    expect(createChatCursorStore(player, [{ offsetSeconds: 100 }], 0).getSnapshot()).toBe(0);
    cleanup();
  });
  it("stops animation callbacks on disposal and effect cleanup", () => {
    const player = fakePlayer(); player.stopped = false;
    const store = createChatCursorStore(player, messages, 0);
    const cleanup = store.subscribe(() => {});
    const pending = [...frames.values()][0];
    player.disposed = true; player.emit("dispose");
    expect(frames.size).toBe(0);
    expect(() => pending()).not.toThrow();
    expect(store.getSnapshot()).toBe(0);
    cleanup();
  });
});
