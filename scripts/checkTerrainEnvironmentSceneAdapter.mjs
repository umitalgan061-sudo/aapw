import assert from 'node:assert/strict';
import { prepareTerrainEnvironmentSceneAsset, attachTerrainEnvironmentSceneAsset } from '../src/3d/world/terrainEnvironmentSceneAdapter.js';

const failures = [];
const check = (label, fn) => { try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); } };

check('adapter exposes shared placement sequence', () => {
  const source = (await import('../src/3d/world/terrainEnvironmentContract.js')).TERRAIN_ENVIRONMENT_CONTRACT;
  assert.deepEqual(source.sequence, [
    'asset-hydrate', 'surface-analysis', 'material-recipe', 'material-validation',
    'ground-transform', 'placement-manifest', 'scene-attach',
  ]);
});

check('adapter rejects missing object before scene attach', () => {
  const result = prepareTerrainEnvironmentSceneAsset(null, {
    category: 'tree',
    asset: { id: 'missing', src: 'assets/models/vegetation/missing.glb' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'terrain-environment-contract');
});

check('attach gate is fail-closed', () => {
  assert.deepEqual(attachTerrainEnvironmentSceneAsset({}, null), { ok: false, error: 'asset-not-prepared' });
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('terrain-environment-scene-adapter: PASS');
