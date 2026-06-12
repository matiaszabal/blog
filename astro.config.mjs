// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://matiasz-nowvertical.github.io',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: false,
    },
  },
});
