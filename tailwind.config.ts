import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme inspired by trading terminals
        'terminal': {
          'bg': '#0a0e17',
          'card': '#111827',
          'border': '#1f2937',
          'hover': '#1a2332',
        },
        'profit': {
          'low': '#22c55e',
          'mid': '#4ade80',
          'high': '#86efac',
        },
        'loss': {
          'low': '#ef4444',
          'mid': '#f87171',
          'high': '#fca5a5',
        },
        'accent': {
          'cyan': '#06b6d4',
          'purple': '#a855f7',
          'amber': '#f59e0b',
        },
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'monospace'],
        'display': ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
