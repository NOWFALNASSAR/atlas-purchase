/** @type {import('tailwindcss').Config} */

/* The colour names are unchanged on purpose — ink, slate2, line, paper,
   gold, good, bad. Every page already uses them, so retheming happens
   here and nowhere else. The values are new: lower chroma, a deeper
   navy, and a brass accent that is now rare enough to mean something. */

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    screens: {
      xs: '420px',
      sm: '640px',
      md: '768px',    // tablet portrait — sidebar rail appears
      lg: '1024px',   // laptop — sidebar opens
      xl: '1280px',
      '2xl': '1536px'
    },
    extend: {
      colors: {
        ink:    '#0E1B2E',   // navy — headers, sidebar, primary action
        ink2:   '#1B2C46',   // raised navy, sidebar hover
        ink3:   '#33465F',   // navy text on light
        slate2: '#5B6879',   // secondary text
        mute:   '#8B94A2',   // tertiary text, placeholders
        line:   '#E2E6EC',   // borders
        line2:  '#EEF1F5',   // inner rules, zebra
        paper:  '#F4F6F9',   // canvas
        gold:   '#A97721',   // brass — the one accent
        gold2:  '#FBF6EC',   // brass wash
        good:   '#12704E',
        bad:    '#A4362B',
        warn:   '#A9761A'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
               'Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '15px', letterSpacing: '0.01em' }],
        xs:    ['12px', { lineHeight: '17px' }],
        sm:    ['13px', { lineHeight: '19px' }],
        base:  ['14px', { lineHeight: '21px' }],
        lg:    ['16px', { lineHeight: '23px' }],
        xl:    ['19px', { lineHeight: '26px', letterSpacing: '-0.011em' }],
        '2xl': ['23px', { lineHeight: '30px', letterSpacing: '-0.016em' }],
        '3xl': ['29px', { lineHeight: '35px', letterSpacing: '-0.021em' }],
        '4xl': ['36px', { lineHeight: '42px', letterSpacing: '-0.024em' }]
      },
      borderRadius: { DEFAULT: '6px', md: '7px', lg: '10px', xl: '14px' },
      boxShadow: {
        card: '0 1px 2px rgba(14,27,46,.05)',
        pop:  '0 10px 34px -6px rgba(14,27,46,.18), 0 2px 6px rgba(14,27,46,.06)',
        rail: '1px 0 0 rgba(14,27,46,.06)'
      },
      maxWidth: { content: '1560px' },
      transitionDuration: { DEFAULT: '150ms' }
    }
  },
  plugins: []
}
