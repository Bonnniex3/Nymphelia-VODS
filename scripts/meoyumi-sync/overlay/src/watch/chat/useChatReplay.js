import { useCallback, useEffect, useState } from "react";
import { MAX_MESSAGES, parseChatReplay, resolveOffset, safeChatUrl } from "./replay";

export const MAX_BYTES = 60 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const NONE = { status: "none", messages: [], offset: 0, error: null };

/** Count decoded response bytes too: Content-Length may be absent or compressed. */
export async function readChatResponse(res, maxBytes = MAX_BYTES) {
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error("chat archive is too large");
  }
  if (!res.body) throw new Error("chat archive has no response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("chat archive is too large");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(parts.join("")); }
  catch { throw new Error("chat archive is not valid JSON"); }
}

/** A truncated archive would replay silently incomplete, so it is refused with an explicit error. */
export function acceptChatReplay(doc, expect) {
  const parsed = parseChatReplay(doc, expect);
  if (!parsed.ok) throw new Error(parsed.message);
  if (parsed.replay.truncated) throw new Error(`chat archive has more than ${MAX_MESSAGES.toLocaleString("en-US")} messages and cannot be replayed completely`);
  return parsed.replay;
}

/**
 * Loads the chat sidecar for a VOD (`vod.chat = { url, offsetSeconds }`, written by
 * scripts/fetch-vods.js). Status: none | loading | ready | error. `retry()` refetches.
 * Results are keyed by (url, attempt), so switching VODs or retrying shows "loading"
 * immediately without any synchronous setState.
 */
export default function useChatReplay(vod) {
  const chat = vod.chat;
  const url = chat ? safeChatUrl(chat.url, typeof window === "undefined" ? undefined : window.location.href) : null;
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState(null);
  const fileName = vod.file_name;
  const twitchVodId = chat?.twitchVodId ?? null;
  const manifestOffset = resolveOffset(chat, null);
  const hasManifestOffset = typeof chat?.offsetSeconds === "number" && Number.isFinite(chat.offsetSeconds);
  const key = JSON.stringify([url, fileName, twitchVodId, hasManifestOffset ? manifestOffset : null, attempt]);

  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    const finish = (result) => {
      if (!ctrl.signal.aborted) setDone({ key, ...result });
    };
    const timer = setTimeout(() => {
      finish({ ...NONE, status: "error", error: "chat archive request timed out; try again" });
      ctrl.abort();
    }, REQUEST_TIMEOUT_MS);
    (async () => {
      try {
        if (!fileName) throw new Error("video has no exact file name for chat matching");
        const res = await fetch(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-cache", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`chat archive returned HTTP ${res.status}`);
        const doc = await readChatResponse(res);
        const replay = acceptChatReplay(doc, { videoFile: fileName, twitchVodId });
        finish({ status: "ready", messages: replay.messages, offset: hasManifestOffset ? manifestOffset : resolveOffset(null, replay.offsetSeconds), error: null });
      } catch (e) {
        if (e?.name === "AbortError") return;
        finish({ status: "error", messages: [], offset: 0, error: e instanceof Error ? e.message : "could not load chat" });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [url, key, fileName, twitchVodId, hasManifestOffset, manifestOffset]);

  const retry = useCallback(() => setAttempt((n) => n + 1), [setAttempt]);

  if (!chat) return { ...NONE, retry };
  if (!url) return { ...NONE, status: "error", error: "chat archive link is not valid", retry };
  if (done?.key !== key) return { ...NONE, status: "loading", retry };
  return { status: done.status, messages: done.messages, offset: done.offset, error: done.error, retry };
}
