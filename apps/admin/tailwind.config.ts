import type { Config } from "tailwindcss";

/**
 * Tokens are CSS variables holding "R G B" triplets, consumed as
 * rgb(var(--token) / <alpha-value>). Defaults live in src/styles/index.css
 * (:root = Maroon Noir dark) and [data-theme="light"]. The ThemeProvider can
 * overwrite them at runtime per-deployment (Layer A) and per-business (Layer B),
 * so the whole app is re-themeable with no rebuild. See FRONTEND canon §2.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--panel) / <alpha-value>)",
          2: "rgb(var(--panel-2) / <alpha-value>)",
        },
        line: "rgb(var(--border-c) / <alpha-value>)",
        text: {
          primary: "rgb(var(--text) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
          faint: "rgb(var(--text-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          deep: "rgb(var(--accent-deep) / <alpha-value>)",
          glow: "rgb(var(--accent-glow) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        sage: "rgb(var(--sage) / <alpha-value>)",
        rose: "rgb(var(--rose) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: { xl2: "var(--radius)" },
      boxShadow: {
        glass: "var(--glass-shadow)",
        glow: "0 0 30px rgb(var(--accent) / 0.22)",
      },
      transitionTimingFunction: { brand: "cubic-bezier(.16,1,.3,1)" },
      keyframes: {
        "tile-in": {
          from: { opacity: "0", transform: "translateY(10px) scale(.98)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "-100% 0" },
        },
      },
      animation: {
        "tile-in": "tile-in .5s cubic-bezier(.16,1,.3,1) backwards",
        "fade-in": "fade-in .3s ease-out",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
