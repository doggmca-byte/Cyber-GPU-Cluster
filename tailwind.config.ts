import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

// Cyberpunk Dark Glassmorphism
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#080b11",
          card: "#101726",
        },
        neon: {
          cyan: "#22d3ee",
          purple: "#b026ff",
          green: "#39ff88",
          gold: "#ffb800",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        display: ["var(--font-orbitron)", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        "neon-cyan": "0 0 20px -2px rgba(34, 211, 238, 0.35)",
        "neon-purple": "0 0 20px -2px rgba(176, 38, 255, 0.35)",
        "neon-green": "0 0 20px -2px rgba(57, 255, 136, 0.35)",
        "neon-gold": "0 0 20px -2px rgba(255, 184, 0, 0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
      height: {
        dvh: "100dvh",
      },
      minHeight: {
        dvh: "100dvh",
      },
      keyframes: {
        "neon-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px -2px rgba(34, 211, 238, 0.35)" },
          "50%": { boxShadow: "0 0 42px 2px rgba(34, 211, 238, 0.65)" },
        },
      },
      animation: {
        "neon-pulse": "neon-pulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
