import { createRoot } from "react-dom/client";
// Critical, latin-only faces: the display and dot-matrix fonts used above the fold.
import "@fontsource-variable/unbounded";
import "@fontsource/dotgothic16/latin-400.css";
import "./styles/index.css";
import App from "./App";

import("./styles/fonts-deferred.js");

createRoot(document.getElementById("root")).render(<App />);
