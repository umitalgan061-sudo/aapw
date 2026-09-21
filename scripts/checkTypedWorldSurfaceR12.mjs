import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/world/vegetation.ts', 'src/3d/world/vegetation.js'],
  ['src/3d/world/terrainBiomeShading.ts', 'src/3d/world/terrainBiomeShading.js'],
  ['src/3d/world/worldReferenceSurfacePindexes.ts', 'src/3d/world/worldReferenceSurfacePindexes.js'],
];

const failures = [];
for (const [typedPath, legacyPath] of owners) {
  const typed = await readFile(typedPath, 'utf8').catch(() => null);
  const legacy = await readFile(legacyPath, 'utf8').catch(() => null);
  if (!typed) failures.push(`${typedPath}: TypeScript owner missing`);
  else if (!typed.includes('Production TypeScript owner')) failures.push(`${typedPath}: production-owner marker missing`);
  if (!legacy) failures.push(`${legacyPath}: compatibility path missing`);
  else {
    if (!legacy.includes('export * from')) failures.push(`${legacyPath}: compatibility export missing`);
    if (!legacy.includes('.ts')) failures.push(`${legacyPath}: not connected to TypeScript owner`);
  }
}

const forbidden = [
  ['src/3d/world/vegetation.ts', /Math\.random\s*\(/],
  ['src/3d/world/terrainBiomeShading.ts', /Math\.random\s*\(/],
  ['src/3d/world/worldReferenceSurfacePindexes.ts', /Math\.random\s*\(/],
];
for (const [path, pattern] of forbidden) {
  const source = await readFile(path, 'utf8');
  if (pattern.test(source)) failures.push(`${path}: ambient randomness detected`);
}

const terrain = await readFile('src/3d/world/terrain.ts', 'utf8');
if (!terrain.includes("from './terrainBiomeShading.ts'")) failures.push('terrain.ts: typed biome shading source not wired');

if (failures.length) {
  console.error(`R12 typed world-surface verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('R12 typed world-surface verification passed.');
