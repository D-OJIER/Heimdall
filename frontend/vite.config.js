import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    port: 3000,
    strictPort: true,
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    open: false,
  },
})
