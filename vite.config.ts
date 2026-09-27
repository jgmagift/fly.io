import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  // Relative asset paths so one build works on Vercel, Cloudflare, GitHub Pages and itch.io alike.
  base: './',
  build: { target: 'es2022' },
  // `pnpm dev:vr` serves over https with a self-signed certificate, because WebXR only runs on secure pages.
  plugins: mode === 'vr' ? [basicSsl()] : [],
}))
