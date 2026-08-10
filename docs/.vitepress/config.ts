import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'KanseiLink Docs',
  description: 'Official documentation for the KanseiLink MCP server — SaaS integration intelligence for AI agents. Search 11,000+ services, get connection tips and recipes, report outcomes.',

  // Internal working documents — never publish (mirrors repo .gitignore policy).
  srcExclude: ['launch/**', 'vendor-reports/**', '.drafts/**'],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'google-site-verification', content: 'Hag98isHABdrjl_MlcNaBYn4vCdFcjqEEmZ8LGpoQto' }],
    ['meta', { property: 'og:site_name', content: 'KanseiLink Docs' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': 'https://docs.kansei-link.com/#website',
          url: 'https://docs.kansei-link.com/',
          name: 'KanseiLink Docs',
          description: 'Official documentation for the KanseiLink MCP server.',
          inLanguage: 'en',
          publisher: { '@id': 'https://kansei-link.com/#organization' },
        },
        {
          '@type': 'Organization',
          '@id': 'https://kansei-link.com/#organization',
          name: 'KanseiLink',
          url: 'https://kansei-link.com',
          parentOrganization: {
            '@type': 'Organization',
            '@id': 'https://synapsearrows.com/#organization',
            name: 'Synapse Arrows Pte. Ltd.',
            url: 'https://synapsearrows.com',
          },
          sameAs: [
            'https://github.com/kansei-link/kansei-mcp-server',
            'https://www.npmjs.com/package/@kansei-link/mcp-server',
          ],
        },
      ],
    })],
  ],

  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/((^|\/)index)?\.md$/, '$2')
    const canonical = `https://docs.kansei-link.com/${path}${path && !path.endsWith('/') ? '.html' : ''}`
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:title', content: pageData.title || 'KanseiLink Docs' }],
    )
    return pageData
  },

  sitemap: {
    hostname: 'https://docs.kansei-link.com',
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/introduction' },
      { text: 'Tools', link: '/tools/search-services' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@kansei-link/mcp-server' },
      { text: 'GitHub', link: 'https://github.com/kansei-link/kansei-mcp-server' },
      { text: 'Ratings', link: 'https://kansei-link.com' },
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
          { text: 'OpenClaw Plugin', link: '/guides/openclaw' },
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
      message: 'MIT License · <a href="https://kansei-link.com">kansei-link.com</a>',
      copyright: '<a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a>',
    },
  },
})
