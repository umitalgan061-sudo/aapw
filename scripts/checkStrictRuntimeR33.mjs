import { readFile } from 'node:fs/promises';

const strictFiles = [
  'src/3d/camera.ts',
  'src/3d/renderBackendCapability.ts',
  'src/3d/strict/runtimeWatchdogR33.ts',
  'src/3d/modern/modernRuntimeFacade.ts',
];

const failures = [];
for (const path of strictFiles) {
  const source = await readFile(path, 'utf8').catch(() => null);
  if (!source) {
    failures.push(path + ': missing');
    continue;
  }
  if (source.includes('@ts-nocheck')) failures.push(path + ': @ts-nocheck is forbidden');
  if (source.includes('@ts-ignore')) failures.push(path + ': @ts-ignore is forbidden');
  if (/\beval\s*\(/.test(source)) failures.push(path + ': eval is forbidden');
  if (/\bnew Function\s*\(/.test(source)) failures.push(path + ': dynamic Function is forbidden');
}

const facade = await readFile('src/3d/modern/modernRuntimeFacade.ts', 'utf8');
for (const needle of [
  "from '../strict/runtimeWatchdogR33.ts'",
  'this.watchdog = new RuntimeWatchdogR33()',
  'this.watchdog.observe',
  "this.#legacyState.set?.('runtimeWatchdogState'",
]) {
  if (!facade.includes(needle)) failures.push('modernRuntimeFacade.ts: missing watchdog integration: ' + needle);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const key of ['verify:strict-runtime-r33', 'typecheck:strict-runtime-r33', 'test:strict-runtime-r33', 'check:strict-runtime-r33']) {
  if (typeof packageJson.scripts?.[key] !== 'string') failures.push('package.json: missing ' + key);
}

if (failures.length) {
  console.error('R33 strict runtime gate failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  strictFiles: strictFiles.length,
  watchdog: 'integrated',
  policy: 'no-ts-nocheck-no-dynamic-code-bounded-runtime-health',
}, null, 2));
