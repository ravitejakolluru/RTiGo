/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1519",
        panel: "#111f23",
        mint: "#a8f0c6",
        muted: "#91a39d",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
