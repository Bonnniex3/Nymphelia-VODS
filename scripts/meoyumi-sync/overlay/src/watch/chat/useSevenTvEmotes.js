import { useEffect, useState } from "react";
import { NO_EMOTES, normalizeChannelId, sevenTv, watchSevenTv } from "./sevenTv";

/**
 * The current 7TV emotes (global + the channel's) as a `Map<word, imageUrl>`.
 * Pure enrichment: it starts as the shared empty map, never throws, and stays empty if 7TV
 * is down, slow or sends garbage, so chat replay never depends on it. `enabled` gates the
 * request (nothing is fetched until the chat is actually shown). The map keeps its identity
 * until a different one arrives, which keeps memoised chat rows memoised.
 * Results are keyed by channel, and a response for a channel we've left is discarded.
 */
export default function useSevenTvEmotes(enabled, channelId) {
  const id = normalizeChannelId(channelId);
  const key = id || "global";
  const [done, setDone] = useState(null);

  useEffect(() => {
    // A fresh cache hit resolves at once with the very map render already used (same identity).
    if (!enabled) return;
    return watchSevenTv(id, (emotes) => setDone({ key, emotes }));
  }, [enabled, id, key]);

  if (!enabled) return NO_EMOTES;
  return done?.key === key ? done.emotes : (sevenTv.peek(id) ?? NO_EMOTES);
}
