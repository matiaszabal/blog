// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://matiaszabal.github.io',
  base: '/blog',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: false,
    },
  },
});
