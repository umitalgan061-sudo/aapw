import assert from 'node:assert/strict';
import { applyShippedVisualAdoption } from '../src/3d/world/shippedVisualAdoption.js';

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}

function makeMaterial() {
	return { roughness: 0.65, opacity: 0.86, normalScale: { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } }, userData: {} };
}

function makeNode(material) {
	return { material, traverse(visitor) { visitor(this); } };
}

const scene = {
	background: { isColor: true, r: 0.02, g: 0.02, b: 0.02 },
	fog: { near: 50, far: 6000 },
	userData: {},
};
const terrain = makeNode(makeMaterial());
const geology = makeNode(makeMaterial());
const vegetation = makeNode(makeMaterial());
const water = makeNode(makeMaterial());
const renderer = { toneMappingExposure: 1 };
const camera = { position: { length: () => 1200 } };

const first = applyShippedVisualAdoption({ scene, renderer, terrain, naturalGeology: geology, vegetation, water, camera });
const second = applyShippedVisualAdoption({ scene, renderer, terrain, naturalGeology: geology, vegetation, water, camera });
assert.deepEqual(first, second, 'adoption plan must remain deterministic');
assert.equal(first.water.rectangularArtifactTarget, 0);
assert.equal(first.water.antiMoire, true);
assert.equal(first.atmosphere.blackSkyTarget, 0);
assert.equal(scene.userData.buzulVisualAdoption, 'atmosphere-v31');
assert.equal(water.userData.visibleMoireTarget, 0);
assert.ok(terrain.material.roughness >= 0.28 && terrain.material.roughness <= 0.96);
assert.ok(terrain.material.normalScale.x >= 0.18 && terrain.material.normalScale.x <= 1.1);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(deepFreeze(first)), true);
console.log(JSON.stringify({ ok: true, version: first.version, targets: { rectangularWater: first.water.rectangularArtifactTarget, moire: first.water.antiMoire, blackSky: first.atmosphere.blackSkyTarget } }));
