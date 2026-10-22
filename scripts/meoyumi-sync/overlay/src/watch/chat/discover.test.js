import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { findChatSidecar } = createRequire(import.meta.url)("../../../scripts/fetch-vods.js");

const VIDEO = "nymphelia - 2026-08-30 - LEWD virus - [319039882455].mp4";
const file = (name, extra = {}) => ({ name, size: "1234", ...extra });

describe("findChatSidecar (scripts/fetch-vods.js)", () => {
  it("finds <video name without extension>.chat.json", () => {
    const sidecar = file("nymphelia - 2026-08-30 - LEWD virus - [319039882455].chat.json");
    expect(findChatSidecar([file(VIDEO), sidecar], VIDEO)).toBe(sidecar);
  });

  it("works for mkv and webm videos", () => {
    const sidecar = file("a b.chat.json");
    expect(findChatSidecar([sidecar], "a b.mkv")).toBe(sidecar);
    expect(findChatSidecar([sidecar], "a b.WEBM")).toBe(sidecar);
  });

  it("never guesses: near-misses are not matches", () => {
    const files = [
      file("nymphelia - 2026-08-30 - LEWD virus - [319039882455].json"),
      file("nymphelia - 2026-08-30 - lewd virus - [319039882455].chat.json"),
      file("nymphelia - 2026-08-30 - LEWD virus - [319039882455].mp4.chat.json"),
      file("319039882455.chat.json"),
      file("nymphelia - 2026-08-30 - another title - [319039882455].chat.json"),
      file("nymphelia - 2026-08-31 - LEWD virus - [319039882455].chat.json"),
    ];
    expect(findChatSidecar(files, VIDEO)).toBeNull();
  });

  it("ignores empty, deleted and superseded copies", () => {
    const name = "x.chat.json";
    expect(findChatSidecar([file(name, { size: "0" })], "x.mp4")).toBeNull();
    expect(findChatSidecar([file(name, { old_version: "true" })], "x.mp4")).toBeNull();
    expect(findChatSidecar([file(name, { deleted: "true" })], "x.mp4")).toBeNull();
  });

  it("refuses ambiguous stems, duplicate sidecars and unsupported videos", () => {
    const sidecar = file("x.chat.json");
    expect(findChatSidecar([file("x.mp4"), file("x.mkv"), sidecar], "x.mp4")).toBeNull();
    expect(findChatSidecar([sidecar, { ...sidecar }], "x.mp4")).toBeNull();
    expect(findChatSidecar([sidecar], "x.txt")).toBeNull();
    expect(findChatSidecar([file("x.mp4"), file("x.mkv", { deleted: true }), sidecar], "x.mp4")).toBe(sidecar);
    expect(findChatSidecar([null, sidecar], "x.mp4")).toBe(sidecar);
  });
});
