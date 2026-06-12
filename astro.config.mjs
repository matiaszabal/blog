// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://matiasz-nowvertical.github.io',
  base: '/blog',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: false,
    },
  },
});
