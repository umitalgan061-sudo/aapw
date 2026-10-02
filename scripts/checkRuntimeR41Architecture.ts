
#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../src/3d/strict/r41/', import.meta.url);
const required = [
  'types.ts',
  'clock.ts',
  'eventStore.ts',
  'commandPipeline.ts',
  'scheduler.ts',
  'network.ts',
  'assets.ts',
  'render.ts',
  'persistence.ts',
  'diagnostics.ts',
  'streaming.ts',
  'workers.ts',
  'integrity.ts',
  'runtime.ts',
  'bridge.ts',
  'ownership.ts',
  'index.ts',
];

const forbidden = [
  /@ts-nocheck/,
  /@ts-ignore/,
  /\\beval\\s*\\(/,
  /\\bnew\\s+Function\\s*\\(/,
  /\\bMath\\.random\\s*\\(/,
  /\\bDate\\.now\\s*\\(/,
];

const failures: string[] = [];
let lineCount = 0;

for (const fileName of required) {
  const source = await readFile(new URL(fileName, root), 'utf8').catch(() => '');
  if (!source) {
    failures.push(fileName + ': missing');
    continue;
  }
  lineCount += source.split('\\n').length;
  for (const pattern of forbidden) {
    if (pattern.test(source)) failures.push(fileName + ': forbidden ' + pattern);
  }
  if (!source.includes('export')) failures.push(fileName + ': no exports');
}

const entries = await readdir(root, { withFileTypes: true });
const javascript = entries.filter(entry => entry.isFile() && /\\.(js|mjs|cjs)$/.test(entry.name));
if (javascript.length) failures.push('R41 package contains JavaScript artifacts: ' + javascript.map(entry => entry.name).join(', '));
if (lineCount < 4000) failures.push('R41 strict surface below 4000 source lines: ' + lineCount);

if (failures.length) {
  console.error('R41 architecture gate failed');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  version: 41,
  files: required.length,
  lineCount,
  language: 'TypeScript',
  policy: 'strict-no-escape-hatches',
}));
