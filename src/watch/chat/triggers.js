import { videoTimeOf } from "./replay";

/**
 * ASMR trigger timestamps, read from the chat replay.
 *
 * Stream bots announce each trigger as it starts; we turn those messages into a list of
 * jump-to points. Nothing is stored in the sidecar: this runs over the messages that are
 * already loaded, so it works for every chat that has ever been archived.
 *
 * Rules are matched on the chat user (case-insensitive) AND the message shape, so a viewer
 * who copies a bot line cannot add an entry. The two sites share this file, so it carries
 * the rules for both channels.
 */
export const TRIGGER_RULES = [
  {
    // Smizzles: starqueueos → Smizzles is doing "Good Boy ♡" for @viewer
    users: ["starqueueos"],
    pattern: /^Smizzles is doing "(?<name>.+)" for @(?<who>\w+)\s*$/u,
  },
  {
    // Nymphelia: LiaaBot (and its earlier name pheliabot) → 🌺 sloppy earlicks in progress~ Please mute …
    users: ["liaabot", "pheliabot"],
    pattern: /^🌺\s*(?<name>.+?)\s+in progress~/u,
  },
];

/** Max length of a trigger name we keep; longer bot text is clipped. */
export const MAX_TRIGGER_NAME = 120;
/** The same trigger announced again this soon (same viewer) is one entry. */
export const DUPLICATE_WINDOW_S = 15;
/** Seconds to rewind when jumping to a trigger, so the viewer hears it begin. */
export const SEEK_LEAD_S = 2;

const TRAILING_DECOR = /[\s~♡♥✦☆★]+$/u;

/** Tidy a bot-supplied trigger name for display; "" if nothing usable is left. */
export function cleanTriggerName(raw) {
  if (typeof raw !== "string") return "";
  const name = raw.replace(/\s+/g, " ").replace(TRAILING_DECOR, "").trim();
  return name.length > MAX_TRIGGER_NAME ? `${name.slice(0, MAX_TRIGGER_NAME - 1).trimEnd()}…` : name;
}

/** One chat message → `{ name, who }`, or null if it is not a trigger announcement. */
export function matchTrigger(message, rules = TRIGGER_RULES) {
  if (!message || typeof message.text !== "string" || typeof message.user !== "string") return null;
  const user = message.user.toLowerCase();
  for (const rule of rules) {
    if (!rule.users.includes(user)) continue;
    const match = rule.pattern.exec(message.text);
    if (!match?.groups) continue;
    const name = cleanTriggerName(match.groups.name);
    if (!name) continue;
    return { name, who: match.groups.who || null };
  }
  return null;
}

/**
 * All triggers in an offset-sorted message list, in play order:
 * `[{ id, at, name, who }]` where `at` is the video time in seconds
 * (chat time minus the chat↔video `offset`).
 */
export function extractTriggers(messages, offset = 0, rules = TRIGGER_RULES) {
  const out = [];
  if (!Array.isArray(messages)) return out;
  const lastSeen = new Map(); // "name\0who" → at of the last kept entry
  for (const message of messages) {
    const hit = matchTrigger(message, rules);
    if (!hit) continue;
    const at = videoTimeOf(message.offsetSeconds, offset);
    const key = `${hit.name.toLowerCase()}\0${(hit.who ?? "").toLowerCase()}`;
    const prev = lastSeen.get(key);
    if (prev !== undefined && at - prev < DUPLICATE_WINDOW_S) continue;
    lastSeen.set(key, at);
    out.push({ id: message.id, at, name: hit.name, who: hit.who });
  }
  return out;
}

/** Index of the trigger in effect at video time `t` (the last one at or before it), or -1. */
export function activeTriggerIndex(triggers, t) {
  if (!Number.isFinite(t)) return -1;
  let lo = 0;
  let hi = triggers.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (triggers[mid].at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Where to seek for a trigger: a short lead-in before the announcement. */
export const seekTimeOf = (trigger) => Math.max(0, trigger.at - SEEK_LEAD_S);
