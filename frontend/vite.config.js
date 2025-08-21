import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'window',
    'process.env': {},
    'process.versions': {},
    'process.browser': true,
    'process.nextTick': '((cb) => setTimeout(cb, 0))',
  },
  build: {
    rollupOptions: {
      input: 'src/main.jsx'
    }
  },
  resolve: {
    alias: {
      util: 'util/',
      process: 'process/browser',
  // removed stream alias to avoid pulling Node stream polyfills that break simple-peer
      zlib: 'browserify-zlib',
      events: 'events',
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  },
  preview: {
    port: 3000,
    strictPort: true,
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    open: false,
    // Proxy local API calls to the signaling server which now exposes /api/ip
    proxy: {
      '/api': {
        // Use explicit IPv4 loopback to avoid IPv6 (::1) connection refused on some Windows setups
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      }
    }
  },
});
