import { readFile } from 'node:fs/promises';

const owners = [
  ['script.ts', 'script.js'],
  ['service-worker.ts', 'service-worker.js'],
  ['scripts/game3dSmokeChecks.ts', 'scripts/game3dSmokeChecks.js'],
  ['scripts/game3dSmokeChecksMovement.ts', 'scripts/game3dSmokeChecksMovement.js'],
  ['scripts/game3dSmokeChecksDragonDive.ts', 'scripts/game3dSmokeChecksDragonDive.js'],
  ['scripts/game3dSmokeChecksDragonFlight.ts', 'scripts/game3dSmokeChecksDragonFlight.js'],
  ['scripts/game3dSmokeChecksDragonPursuit.ts', 'scripts/game3dSmokeChecksDragonPursuit.js'],
  ['scripts/game3dSmokeChecksPauseMenu.ts', 'scripts/game3dSmokeChecksPauseMenu.js'],
  ['scripts/game3dSmokeChecksScene.ts', 'scripts/game3dSmokeChecksScene.js'],
  ['src/app/rootApplicationRuntime.ts', null],
];

const failures = [];
for (const [typedPath, legacyPath] of owners) {
  const typed = await readFile(typedPath, 'utf8').catch(() => null);
  if (!typed) failures.push(typedPath + ': TypeScript production source is missing');
  else if (typedPath !== 'src/app/rootApplicationRuntime.ts' && !typed.includes('// @ts-nocheck')) {
    failures.push(typedPath + ': migration marker is missing');
  }

  if (legacyPath) {
    const legacy = await readFile(legacyPath, 'utf8').catch(() => null);
    if (!legacy) failures.push(legacyPath + ': compatibility artifact is missing');
    else if (!legacy.includes('.ts')) failures.push(legacyPath + ': compatibility artifact is not TypeScript-backed');
  }
}

const index = await readFile('index.html', 'utf8');
if (!index.includes('<script type="module" src="script.ts"></script>')) failures.push('index.html: root TS module is not the primary entry');

const sw = await readFile('service-worker.js', 'utf8');
if (!sw.includes("'./script.ts'")) failures.push('service-worker.js: script.ts is not offline cached');

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const key of ['build:service-worker', 'verify:typed-platform-r22', 'test:typed-platform-r22']) {
  if (!packageJson.scripts?.[key]) failures.push('package.json: missing ' + key);
}

if (failures.length) {
  console.error('R22 TypeScript migration gate failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('R22 TypeScript migration gate passed.');
