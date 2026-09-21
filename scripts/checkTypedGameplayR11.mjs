import { readFile } from 'node:fs/promises';

const owners = [["interaction.js","interaction.ts"],["player.js","player.ts"],["npc.js","npc.ts"],["animals.js","animals.ts"],["dragonController.js","dragonController.ts"],["dragonConfig.js","dragonConfig.ts"],["creatureBrain.js","creatureBrain.ts"],["cartBrain.js","cartBrain.ts"],["livingWorldSpawner.js","livingWorldSpawner.ts"],["worldEvents.js","worldEvents.ts"],["interactionFieldReadiness.js","interactionFieldReadiness.ts"],["creatureLocomotionStateSynthesis.js","creatureLocomotionStateSynthesis.ts"],["playerLocomotionStateSynthesis.js","playerLocomotionStateSynthesis.ts"]];

const failures = [];
for (const [legacy, typed] of owners) {
  const legacyPath = `src/3d/gameplay/${legacy}`;
  const typedPath = `src/3d/gameplay/${typed}`;
  const [legacyBody, typedBody] = await Promise.all([
    readFile(legacyPath, 'utf8').catch(() => null),
    readFile(typedPath, 'utf8').catch(() => null),
  ]);
  if (!typedBody) failures.push(`${typedPath}: missing TypeScript owner`);
  else if (!typedBody.includes('Production TypeScript owner')) failures.push(`${typedPath}: owner marker missing`);
  if (!legacyBody) failures.push(`${legacyPath}: compatibility shim missing`);
  else {
    if (!legacyBody.includes('export * from')) failures.push(`${legacyPath}: compatibility export missing`);
    if (!legacyBody.includes('.ts')) failures.push(`${legacyPath}: not targeting TS owner`);
  }
}

const game3d = await readFile('src/3d/game3d.ts', 'utf8').catch(() => '');
for (const specifier of [
  './gameplay/player.ts',
  './gameplay/interaction.ts',
  './gameplay/livingWorldSpawner.ts',
  './gameplay/worldEvents.ts',
]) {
  if (!game3d.includes(`from '${specifier}'`)) failures.push(`game3d.ts: missing typed gameplay import ${specifier}`);
}

const spawn = await readFile('src/3d/gameplay/livingWorldSpawner.ts', 'utf8').catch(() => '');
for (const specifier of [
  './npc.ts',
  './animals.ts',
  './creatureBrain.ts',
  './cartBrain.ts',
  './dragonController.ts',
]) {
  if (!spawn.includes(`from '${specifier}'`)) failures.push(`livingWorldSpawner.ts: missing typed import ${specifier}`);
}

if (failures.length) {
  console.error(`R11 gameplay migration gate failed with ${failures.length} issue(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('R11 gameplay migration gate passed.');
