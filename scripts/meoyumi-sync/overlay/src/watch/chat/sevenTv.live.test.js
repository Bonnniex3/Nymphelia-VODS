import process from "node:process";
import { describe, expect, it } from "vitest";
import { TWITCH_ID } from "./config";
import { createSevenTvLoader, enrichFragments } from "./sevenTv";

// Opt-in check against the real public 7TV API (needs network, no key):
//   SEVENTV_LIVE=1 npx vitest run src/watch/chat/sevenTv.live.test.js
// Asserts only invariants that hold for any current emote set, never fixed emote lists.
describe.skipIf(!process.env.SEVENTV_LIVE)("7TV live API", () => {
  it("loads the current global + channel sets through the real parser", async () => {
    const emotes = await createSevenTvLoader().load(TWITCH_ID);
    expect(emotes.size).toBeGreaterThan(10);
    for (const [word, src] of emotes) {
      expect(word).not.toMatch(/\s/);
      expect(src).toMatch(/^https:\/\/cdn\.7tv\.app\/emote\/[A-Za-z0-9]{8,40}\/[1-4]x\.(webp|avif|gif|png)$/);
    }

    const [word, src] = emotes.entries().next().value;
    const out = enrichFragments([{ text: `hi ${word}, ${word} ${word.toLowerCase() === word ? word.toUpperCase() : word.toLowerCase()}!` }], emotes);
    expect(out.map((f) => f.text).join("")).toBe(`hi ${word}, ${word} ${word.toLowerCase() === word ? word.toUpperCase() : word.toLowerCase()}!`);
    expect(out.find((f) => f.emoteUrl)).toEqual({ text: word, emoteUrl: src });
  }, 30_000);
});
