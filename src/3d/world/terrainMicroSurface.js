/**
 * Render-only micro-PBR surface layer for terrain: a tiny, exactly-tileable normal + roughness atlas
 * generated once and shared by every chunk material.
 *
 * Extracted from `world/terrain.js` on 2026-08-19 when that file crossed the 600-line cap
 * (GOVERNANCE.md Altin Kural 7). Pure move — no behaviour change, no constant changed. `terrain.js`
 * re-exports this module's public names so every existing importer and regression check keeps working
 * against the same API.
 *
 * This is deliberately not geography: canonical height, coastline, hydrology, placement and collision
 * are untouched. The atlas is addressed through a second UV channel whose phase comes directly from
 * world metres, so 22 m means 22 m everywhere and neighbouring chunks cannot restart the pattern at
 * their shared border.
 * @module world/terrainMicroSurface
 */

import * as THREE from 'three';
import { applyGroundSurfaceGrain } from './groundSurfaceGrain.js';

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Render-only micro PBR layer. This is deliberately not geography: canonical height, coastline,
 * hydrology, placement and collision stay unchanged. The normal/roughness atlas uses a second UV
 * channel whose phase is derived directly from world metres, so 22 m means 22 m everywhere and
 * neighboring chunks cannot restart the detail pattern at their border.
 */
export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-world-uv-pbr-v2',
	textureSize: 128,
	detailRepeatMeters: 22,
	normalStrength: 0.72,
	normalSlopeGain: 3.4,
	roughnessBase: 0.96,
	roughnessMin: 0.68,
	roughnessMax: 0.98,
	uvChannel: 1,
	maxAnisotropy: 8,
	renderOnly: true,
});

/** Stable metre-space UV for the render-only detail channel. Negative UV is valid with RepeatWrapping. */
export function terrainMicroUvAt(worldX, worldZ) {
	const repeatMeters = TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters;
	return Object.freeze({ u: worldX / repeatMeters, v: worldZ / repeatMeters });
}

/**
 * Deterministic [0,1) hash of an integer lattice cell. Integer-free trig hash, same family as the other
 * micro-signal hashes in `world/`; no `Math.random()`, no state.
 */
function latticeHash01(ix, iy) {
	const value = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

/** Quintic smoothstep — C2 continuous, so the noise has no visible lattice creases. */
function fade(t) {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Value noise on a lattice of `period` cells, wrapping exactly at the period.
 *
 * Wrapping the lattice indices modulo `period` is what makes the result seamlessly tileable, and it is
 * the reason this can replace the plane-wave sum below without giving up the tiling guarantee.
 */
function tileableValueNoise(u, v, period) {
	const x = u * period;
	const y = v * period;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = fade(x - x0);
	const fy = fade(y - y0);
	const wrap = (n) => ((n % period) + period) % period;
	const xa = wrap(x0);
	const xb = wrap(x0 + 1);
	const ya = wrap(y0);
	const yb = wrap(y0 + 1);
	const top = latticeHash01(xa, ya) + (latticeHash01(xb, ya) - latticeHash01(xa, ya)) * fx;
	const bottom = latticeHash01(xa, yb) + (latticeHash01(xb, yb) - latticeHash01(xa, yb)) * fx;
	return top + (bottom - top) * fy;
}

/**
 * The detail atlas's height field: multi-octave tileable value noise.
 *
 * **Why this was rebuilt (run 368 / ADR-0315).** The previous version summed six sinusoids at integer
 * frequencies — `3u+5v`, `7u-4v`, `11u+13v`, `19u-17v`, `29u+23v`, `37u-31v`. Integer frequencies do
 * make an atlas exactly tileable, which is why it was written that way, but every one of those terms is
 * a *plane wave travelling along a fixed diagonal*. Summed, they do not read as surface grain; they read
 * as a diagonal cross-hatch weave, and because the atlas repeats every 22 m that weave covered every
 * hillside in the world.
 *
 * That artefact was misdiagnosed twice before it was isolated. It looked like height-noise aliasing
 * against the mesh, since it follows the triangulation and is strongest where triangles are large — so
 * an LOD-aware band limit was built for the height sampler, measured (it does change far-field heights
 * by a mean of 1.17 m), and changed the render not at all. The artefact was finally pinned down by
 * rendering the same view with the detail `map` detached, which removed it completely and left clean
 * ground. It was in this function all along.
 *
 * Value noise on a wrapped lattice keeps the exact tileability — the lattice indices are taken modulo
 * the period, so opposite edges sample the same cells — while having no preferred direction at all.
 * Octave periods are coprime-ish and each is an exact divisor relationship with the atlas, so every
 * octave tiles too.
 */
/**
 * Exported for `scripts/checkTerrainDetailAtlasIsotropy.js`, which has to score the real field rather
 * than a reconstruction: measuring the built normal map instead was tried and its rectified gradient
 * destroyed exactly the directionality the check exists to detect.
 */
export function terrainDetailHeight(u, v) {
	return (
		0.52 * (tileableValueNoise(u, v, 4) * 2 - 1)
		+ 0.26 * (tileableValueNoise(u + 0.37, v + 0.11, 8) * 2 - 1)
		+ 0.14 * (tileableValueNoise(u + 0.71, v + 0.53, 16) * 2 - 1)
		+ 0.08 * (tileableValueNoise(u + 0.19, v + 0.83, 32) * 2 - 1)
	);
}

function buildTerrainDetailField(size) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) field[y * size + x] = terrainDetailHeight(x / size, y / size);
	}
	return field;
}

function wrappedTerrainDetailSample(field, size, x, y) {
	return field[((y + size) % size) * size + ((x + size) % size)];
}

function buildTerrainNormalData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const gain = TERRAIN_MICRO_SURFACE_POLICY.normalSlopeGain;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const dx = (wrappedTerrainDetailSample(field, size, x + 1, y) - wrappedTerrainDetailSample(field, size, x - 1, y)) * gain;
			const dy = (wrappedTerrainDetailSample(field, size, x, y + 1) - wrappedTerrainDetailSample(field, size, x, y - 1)) * gain;
			const inverseLength = 1 / Math.hypot(dx, dy, 1);
			const offset = (y * size + x) * 4;
			data[offset] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
			data[offset + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
			data[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
			data[offset + 3] = 255;
		}
	}
	return data;
}

function buildTerrainRoughnessData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const { roughnessMin, roughnessMax } = TERRAIN_MICRO_SURFACE_POLICY;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const center = wrappedTerrainDetailSample(field, size, x, y);
			const dx = Math.abs(wrappedTerrainDetailSample(field, size, x + 1, y) - wrappedTerrainDetailSample(field, size, x - 1, y));
			const dy = Math.abs(wrappedTerrainDetailSample(field, size, x, y + 1) - wrappedTerrainDetailSample(field, size, x, y - 1));
			const grain = clamp01(0.5 + center * 0.28 + Math.hypot(dx, dy) * 0.9);
			const encoded = Math.round(clamp01(lerp(roughnessMin, roughnessMax, grain)) * 255);
			const offset = (y * size + x) * 4;
			data[offset] = encoded;
			data[offset + 1] = encoded;
			data[offset + 2] = encoded;
			data[offset + 3] = 255;
		}
	}
	return data;
}

function configureTerrainDataTexture(texture, name) {
	texture.name = name;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1, 1);
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = TERRAIN_MICRO_SURFACE_POLICY.maxAnisotropy;
	texture.colorSpace = THREE.NoColorSpace;
	texture.channel = TERRAIN_MICRO_SURFACE_POLICY.uvChannel;
	texture.userData = {
		...texture.userData,
		terrainMicroSurfacePolicy: TERRAIN_MICRO_SURFACE_POLICY.id,
		worldSpaceRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
	};
	texture.needsUpdate = true;
	return texture;
}

let sharedTerrainMicroSurface = null;

/** Two tiny app-lifetime maps shared by every chunk; geometry density and canonical height are unchanged. */
export function getSharedTerrainMicroSurfaceTextures() {
	if (sharedTerrainMicroSurface) return sharedTerrainMicroSurface;
	const size = TERRAIN_MICRO_SURFACE_POLICY.textureSize;
	const field = buildTerrainDetailField(size);
	const normalMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainNormalData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-normal-v2',
	);
	const roughnessMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v2',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

export function applyTerrainMicroSurface(material) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('terrain micro-surface requires MeshStandardMaterial');
	const surface = getSharedTerrainMicroSurfaceTextures();
	material.normalMap = surface.normalMap;
	material.normalMapType = THREE.TangentSpaceNormalMap;
	material.normalScale.setScalar(TERRAIN_MICRO_SURFACE_POLICY.normalStrength);
	material.roughnessMap = surface.roughnessMap;
	material.roughness = TERRAIN_MICRO_SURFACE_POLICY.roughnessBase;
	// Run 416 — the near layer, applied here rather than at the `terrain.js` call site because it is the
	// same concern this module already owns and `terrain.js` is at its 600-line cap. The atlas above
	// repeats every 22 m, so its smallest feature is metres wide and the ground reads as flat colour
	// from standing height; `world/groundSurfaceGrain.js` adds the 1.6-7.3 m band underneath it, out of
	// the owner's own baked normal map. Layered, not replaced: this normal map still runs first.
	applyGroundSurfaceGrain(material);
	material.userData.terrainMicroSurface = Object.freeze({
		policyId: TERRAIN_MICRO_SURFACE_POLICY.id,
		detailRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
		uvChannel: TERRAIN_MICRO_SURFACE_POLICY.uvChannel,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
