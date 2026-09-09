import assert from 'node:assert/strict';
import { applyEnvironmentVisualQualityRuntime } from '../src/3d/world/environmentVisualQualityRuntime.js';

function color(r, g, b) {
	return { isColor: true, r, g, b, setRGB(nr, ng, nb) { this.r = nr; this.g = ng; this.b = nb; } };
}

function makeRuntime() {
	const scene = { background: color(0.001, 0.001, 0.001), userData: {} };
	const fog = { color: color(0.001, 0.001, 0.001), near: 0, far: 0 };
	const renderer = { toneMappingExposure: 0 };
	const camera = { far: 2000, userData: {} };
	return { scene, fog, renderer, camera };
}

const runtime = makeRuntime();
const first = applyEnvironmentVisualQualityRuntime({
	...runtime,
	fog: runtime.fog,
	renderQuality: { preset: { exposure: 1.1, pixelRatioCap: 2 } },
});
assert.equal(first.applied, true);
assert.equal(first.blackSkyGuard, true);
assert.ok(runtime.scene.background.r >= 0.08);
assert.ok(runtime.fog.near < runtime.fog.far);
assert.equal(runtime.scene.userData.environmentVisualQuality.canonicalMutation, false);
assert.equal(runtime.camera.userData.environmentVisualQuality.cameraRelativeSky, true);

const second = applyEnvironmentVisualQualityRuntime({
	...makeRuntime(),
	renderQuality: { preset: { exposure: Number.NaN, pixelRatioCap: Number.NaN } },
});
assert.equal(second.applied, true);
assert.ok(Number.isFinite(second.exposure));
assert.ok(Number.isFinite(second.horizonLumaFloor));

const missing = applyEnvironmentVisualQualityRuntime({});
assert.deepEqual(missing, { applied: false, reason: 'missing-runtime-owner' });

console.log(JSON.stringify({
	ok: true,	blackSkyGuard: first.blackSkyGuard,
	near: runtime.fog.near, far: runtime.fog.far,
	exposure: first.exposure, canonicalMutation: runtime.scene.userData.environmentVisualQuality.canonicalMutation,
}));
