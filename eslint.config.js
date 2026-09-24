"use strict";

const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        // Node 18+ web-platform globals (fetch, AbortController, URL) used
        // by the geo-welcome lookup and URL allow-listing.
        fetch: "readonly",
        AbortController: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
      "no-shadow": "warn",
    },
  },
  {
    // `.mjs` files are ES modules by definition (scripts/generate-app-icons.mjs,
    // scripts/generate-favicon.mjs, apps/landing/next.config.mjs, and the CI
    // result asserter). Without this override the shared commonjs block above
    // makes `import`/`export` a parse error, so they cannot be linted at all.
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["tests/**/*.js", "**/*.test.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    // Cloudflare Email Worker — runs on the Workers runtime and MUST be an ES
    // module (the email() handler only exists in `export default`). Lint it as
    // a module and declare the Web/Workers globals it uses so `import` and
    // crypto/TextEncoder/fetch don't false-positive as parse/undef errors.
    files: ["cloudflare/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        crypto: "readonly",
        TextEncoder: "readonly",
        Uint8Array: "readonly",
        fetch: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
