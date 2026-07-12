import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Do NOT inline images as base64. Vite inlines assets under 4 KB by default, which pulled all
    // ~1,700 bundled icons into the JS bundle (10 MB -> 15.4 MB) — meaning the app parses every icon
    // at cold start and holds them all in memory, whether shown or not. On a phone that is a real
    // startup cost. Emitting them as files keeps the JS small and lets the webview load each icon
    // only when it's actually rendered. They're still packaged locally, so offline is unaffected.
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    allowedHosts: [
      'ambitious-hermit-lubricate.ngrok-free.app',
      'ambitious-hermit-lubricate.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok-free.dev',
      'localhost'
    ]
  }
})