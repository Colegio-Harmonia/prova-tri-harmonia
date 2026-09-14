import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        harmonia: {
          green: 'rgb(var(--color-action-primary) / <alpha-value>)',
        },
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          subtle: 'rgb(var(--color-surface-subtle) / <alpha-value>)',
          raised: 'rgb(var(--color-surface-raised) / <alpha-value>)',
        },
        content: {
          primary: 'rgb(var(--color-content-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-content-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-content-muted) / <alpha-value>)',
          inverse: 'rgb(var(--color-content-inverse) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        action: {
          primary: 'rgb(var(--color-action-primary) / <alpha-value>)',
          'primary-hover': 'rgb(var(--color-action-primary-hover) / <alpha-value>)',
          'primary-foreground': 'rgb(var(--color-action-primary-foreground) / <alpha-value>)',
          danger: 'rgb(var(--color-action-danger) / <alpha-value>)',
          'danger-hover': 'rgb(var(--color-action-danger-hover) / <alpha-value>)',
        },
        status: {
          success: {
            DEFAULT: 'rgb(var(--color-status-success) / <alpha-value>)',
            surface: 'rgb(var(--color-status-success-surface) / <alpha-value>)',
            content: 'rgb(var(--color-status-success-content) / <alpha-value>)',
            border: 'rgb(var(--color-status-success-border) / <alpha-value>)',
          },
          warning: {
            DEFAULT: 'rgb(var(--color-status-warning) / <alpha-value>)',
            surface: 'rgb(var(--color-status-warning-surface) / <alpha-value>)',
            content: 'rgb(var(--color-status-warning-content) / <alpha-value>)',
            border: 'rgb(var(--color-status-warning-border) / <alpha-value>)',
          },
          danger: {
            DEFAULT: 'rgb(var(--color-status-danger) / <alpha-value>)',
            surface: 'rgb(var(--color-status-danger-surface) / <alpha-value>)',
            content: 'rgb(var(--color-status-danger-content) / <alpha-value>)',
            border: 'rgb(var(--color-status-danger-border) / <alpha-value>)',
          },
          info: {
            DEFAULT: 'rgb(var(--color-status-info) / <alpha-value>)',
            surface: 'rgb(var(--color-status-info-surface) / <alpha-value>)',
            content: 'rgb(var(--color-status-info-content) / <alpha-value>)',
            border: 'rgb(var(--color-status-info-border) / <alpha-value>)',
          },
        },
        focus: 'rgb(var(--color-focus) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'sans-serif'],
        display: ['var(--font-display)', 'serif'],
      },
      spacing: {
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.25rem',
        6: '1.5rem',
        8: '2rem',
        10: '2.5rem',
        12: '3rem',
        16: '4rem',
        grid: '0.5rem',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        raised: 'var(--shadow-raised)',
      },
      transitionTimingFunction: {
        productive: 'var(--ease-productive)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        DEFAULT: 'var(--duration-default)',
      },
    },
  },
  plugins: [],
}

export default config
