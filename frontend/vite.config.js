import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy export libraries into a separate lazy-loaded chunk
          'export-libs': ['jspdf', 'jspdf-autotable', 'xlsx', 'jszip', 'file-saver'],
          // Split React router and core vendor
          vendor: ['react', 'react-dom', 'react-router-dom'],
          // Split axios
          axios: ['axios'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['jspdf', 'jspdf-autotable', 'xlsx', 'jszip', 'file-saver'],
  },
})
