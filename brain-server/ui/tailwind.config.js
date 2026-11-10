/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          900: '#0B0A0F',
          800: '#12111A',
          700: '#1C1A26',
        },
        amethyst: {
          700: '#7E22CE',
          500: '#A855F7',
          400: '#C084FC',
          300: '#E9D5FF',
        },
        electric: {
          pink: '#F472B6',
          indigo: '#6366F1',
        },
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(168, 85, 247, 0.15)',
      },
    },
  },
  plugins: [],
};