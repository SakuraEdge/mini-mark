import { cp, mkdir } from 'node:fs/promises';

// Keep the LGPL converter replaceable, with its unminified source and license.
for (const [source, target] of [
  ['mathlive/fonts', 'mathlive/fonts'],
  ['mathlive/LICENSE.txt', 'mathlive/LICENSE.txt'],
  ['mathml2omml-plus/dist/index.js', 'mathml2omml/index.js'],
  ['mathml2omml-plus/LICENSE', 'mathml2omml/LICENSE'],
  ['mathml2omml-plus/README.md', 'mathml2omml/README.md'],
]) {
  const destination = new URL(`../public/vendor/${target}`, import.meta.url);
  await mkdir(new URL('.', destination), { recursive: true });
  await cp(new URL(`../node_modules/${source}`, import.meta.url), destination, { recursive: true });
}
for (const name of ['source-0.6.4.tar.gz', 'GPL-3.0.txt', 'NOTICE.txt']) {
  await cp(new URL(`../third_party/mathml2omml-plus/${name}`, import.meta.url), new URL(`../public/vendor/mathml2omml/${name}`, import.meta.url));
}
