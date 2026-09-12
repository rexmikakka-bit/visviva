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
    port: 5173,
    strictPort: true,
    // mutamarket.com sends no CORS headers, so a browser cannot call it directly and the market
    // side of the compare tab is unreviewable on the dev server without this. The installed app
    // goes straight to `MUTAMARKET_API` (CapacitorHttp has replaced fetch by then) and never uses
    // this prefix — see `apiBase()` in src/lib/mutamarket-client.js. The User-Agent is MutaMarket's
    // asked-for contact string, duplicated from `MUTAMARKET_USER_AGENT` because importing it here
    // would pull the whole game-data bundle into the Vite config.
    proxy: {
      '/mutamarket-api': {
        target: 'https://mutamarket.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/mutamarket-api/, '/api'),
        headers: { 'User-Agent': 'Axis EVE fitting tool (rexmikakka@gmail.com)' }
      }
    },
    allowedHosts: [
      'ambitious-hermit-lubricate.ngrok-free.app',
      'ambitious-hermit-lubricate.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok-free.dev',
      'localhost'
    ]
  }
})