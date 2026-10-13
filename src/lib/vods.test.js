import { describe, expect, it } from "vitest";
import { archiveStats, categoryOf, durationSeconds, facets, neighbours, queryVods } from "./vods";
import { makeSlug } from "./helpers";

const vod = (id, createdAt, title, duration = "01:00:00", item_id = "nymphelia-vods") => ({ id, createdAt, title, duration, item_id });

const VODS = [
  vod("a", "2025-12-30T20:00:00.000Z", "Minecraft cozy build", "02:30:00", "nymphelia-gaming-vods"),
  vod("b", "2026-03-02T20:00:00.000Z", "Karaoke night", "01:15:00"),
  vod("c", "2026-03-20T20:00:00.000Z", "just chatting", "03:05:10"),
  vod("d", "2026-05-01T20:00:00.000Z", "Minecraft finale", "00:45:00", "nymphelia-gaming-vods"),
];

describe("queryVods", () => {
  it("sorts newest first by default", () => {
    expect(queryVods(VODS).map((v) => v.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("supports the other sort orders", () => {
    expect(queryVods(VODS, { sort: "oldest" }).map((v) => v.id)).toEqual(["a", "b", "c", "d"]);
    expect(queryVods(VODS, { sort: "longest" }).map((v) => v.id)).toEqual(["c", "a", "b", "d"]);
    expect(queryVods(VODS, { sort: "shortest" }).map((v) => v.id)).toEqual(["d", "b", "a", "c"]);
    expect(queryVods(VODS, { sort: "az" }).map((v) => v.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("filters by title, year and category together", () => {
    expect(queryVods(VODS, { q: "  MINECRAFT " }).map((v) => v.id)).toEqual(["d", "a"]);
    expect(queryVods(VODS, { year: "2026" }).map((v) => v.id)).toEqual(["d", "c", "b"]);
    expect(queryVods(VODS, { category: "gaming", year: "2026" }).map((v) => v.id)).toEqual(["d"]);
  });

  it("does not mutate its input", () => {
    const copy = [...VODS];
    queryVods(VODS, { sort: "az" });
    expect(VODS).toEqual(copy);
  });
});

describe("helpers", () => {
  it("derives categories from explicit field or IA item name", () => {
    expect(categoryOf(VODS[0])).toBe("gaming");
    expect(categoryOf(VODS[1])).toBe("stream");
    expect(categoryOf({ ...VODS[1], category: "ASMR" })).toBe("asmr");
  });

  it("parses durations defensively", () => {
    expect(durationSeconds(VODS[2])).toBe(3 * 3600 + 5 * 60 + 10);
    expect(durationSeconds({ duration: "" })).toBe(0);
    expect(durationSeconds({})).toBe(0);
  });

  it("counts facets", () => {
    const f = facets(VODS);
    expect(f.years).toEqual([
      { value: 2026, count: 3 },
      { value: 2025, count: 1 },
    ]);
    expect(f.categories).toEqual([
      { value: "gaming", count: 2 },
      { value: "stream", count: 2 },
    ]);
  });

  it("builds a 12-month histogram ending at the newest VOD", () => {
    const s = archiveStats(VODS);
    expect(s.count).toBe(4);
    expect(s.hours).toBeCloseTo(7 + 35 / 60 + 10 / 3600, 5);
    expect(s.perMonth).toHaveLength(12);
    expect(s.perMonth.at(-1)).toMatchObject({ label: "MAY", count: 1 });
    expect(s.perMonth.find((m) => m.label === "MAR").count).toBe(2);
    expect(s.perMonth.reduce((n, m) => n + m.count, 0)).toBe(4);
  });

  it("handles an empty archive", () => {
    const s = archiveStats([], new Date("2026-10-12T00:00:00Z"));
    expect(s).toMatchObject({ count: 0, hours: 0, latest: null });
    expect(s.perMonth.at(-1).label).toBe("OCT");
  });

  it("finds neighbours in date order", () => {
    const sorted = queryVods(VODS);
    expect(neighbours(VODS[2], sorted)).toEqual({ newer: VODS[3], older: VODS[1] });
    expect(neighbours({ id: "zzz" }, sorted)).toEqual({ newer: null, older: null });
  });

  it("keeps slugs stable", () => {
    expect(makeSlug({ title: "Resident Evil Requiem!! 🎀", createdAt: "2026-04-04T02:02:00.000Z" })).toBe("resident-evil-requiem-2026-04-04-0202");
  });
});
