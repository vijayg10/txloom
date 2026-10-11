import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'
import { viteBundler } from '@vuepress/bundler-vite'

export default defineUserConfig({
  lang: 'en-US',

  title: 'TxLoom',
  description: 'Synthetic Transaction Studio. A self-hosted payments world simulator.',

  // Served from https://vijayg10.github.io/txloom/ on GitHub Pages
  base: '/txloom/',

  theme: defaultTheme({
    logo: '/images/txloom_logo.png',

    navbar: [
      { text: 'Home', link: '/' },
      {
        text: 'Get to Know',
        children: [
          { text: 'What is TxLoom?', link: '/get-to-know/what-is-txloom' },
          { text: 'How It Works', link: '/get-to-know/how-it-works' },
          { text: 'Features', link: '/get-to-know/features' },
        ],
      },
      {
        text: 'Gallery',
        children: [
          { text: 'Screenshots', link: '/gallery/screenshots' },
          { text: 'Demo Videos', link: '/gallery/demo-videos' },
        ],
      },
      {
        text: 'Documentation',
        children: [
          { text: 'Installation Guide', link: '/guide/installation' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Scenario Spec', link: '/guide/scenario-spec' },
          { text: 'Under the Hood', link: '/technical/architecture' },
        ],
      },
    ],

    sidebar: {
      '/get-to-know/': [
        {
          text: 'Get to Know',
          children: [
            '/get-to-know/what-is-txloom',
            '/get-to-know/how-it-works',
            '/get-to-know/features',
          ],
        },
      ],
      '/guide/': [
        {
          text: 'Getting Started',
          children: [
            '/guide/installation',
            '/guide/configuration',
            '/guide/scenario-spec',
          ],
        },
      ],
      '/gallery/': [
        {
          text: 'Gallery',
          children: [
            '/gallery/screenshots',
            '/gallery/demo-videos',
          ],
        },
      ],
      '/technical/': [
        {
          text: 'Under the Hood',
          children: [
            '/technical/architecture',
            '/technical/tech-stack',
            '/technical/generation-engine',
            '/technical/sinks',
            '/technical/agent-authoring',
          ],
        },
      ],
    },

    colorMode: 'light',
    colorModeSwitch: false,
    editLink: false,
    lastUpdated: false,
  }),

  bundler: viteBundler(),

  plugins: [],
})
