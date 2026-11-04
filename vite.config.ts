import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 4173, strictPort: true, watch: { ignored: ['**/native/**', '**/native-tests/**', '**/native-pdf-tests/**'] } },
  preview: { port: 4173, strictPort: true },
});
