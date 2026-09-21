import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/world/terrain.ts', 'src/3d/world/terrain.js'],
  ['src/3d/world/water.ts', 'src/3d/world/water.js'],
  ['src/3d/world/rivers.ts', 'src/3d/world/rivers.js'],
  ['src/3d/world/chunkManager.ts', 'src/3d/world/chunkManager.js'],
];

const failures = [];

for (const [typedPath, legacyPath] of owners) {
  const typed = await readFile(typedPath, 'utf8').catch(() => null);
  const legacy = await readFile(legacyPath, 'utf8').catch(() => null);

  if (!typed) failures.push(`${typedPath}: missing TypeScript production owner`);
  else if (!typed.includes('Production TypeScript owner')) failures.push(`${typedPath}: production-owner marker missing`);

  if (!legacy) failures.push(`${legacyPath}: missing compatibility boundary`);
  else {
    if (!legacy.includes('.ts')) failures.push(`${legacyPath}: does not point at the TypeScript owner`);
    if (!legacy.includes('export * from')) failures.push(`${legacyPath}: compatibility export missing`);
  }
}

const scene = await readFile('src/3d/sceneManager.ts', 'utf8');
for (const specifier of [
  './world/chunkManager.ts',
  './world/water.ts',
  './world/rivers.ts',
  './world/terrain.ts',
]) {
  if (!scene.includes(`from '${specifier}'`)) failures.push(`sceneManager.ts: typed world owner missing: ${specifier}`);
}

const weather = await readFile('src/3d/world/weather.ts', 'utf8');
if (!weather.includes("from './terrain.ts'")) failures.push('weather.ts: typed terrain owner missing');

const livingWorld = await readFile('src/3d/gameplay/livingWorldSpawner.ts', 'utf8');
if (!livingWorld.includes("from '../world/terrain.ts'")) failures.push('livingWorldSpawner.ts: typed terrain owner missing');

if (failures.length) {
  console.error(`Typed world runtime R7 check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Typed world runtime R7 check passed: terrain, water, rivers and chunk streaming are TypeScript-owned.');
