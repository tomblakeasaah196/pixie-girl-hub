// Flat ESLint config for the admin app (ESLint v9). The standard Vite +
// React + TypeScript setup: typescript-eslint recommended, the react-hooks
// rules (rules-of-hooks as an error, exhaustive-deps as a warning), and the
// react-refresh guard for fast-refresh-safe exports. Scoped to src/ so build
// output and config files are never linted.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "**/*.d.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // `any` shows up at a few hard-to-type boundaries (kept as a warning, not
      // a hard failure); unused vars are a warning and respect the `_` prefix.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Intentional patterns in this codebase: silent `catch {}` for best-effort
      // work, and `cond ? a() : b()` / `cond && fn()` as terse statements.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
);
