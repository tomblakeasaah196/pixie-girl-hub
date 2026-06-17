import type { Config } from "tailwindcss";

/**
 * Maroon Noir palette + canon tokens. Mirrors the admin app's tokens
 * (apps/admin/tailwind.config.ts) so the landing inherits the same
 * brand language. Per-business Layer B tint is applied at runtime via
 * the brand id from the resolved Host → brand mapping (see app/sale).
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        "panel-2": "rgb(var(--panel-2) / <alpha-value>)",
        "text-primary": "rgb(var(--text) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
        "text-faint": "rgb(var(--text-faint) / <alpha-value>)",
        line: "rgb(var(--border-c) / 0.08)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-deep": "rgb(var(--accent-deep) / <alpha-value>)",
        "accent-glow": "rgb(var(--accent-glow) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        glass: "var(--radius)",
      },
      backdropBlur: {
        glass: "22px",
        drop: "28px",
      },
      boxShadow: {
        glass:
          "inset 0 1px 0 rgb(255 255 255 / 0.05), 0 18px 44px rgb(0 0 0 / 0.6)",
        cta: "0 8px 26px rgb(var(--accent-deep) / 0.5)",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(.16,1,.3,1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "cta-breathe": {
          "0%, 100%": {
            boxShadow: "0 8px 26px rgb(var(--accent-deep) / 0.4)",
          },
          "50%": {
            boxShadow: "0 12px 38px rgb(var(--accent-deep) / 0.65)",
          },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(-1.5%, 1%)" },
        },
        "ticker-pop": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "12%": { opacity: "1", transform: "translateY(0)" },
          "88%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-8px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 600ms cubic-bezier(.16,1,.3,1) both",
        "rise-in": "rise-in 700ms cubic-bezier(.16,1,.3,1) both",
        "cta-breathe": "cta-breathe 3.6s ease-in-out infinite",
        drift: "drift 26s ease-in-out infinite",
        "ticker-pop": "ticker-pop 7s ease-in-out forwards",
      },
    },
  },
  plugins: [],
};
export default config;
