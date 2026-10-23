import { mkdir, cp } from 'node:fs/promises';
const target = new URL('../dist/extension/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'favicon.svg', 'src', 'extension']) await cp(new URL(`../${name}`, import.meta.url), new URL(name, target), { recursive: true });
await cp(new URL('../extension/manifest.json', import.meta.url), new URL('manifest.json', target));
console.log('Load unpacked: dist/extension');
