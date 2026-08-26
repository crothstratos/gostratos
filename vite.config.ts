import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    // NOTE: the GEMINI_API_KEY `define` was removed during the Firebase migration.
    // It inlined the Gemini key into the shipped client bundle. Nothing in src/
    // reads process.env, so this was pure exposure with no benefit.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
    },
    optimizeDeps: {
      exclude: ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage']
    },
    build: {
      target: 'esnext'
    }
  };
});
