/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), sunken: v('sunken'), line: v('line'),
        ink: v('ink'), muted: v('muted'), accent: v('accent'), 'on-accent': v('on-accent'),
        ok: v('ok'), bad: v('bad'), star: v('star'),
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        fa: ['Vazirmatn', '"Geeza Pro"', 'Tahoma', 'sans-serif'],
      },
      borderRadius: { card: '1.375rem' },
      boxShadow: { card: '0 1px 2px rgb(20 33 43 / 0.05), 0 8px 24px -12px rgb(20 33 43 / 0.18)' },
    },
  },
  plugins: [],
};
