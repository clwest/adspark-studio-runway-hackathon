/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0b0f',
        spark: '#f97316',
        // Mid-tones for the studio shell. Gives stage panels a subtle
        // step-up from the body (#0b0b0f) without per-section borders.
        studio: {
          950: '#0d0d12',
          900: '#13131a',
          850: '#191921',
          800: '#1f1f29',
        },
      },
      backgroundImage: {
        // Soft radial centered at top-left, tinted with spark, fading
        // to ink. Adds depth on the hero without per-card borders.
        'studio-glow':
          'radial-gradient(60% 80% at 0% 0%, rgba(249,115,22,0.08), transparent 60%), radial-gradient(50% 60% at 100% 0%, rgba(99,102,241,0.05), transparent 60%)',
      },
      boxShadow: {
        // Subtle inner glow used on stage panels so they read as
        // "panel" without a hard border.
        panel:
          'inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
