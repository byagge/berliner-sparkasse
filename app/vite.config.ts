import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    open: '/',
    proxy: {
      '/de': { target: 'http://localhost:5180', changeOrigin: true },
      '/fi': { target: 'http://localhost:5180', changeOrigin: true },
      '/en': { target: 'http://localhost:5180', changeOrigin: true },
      '/content': { target: 'http://localhost:5180', changeOrigin: true },
      '/etc': { target: 'http://localhost:5180', changeOrigin: true },
      '/__module': { target: 'http://localhost:5180', changeOrigin: true },
      '/__sparkasse': { target: 'http://localhost:5180', changeOrigin: true },
      '/api': { target: 'http://localhost:5180', changeOrigin: true },
    },
  },
});
