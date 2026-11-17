/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), sunken: v('sunken'), line: v('line'),
        ink: v('ink'), muted: v('muted'), accent: v('accent'), 'accent-soft': v('accent-soft'), 'on-accent': v('on-accent'),
        ok: v('ok'), 'ok-soft': v('ok-soft'), bad: v('bad'), 'bad-soft': v('bad-soft'), star: v('star'),
      },
      borderRadius: { card: '1.5rem' },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.05), 0 10px 30px -14px rgb(var(--shadow) / 0.22)',
        lift: '0 2px 4px rgb(var(--shadow) / 0.06), 0 22px 44px -18px rgb(var(--shadow) / 0.32)',
      },
    },
  },
  plugins: [],
};
