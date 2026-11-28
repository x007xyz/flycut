const plugin = require('tailwindcss/plugin')
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    minHeight: {
      '8': '2rem',
      '600': '600px',
      'full': '100%'
    },
    extend: {
      cursor:{
        'r-resize': 'row-resize',
        'c-resize': 'col-resize',
        grab: 'grab',
      },
      lineHeight: {
        '16': '4rem',
        '12': '3rem',
      },
      minWidth: {
        '1256': '1256px'
      },
      spacing: {
        '100': '25rem',
        '24': '6rem',
        '34': '8.5rem',
        '22': '5.5rem'
      },
      colors: {
        'dark': '#1b1c20',
        'darker': '#111215',
        'light': '#ece8df',
        'lighter': '#f5f2eb',
        'accent': '#ff735c',
        // 暖灰色阶，取自品牌配色（ink / panel / line / muted / paper）
        gray: {
          50: '#f5f2eb',
          100: '#ece8df',
          200: '#dcd7cc',
          300: '#c9c4ba',
          400: '#b8b6be',
          500: '#77717a',
          600: '#595653',
          700: '#3a3a42',
          800: '#212227',
          900: '#1b1c20',
          950: '#111215'
        },
        zinc: {
          100: '#ece8df',
          200: '#dcd7cc',
          700: '#212227'
        },
        indigo: { 400: '#ff735c' },
        blue: { 400: '#ff735c' },
      },
    }
  },
  plugins: [
    require('@tailwindcss/aspect-ratio'),
    require('@tailwindcss/line-clamp'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    plugin(function ({ addVariant, e, postcss }) {
      addVariant('firefox', ({ container, separator }) => {
        const isFirefoxRule = postcss.atRule({
          name: '-moz-document',
          params: 'url-prefix()',
        })
        isFirefoxRule.append(container.nodes)
        container.append(isFirefoxRule)
        isFirefoxRule.walkRules((rule) => {
          rule.selector = `.${e(`firefox${separator}${rule.selector.slice(1)}`)}`
        })
      })
    })
  ]
};
