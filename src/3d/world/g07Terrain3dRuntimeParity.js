/**
 * Günbatımı Ustası / G07 — Terrain3D -> Three.js runtime parity adapter.
 *
 * G07 is canonical open Sunset Sea. Terrain3D's validated LOD0 bake for the cell uses a
 * -7.5 m seabed. This module projects that authored height into the browser runtime in owner-map
 * normalized coordinates. GeoCell bounds remain addressing/QA metadata only: the runtime edge uses
 * a smooth guard band and the canonical owner-map water mask, never a visible hard grid cut.
 *
 * This is deliberately a small adapter, not a second terrain generator. Future authored cells can
 * register their own parity adapters without changing the deterministic legacy height field outside
 * their validated domains.
 */
import { sampleReferenceWaterMask } from './worldReferenceWaterMask.js';

export const G07_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
	id: 'gunbatimi-ustasi-g07-terrain3d-threejs-parity-2026-08-13-v1',
	geoCell: 'G07',
	layer: 'Terrain3D Bake / Three.js Runtime Parity',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	terrain3dVersion: '1.0.2-stable',
	terrain3dLod: 0,
	targetHeightMeters: -7.5,
	worldSpanMeters: 12000,
	normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
	// ~47 m in the shared 12 km authoring space. Smoothstep makes both ends C1-continuous.
	guardBandNormalized: 1 / 256,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep01 = (value) => {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
};

export function worldToG07OwnerMapNormalized(worldX, worldZ) {
	const span = G07_TERRAIN3D_RUNTIME_PARITY.worldSpanMeters;
	return Object.freeze({ x: worldX / span + 0.5, y: worldZ / span + 0.5 });
}

function axisGuardWeight(value, minValue, maxValue, guard) {
	if (value >= minValue && value <= maxValue) return 1;
	if (value < minValue) return smoothstep01((value - (minValue - guard)) / guard);
	return smoothstep01(((maxValue + guard) - value) / guard);
}

/**
 * Returns the authored G07 influence in [0,1]. The cell interior is exactly 1; the guard fades
 * continuously outside the QA boundary and is forcibly zero wherever map.png says land.
 */
export function sampleG07Terrain3dRuntimeInfluence(worldX, worldZ) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
	const { x, y } = worldToG07OwnerMapNormalized(worldX, worldZ);
	const { xMin, xMax, yMin, yMax } = G07_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
	const guard = G07_TERRAIN3D_RUNTIME_PARITY.guardBandNormalized;
	if (x < xMin - guard || x > xMax + guard || y < yMin - guard || y > yMax + guard) return 0;
	if (x < 0 || x > 1 || y < 0 || y > 1 || !sampleReferenceWaterMask(x, y)) return 0;
	return axisGuardWeight(x, xMin, xMax, guard) * axisGuardWeight(y, yMin, yMax, guard);
}

/** Apply the validated Terrain3D LOD0 seabed height to the real Three.js height field. */
export function applyG07Terrain3dRuntimeParity(legacyHeightMeters, worldX, worldZ) {
	if (!Number.isFinite(legacyHeightMeters)) throw new TypeError('legacy height must be finite');
	const influence = sampleG07Terrain3dRuntimeInfluence(worldX, worldZ);
	if (influence <= 0) return legacyHeightMeters;
	const target = G07_TERRAIN3D_RUNTIME_PARITY.targetHeightMeters;
	return legacyHeightMeters + (target - legacyHeightMeters) * influence;
}
