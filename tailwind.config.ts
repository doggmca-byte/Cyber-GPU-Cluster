import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

// Neon glow повернено за прямим запитом (референс-мокап Farm-екрану,
// 2026-08-19) — попередній коміт "Clean Dark Flat UI" навмисно глушив
// shadow-neon-* до "none"; тепер вони знову реальні box-shadow. Самі кольори
// (neon.*) не змінювались, лишень box-shadow. Застосовується вибірково — на
// акцентних/CTA елементах (кнопки, hero-картки, бейджі), а не на кожній
// glass-card поспіль, щоб не заглушити ієрархію (той самий принцип, що й на
// референс-мокапі: звичайні рядки списку без світіння, лише ключові елементи).
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
        "neon-cyan": "0 0 1px rgba(34, 211, 238, 0.8), 0 0 22px rgba(34, 211, 238, 0.35)",
        "neon-purple": "0 0 1px rgba(167, 139, 250, 0.8), 0 0 22px rgba(167, 139, 250, 0.35)",
        "neon-green": "0 0 1px rgba(52, 211, 153, 0.8), 0 0 22px rgba(52, 211, 153, 0.35)",
        "neon-gold": "0 0 1px rgba(251, 191, 36, 0.8), 0 0 22px rgba(251, 191, 36, 0.35)",
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
