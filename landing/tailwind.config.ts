import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        palate: {
          red: "#FF3008",
          ink: "#111111",
          paper: "#FFFFFF",
          mute: "#717171",
          line: "#EBEBEB",
          soft: "#F7F7F7",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tightish: "-0.02em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.04)",
        cardHover:
          "0 4px 12px rgba(0,0,0,0.08), 0 16px 32px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [typography],
};

export default config;
