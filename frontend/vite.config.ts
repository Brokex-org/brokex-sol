import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/ostium': {
        target: 'https://metadata-backend.ostium.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ostium/, '')
      },
      '/api/pyth': {
        target: 'https://benchmarks.pyth.network',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pyth/, '')
      },
      '/api/datalake': {
        target: 'https://data-lake.ostium.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/datalake/, '/api')
      }
    }
  },
  define: {
    // Répare l'erreur "process is not defined"
    'process.env': {},
    // Répare l'erreur "global is not defined"
    global: 'globalThis',
  },
  resolve: {
    // @pythnetwork/solana-utils → jito-ts pins @solana/web3.js ~1.77, which imports removed
    // rpc-websockets subpaths. Dedupe so the whole graph uses the app’s @solana/web3.js ^1.98.
    dedupe: ['@solana/web3.js', 'rpc-websockets'],
    alias: {
      // Dit à Vite où trouver ces modules Node.js
      process: "process/browser",
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    include: ['@solana/web3.js', 'rpc-websockets'],
  },
})
