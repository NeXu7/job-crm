import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same .env as the server (CRM_PORT may live there); real env vars win.
const envFile = fileURLToPath(new URL('./.env', import.meta.url));
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const api = `http://127.0.0.1:${process.env.CRM_PORT || 4317}`;

export default defineConfig({
  // absolute, so the build does not depend on the current directory
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api/': api, '/fonts/': api },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    // one bundle served from localhost: its size costs nothing, so no "chunks are larger than 500 kB" on every start
    chunkSizeWarningLimit: 1000,
  },
});
