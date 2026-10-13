// Japanese-capable faces ship ~120 unicode-range subsets each, so their CSS is
// loaded as a separate, non-blocking chunk. Text renders immediately in the
// fallback stack and swaps in when these arrive (font-display: swap).
import "@fontsource/dotgothic16/japanese-400.css";
import "@fontsource/m-plus-rounded-1c/500.css";
import "@fontsource/m-plus-rounded-1c/700.css";
