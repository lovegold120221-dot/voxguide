import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // Public env vars only - NEVER expose secrets to frontend
      'import.meta.env.VITE_APP_URL': JSON.stringify(env.VITE_APP_URL || env.APP_URL || ''),
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(env.VITE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || ''),
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(env.VITE_BACKEND_URL || env.VITE_SANDBOX_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': 'http://localhost:4200',
        '/site-build': 'http://localhost:4200',
        '/beatrice-workspace': 'http://localhost:4200',
        '/socket.io': {
          target: 'http://localhost:4200',
          ws: true,
        },
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
