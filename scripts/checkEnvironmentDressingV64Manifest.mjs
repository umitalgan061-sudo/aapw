import assert from 'node:assert/strict';
import { getEnvironmentDressingV64Manifest } from '../src/3d/world/environmentDressingV64Manifest.js';

const manifest = getEnvironmentDressingV64Manifest();
assert.equal(manifest.version, 64);
assert.equal(manifest.owner, 'Buzul Muhafızı');
assert.ok(manifest.production.length >= 7);
assert.ok(manifest.acceptance.includes('deterministic seeded replay and immutable evidence'));
assert.ok(manifest.prohibited.includes('runtime EditorMaterialStudio import'));
assert.ok(manifest.prohibited.includes('regular-grid environment distribution'));
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.production), true);
assert.equal(Object.isFrozen(manifest.acceptance), true);
assert.equal(Object.isFrozen(manifest.prohibited), true);
console.log(JSON.stringify({ ok: true, id: manifest.id }, null, 2));
