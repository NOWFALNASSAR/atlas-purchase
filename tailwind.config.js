/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:    '#12203A',   // deep indigo - dye vat
        slate2: '#4A5A73',
        line:   '#DFE3EA',
        paper:  '#F7F8FA',
        gold:   '#C8892B',   // marigold - the one accent
        good:   '#1F7A54',
        bad:    '#B23A2F'
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}
