/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        destructive: "hsl(var(--destructive))",
        // Accents de marque (AGENTS.md) : variables définies dans index.css.
        brand: {
          from: "var(--brand-from)",
          to: "var(--brand-to)",
          foreground: "var(--brand-foreground)",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
