import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths so one build works on Cloudflare, GitHub Pages and itch.io alike.
  base: './',
  build: { target: 'es2022' },
})
