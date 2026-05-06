export default {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        plb: {
          bg: "#000000",
          card: "#1e1830",
          card2: "#231d38",
          text: "#f8f0ff",
          muted: "#b8a8d8",
          pink: "#ff6eb4",
          purple: "#a855f7",
          gold: "#f4d27a",
        },
      },
      boxShadow: {
        "plb-glow": "0 0 22px rgba(168, 85, 247, 0.45), 0 0 38px rgba(255, 110, 180, 0.28)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Morpheus", "Inter", "ui-sans-serif", "sans-serif"],
      },
      borderRadius: {
        xl2: "14px",
      },
    },
  },
};
