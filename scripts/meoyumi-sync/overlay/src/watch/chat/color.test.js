import { describe, expect, it } from "vitest";
import { readableColor } from "./color";

describe("readableColor", () => {
  it("keeps colours that already read on a dark surface", () => {
    expect(readableColor("#FF69B4")).toBe("#ff69b4");
    expect(readableColor("#9ACD32")).toBe("#9acd32");
  });

  it("lifts near-black names toward white", () => {
    expect(readableColor("#000000")).toBe("rgb(140 140 140)");
    const lifted = readableColor("#0000ff");
    const [r, g, b] = lifted.match(/\d+/g).map(Number);
    expect(b).toBeGreaterThan(255 * 0.9);
    expect(r).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(0);
  });

  it("returns null for anything that isn't a #rrggbb string", () => {
    for (const bad of [undefined, null, 5, "", "red", "#fff", "#12345", "#1234567", "rgb(0,0,0)", "#gggggg", {}]) {
      expect(readableColor(bad)).toBeNull();
    }
  });
});
