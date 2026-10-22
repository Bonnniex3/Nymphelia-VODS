import { describe, expect, it } from "vitest";
import {
  MAX_BADGE_BYTES,
  MAX_BADGE_CATALOG,
  MAX_BADGE_TITLE,
  MAX_BADGE_TOTAL_BYTES,
  MAX_FRAGMENTS,
  MAX_MESSAGE_BADGES,
  MAX_MESSAGES,
  MAX_ROWS,
  MAX_TEXT,
  badgeImageSize,
  chatTime,
  cleanText,
  colorIndex,
  countUpTo,
  normalizeMessage,
  parseBadgeCatalog,
  parseChatReplay,
  resolveOffset,
  safeChatUrl,
  safeColor,
  safeHttpsUrl,
  videoTimeOf,
  windowStart,
} from "./replay";

const FILE = "nymphelia - 2026-08-30 - hi - [319039882455].mp4";
const doc = (over = {}) => ({ version: 1, twitchVodId: "319039882455", videoFile: FILE, offsetSeconds: 0, messages: [], ...over });
const msg = (offsetSeconds, over = {}) => ({ id: `m${offsetSeconds}`, offsetSeconds, user: "mimi", text: "hi", fragments: [{ text: "hi" }], ...over });

describe("countUpTo (binary search)", () => {
  const list = [1, 1, 2, 5, 5, 5, 9].map((offsetSeconds) => ({ offsetSeconds }));

  it("counts messages at or before t", () => {
    expect(countUpTo(list, 0.99)).toBe(0);
    expect(countUpTo(list, 1)).toBe(2);
    expect(countUpTo(list, 4.9)).toBe(3);
    expect(countUpTo(list, 5)).toBe(6);
    expect(countUpTo(list, 9)).toBe(7);
    expect(countUpTo(list, 1e9)).toBe(7);
  });

  it("handles empty lists, negative times and bad input", () => {
    expect(countUpTo([], 5)).toBe(0);
    expect(countUpTo(list, -10)).toBe(0);
    expect(countUpTo(list, NaN)).toBe(0);
    expect(countUpTo(list, Infinity)).toBe(0);
  });

  it("agrees with a linear scan", () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ offsetSeconds: Math.floor(i / 3) * 1.5 }));
    for (let t = -2; t < 260; t += 0.7) expect(countUpTo(big, t)).toBe(big.filter((m) => m.offsetSeconds <= t).length);
  });
});

describe("time mapping", () => {
  it("is explicitly videoTime + offset", () => {
    expect(chatTime(100, 0)).toBe(100);
    expect(chatTime(100, 12.5)).toBe(112.5);
    expect(chatTime(100, -30)).toBe(70);
  });

  it("inverts for seeking, never below zero", () => {
    expect(videoTimeOf(112.5, 12.5)).toBe(100);
    expect(videoTimeOf(5, 12)).toBe(0);
  });

  it("windows the newest rows", () => {
    expect(windowStart(50)).toBe(0);
    expect(windowStart(MAX_ROWS)).toBe(0);
    expect(windowStart(MAX_ROWS + 30)).toBe(30);
    expect(windowStart(10, 4)).toBe(6);
  });
});

describe("resolveOffset", () => {
  it("manifest wins, then the sidecar, then 0", () => {
    expect(resolveOffset({ offsetSeconds: 7 }, 3)).toBe(7);
    expect(resolveOffset({ offsetSeconds: 0 }, 3)).toBe(0);
    expect(resolveOffset({}, 3)).toBe(3);
    expect(resolveOffset({ url: "x" }, null)).toBe(0);
    expect(resolveOffset(undefined, undefined)).toBe(0);
    expect(resolveOffset({ offsetSeconds: -4.5 }, 3)).toBe(-4.5);
  });

  it("ignores non-numeric offsets", () => {
    expect(resolveOffset({ offsetSeconds: "7" }, 3)).toBe(3);
    expect(resolveOffset({ offsetSeconds: NaN }, "9")).toBe(0);
  });
});

describe("parseChatReplay", () => {
  it("accepts a valid sidecar", () => {
    const r = parseChatReplay(doc({ offsetSeconds: 2, messages: [msg(1), msg(2)] }), { videoFile: FILE });
    expect(r.ok).toBe(true);
    expect(r.replay.messages).toHaveLength(2);
    expect(r.replay.offsetSeconds).toBe(2);
    expect(r.replay.twitchVodId).toBe("319039882455");
  });

  it("reports an absent offset as null", () => {
    const withoutOffset = doc({ messages: [msg(1)] });
    delete withoutOffset.offsetSeconds;
    expect(parseChatReplay(withoutOffset).replay.offsetSeconds).toBeNull();
  });

  it("refuses unusable documents", () => {
    expect(parseChatReplay(null).code).toBe("invalid");
    expect(parseChatReplay([]).code).toBe("invalid");
    expect(parseChatReplay(doc({ version: 2 })).code).toBe("version");
    expect(parseChatReplay(doc({ version: undefined })).code).toBe("version");
    expect(parseChatReplay(doc({ videoFile: "" })).code).toBe("invalid");
    expect(parseChatReplay(doc({ messages: {} })).code).toBe("invalid");
  });

  it("refuses a sidecar written for a different video", () => {
    expect(parseChatReplay(doc(), { videoFile: "other.mp4" })).toMatchObject({ ok: false, code: "mismatch" });
    expect(parseChatReplay(doc()).ok).toBe(true);
  });

  it("sorts out-of-order messages (stable) so binary search is valid", () => {
    const r = parseChatReplay(doc({ messages: [msg(5, { id: "a" }), msg(1, { id: "b" }), msg(5, { id: "c" }), msg(3, { id: "d" })] }));
    expect(r.replay.messages.map((m) => m.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("drops broken messages and counts them", () => {
    const r = parseChatReplay(
      doc({ messages: [msg(1), null, "x", { user: "a", text: "t" }, { offsetSeconds: "3", user: "a", text: "t" }, { offsetSeconds: NaN, user: "a" }, { offsetSeconds: 4 }, msg(6)] })
    );
    expect(r.replay.messages.map((m) => m.offsetSeconds)).toEqual([1, 6]);
    expect(r.replay.dropped).toBe(6);
  });

  it("caps the number of messages", () => {
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({ offsetSeconds: i, user: "u", text: "t" }));
    const r = parseChatReplay(doc({ messages: many }));
    expect(r.replay.messages).toHaveLength(MAX_MESSAGES);
    expect(r.replay.truncated).toBe(true);
  });
});

describe("normalizeMessage", () => {
  it("fills in id, user and fragments", () => {
    expect(normalizeMessage({ offsetSeconds: 3, text: "hello" }, 7)).toEqual({ id: "7", offsetSeconds: 3, user: "anon", text: "hello", fragments: [{ text: "hello" }] });
  });

  it("derives text from fragments", () => {
    const m = normalizeMessage({ offsetSeconds: 1, user: "a", fragments: [{ text: "hi " }, { text: "Kappa", emoteUrl: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0" }] }, 0);
    expect(m.text).toBe("hi Kappa");
    expect(m.fragments).toHaveLength(2);
  });

  it("keeps only https emote urls", () => {
    const m = normalizeMessage(
      {
        offsetSeconds: 1,
        user: "a",
        text: "x",
        fragments: [
          { text: "ok", emoteUrl: "https://static-cdn.jtvnw.net/e.png" },
          { text: "http", emoteUrl: "http://static-cdn.jtvnw.net/e.png" },
          { text: "js", emoteUrl: "javascript:alert(1)" },
          { text: "data", emoteUrl: "data:image/png;base64,AAAA" },
          { text: "creds", emoteUrl: "https://u:p@evil.test/e.png" },
          { text: "rel", emoteUrl: "/e.png" },
          { text: "num", emoteUrl: 5 },
        ],
      },
      0
    );
    expect(m.fragments.map((f) => Boolean(f.emoteUrl))).toEqual([true, false, false, false, false, false, false]);
    expect(m.fragments.map((f) => f.text)).toEqual(["ok", "http", "js", "data", "creds", "rel", "num"]);
  });

  it("limits fragments and text", () => {
    const frags = Array.from({ length: MAX_FRAGMENTS + 50 }, () => ({ text: "a" }));
    expect(normalizeMessage({ offsetSeconds: 1, user: "a", fragments: frags }, 0).fragments).toHaveLength(MAX_FRAGMENTS);
    expect(normalizeMessage({ offsetSeconds: 1, user: "a", text: "x".repeat(MAX_TEXT * 3) }, 0).text).toHaveLength(MAX_TEXT);
  });

  it("keeps markup as inert text", () => {
    const m = normalizeMessage({ offsetSeconds: 1, user: "<b>a</b>", text: "<img src=x onerror=alert(1)>" }, 0);
    expect(m.text).toBe("<img src=x onerror=alert(1)>");
    expect(m.user).toBe("<b>a</b>");
  });
});

describe("archive integrity regressions", () => {
  it("drops repeat IDs before sorting, keeping the first occurrence", () => {
    const result = parseChatReplay(doc({ messages: [msg(5, { id: "same" }), msg(1, { id: "same" }), msg(2)] }));
    expect(result.replay.messages.map(m => m.offsetSeconds)).toEqual([2, 5]);
    expect(result.replay.dropped).toBe(1);
  });
  it("checks explicit Twitch identity and rejects negative message offsets", () => {
    expect(parseChatReplay(doc({ twitchVodId: "wrong" })).ok).toBe(false);
    expect(parseChatReplay(doc(), { twitchVodId: "999" }).code).toBe("mismatch");
    expect(normalizeMessage(msg(-1), 0)).toBeNull();
  });
  it("preserves adjacent text and bounds the total rendered fragment length", () => {
    const m = normalizeMessage({ offsetSeconds: 0, fragments: [{ text: "hello " }, { text: "Kappa" }, { text: "!  hi" }] }, 0);
    expect(m.fragments.map(f => f.text).join("")).toBe("hello Kappa!  hi");
    expect(m.text).toBe("hello Kappa!  hi");
    const huge = normalizeMessage({ offsetSeconds: 0, fragments: Array.from({ length: 100 }, () => ({ text: "x".repeat(500) })) }, 0);
    expect(huge.fragments.map(f => f.text).join("")).toHaveLength(MAX_TEXT);
  });
});

describe("cleanText", () => {
  it("strips controls, bidi overrides and BOMs but keeps emoji joiners", () => {
    expect(cleanText("a\u0000b\u202ec\u2066d\ufeffe\u0085f", 50)).toBe("abcdef");
    expect(cleanText("\u{1F468}\u200D\u{1F469}", 50)).toBe("\u{1F468}\u200D\u{1F469}");
  });

  it("only accepts strings", () => {
    expect(cleanText(5, 10)).toBe("");
    expect(cleanText(null, 10)).toBe("");
    expect(cleanText("  hi  ", 10)).toBe("hi");
  });
});

describe("urls", () => {
  it("safeHttpsUrl", () => {
    expect(safeHttpsUrl("https://archive.org/a b")).toBe("https://archive.org/a%20b");
    expect(safeHttpsUrl("http://archive.org/a")).toBeNull();
    expect(safeHttpsUrl("//archive.org/a")).toBeNull();
    expect(safeHttpsUrl("https://" + "a".repeat(600))).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });

  it("safeChatUrl allows https, and same-origin paths only with a base", () => {
    const base = "https://nymphelia.example/vod/x";
    expect(safeChatUrl("https://archive.org/download/i/a.chat.json", base)).toBe("https://archive.org/download/i/a.chat.json");
    expect(safeChatUrl("/chats/a.chat.json", base)).toBe("https://nymphelia.example/chats/a.chat.json");
    expect(safeChatUrl("/chats/a.chat.json")).toBeNull();
    expect(safeChatUrl("//evil.test/a.json", base)).toBeNull();
    expect(safeChatUrl("/\\evil.test/a.json", base)).toBeNull();
    expect(safeChatUrl("javascript:alert(1)", base)).toBeNull();
    expect(safeChatUrl("http://archive.org/a.json", base)).toBeNull();
    expect(safeChatUrl("a.chat.json", base)).toBeNull();
    // Encoded titles make long but legitimate sidecar URLs.
    expect(safeChatUrl(`https://archive.org/download/i/${"%E2%99%A1".repeat(100)}.chat.json`, base)).not.toBeNull();
    expect(safeChatUrl(`https://archive.org/${"a".repeat(2100)}`, base)).toBeNull();
  });
});

describe("colorIndex", () => {
  it("is stable and in range", () => {
    expect(colorIndex("mimi", 3)).toBe(colorIndex("mimi", 3));
    for (const u of ["a", "zzzz", "日本語", ""]) {
      expect(colorIndex(u, 3)).toBeGreaterThanOrEqual(0);
      expect(colorIndex(u, 3)).toBeLessThan(3);
    }
  });
});

describe("chat colours and badges", () => {
  // A real 1x1 PNG, and PNG headers that declare other sizes (only the first 24 bytes matter to the check).
  const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const pngBytes = (w, h, extra = 0, kind = "IHDR") =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...[...kind].map((c) => c.charCodeAt(0)), ...u32(w), ...u32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0, ...new Array(extra).fill(0)]);
  const url = (bytes) => `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
  const MOD = { id: "moderator", version: "1", title: "Moderator", imageUrl: `data:image/png;base64,${PNG_1X1}` };
  const BOT = { id: "bot-badge", version: "1", title: "Chat Bot", imageUrl: url(pngBytes(36, 36)) };
  const withBadges = (messages, badgeCatalog = [MOD, BOT]) => doc({ badgeCatalog, messages });
  const parse = (d) => parseChatReplay(d).replay;

  it("resolves real-shape metadata to shared, bounded badge objects", () => {
    const r = parse(
      withBadges([
        msg(1, { color: "#5B99FF", badges: [{ id: "moderator", version: "1" }, { id: "bot-badge", version: "1" }] }),
        msg(2, { badges: [{ id: "moderator", version: "1" }] }),
      ])
    );
    const [a, b] = r.messages;
    expect(a.color).toBe("#5B99FF");
    expect(a.badges.map((x) => [x.id, x.version, x.title])).toEqual([["moderator", "1", "Moderator"], ["bot-badge", "1", "Chat Bot"]]);
    expect(a.badges[0].imageUrl).toBe(MOD.imageUrl);
    expect(b.color).toBeUndefined();
    expect(b.badges[0]).toBe(a.badges[0]); // one object per catalog entry, not a copy per message
    expect(Object.isFrozen(a.badges[0])).toBe(true);
    expect(r.badgeCatalog).toHaveLength(2);
  });

  it("leaves legacy sidecars untouched (no new keys)", () => {
    const r = parse(doc({ messages: [msg(1)] }));
    expect(r.messages[0]).toEqual({ id: "m1", offsetSeconds: 1, user: "mimi", text: "hi", fragments: [{ text: "hi" }] });
    expect(Object.keys(r.messages[0])).not.toContain("color");
    expect(Object.keys(r.messages[0])).not.toContain("badges");
    expect(r.badgeCatalog).toEqual([]);
  });

  it("accepts only #rrggbb colours and keeps the message otherwise", () => {
    for (const color of ["red", "#fff", "#GGGGGG", "#5B99FF ", "#5B99FFAA", "rgb(1,2,3)", "url(x)", 5, null, ["#5B99FF"], "javascript:1"]) {
      const m = normalizeMessage(msg(1, { color }), 0);
      expect(m.color).toBeUndefined();
      expect(m.text).toBe("hi");
    }
    expect(normalizeMessage(msg(1, { color: "#5b99ff" }), 0).color).toBe("#5b99ff");
    expect(safeColor("#ABCDEF")).toBe("#ABCDEF");
    expect(safeColor("#ABCDE")).toBeNull();
  });

  it("ignores references that are malformed, unknown, repeated or past the cap", () => {
    const many = Array.from({ length: MAX_MESSAGE_BADGES + 4 }, (_, i) => ({ id: `b${i}`, version: "1", title: `b${i}`, imageUrl: MOD.imageUrl }));
    const refs = [null, "x", 5, {}, { id: "moderator" }, { version: "1" }, { id: "moderator", version: 1 }, { id: "nope", version: "1" }, { id: "moderator", version: "1" }, { id: "moderator", version: "1" }];
    expect(parse(withBadges([msg(1, { badges: refs })])).messages[0].badges).toHaveLength(1);
    expect(parse(withBadges([msg(1, { badges: "moderator" })])).messages[0].badges).toBeUndefined();
    expect(parse(withBadges([msg(1, { badges: [{ id: "nope", version: "1" }] })])).messages[0].badges).toBeUndefined();
    const capped = parse(withBadges([msg(1, { badges: many.map(({ id, version }) => ({ id, version })) })], many)).messages[0];
    expect(capped.badges).toHaveLength(MAX_MESSAGE_BADGES);
  });

  it("drops malformed catalog entries without losing chat", () => {
    const bad = [
      null,
      "x",
      { id: "a b", version: "1", title: "t", imageUrl: MOD.imageUrl },
      { id: "x", version: "", title: "t", imageUrl: MOD.imageUrl },
      { id: "svg", version: "1", title: "t", imageUrl: "data:image/svg+xml;base64," + PNG_1X1 },
      { id: "https", version: "1", title: "t", imageUrl: "https://evil.example/b.png" },
      { id: "html", version: "1", title: "t", imageUrl: `data:image/png;base64,${btoa("<svg onload=alert(1)>")}` },
      { id: "b64", version: "1", title: "t", imageUrl: "data:image/png;base64,!!!notbase64!!!" },
      { id: "pad", version: "1", title: "t", imageUrl: MOD.imageUrl + "=" },
      { id: "ihdr", version: "1", title: "t", imageUrl: url(pngBytes(1, 1, 0, "IDAT")) },
      { id: "short", version: "1", title: "t", imageUrl: url(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
      { id: "num", version: "1", title: "t", imageUrl: 5 },
      MOD,
    ];
    const r = parse(withBadges([msg(1, { badges: [MOD, ...bad.filter((e) => e?.id)].map((e) => ({ id: e.id, version: e.version })) }), msg(2)], bad));
    expect(r.badgeCatalog.map((b) => b.id)).toEqual(["moderator"]);
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0].badges.map((b) => b.id)).toEqual(["moderator"]);
    expect(parse(doc({ badgeCatalog: "nope", messages: [msg(1)] })).messages).toHaveLength(1);
    expect(parse(doc({ badgeCatalog: { a: 1 }, messages: [msg(1)] })).badgeCatalog).toEqual([]);
  });

  it("bounds image dimensions by the PNG header, not by payload size", () => {
    expect(badgeImageSize(url(pngBytes(256, 256)))).toBeGreaterThan(0);
    expect(badgeImageSize(url(pngBytes(36, 36)))).toBeGreaterThan(0);
    expect(badgeImageSize(MOD.imageUrl)).toBeGreaterThan(0);
    for (const [w, h] of [[257, 1], [1, 257], [0, 1], [1, 0], [65535, 65535], [4294967295, 1], [1, 4294967295]]) {
      expect(badgeImageSize(url(pngBytes(w, h))), `${w}x${h}`).toBe(0);
    }
  });

  it("bounds byte size per image, catalog length and total size", () => {
    expect(badgeImageSize(url(pngBytes(1, 1, MAX_BADGE_BYTES - 33)))).toBe(MAX_BADGE_BYTES);
    expect(badgeImageSize(url(pngBytes(1, 1, MAX_BADGE_BYTES - 32)))).toBe(0);
    const many = Array.from({ length: MAX_BADGE_CATALOG + 20 }, (_, i) => ({ id: `b${i}`, version: "1", title: "t", imageUrl: MOD.imageUrl }));
    expect(parseBadgeCatalog(many).size).toBe(MAX_BADGE_CATALOG);
    const big = url(pngBytes(1, 1, MAX_BADGE_BYTES - 33));
    const heavy = Array.from({ length: 100 }, (_, i) => ({ id: `h${i}`, version: "1", title: "t", imageUrl: big }));
    expect(parseBadgeCatalog(heavy).size).toBe(MAX_BADGE_TOTAL_BYTES / MAX_BADGE_BYTES);
  });

  it("keeps the first of a duplicate id+version and cleans titles", () => {
    const rtl = String.fromCharCode(0x202e);
    const catalog = parseBadgeCatalog([
      { id: "dup", version: "1", title: `${rtl}First${String.fromCharCode(0)} <b>x</b>`, imageUrl: MOD.imageUrl },
      { id: "dup", version: "1", title: "Second", imageUrl: MOD.imageUrl },
      { id: "plain", version: "2", title: 5, imageUrl: MOD.imageUrl },
      { id: "long", version: "1", title: "t".repeat(500), imageUrl: MOD.imageUrl },
    ]);
    expect(catalog.get("dup/1").title).toBe("First <b>x</b>");
    expect(catalog.get("plain/2").title).toBe("plain");
    expect(catalog.get("long/1").title).toHaveLength(MAX_BADGE_TITLE);
  });

  it("does not let an id/version pair alias another catalog key", () => {
    const catalog = parseBadgeCatalog([{ id: "a", version: "b", title: "t", imageUrl: MOD.imageUrl }]);
    expect(resolveKey(catalog, "a/b", "1")).toBe(false);
    expect(resolveKey(catalog, "a", "b")).toBe(true);
    function resolveKey(map, id, version) {
      const m = normalizeMessage(msg(1, { badges: [{ id, version }] }), 0, map);
      return Boolean(m.badges);
    }
  });
});
