import { readFile } from 'node:fs/promises';

const productionOwners = [
  ['src/3d/gameplay/npc.ts', 'src/3d/gameplay/npc.js'],
  ['src/3d/gameplay/animals.ts', 'src/3d/gameplay/animals.js'],
  ['src/3d/gameplay/livingWorldSpawner.ts', 'src/3d/gameplay/livingWorldSpawner.js'],
  ['src/3d/gameplay/interaction.ts', 'src/3d/gameplay/interaction.js'],
  ['src/3d/gameplay/animalConfig.ts', 'src/3d/gameplay/animalConfig.js'],
  ['src/3d/gameplay/npcConfig.ts', 'src/3d/gameplay/npcConfig.js'],
  ['src/3d/gameplay/interactionConfig.ts', 'src/3d/gameplay/interactionConfig.js'],
  ['src/3d/gameplay/creatureSpeciesConfig.ts', 'src/3d/gameplay/creatureSpeciesConfig.js'],
];

const failures = [];

for (const [typedPath, legacyPath] of productionOwners) {
  try {
    const typed = await readFile(typedPath, 'utf8');
    if (!typed.includes('Production TypeScript owner')) failures.push(`${typedPath}: missing production-owner marker`);
  } catch {
    failures.push(`${typedPath}: missing typed production owner`);
  }

  try {
    const legacy = await readFile(legacyPath, 'utf8');
    if (!legacy.includes('.ts')) failures.push(`${legacyPath}: legacy boundary no longer points at a TypeScript owner`);
    if (!legacy.includes('export * from')) failures.push(`${legacyPath}: compatibility shim export missing`);
  } catch {
    failures.push(`${legacyPath}: legacy compatibility boundary missing`);
  }
}

const game3d = await readFile('src/3d/game3d.ts', 'utf8');
for (const specifier of [
  './gameplay/interaction.ts',
  './gameplay/livingWorldSpawner.ts',
  './gameplay/player.ts',
]) {
  if (!game3d.includes(`from '${specifier}'`)) failures.push(`src/3d/game3d.ts: production runtime is not wired to ${specifier}`);
}

const gameplayFacade = await readFile('src/3d/gameplay/gameplayConfig.ts', 'utf8');
for (const specifier of ['./animalConfig.ts', './npcConfig.ts', './interactionConfig.ts']) {
  if (!gameplayFacade.includes(`from '${specifier}'`)) failures.push(`gameplayConfig.ts: typed config owner missing for ${specifier}`);
}

if (failures.length) {
  console.error(`Typed gameplay runtime R6 check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Typed gameplay runtime R6 check passed: production gameplay owners and compatibility boundaries are present.');
