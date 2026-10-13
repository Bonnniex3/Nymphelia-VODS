// Visual effects layer. Each effect is self-contained (own canvas, own loop, own cleanup).
export { default as HalftoneField } from "./HalftoneField.jsx";
export { default as DotMatrix } from "./DotMatrix.jsx";
export { default as KanaRain } from "./KanaRain.jsx";
export { default as PfpMatrix } from "./PfpMatrix.jsx";
export { default as CursorSparkles } from "./CursorSparkles.jsx";
export { textToDotColumns, glyphColumns, DOT_FONT_ROWS } from "./dotFont.js";
export { useMediaQuery, usePrefersReducedMotion } from "./media.js";
export { PALETTE } from "./palette.js";
export { initFx, setFxMode, useFx, useLiteFx } from "./perf.js";
