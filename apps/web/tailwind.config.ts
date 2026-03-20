import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      colors: {
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
        },
        surface: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
          card: "var(--bg-card)",
        },
        content: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        border: "var(--border)",
        priority: {
          urgent: "#EF4444",
          high: "#F97316",
          medium: "#EAB308",
          low: "var(--text-tertiary)",
        },
        success: "#22C55E",
        warning: "#EAB308",
        error: "#EF4444",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "card-highlight": {
          "0%": { borderColor: "var(--accent)" },
          "100%": { borderColor: "var(--border)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "card-highlight": "card-highlight 1s ease-out forwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
