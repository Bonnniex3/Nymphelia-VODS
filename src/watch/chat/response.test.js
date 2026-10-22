import { describe, expect, it } from "vitest";
import { MAX_MESSAGES } from "./replay";
import { acceptChatReplay, readChatResponse } from "./useChatReplay";

const bytes = (text) => new TextEncoder().encode(text);
const response = (chunks, headers = {}) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  },
}), { headers });

describe("chat archive streamed reads", () => {
  it("decodes multibyte text split between chunks", async () => {
    const data = bytes(JSON.stringify({ text: "hello 🎉" }));
    const split = data.length - 4;
    await expect(readChatResponse(response([data.slice(0, split), data.slice(split)]))).resolves.toEqual({ text: "hello 🎉" });
  });

  it("accepts a payload exactly at the byte limit", async () => {
    await expect(readChatResponse(response([bytes("{}")]), 2)).resolves.toEqual({});
  });

  it("rejects an oversized declared length and stops its body download", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    await expect(readChatResponse(new Response(body, { headers: { "Content-Length": "100" } }), 10)).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });

  it("counts streamed bytes even when Content-Length understates them and cancels the reader", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(bytes("12345")); },
      cancel() { cancelled = true; },
    });
    await expect(readChatResponse(new Response(body, { headers: { "Content-Length": "1" } }), 4)).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("reports malformed JSON", async () => {
    await expect(readChatResponse(response([bytes("{broken")]))).rejects.toThrow("not valid JSON");
  });

  it("reports a missing body", async () => {
    await expect(readChatResponse(new Response(null))).rejects.toThrow("no response body");
  });
});

describe("chat archive message limit", () => {
  const archive = (count) => ({
    version: 1,
    videoFile: "a.mp4",
    twitchVodId: "1",
    messages: Array.from({ length: count }, (_, index) => ({ offsetSeconds: index, user: "viewer", text: "hi" })),
  });

  it("accepts an archive with exactly the maximum number of messages", () => {
    const replay = acceptChatReplay(archive(MAX_MESSAGES), { videoFile: "a.mp4", twitchVodId: "1" });
    expect(replay.messages).toHaveLength(MAX_MESSAGES);
    expect(replay.truncated).toBe(false);
  });

  it("rejects an archive one message over the limit instead of replaying it incomplete", () => {
    expect(() => acceptChatReplay(archive(MAX_MESSAGES + 1), { videoFile: "a.mp4", twitchVodId: "1" })).toThrow("cannot be replayed completely");
  });

  it("still reports validation failures from the parser", () => {
    expect(() => acceptChatReplay(archive(1), { videoFile: "b.mp4", twitchVodId: "1" })).toThrow("different video file");
  });
});
