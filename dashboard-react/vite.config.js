import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite config for Oxford 3000 Dashboard (React)
 *
 * Dev proxy: all /api/*, /login, /register, /logout requests are forwarded to
 * the Flask backend running on port 5000.  This means the browser sees a single
 * origin (localhost:5173) so session cookies work without any CORS setup.
 */
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../static/react',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/login': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/register': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/logout': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
