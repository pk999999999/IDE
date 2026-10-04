/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        border: "#292d38",
        background: "#101116",
        foreground: "#d9dce5",
        primary: "#b5a0ff",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
        mono: ["Cascadia Code", "SFMono-Regular", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
