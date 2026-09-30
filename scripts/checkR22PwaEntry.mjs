import { readFile } from 'node:fs/promises';

const sw = await readFile('service-worker.js', 'utf8');
const index = await readFile('index.html', 'utf8');

const failures = [];
if (!sw.includes("const SHELL_CACHE = 'westeros-shell-v22';")) failures.push('service worker cache version is not v22');
if (!sw.includes("'./script.ts'")) failures.push('script.ts is missing from the PWA shell cache');
if (!index.includes('<script type="module" src="script.ts"></script>')) failures.push('index.html does not load script.ts as its primary entry');

if (failures.length) {
  console.error('R22 PWA entry guard failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('R22 PWA entry guard passed.');
