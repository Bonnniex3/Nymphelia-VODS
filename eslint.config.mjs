import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  { ignores: ["prod", "node_modules", "public"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.js", "api/**/*.js", "*.config.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["scripts/fetch-vods.js", "api/**/*.js", "**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },
  {
    // Playwright page.evaluate callbacks run in the browser.
    files: ["scripts/brand/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Legacy filename parser, kept as-is.
    files: ["scripts/fetch-vods.js"],
    rules: { "no-unused-vars": "off", "no-useless-escape": "off", "no-useless-assignment": "off" },
  },
];
