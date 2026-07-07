/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ops console palette — near-black with amber + signal-red accents,
        // deliberately distinct from the admin app's "Maroon Noir".
        ink: {
          950: "#0a0c10",
          900: "#0e1116",
          850: "#12161d",
          800: "#171c25",
          700: "#1f2632",
          600: "#2b3340",
        },
        line: "#26303c",
        amber: {
          DEFAULT: "#f5a623",
          soft: "#f7b955",
        },
        signal: {
          red: "#e5484d",
          green: "#30a46c",
          amber: "#f5a623",
          blue: "#5b8def",
        },
        fog: {
          100: "#e6edf3",
          200: "#c3ced9",
          300: "#94a3b3",
          400: "#6b7887",
        },
      },
      fontFamily: {
        sans: ["Montserrat", "system-ui", "sans-serif"],
        display: ["Playfair Display", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};
