import { describe, expect, it } from "vitest";
import { isSlow, isSoftwareRenderer, resolveFx } from "./perf";

describe("isSoftwareRenderer", () => {
  it("spots CPU-only WebGL renderers", () => {
    expect(isSoftwareRenderer("Google SwiftShader")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)")).toBe(true);
  });

  it("leaves real GPUs alone", () => {
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("Apple M2")).toBe(false);
    expect(isSoftwareRenderer("WebKit WebGL")).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
  });
});

describe("isSlow", () => {
  const frames = (ms, n = 90) => Array.from({ length: n }, () => ms);

  it("is fine at 60 fps and flags under ~30 fps", () => {
    expect(isSlow(frames(16.7))).toBe(false);
    expect(isSlow(frames(50))).toBe(true);
  });

  it("goes by the median, so a few hitches don't count", () => {
    expect(isSlow([...frames(16.7, 80), ...frames(250, 10)])).toBe(false);
  });

  it("needs enough samples to judge", () => {
    expect(isSlow(frames(80, 20))).toBe(false);
  });
});

describe("resolveFx", () => {
  it("lets the visitor's choice win", () => {
    expect(resolveFx({ user: "full", software: true, slow: true })).toMatchObject({ lite: false, source: "user" });
    expect(resolveFx({ user: "lite", software: false, slow: false })).toMatchObject({ lite: true, source: "user" });
  });

  it("goes lite automatically without acceleration or when slow", () => {
    expect(resolveFx({ user: null, software: true, slow: false })).toMatchObject({ lite: true, source: "auto", reason: "no graphics acceleration" });
    expect(resolveFx({ user: null, software: false, slow: true })).toMatchObject({ lite: true, source: "auto", reason: "running slowly" });
    expect(resolveFx({ user: null, software: false, slow: false })).toMatchObject({ lite: false, source: "auto" });
  });
});
