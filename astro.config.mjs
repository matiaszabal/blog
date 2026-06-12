// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://matiaszabal.github.io/blog',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: false,
    },
  },
});
