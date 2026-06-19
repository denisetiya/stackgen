/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx,md,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f7f7f8',
          100: '#eeeef1',
          200: '#d8d8df',
          300: '#b6b6c2',
          400: '#8e8ea0',
          500: '#6e6e80',
          600: '#565667',
          700: '#3f3f4d',
          800: '#27272e',
          900: '#18181b',
          950: '#0c0c0f',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
