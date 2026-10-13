/**
 * Minimal WebGL plumbing shared by HalftoneField and PfpMatrix.
 *
 * Shaders are written once against a few macros so the same source compiles as GLSL ES 3.00
 * (WebGL2) or GLSL ES 1.00 (WebGL1 fallback):
 *   ATTR        vertex attribute         (in / attribute)
 *   VARYING     varying                  (out|in / varying)
 *   FRAG_COLOR  fragment output          (out vec4 / gl_FragColor)
 */

export const GL_ATTRS = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

/** Returns `{ gl, webgl2 }` or null. */
export function getGLContext(canvas, attrs = GL_ATTRS) {
  try {
    let gl = canvas.getContext("webgl2", attrs);
    if (gl) return { gl, webgl2: true };
    gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
    if (gl) return { gl, webgl2: false };
  } catch {
    // fall through
  }
  return null;
}

let support = null;

/** 2 = WebGL2, 1 = WebGL1, 0 = none. Probed once with a throwaway context. */
export function detectWebGL() {
  if (support !== null) return support;
  support = 0;
  if (typeof document === "undefined") return support;
  const probe = getGLContext(document.createElement("canvas"));
  if (probe) {
    support = probe.webgl2 ? 2 : 1;
    probe.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return support;
}

const VS_PRELUDE = {
  2: "#version 300 es\n#define ATTR in\n#define VARYING out\nprecision highp float;\n",
  1: "#define ATTR attribute\n#define VARYING varying\nprecision highp float;\n",
};

const FS_PRELUDE = {
  2: "#version 300 es\nprecision highp float;\n#define VARYING in\nout vec4 fxFragColor;\n#define FRAG_COLOR fxFragColor\n",
  1: "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define VARYING varying\n#define FRAG_COLOR gl_FragColor\n",
};

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[fx] shader compile failed: ${log}`);
  }
  return sh;
}

/** Compile + link. Returns `{ program, uniforms: {name: location}, attribs: {name: index} }`. */
export function createProgram(gl, webgl2, vsBody, fsBody, uniformNames = [], attribNames = []) {
  const v = webgl2 ? 2 : 1;
  const vs = compile(gl, gl.VERTEX_SHADER, VS_PRELUDE[v] + vsBody);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS_PRELUDE[v] + fsBody);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`[fx] program link failed: ${log}`);
  }
  const uniforms = {};
  for (const n of uniformNames) uniforms[n] = gl.getUniformLocation(program, n);
  const attribs = {};
  for (const n of attribNames) attribs[n] = gl.getAttribLocation(program, n);
  return { program, uniforms, attribs };
}

/**
 * Release a context once its canvas has really left the document. Deferred so React StrictMode's
 * mount -> unmount -> mount (same canvas element) keeps a working context, while real unmounts
 * don't pile up live contexts (browsers cap them at ~16).
 */
export function releaseContextLater(canvas, gl) {
  setTimeout(() => {
    if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }, 0);
}

/** Largest gl_PointSize the implementation supports (often 64-1024; WebGL guarantees >= 1). */
export function maxPointSize(gl) {
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  return range ? range[1] : 64;
}

/**
 * GLSL snippets. 3D simplex noise: Ian McEwan / Stefan Gustavson (Ashima Arts), MIT.
 * Returns roughly [-1, 1].
 */
export const GLSL_NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Dave Hoskins' sin-free hash: stable across GPUs (no precision-dependent sin() patterns).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
