import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  server: { port: 4173, strictPort: true, watch: { ignored: ['**/native/**', '**/native-tests/**', '**/native-pdf-tests/**'] } },
  preview: { port: 4173, strictPort: true },
});
