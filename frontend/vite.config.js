import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5166,
    proxy: {
      '/api': 'http://localhost:3066',
      '/socket.io': {
        target: 'http://localhost:3066',
        ws: true,
      },
    },
  },
});
