import { readFile } from 'node:fs/promises';

const promoted = [
  'waterDepthField',
  'iceLandmarkGeometryBreakup',
  'terrainGroundwaterSurfaceDetailFixturesTransitions',
  'terrainSeasonalErosionScenarioLedger',
  'terrainSurfaceSedimentCalibration',
  'geographicAssetDistributionTelemetry',
];

const failures = [];

for (const name of promoted) {
  const ownerPath = 'src/3d/world/' + name + '.ts';
  const legacyPath = 'src/3d/world/' + name + '.legacy.js';
  const owner = await readFile(ownerPath, 'utf8').catch(() => '');
  const legacy = await readFile(legacyPath, 'utf8').catch(() => '');

  if (!owner) failures.push(ownerPath + ': missing TypeScript owner');
  if (owner.includes('import * as __legacy from')) failures.push(ownerPath + ': still depends on legacy payload');
  if (!legacy.includes('export * from')) failures.push(legacyPath + ': missing compatibility re-export');
  if (!legacy.includes('.ts')) failures.push(legacyPath + ': compatibility boundary does not target TypeScript');
}

if (failures.length) {
  console.error('R34 world source-of-truth gate failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('R34 world source-of-truth gate passed.');
