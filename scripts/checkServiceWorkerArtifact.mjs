import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile('service-worker.ts', 'utf8');
const artifact = await readFile('service-worker.js', 'utf8');

const expected = createHash('sha256').update(source, 'utf8').digest('hex');
const match = artifact.match(/source-sha256:\s*([a-f0-9]{64})/u);

if (!match) {
  console.error('service-worker.js is missing the generated source hash');
  process.exit(1);
}
if (match[1] !== expected) {
  console.error(`service-worker.js hash mismatch: expected ${expected}, found ${match[1]}`);
  process.exit(1);
}

const generatedMarker = artifact.startsWith('/* generated-from: service-worker.ts; source-sha256:');
if (!generatedMarker) {
  console.error('service-worker.js is not marked as a generated TypeScript browser artifact');
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  source: 'service-worker.ts',
  artifact: 'service-worker.js',
  sourceSha256: expected,
  policy: 'browser-artifact-must-reference-current-TypeScript-source',
}, null, 2));
