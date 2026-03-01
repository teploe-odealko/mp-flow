/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/client/**/*.{tsx,ts,html}"],
  theme: {
    extend: {
      colors: {
        "bg-deep": "var(--bg-deep)",
        "bg-surface": "var(--bg-surface)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-border": "var(--bg-border)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "accent-light": "var(--accent-light)",
        "accent-dark": "var(--accent-dark)",
        "accent-glow": "var(--accent-glow)",
        inflow: "var(--color-inflow)",
        outflow: "var(--color-outflow)",
        risk: "var(--color-risk)",
        loss: "var(--color-loss)",
      },
    },
  },
  plugins: [],
}
