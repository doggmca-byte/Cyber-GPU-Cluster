import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

// Clean Dark Flat UI — суцільні матові поверхні, без неонового світіння/blur.
// Токени "neon.*"/"shadow-neon-*" лишили назви для мінімального diff у
// компонентах (сотні існуючих className), але самі значення тепер приглушені
// акцентні кольори без glow — shadow-neon-* навмисно "none".
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
          DEFAULT: "#0b0e14",
          card: "#161b22",
        },
        neon: {
          cyan: "#22d3ee",
          purple: "#a78bfa",
          green: "#34d399",
          gold: "#fbbf24",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        display: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        "neon-cyan": "none",
        "neon-purple": "none",
        "neon-green": "none",
        "neon-gold": "none",
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
    },
  },
  plugins: [],
};

export default config;
