import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'replaceable-equation-converter',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'mathml2omml-plus') return { id: './vendor/mathml2omml/index.js', external: true };
    },
  }],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  build: { target: 'es2022', sourcemap: true, rollupOptions: { output: { paths: { './vendor/mathml2omml/index.js': '../vendor/mathml2omml/index.js' } } } },
  server: { port: 4173, strictPort: true, watch: { ignored: ['**/native/**', '**/native-tests/**', '**/native-pdf-tests/**'] } },
  preview: { port: 4173, strictPort: true },
});
