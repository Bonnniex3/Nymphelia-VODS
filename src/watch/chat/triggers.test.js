import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_S,
  MAX_TRIGGER_NAME,
  SEEK_LEAD_S,
  activeTriggerIndex,
  cleanTriggerName,
  extractTriggers,
  matchTrigger,
  seekTimeOf,
} from "./triggers";

const msg = (offsetSeconds, user, text, id = `${user}-${offsetSeconds}`) => ({ id, offsetSeconds, user, text });
const TAIL = "Please mute if it makes you uncomfortable! ✦ Redeems are currently paused~ 🌺";

describe("matchTrigger", () => {
  it("reads a Smizzles starqueueos announcement", () => {
    expect(matchTrigger(msg(1, "starqueueos", 'Smizzles is doing "Good Boy ♡" for @cap_silver05'))).toEqual({ name: "Good Boy", who: "cap_silver05" });
    expect(matchTrigger(msg(1, "starqueueos", 'Smizzles is doing "No Talking (3 mins) ♡" for @Sihso'))).toEqual({ name: "No Talking (3 mins)", who: "Sihso" });
    expect(matchTrigger(msg(1, "StarQueueOS", 'Smizzles is doing "brain tickles" for @Ikkaros007'))?.name).toBe("brain tickles");
  });

  it("reads a Nymphelia LiaaBot / pheliabot announcement", () => {
    expect(matchTrigger(msg(1, "LiaaBot", `🌺 wet wipe ear rubs in progress~ ${TAIL}`))).toEqual({ name: "wet wipe ear rubs", who: null });
    expect(matchTrigger(msg(1, "LiaaBot", `🌺 Ear Eating Kisses~ in progress~ ${TAIL}`))?.name).toBe("Ear Eating Kisses");
    expect(matchTrigger(msg(1, "pheliabot", `🌺  sloppy earlicks in progress~  ${TAIL}`))?.name).toBe("sloppy earlicks");
    expect(matchTrigger(msg(1, "LiaaBot", `🌺 deep breathing for two minutes! in progress~ ${TAIL}`))?.name).toBe("deep breathing for two minutes!");
  });

  it("reads a Kukuroneko kunekobot announcement", () => {
    expect(matchTrigger(msg(1, "kunekobot", "♡ ear licks is in progress for @LuisAguilar heart"))).toEqual({ name: "ear licks", who: "LuisAguilar" });
    expect(matchTrigger(msg(1, "KunekoBot", "♡ fizzy lotion :)) is in progress for @ginsho_ heart"))).toEqual({ name: "fizzy lotion :))", who: "ginsho_" });
    expect(matchTrigger(msg(1, "kunekobot", "♡ Quack Quack is in progress for @pemgwim"))?.name).toBe("Quack Quack");
    // the earlier wording, without the leading heart
    expect(matchTrigger(msg(1, "kunekobot", "ear blowing is in progress for @gossbae ♡"))).toEqual({ name: "ear blowing", who: "gossbae" });
    expect(matchTrigger(msg(1, "kunekobot", "your choice / fave is in progress for @ColdNicoo ♡"))?.name).toBe("your choice / fave");
    expect(matchTrigger(msg(1, "kunekobot", "♡ positive affirmations https://x.co/a is in progress for @ChiefChud heart"))?.name).toBe("positive affirmations https://x.co/a");
  });

  it("ignores other bot chatter", () => {
    expect(matchTrigger(msg(1, "kunekobot", '@ginsho_ Your trigger "fizzy lotion" is in the queue at #2. You have 3 points left! heart'))).toBeNull();
    expect(matchTrigger(msg(1, "kunekobot", "@egelpom Thank you for the sub ♡ Feel free to use your points to redeem a trigger ♡ Type !redeem <trigger> to use one. heart"))).toBeNull();
    expect(matchTrigger(msg(1, "LiaaBot", "nympheliaDinkdonk Redeems are now open nympheliaKissu Enjoy your shopping at Lia inc"))).toBeNull();
    expect(matchTrigger(msg(1, "LiaaBot", "@viewer Added Reverse kisses to the queue for 5 points!"))).toBeNull();
    expect(matchTrigger(msg(1, "starqueueos", '@viewer Your trigger "negative affirmations" is in the queue at #2. You have 3 points left.'))).toBeNull();
    expect(matchTrigger(msg(1, "StreamElements", 'Smizzles is doing "Good Boy" for @x'))).toBeNull();
  });

  it("does not let a viewer fake an entry", () => {
    expect(matchTrigger(msg(1, "viewer123", 'Smizzles is doing "Good Boy ♡" for @someone'))).toBeNull();
    expect(matchTrigger(msg(1, "viewer123", `🌺 free money in progress~ ${TAIL}`))).toBeNull();
    expect(matchTrigger(msg(1, "viewer123", "♡ free money is in progress for @someone heart"))).toBeNull();
  });

  it("is safe on malformed input", () => {
    expect(matchTrigger(null)).toBeNull();
    expect(matchTrigger({})).toBeNull();
    expect(matchTrigger({ user: "liaabot", text: 5 })).toBeNull();
    expect(matchTrigger(msg(1, "liaabot", "🌺  in progress~"))).toBeNull();
  });
});

describe("cleanTriggerName", () => {
  it("trims decoration and whitespace", () => {
    expect(cleanTriggerName("  mouth pops~  ")).toBe("mouth pops");
    expect(cleanTriggerName("Loser ♡ ")).toBe("Loser");
    expect(cleanTriggerName("a   b")).toBe("a b");
  });
  it("clips very long names", () => {
    const out = cleanTriggerName("x".repeat(500));
    expect(out.length).toBe(MAX_TRIGGER_NAME);
    expect(out.endsWith("…")).toBe(true);
  });
  it("rejects non-strings", () => {
    expect(cleanTriggerName(undefined)).toBe("");
  });
});

describe("extractTriggers", () => {
  it("returns triggers in order, in video time (chat time minus offset)", () => {
    const messages = [
      msg(10, "viewer", "hi"),
      msg(130, "starqueueos", 'Smizzles is doing "Loser ♡" for @a'),
      msg(400, "starqueueos", 'Smizzles is doing "Good Boy ♡" for @b'),
    ];
    expect(extractTriggers(messages, 30).map((t) => [t.at, t.name, t.who])).toEqual([[100, "Loser", "a"], [370, "Good Boy", "b"]]);
  });

  it("never goes negative when the offset exceeds the message time", () => {
    expect(extractTriggers([msg(5, "liaabot", `🌺 x in progress~ ${TAIL}`)], 60)[0].at).toBe(0);
  });

  it("collapses a double-post of the same trigger for the same viewer", () => {
    const messages = [
      msg(100, "starqueueos", 'Smizzles is doing "Loser ♡" for @a'),
      msg(100 + DUPLICATE_WINDOW_S - 1, "starqueueos", 'Smizzles is doing "Loser ♡" for @a'),
      msg(100 + DUPLICATE_WINDOW_S, "starqueueos", 'Smizzles is doing "Loser ♡" for @a'),
    ];
    expect(extractTriggers(messages).map((t) => t.at)).toEqual([100, 100 + DUPLICATE_WINDOW_S]);
  });

  it("keeps the same trigger for different viewers", () => {
    const messages = [
      msg(100, "starqueueos", 'Smizzles is doing "Loser ♡" for @a'),
      msg(101, "starqueueos", 'Smizzles is doing "Loser ♡" for @b'),
    ];
    expect(extractTriggers(messages)).toHaveLength(2);
  });

  it("collapses Nymphelia repeats, which have no viewer, by name", () => {
    const messages = [
      msg(100, "LiaaBot", `🌺 water spray in progress~ ${TAIL}`),
      msg(104, "pheliabot", `🌺  Water Spray in progress~  ${TAIL}`),
      msg(900, "LiaaBot", `🌺 water spray in progress~ ${TAIL}`),
    ];
    expect(extractTriggers(messages).map((t) => t.at)).toEqual([100, 900]);
  });

  it("handles empty and invalid input", () => {
    expect(extractTriggers([])).toEqual([]);
    expect(extractTriggers(undefined)).toEqual([]);
    expect(extractTriggers([null, {}, msg(1, "viewer", "hi")])).toEqual([]);
  });
});

describe("activeTriggerIndex", () => {
  const triggers = [{ at: 100 }, { at: 200 }, { at: 300 }];
  it("finds the last trigger at or before the time", () => {
    expect(activeTriggerIndex(triggers, 0)).toBe(-1);
    expect(activeTriggerIndex(triggers, 99.9)).toBe(-1);
    expect(activeTriggerIndex(triggers, 100)).toBe(0);
    expect(activeTriggerIndex(triggers, 250)).toBe(1);
    expect(activeTriggerIndex(triggers, 9999)).toBe(2);
  });
  it("copes with an empty list or a bad time", () => {
    expect(activeTriggerIndex([], 50)).toBe(-1);
    expect(activeTriggerIndex(triggers, NaN)).toBe(-1);
  });
});

describe("seekTimeOf", () => {
  it("rewinds a little and stays at zero or above", () => {
    expect(seekTimeOf({ at: 100 })).toBe(100 - SEEK_LEAD_S);
    expect(seekTimeOf({ at: 1 })).toBe(0);
  });
});
