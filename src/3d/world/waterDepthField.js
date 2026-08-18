/**
 * Water depth field — a baked, world-space "how deep is the water here" lookup that lets
 * `world/water.js` displace its surface with real geometric swell **without** re-introducing the
 * shallow-lake bug that made DECISIONS.md ADR-0048 give geometric waves up entirely.
 *
 * **The ADR-0048 problem, restated.** The original water surface displaced vertices with real
 * Gerstner waves (up to ~1m). That reads fine over deep sea, but many lakes in this world sit only
 * centimetres below `WORLD_DEFAULTS.WATER_LEVEL_METERS`: a 1m wave trough dipped *below the lake
 * bed* and the crest rose above it, so the shoreline's terrain popped in and out every frame.
 * ADR-0048's fix was to delete the displacement and fake all wave motion in the fragment shader.
 * That removed the flicker but also removed any actual undulation — the surface is a dead-flat
 * plane today.
 *
 * **This module's fix.** Wave amplitude is scaled by local water depth instead of being constant:
 * deep open sea gets the full swell, a shin-deep lake edge gets none, and the transition is smooth.
 * Because the scale factor is `depth / FULL_WAVE_DEPTH_METERS` (clamped to 1) and the summed wave
 * amplitude is strictly less than `FULL_WAVE_DEPTH_METERS`, the trough can **never** reach the bed:
 *
 *   displacement(depth) <= WAVE_TOTAL_AMPLITUDE_METERS * min(1, depth / FULL_WAVE_DEPTH_METERS)
 *                        < FULL_WAVE_DEPTH_METERS * (depth / FULL_WAVE_DEPTH_METERS)
 *                        = depth                                          ... for depth < FULL_WAVE_DEPTH
 *   displacement(depth) <= WAVE_TOTAL_AMPLITUDE_METERS < FULL_WAVE_DEPTH_METERS <= depth
 *                                                                          ... for depth >= FULL_WAVE_DEPTH
 *
 * i.e. the surface stays strictly above the lake/sea bed at every depth, by construction rather
 * than by tuning. `scripts/checkRun325WaterSwell.js` asserts that inequality directly, so a future
 * amplitude tweak that would break it fails the check instead of silently resurrecting ADR-0048's
 * flicker.
 *
 * The same texture also carries **canonical water coverage** in its green channel. Red answers
 * "how deep?" while green answers "is this terrain sample actually below sea level?". Those are
 * deliberately separate signals: depth clamps dry land and an exact shoreline to the same red=0,
 * which previously meant the full-world water plane still rendered translucent cyan over dry land.
 * A binary coverage sample baked from the authoritative terrain height, then linearly filtered on
 * the GPU, gives the shader a continuous shoreline opacity edge without inventing geometry or a
 * second coastline source.
 *
 * **Why a baked texture and not GLSL noise.** The height field lives in `world/terrain.js`
 * (`createHeightSampler` — FBM + macro relief + settlement flatten pads). Re-implementing that in
 * GLSL would create a second, drifting copy of the world's shape, which this codebase deliberately
 * avoids everywhere else (see `createHeightSampler`'s own doc comment on why rivers sample it
 * rather than approximate it). Baking one texture from that single source of truth keeps the
 * shader and the terrain provably in agreement, and costs one startup pass instead of per-frame
 * work.
 *
 * Determinism: a pure function of `(sampleHeightMeters, waterLevelMeters, extent, resolution)` —
 * no `Math.random()`, no time dependence. The same world seed always bakes byte-identical texels.
 * @module world/waterDepthField
 */

import * as THREE from 'three';

/**
 * Side length, in meters, of the square region baked into the depth texture, centred on the world
 * origin. The playable world is 12022.5 x 10797.5 m (`WORLD_SCALE`), so 13000 covers all of it in
 * X and comfortably in Z. Outside this square the shader treats water as fully deep open ocean —
 * correct here, because `ChunkManager` only ever streams terrain inside the world grid, so there
 * is no rendered ground out there for a wave trough to expose.
 */
export const WATER_DEPTH_FIELD_EXTENT_METERS = 13000;

/**
 * Texels per side. 384 over `WATER_DEPTH_FIELD_EXTENT_METERS` is ~33.9 m/texel — deliberately close
 * to the water plane's own quad size at desktop resolution (4000/320 = 12.5 m) and well under the
 * shortest swell wavelength, so the amplitude mask never becomes the limiting detail. Bilinear
 * filtering smooths it further. Raising this raises startup bake cost quadratically — see
 * `createWaterDepthField`'s `bakeMs` return value, which the smoke/perf checks record.
 */
export const WATER_DEPTH_FIELD_RESOLUTION = 384;

/**
 * Depth, in meters, at which swell reaches full amplitude. Also the safety denominator in the
 * inequality proved in this module's doc comment — `WAVE_TOTAL_AMPLITUDE_METERS` (in `water.js`)
 * must stay strictly below it.
 */
export const FULL_WAVE_DEPTH_METERS = 10;

/**
 * Bakes the depth field. Every texel stores:
 * - red: `clamp((waterLevel - terrainHeight) / fullWaveDepth, 0, 1)`;
 * - green: canonical water coverage (`1` iff terrain is strictly below water level, else `0`).
 *
 * Keeping coverage independent from depth is critical because both dry land and an exact shoreline
 * have red=0. Linear filtering of green provides the water shader with a soft sub-texel shoreline
 * transition while the underlying classification stays deterministic and terrain-authoritative.
 *
 * `THREE.RGBAFormat`/`UnsignedByteType` is used rather than the more compact `RedFormat` because
 * single-channel byte textures are a WebGL2-only format and this project still supports a WebGL1
 * fallback path on older mobile hardware. Blue/alpha remain reserved at 255.
 *
 * @param {object} options
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters Terrain height
 *   source — pass `groundCollider.getGroundHeight` so the bake sees the same flattened height field
 *   the rendered chunks and every gameplay query already agree on (ADR-0118).
 * @param {number} options.waterLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS`.
 * @param {number} [options.extentMeters]
 * @param {number} [options.resolution]
 * @param {number} [options.fullWaveDepthMeters]
 * @returns {{texture: THREE.DataTexture, extentMeters: number, resolution: number, fullWaveDepthMeters: number, deepTexelRatio: number, dryTexelRatio: number, bakeMs: number}}
 *   `deepTexelRatio`/`dryTexelRatio` are diagnostics (fraction of the baked square that is fully
 *   deep water / dry land) — logged at boot and asserted by the run-325 checks so an accidental
 *   sampler or water-level change shows up as a coverage shift instead of passing silently.
 */
export function createWaterDepthField({
	sampleHeightMeters,
	waterLevelMeters,
	extentMeters = WATER_DEPTH_FIELD_EXTENT_METERS,
	resolution = WATER_DEPTH_FIELD_RESOLUTION,
	fullWaveDepthMeters = FULL_WAVE_DEPTH_METERS,
}) {
	const startMs = performance.now();
	const texelCount = resolution * resolution;
	const data = new Uint8Array(texelCount * 4);
	// `resolution - 1` steps span the full extent, so the first and last texel centres land exactly
	// on the region's edges — the shader's UV mapping below assumes that alignment.
	const stepMeters = extentMeters / (resolution - 1);
	const originMeters = -extentMeters / 2;

	let deepTexels = 0;
	let dryTexels = 0;
	for (let row = 0; row < resolution; row++) {
		const worldZ = originMeters + row * stepMeters;
		for (let column = 0; column < resolution; column++) {
			const worldX = originMeters + column * stepMeters;
			const depthMeters = waterLevelMeters - sampleHeightMeters(worldX, worldZ);
			const normalized = Math.min(1, Math.max(0, depthMeters / fullWaveDepthMeters));
			const hasWater = depthMeters > 0;
			if (normalized >= 1) deepTexels++;
			if (!hasWater) dryTexels++;
			const offset = (row * resolution + column) * 4;
			data[offset] = Math.round(normalized * 255);
			data[offset + 1] = hasWater ? 255 : 0;
			data[offset + 2] = 255;
			data[offset + 3] = 255;
		}
	}

	const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	// Clamp rather than repeat: sampling past the baked square must not wrap the far shore back
	// under the camera. The shader additionally short-circuits out-of-range UVs to "deep ocean"
	// (see `water.js`), so clamping is only a defensive second line.
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	return {
		texture,
		extentMeters,
		resolution,
		fullWaveDepthMeters,
		deepTexelRatio: deepTexels / texelCount,
		dryTexelRatio: dryTexels / texelCount,
		bakeMs: performance.now() - startMs,
	};
}

/**
 * Releases the baked texture's GPU/CPU memory. Call on teardown — memory-leak checklist.
 * `world/water.js`'s `disposeWater` already does this for the field attached to a water mesh, so
 * callers only need this for a field they baked but never attached.
 * @param {{texture: THREE.DataTexture}} depthField
 */
export function disposeWaterDepthField(depthField) {
	depthField.texture.dispose();
}
