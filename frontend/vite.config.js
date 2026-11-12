import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5166,
    proxy: {
      '/api': 'http://127.0.0.1:3066',
      '/socket.io': {
        target: 'http://127.0.0.1:3066',
        ws: true,
      },
    },
  },
});
