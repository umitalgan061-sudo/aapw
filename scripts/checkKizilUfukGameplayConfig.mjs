import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const repoRoot = new URL('../', import.meta.url);
const typedPath = new URL('./src/3d/gameplay/gameplayConfig.ts', repoRoot);
const legacyPath = new URL('./src/3d/gameplay/gameplayConfig.js', repoRoot);

const { DRAGON_CONFIG, getGameplayConfigSnapshot, INTERACTION_CONFIG, validateGameplayConfig } =
  await import(new URL('./src/3d/gameplay/gameplayConfig.ts', repoRoot));

validateGameplayConfig();
const snapshot = getGameplayConfigSnapshot();

if (!Object.isFrozen(DRAGON_CONFIG)) throw new Error('Dragon config is not frozen.');
if (!Object.isFrozen(INTERACTION_CONFIG)) throw new Error('Interaction config is not frozen.');
if (snapshot.dragonSpawnCount < 1) throw new Error('No dragon spawn is registered.');
if (snapshot.animalSpeciesCount < 3) throw new Error('Animal species registry is unexpectedly small.');

const [typedSource, legacySource] = await Promise.all([
  readFile(typedPath, 'utf8'),
  readFile(legacyPath, 'utf8'),
]);

if (!legacySource.includes("from './gameplayConfig.ts'")) {
  throw new Error('Legacy gameplay config barrel is not wired to the typed facade.');
}
if (typedSource.includes('Math.random(')) throw new Error('Typed gameplay config must remain deterministic.');
if (typedSource.includes('EditorMaterialStudio.js')) throw new Error('Editor material tooling must never be a runtime dependency.');

const stablePayload = JSON.stringify(snapshot);
const checksum = createHash('sha256').update(stablePayload).digest('hex');
console.log(JSON.stringify({
  schemaVersion: snapshot.schemaVersion,
  domains: snapshot.domains,
  npcSpawnCount: snapshot.npcSpawnCount,
  animalSpeciesCount: snapshot.animalSpeciesCount,
  animalSpawnCount: snapshot.animalSpawnCount,
  dragonSpawnCount: snapshot.dragonSpawnCount,
  deterministicChecksum: checksum,
}, null, 2));
