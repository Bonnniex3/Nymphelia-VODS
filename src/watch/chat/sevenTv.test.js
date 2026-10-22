import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_EMOTES, NO_EMOTES, createSevenTvLoader, emoteImageUrl, emoteWord, enrichFragments, mergeEmotes, normalizeChannelId, parseChannelSet, parseEmoteSet, watchSevenTv } from "./sevenTv";

const ID = "01F6MQ33FG000FFJ97ZB8MWV52";
const url = (id, file = "2x.webp") => `https://cdn.7tv.app/emote/${id}/${file}`;
const files = (...names) => names.map((name) => ({ name, format: name.split(".")[1].toUpperCase() }));
const host = (over = {}) => ({ url: `//cdn.7tv.app/emote/${ID}`, files: files("1x.webp", "2x.webp", "4x.webp", "2x.png"), ...over });
const entry = (name, over = {}) => ({ id: ID, name, data: { id: ID, name, animated: true, host: host() }, ...over });
const set = (...entries) => ({ id: "set", emotes: entries });
const emotes = (obj) => new Map(Object.entries(obj));

describe("emoteImageUrl", () => {
  it("builds a 2x.webp URL on the official CDN, keeping animation", () => {
    expect(emoteImageUrl(host(), true)).toBe(url(ID, "2x.webp"));
    expect(emoteImageUrl(host({ url: `https://cdn.7tv.app/emote/${ID}/` }), false)).toBe(url(ID));
  });

  it("falls back through other webp sizes before gif/png", () => {
    expect(emoteImageUrl(host({ files: files("1x.webp", "4x.webp", "2x.gif") }), true)).toBe(url(ID, "4x.webp"));
    expect(emoteImageUrl(host({ files: files("2x.png", "2x.gif", "1x.gif") }), true)).toBe(url(ID, "2x.gif"));
    expect(emoteImageUrl(host({ files: files("2x.png", "2x.gif") }), false)).toBe(url(ID, "2x.png"));
  });

  it("does not use a static png for an animated emote", () => {
    expect(emoteImageUrl(host({ files: files("2x.png", "1x.png") }), true)).toBeNull();
  });

  it("uses only files the API lists, with a well-formed name", () => {
    expect(emoteImageUrl(host({ files: files("1x.webp") }), true)).toBe(url(ID, "1x.webp"));
    expect(emoteImageUrl(host({ files: files("../2x.webp", "2x.webp.exe", "9x.webp", "2X.webp") }), true)).toBeNull();
    expect(emoteImageUrl(host({ files: [null, 5, { name: 7 }, {}] }), true)).toBeNull();
  });

  it.each([
    ["another host", "//evil.example/emote/" + ID],
    ["a lookalike host", "//cdn.7tv.app.evil.example/emote/" + ID],
    ["a subdomain trick", "//cdn.7tv.app@evil.example/emote/" + ID],
    ["credentials", "https://u:p@cdn.7tv.app/emote/" + ID],
    ["a port", "https://cdn.7tv.app:8443/emote/" + ID],
    ["http", "http://cdn.7tv.app/emote/" + ID],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["a query", `//cdn.7tv.app/emote/${ID}?x=1`],
    ["a path escape", `//cdn.7tv.app/emote/${ID}/../x`],
    ["a short id", "//cdn.7tv.app/emote/abc"],
    ["an id with symbols", "//cdn.7tv.app/emote/" + ID.slice(0, 10) + "%2e%2e"],
    ["a wrong directory", `//cdn.7tv.app/avatar/${ID}`],
    ["a relative path", `/emote/${ID}`],
    ["uppercase scheme host", `//CDN.7TV.APP/emote/${ID}`],
  ])("rejects %s", (_label, bad) => {
    expect(emoteImageUrl(host({ url: bad }), true)).toBeNull();
  });

  it("rejects missing or malformed hosts", () => {
    for (const bad of [undefined, null, "x", 3, {}, { url: ID }, { url: host().url }, { url: host().url, files: "2x.webp" }, { url: 5, files: [] }]) {
      expect(emoteImageUrl(bad, true)).toBeNull();
    }
  });

  it("accepts the legacy 24-hex ids as well as the current 26-char ULIDs", () => {
    const hex = "60ae958e229664e8667aea38";
    expect(emoteImageUrl(host({ url: `//cdn.7tv.app/emote/${hex}` }), true)).toBe(url(hex));
  });
});

describe("emoteWord", () => {
  it("prefers the active alias (entry.name) over the original (data.name)", () => {
    expect(emoteWord({ name: "xdd", data: { name: "ActuallyOriginal" } })).toBe("xdd");
  });

  it("falls back to data.name only when the entry has no name at all", () => {
    expect(emoteWord({ data: { name: "Orig" } })).toBe("Orig");
    expect(emoteWord({ name: null, data: { name: "Orig" } })).toBe("Orig");
  });

  it("skips an alias that is present but unusable instead of substituting the original", () => {
    expect(emoteWord({ name: "two words", data: { name: "Orig" } })).toBe("");
    expect(emoteWord({ name: "", data: { name: "Orig" } })).toBe("");
    expect(emoteWord({ name: 4, data: { name: "Orig" } })).toBe("");
  });

  it.each(["a b", "a\tb", "a\nb", "a\u00a0b", "a\u202eb", "a\u0000b", "a\u2028b", " lead", "trail ", "a".repeat(101), ""])("rejects %j", (name) => {
    expect(emoteWord({ name })).toBe("");
  });

  it("keeps punctuation and unicode inside a single word", () => {
    expect(emoteWord({ name: "(ノಠ益ಠ)ノ" })).toBe("(ノಠ益ಠ)ノ");
    expect(emoteWord({ name: "Clap:3" })).toBe("Clap:3");
  });
});

describe("parseEmoteSet", () => {
  it("maps each word to its image URL", () => {
    const parsed = parseEmoteSet(set(entry("HUH"), entry("xdd", { id: "x", data: { id: "x", name: "Orig", animated: false, host: host({ url: "//cdn.7tv.app/emote/01ABCDEFGH000000000000XDD1" }) } })));
    expect([...parsed.entries()]).toEqual([
      ["HUH", url(ID)],
      ["xdd", url("01ABCDEFGH000000000000XDD1")],
    ]);
  });

  it("uses the channel alias, not the original name", () => {
    const parsed = parseEmoteSet(set({ id: ID, name: "hello", data: { id: ID, name: "Wave", animated: true, host: host() } }));
    expect([...parsed.keys()]).toEqual(["hello"]);
  });

  it("drops bad entries one by one and keeps the good ones", () => {
    const parsed = parseEmoteSet(set(null, 5, "x", entry("bad name"), entry("evil", { data: { name: "evil", host: host({ url: "//evil.example/emote/" + ID }) } }), { name: "nodata" }, entry("ok")));
    expect([...parsed.keys()]).toEqual(["ok"]);
  });

  it("keeps the first entry when a word repeats", () => {
    const parsed = parseEmoteSet(set(entry("dup"), entry("dup", { data: { name: "dup", animated: true, host: host({ url: "//cdn.7tv.app/emote/01OTHEROTHER00000000000000" }) } })));
    expect(parsed.get("dup")).toBe(url(ID));
  });

  it("is case-sensitive: HUH and huh are different words", () => {
    const parsed = parseEmoteSet(set(entry("HUH"), entry("huh")));
    expect([...parsed.keys()]).toEqual(["HUH", "huh"]);
  });

  it("is safe with prototype-ish names", () => {
    const parsed = parseEmoteSet(set(entry("__proto__"), entry("constructor")));
    expect(parsed.get("__proto__")).toBe(url(ID));
    expect(parsed.get("toString")).toBeUndefined();
  });

  it("returns null when it isn't an emote set", () => {
    for (const bad of [null, undefined, "x", 4, [], {}, { emotes: null }, { emotes: {} }]) expect(parseEmoteSet(bad)).toBeNull();
  });

  it("accepts an empty set", () => {
    expect(parseEmoteSet({ emotes: [] }).size).toBe(0);
  });

  it("stops at MAX_EMOTES entries", () => {
    const many = Array.from({ length: MAX_EMOTES + 5 }, (_, i) => entry(`e${i}`));
    expect(parseEmoteSet({ emotes: many }).size).toBe(MAX_EMOTES);
  });
});

describe("parseChannelSet", () => {
  it("reads the inline emote_set of the user document", () => {
    expect([...parseChannelSet({ username: "smizzles", emote_set: set(entry("clappi")) }).keys()]).toEqual(["clappi"]);
  });

  it("treats a user without a set as an empty channel, not an error", () => {
    expect(parseChannelSet({ username: "x", emote_set: null }).size).toBe(0);
    expect(parseChannelSet({ username: "x" }).size).toBe(0);
  });

  it("rejects non-documents and a malformed set", () => {
    expect(parseChannelSet(null)).toBeNull();
    expect(parseChannelSet("x")).toBeNull();
    expect(parseChannelSet({ emote_set: { emotes: 3 } })).toBeNull();
  });
});

describe("mergeEmotes", () => {
  it("lets the channel override a global emote with the same word", () => {
    const merged = mergeEmotes(emotes({ OMG: "g1", only: "g2" }), emotes({ OMG: "c1", mine: "c2" }));
    expect(Object.fromEntries(merged)).toEqual({ OMG: "c1", only: "g2", mine: "c2" });
  });

  it("copes with a missing side and doesn't mutate its inputs", () => {
    const g = emotes({ a: "1" });
    expect(Object.fromEntries(mergeEmotes(g, null))).toEqual({ a: "1" });
    expect(Object.fromEntries(mergeEmotes(null, g))).toEqual({ a: "1" });
    mergeEmotes(g, emotes({ a: "2" }));
    expect(g.get("a")).toBe("1");
  });
});

describe("normalizeChannelId", () => {
  it("accepts only numeric ids", () => {
    expect(normalizeChannelId("599650809")).toBe("599650809");
    expect(normalizeChannelId(599650809)).toBe("599650809");
    for (const bad of ["", "smizzles", "12a", "../1", "1/2", "-1", " 1", "1".repeat(21), null, undefined, 1.5, -3, {}]) expect(normalizeChannelId(bad)).toBe("");
  });
});

describe("enrichFragments", () => {
  const E = emotes({ HUH: "https://cdn.7tv.app/emote/A/2x.webp", xdd: "https://cdn.7tv.app/emote/B/2x.webp" });
  const joined = (fs) => fs.map((f) => f.text).join("");
  const text = (s) => [{ text: s }];

  it("splits out an emote word and preserves every byte of the rest", () => {
    const out = enrichFragments(text("hi HUH there"), E);
    expect(out).toEqual([{ text: "hi " }, { text: "HUH", emoteUrl: E.get("HUH") }, { text: " there" }]);
    expect(joined(out)).toBe("hi HUH there");
  });

  it("handles emotes at the very start, end and back to back", () => {
    expect(enrichFragments(text("HUH xdd"), E)).toEqual([
      { text: "HUH", emoteUrl: E.get("HUH") },
      { text: " " },
      { text: "xdd", emoteUrl: E.get("xdd") },
    ]);
    expect(joined(enrichFragments(text("a  HUH  "), E))).toBe("a  HUH  ");
  });

  it("keeps all kinds of whitespace exactly", () => {
    const s = "  HUH\t\txdd\n\u00a0HUH  ";
    expect(joined(enrichFragments(text(s), E))).toBe(s);
    expect(enrichFragments(text(s), E).filter((f) => f.emoteUrl)).toHaveLength(3);
  });

  it("matches case-sensitively", () => {
    const f = text("huh Huh HUH xDD");
    const out = enrichFragments(f, E);
    expect(out.filter((x) => x.emoteUrl).map((x) => x.text)).toEqual(["HUH"]);
    expect(enrichFragments(text("huh xDD Xdd"), E)).toEqual(text("huh xDD Xdd"));
  });

  it("doesn't touch substrings or punctuation-wrapped words", () => {
    for (const s of ["HUHH", "aHUH", "HUH!", "(HUH)", "HUH,", "'xdd'", "xdd?", "HUH.HUH", "HUH-xdd", "HUH:", "@HUH", "#xdd"]) {
      expect(enrichFragments(text(s), E)).toEqual(text(s));
    }
  });

  it("returns the very same array (identity) when nothing matched or there is nothing to match", () => {
    const f = text("nothing here");
    expect(enrichFragments(f, E)).toBe(f);
    expect(enrichFragments(f, NO_EMOTES)).toBe(f);
    expect(enrichFragments(f, undefined)).toBe(f);
    const empty = [];
    expect(enrichFragments(empty, E)).toBe(empty);
  });

  it("never alters existing Twitch emote fragments, even if their code is a 7TV word", () => {
    const twitch = { text: "HUH", emoteUrl: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" };
    const f = [{ text: "hi " }, twitch, { text: " xdd" }];
    const out = enrichFragments(f, E);
    expect(out[1]).toBe(twitch);
    expect(out[1].emoteUrl).toContain("jtvnw.net");
    expect(out.map((x) => x.text).join("")).toBe("hi HUH xdd");
    expect(out[out.length - 1]).toEqual({ text: "xdd", emoteUrl: E.get("xdd") });
  });

  it("only-Twitch-emote messages come back unchanged", () => {
    const f = [{ text: "HUH", emoteUrl: "https://static-cdn.jtvnw.net/x" }];
    expect(enrichFragments(f, E)).toBe(f);
  });

  it("joins adjacent text fragments, so a word split across them is still one word", () => {
    const out = enrichFragments([{ text: "see HU" }, { text: "H now" }], E);
    expect(out).toEqual([{ text: "see " }, { text: "HUH", emoteUrl: E.get("HUH") }, { text: " now" }]);
    // ...and a fragment boundary at a space doesn't invent one
    expect(enrichFragments([{ text: "aHU" }, { text: "H" }], E)).toEqual([{ text: "aHU" }, { text: "H" }]);
  });

  it("doesn't create a word boundary where an adjacent Twitch emote touches the text", () => {
    const k = { text: "Kappa", emoteUrl: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" };
    // "HUHKappa", "KappaHUH" and "HUHKappaxdd" are single tokens in the original message
    expect(enrichFragments([{ text: "HUH" }, k], E)).toEqual([{ text: "HUH" }, k]);
    expect(enrichFragments([k, { text: "HUH" }], E)).toEqual([k, { text: "HUH" }]);
    const both = [{ text: "HUH" }, k, { text: "xdd" }];
    expect(enrichFragments(both, E)).toBe(both);
    const mid = [{ text: "HUH xdd" }, k];
    expect(enrichFragments(mid, E)).toEqual([{ text: "HUH", emoteUrl: E.get("HUH") }, { text: " xdd" }, k]);
    const after = [k, { text: "HUH xdd" }];
    expect(enrichFragments(after, E)).toEqual([k, { text: "HUH " }, { text: "xdd", emoteUrl: E.get("xdd") }]);
  });

  it("does enrich next to a Twitch emote when whitespace separates them", () => {
    const k = { text: "Kappa", emoteUrl: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" };
    expect(enrichFragments([{ text: "HUH " }, k, { text: " xdd" }], E)).toEqual([
      { text: "HUH", emoteUrl: E.get("HUH") },
      { text: " " },
      k,
      { text: " " },
      { text: "xdd", emoteUrl: E.get("xdd") },
    ]);
  });

  it("doesn't mutate its input", () => {
    const f = Object.freeze([Object.freeze({ text: "a HUH" })]);
    expect(() => enrichFragments(f, E)).not.toThrow();
  });

  it("is safe with prototype-ish words", () => {
    expect(enrichFragments(text("__proto__ constructor toString"), E)).toEqual(text("__proto__ constructor toString"));
  });

  it("applies the channel's alias and override through a merged map", () => {
    const merged = mergeEmotes(emotes({ OMG: "https://cdn.7tv.app/emote/G/2x.webp" }), emotes({ OMG: "https://cdn.7tv.app/emote/C/2x.webp" }));
    expect(enrichFragments(text("OMG"), merged)[0].emoteUrl).toBe("https://cdn.7tv.app/emote/C/2x.webp");
  });
});

// ---------------------------------------------------------------- loader

const okRes = (body) => ({ ok: true, status: 200, headers: new Headers(), body: new Response(JSON.stringify(body)).body });
const GLOBAL_URL = "https://7tv.io/v3/emote-sets/global";
const userUrl = (id) => `https://7tv.io/v3/users/twitch/${id}`;

/** Routes by URL; a route may be a document, an Error (reject) or a function. */
function fakeFetch(routes) {
  const fn = vi.fn(async (u, init) => {
    const route = routes[u];
    if (route === undefined) return { ok: false, status: 404, headers: new Headers(), body: null };
    const value = typeof route === "function" ? await route(init) : route;
    if (value instanceof Error) throw value;
    if (value && value.__status) return { ok: false, status: value.__status, headers: new Headers(), body: null };
    return okRes(value);
  });
  return fn;
}

const globalDoc = set(entry("OMG"), entry("shared"));
const channelDoc = { emote_set: set({ id: ID, name: "shared", data: { id: ID, name: "Orig", animated: false, host: host({ url: "//cdn.7tv.app/emote/01CHANNELCHANNEL0000000001" }) } }, entry("clappi")) };

describe("createSevenTvLoader", () => {
  afterEach(() => vi.useRealTimers());

  it("loads global + channel emotes, the channel overriding the global", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("599650809")]: channelDoc });
    const loader = createSevenTvLoader({ fetchImpl: f });
    const got = await loader.load("599650809");
    expect([...got.keys()].sort()).toEqual(["OMG", "clappi", "shared"]);
    expect(got.get("shared")).toBe(url("01CHANNELCHANNEL0000000001"));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("sends keyless, credential-free, referrer-free requests", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("1")]: channelDoc });
    await createSevenTvLoader({ fetchImpl: f }).load("1");
    for (const [, init] of f.mock.calls) {
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(init.headers).toEqual({ Accept: "application/json" });
    }
  });

  it("fetches only the global set without a valid channel id (never guesses or resolves a name)", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc });
    const got = await createSevenTvLoader({ fetchImpl: f }).load("smizzles");
    expect([...got.keys()]).toEqual(["OMG", "shared"]);
    expect(f.mock.calls.map(([u]) => u)).toEqual([GLOBAL_URL]);
  });

  it("reuses a fresh result: same identity, no new request, also for concurrent callers", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("1")]: channelDoc });
    const loader = createSevenTvLoader({ fetchImpl: f });
    const [a, b] = await Promise.all([loader.load("1"), loader.load("1")]);
    expect(a).toBe(b);
    expect(await loader.load("1")).toBe(a);
    expect(loader.peek("1")).toBe(a);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("keeps separate caches per channel", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("1")]: channelDoc, [userUrl("2")]: { emote_set: null } });
    const loader = createSevenTvLoader({ fetchImpl: f });
    const a = await loader.load("1");
    const b = await loader.load("2");
    expect(a).not.toBe(b);
    expect(a.has("clappi")).toBe(true);
    expect(b.has("clappi")).toBe(false);
  });

  it("refetches after the TTL, and peek stops returning the stale value", async () => {
    let t = 1000;
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("1")]: channelDoc });
    const loader = createSevenTvLoader({ fetchImpl: f, now: () => t, okTtl: 5000 });
    const first = await loader.load("1");
    t += 4999;
    expect(loader.peek("1")).toBe(first);
    t += 2;
    expect(loader.peek("1")).toBeNull();
    const second = await loader.load("1");
    expect(second).not.toBe(first);
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("uses the other set when one fails, and retries it sooner", async () => {
    let t = 0;
    const routes = { [GLOBAL_URL]: new Error("down"), [userUrl("1")]: channelDoc };
    const f = fakeFetch(routes);
    const loader = createSevenTvLoader({ fetchImpl: f, now: () => t, okTtl: 100_000, retryTtl: 1000 });
    const partial = await loader.load("1");
    expect([...partial.keys()].sort()).toEqual(["clappi", "shared"]);
    t += 999;
    expect(await loader.load("1")).toBe(partial);
    expect(f).toHaveBeenCalledTimes(2);
    routes[GLOBAL_URL] = globalDoc;
    t += 2;
    const full = await loader.load("1");
    expect([...full.keys()].sort()).toEqual(["OMG", "clappi", "shared"]);
    t += 50_000;
    expect(await loader.load("1")).toBe(full);
  });

  it("works with only the global set when the channel request fails or is garbage", async () => {
    for (const bad of [new Error("down"), { __status: 500 }, "nope", { emote_set: { emotes: 1 } }]) {
      const loader = createSevenTvLoader({ fetchImpl: fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("1")]: bad }) });
      expect([...(await loader.load("1")).keys()]).toEqual(["OMG", "shared"]);
    }
  });

  it("resolves to the shared empty map when everything fails, and doesn't hammer 7TV", async () => {
    let t = 0;
    const f = fakeFetch({ [GLOBAL_URL]: new Error("down"), [userUrl("1")]: { __status: 503 } });
    const loader = createSevenTvLoader({ fetchImpl: f, now: () => t, retryTtl: 1000 });
    expect(await loader.load("1")).toBe(NO_EMOTES);
    expect(await loader.load("1")).toBe(NO_EMOTES);
    expect(f).toHaveBeenCalledTimes(2);
    t += 1001;
    await loader.load("1");
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("keeps the previous good set when a later refresh of it fails", async () => {
    let t = 0;
    const routes = { [GLOBAL_URL]: globalDoc, [userUrl("1")]: channelDoc };
    const loader = createSevenTvLoader({ fetchImpl: fakeFetch(routes), now: () => t, okTtl: 10 });
    await loader.load("1");
    routes[GLOBAL_URL] = new Error("down");
    routes[userUrl("1")] = new Error("down");
    t += 11;
    expect([...(await loader.load("1")).keys()].sort()).toEqual(["OMG", "clappi", "shared"]);
  });

  it("ignores malformed documents and hostile entries", async () => {
    const hostile = set(entry("good"), { name: "evil", data: { name: "evil", host: { url: "//evil.example/emote/" + ID, files: files("2x.webp") } } });
    const loader = createSevenTvLoader({ fetchImpl: fakeFetch({ [GLOBAL_URL]: hostile }) });
    expect([...(await loader.load(""))].map(([k]) => k)).toEqual(["good"]);
    const junk = createSevenTvLoader({ fetchImpl: fakeFetch({ [GLOBAL_URL]: [1, 2, 3] }) });
    expect(await junk.load("")).toBe(NO_EMOTES);
  });

  it("refuses an oversized response", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(50 * 1024 * 1024) }), body: null }));
    expect(await createSevenTvLoader({ fetchImpl: f }).load("")).toBe(NO_EMOTES);
  });

  it("aborts a request that takes too long and still resolves", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const f = vi.fn(
      (_u, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const loader = createSevenTvLoader({ fetchImpl: f, timeoutMs: 2000 });
    const pending = loader.load("1");
    await vi.advanceTimersByTimeAsync(1999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(aborted).toBe(true);
    expect(await pending).toBe(NO_EMOTES);
  });

  it("a hung channel request doesn't hide the global set forever", async () => {
    vi.useFakeTimers();
    const f = vi.fn((u, init) => {
      if (u === GLOBAL_URL) return Promise.resolve(okRes(globalDoc));
      return new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout"))));
    });
    const pending = createSevenTvLoader({ fetchImpl: f, timeoutMs: 1000 }).load("1");
    await vi.advanceTimersByTimeAsync(1001);
    expect([...(await pending).keys()]).toEqual(["OMG", "shared"]);
  });

  it("clear() drops the cache", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc });
    const loader = createSevenTvLoader({ fetchImpl: f });
    await loader.load("");
    loader.clear();
    expect(loader.peek("")).toBeNull();
  });
});

describe("watchSevenTv (hook lifecycle)", () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };

  it("delivers the emotes once", async () => {
    const loader = { load: vi.fn(() => Promise.resolve(NO_EMOTES)) };
    const onLoad = vi.fn();
    watchSevenTv("1", onLoad, loader);
    await Promise.resolve();
    await Promise.resolve();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledWith(NO_EMOTES);
  });

  it("delivers nothing after cancel (unmount or channel change), however late the answer is", async () => {
    const slow = deferred();
    const loader = { load: () => slow.promise };
    const onLoad = vi.fn();
    const cancel = watchSevenTv("1", onLoad, loader);
    cancel();
    slow.resolve(emotes({ a: "b" }));
    await slow.promise;
    await Promise.resolve();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("a stale channel's response can't reach the new channel's callback", async () => {
    const a = deferred();
    const b = deferred();
    const loader = { load: (id) => (id === "1" ? a.promise : b.promise) };
    const seen = [];
    const cancelA = watchSevenTv("1", (m) => seen.push(["1", m]), loader);
    cancelA();
    watchSevenTv("2", (m) => seen.push(["2", m]), loader);
    const mapA = emotes({ old: "x" });
    const mapB = emotes({ new: "y" });
    b.resolve(mapB);
    a.resolve(mapA);
    await Promise.all([a.promise, b.promise]);
    await Promise.resolve();
    expect(seen).toEqual([["2", mapB]]);
  });

  it("shares one cached load between mounts", async () => {
    const f = fakeFetch({ [GLOBAL_URL]: globalDoc, [userUrl("1")]: channelDoc });
    const loader = createSevenTvLoader({ fetchImpl: f });
    const seen = [];
    watchSevenTv("1", (m) => seen.push(m), loader);
    watchSevenTv("1", (m) => seen.push(m), loader);
    await loader.load("1");
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
