import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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