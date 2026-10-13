import { createRoot } from "react-dom/client";
// Critical, latin-only faces: the display and dot-matrix fonts used above the fold.
import "@fontsource-variable/unbounded";
import "@fontsource/dotgothic16/latin-400.css";
import "./styles/index.css";
import App from "./App";
import { initFx } from "./fx/perf";

import("./styles/fonts-deferred.js");

// Pick full or lite effects before the first paint (src/fx/perf.js).
initFx();

createRoot(document.getElementById("root")).render(<App />);
