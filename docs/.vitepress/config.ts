import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'KanseiLink',
  description: 'Local-first MCP navigator for AI agents. 11,000+ services, 200 recipes, 89-97% token savings.',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/introduction' },
      { text: 'Tools', link: '/tools/search-services' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@kansei-link/mcp-server' },
      { text: 'GitHub', link: 'https://github.com/kansei-link/kansei-mcp-server' },
    ],

    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'Introduction', link: '/introduction' },
          { text: 'Quickstart', link: '/quickstart' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Standard Flow', link: '/guides/standard-flow' },
          { text: 'Migration to v1.0', link: '/guides/migration-v1' },
        ],
      },
      {
        text: 'Tools Reference',
        items: [
          { text: 'search_services', link: '/tools/search-services' },
          { text: 'lookup', link: '/tools/lookup' },
          { text: 'report', link: '/tools/report' },
          { text: 'inspect', link: '/tools/inspect' },
          { text: 'analyze', link: '/tools/analyze' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/kansei-link/kansei-mcp-server' },
      { icon: 'x', link: 'https://x.com/KanseiLink' },
    ],

    editLink: {
      pattern: 'https://github.com/kansei-link/kansei-mcp-server/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message: 'MIT License',
      copyright: 'Synapse Arrows PTE. LTD.',
    },
  },
})
