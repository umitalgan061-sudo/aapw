import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/config.ts', 'src/3d/config.js'],
  ['src/3d/eventBus.ts', 'src/3d/eventBus.js'],
  ['src/3d/state.ts', 'src/3d/state.js'],
  ['src/3d/physics.ts', 'src/3d/physics.js'],
  ['src/3d/input.ts', 'src/3d/input.js'],
  ['src/3d/assetLoader.ts', 'src/3d/assetLoader.js'],
  ['src/3d/renderQuality.ts', 'src/3d/renderQuality.js'],
  ['src/3d/camera.ts', 'src/3d/camera.js'],
  ['src/3d/game3d.ts', 'src/3d/game3d.js'],
  ['src/3d/sceneManager.ts', 'src/3d/sceneManager.js'],
  ['src/3d/world/terrain.ts', 'src/3d/world/terrain.js'],
  ['src/3d/world/water.ts', 'src/3d/world/water.js'],
  ['src/3d/world/rivers.ts', 'src/3d/world/rivers.js'],
  ['src/3d/world/chunkManager.ts', 'src/3d/world/chunkManager.js'],
  ['src/3d/world/materials.ts', 'src/3d/world/materials.js'],
  ['src/3d/world/settlements.ts', 'src/3d/world/settlements.js'],
  ['src/3d/world/geographicAssetRegionProfiles.ts', 'src/3d/world/geographicAssetRegionProfiles.js'],
  ['src/3d/world/terrainSurfaceFacies.ts', 'src/3d/world/terrainSurfaceFacies.js'],
  ['src/3d/world/geographicAssetContext.ts', 'src/3d/world/geographicAssetContext.js'],
  ['src/3d/world/geographicAssetRuntimeOrchestrator.ts', 'src/3d/world/geographicAssetRuntimeOrchestrator.js'],
];

const failures = [];
for (const [typedPath, legacyPath] of owners) {
  const typed = await readFile(typedPath, 'utf8').catch(() => null);
  const legacy = await readFile(legacyPath, 'utf8').catch(() => null);
  if (!typed) failures.push(`${typedPath}: missing TypeScript production owner`);
  if (!legacy) failures.push(`${legacyPath}: missing compatibility boundary`);
  else {
    if (!legacy.includes('export * from')) failures.push(`${legacyPath}: missing compatibility re-export`);
    if (!legacy.includes('.ts')) failures.push(`${legacyPath}: does not point to TypeScript owner`);
  }
}

if (failures.length) {
  console.error(`R9 typed-platform check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('R9 typed-platform check passed.');
