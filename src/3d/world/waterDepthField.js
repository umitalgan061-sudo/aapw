/**
 * Water depth field — a baked, world-space "how deep is the water here" lookup that lets
 * `world/water.js` displace its surface with real geometric swell without re-introducing the
 * shallow-lake bug that made DECISIONS.md ADR-0048 give geometric waves up entirely.
 *
 * The texture carries two independent terrain-authoritative signals:
 * - red: normalized water depth used to bound geometric swell;
 * - green: fractional wet coverage used to decide whether the full-world water plane may render.
 *
 * Keeping those signals independent is essential. Exact shoreline samples and dry land both have
 * red=0, so depth alone cannot tell the renderer whether a fragment belongs to water. The green
 * channel is therefore derived from the same canonical terrain sampler as depth, not from a second
 * coastline approximation.
 *
 * P0 shoreline raster quality:
 * A single centre sample per ~34m texel made diagonal/curved coasts quantize into large rectangular
 * coverage steps in full-world orthographic views. Coverage is now supersampled at a deterministic
 * 2x2 pattern inside each texel. The result remains a pure function of the authoritative height
 * sampler, but green can encode 0%, 25%, 50%, 75% or 100% wet area before GPU bilinear filtering.
 * This gives the shader a sub-texel coastline envelope instead of a binary block edge, without
 * inventing geography or raising texture resolution/startup memory.
 *
 * The depth channel uses the wet subsamples only. Dry subsamples do not dilute nearby shallow-water
 * depth toward zero, which would incorrectly suppress swell in a narrow but genuinely wet part of a
 * mixed coastline texel. A texel with no wet subsamples remains depth=0, coverage=0.
 *
 * Determinism: a pure function of `(sampleHeightMeters, waterLevelMeters, extent, resolution,
 * fullWaveDepthMeters, coverageSubsamplesPerAxis)` — no randomness or time dependence.
 * @module world/waterDepthField
 */

import * as THREE from 'three';

export const WATER_DEPTH_FIELD_EXTENT_METERS = 13000;

/**
 * 384² keeps startup memory fixed at the already-qualified level. Coast quality is improved by
 * sub-texel terrain sampling rather than by multiplying GPU texture resolution.
 */
export const WATER_DEPTH_FIELD_RESOLUTION = 384;

/** Depth at which geometric swell reaches full amplitude. */
export const FULL_WAVE_DEPTH_METERS = 10;

/**
 * Depth over which the *optical* channel is normalised, in metres.
 *
 * Deliberately separate from `FULL_WAVE_DEPTH_METERS`, and much larger. That constant is a statement
 * about wave physics — the depth at which swell stops growing — and it saturates at 10 m, so a lake
 * bed at 8 m and an ocean trench at 60 m encode identically in the red channel. That is right for
 * swell and useless for colour: the whole point of deep water is that it keeps darkening long past the
 * depth where waves stop caring. Overloading red would tie the two together and make any change to one
 * silently change the other, so optical depth gets the reserved blue channel and its own range.
 */
export const FULL_OPTICAL_DEPTH_METERS = 60;

/**
 * Deterministic coverage supersampling grid. Two samples per axis gives four terrain probes per
 * texel and fractional 0/25/50/75/100% coverage. This is intentionally exported so acceptance can
 * prove the production constant rather than duplicating it.
 */
export const WATER_COVERAGE_SUBSAMPLES_PER_AXIS = 2;

/**
 * Returns normalized sub-texel offsets in [-0.5, 0.5] for a regular N×N coverage pattern.
 * Samples are centered inside each stratum rather than on texel boundaries, which avoids duplicate
 * probes between neighbouring texels and keeps edge behaviour symmetric.
 *
 * @param {number} samplesPerAxis
 * @returns {ReadonlyArray<ReadonlyArray<number>>}
 */
export function createCoverageSubsampleOffsets(samplesPerAxis = WATER_COVERAGE_SUBSAMPLES_PER_AXIS) {
	if (!Number.isInteger(samplesPerAxis) || samplesPerAxis < 1 || samplesPerAxis > 4) {
		throw new RangeError('coverageSubsamplesPerAxis must be an integer in [1, 4]');
	}
	const offsets = [];
	for (let row = 0; row < samplesPerAxis; row++) {
		for (let column = 0; column < samplesPerAxis; column++) {
			const x = (column + 0.5) / samplesPerAxis - 0.5;
			const z = (row + 0.5) / samplesPerAxis - 0.5;
			offsets.push(Object.freeze([x, z]));
		}
	}
	return Object.freeze(offsets);
}

/**
 * Samples one texel footprint from the canonical terrain source.
 *
 * Coverage is the fraction of sub-probes that lie strictly below water level. Depth is the average
 * normalized depth of wet probes only. This preserves shallow/deep response in mixed coast texels
 * instead of averaging dry terrain into the water column.
 *
 * @param {object} options
 * @param {(worldX:number, worldZ:number)=>number} options.sampleHeightMeters
 * @param {number} options.waterLevelMeters
 * @param {number} options.fullWaveDepthMeters
 * @param {number} options.worldX
 * @param {number} options.worldZ
 * @param {number} options.stepMeters
 * @param {ReadonlyArray<ReadonlyArray<number>>} options.coverageOffsets
 * @returns {{normalizedDepth:number, coverage:number, hasAnyWater:boolean, fullyDeep:boolean}}
 */
export function sampleWaterTexelFootprint({
	sampleHeightMeters,
	waterLevelMeters,
	fullWaveDepthMeters,
	worldX,
	worldZ,
	stepMeters,
	coverageOffsets,
}) {
	let wetSamples = 0;
	let normalizedDepthSum = 0;
	let opticalDepthSum = 0;
	let fullyDeepSamples = 0;

	for (const [offsetX, offsetZ] of coverageOffsets) {
		const sampleX = worldX + offsetX * stepMeters;
		const sampleZ = worldZ + offsetZ * stepMeters;
		const depthMeters = waterLevelMeters - sampleHeightMeters(sampleX, sampleZ);
		if (depthMeters <= 0) continue;

		wetSamples++;
		const normalizedDepth = Math.min(1, depthMeters / fullWaveDepthMeters);
		normalizedDepthSum += normalizedDepth;
		opticalDepthSum += Math.min(1, depthMeters / FULL_OPTICAL_DEPTH_METERS);
		if (normalizedDepth >= 1) fullyDeepSamples++;
	}

	const sampleCount = coverageOffsets.length;
	return {
		normalizedDepth: wetSamples > 0 ? normalizedDepthSum / wetSamples : 0,
		opticalDepth: wetSamples > 0 ? opticalDepthSum / wetSamples : 0,
		coverage: wetSamples / sampleCount,
		hasAnyWater: wetSamples > 0,
		fullyDeep: wetSamples === sampleCount && fullyDeepSamples === sampleCount,
	};
}

/**
 * Bakes the terrain-authoritative water field.
 *
 * RGBA byte layout:
 * - R = normalized wet-sample depth, 0..255
 * - G = fractional canonical wet coverage, 0..255
 * - B = normalized optical depth over `FULL_OPTICAL_DEPTH_METERS`, 0..255 (colour and clarity)
 * - A = 255
 *
 * @param {object} options
 * @param {(worldX:number, worldZ:number)=>number} options.sampleHeightMeters
 * @param {number} options.waterLevelMeters
 * @param {number} [options.extentMeters]
 * @param {number} [options.resolution]
 * @param {number} [options.fullWaveDepthMeters]
 * @param {number} [options.coverageSubsamplesPerAxis]
 * @returns {{
 *   texture: THREE.DataTexture,
 *   extentMeters:number,
 *   resolution:number,
 *   fullWaveDepthMeters:number,
 *   coverageSubsamplesPerAxis:number,
 *   deepTexelRatio:number,
 *   dryTexelRatio:number,
 *   mixedCoastTexelRatio:number,
 *   meanWetCoverage:number,
 *   bakeMs:number
 * }}
 */
export function createWaterDepthField({
	sampleHeightMeters,
	waterLevelMeters,
	extentMeters = WATER_DEPTH_FIELD_EXTENT_METERS,
	resolution = WATER_DEPTH_FIELD_RESOLUTION,
	fullWaveDepthMeters = FULL_WAVE_DEPTH_METERS,
	coverageSubsamplesPerAxis = WATER_COVERAGE_SUBSAMPLES_PER_AXIS,
}) {
	if (typeof sampleHeightMeters !== 'function') {
		throw new TypeError('sampleHeightMeters must be a function');
	}
	if (!Number.isFinite(waterLevelMeters)) {
		throw new TypeError('waterLevelMeters must be finite');
	}
	if (!Number.isFinite(extentMeters) || extentMeters <= 0) {
		throw new RangeError('extentMeters must be > 0');
	}
	if (!Number.isInteger(resolution) || resolution < 2) {
		throw new RangeError('resolution must be an integer >= 2');
	}
	if (!Number.isFinite(fullWaveDepthMeters) || fullWaveDepthMeters <= 0) {
		throw new RangeError('fullWaveDepthMeters must be > 0');
	}

	const startMs = performance.now();
	const texelCount = resolution * resolution;
	const data = new Uint8Array(texelCount * 4);
	const stepMeters = extentMeters / (resolution - 1);
	const originMeters = -extentMeters / 2;
	const coverageOffsets = createCoverageSubsampleOffsets(coverageSubsamplesPerAxis);

	let deepTexels = 0;
	let dryTexels = 0;
	let mixedCoastTexels = 0;
	let coverageSum = 0;

	for (let row = 0; row < resolution; row++) {
		const worldZ = originMeters + row * stepMeters;
		for (let column = 0; column < resolution; column++) {
			const worldX = originMeters + column * stepMeters;
			const sample = sampleWaterTexelFootprint({
				sampleHeightMeters,
				waterLevelMeters,
				fullWaveDepthMeters,
				worldX,
				worldZ,
				stepMeters,
				coverageOffsets,
			});

			if (sample.fullyDeep) deepTexels++;
			if (!sample.hasAnyWater) dryTexels++;
			if (sample.coverage > 0 && sample.coverage < 1) mixedCoastTexels++;
			coverageSum += sample.coverage;

			const offset = (row * resolution + column) * 4;
			data[offset] = Math.round(sample.normalizedDepth * 255);
			data[offset + 1] = Math.round(sample.coverage * 255);
			data[offset + 2] = Math.round(sample.opticalDepth * 255);
			data[offset + 3] = 255;
		}
	}

	const texture = new THREE.DataTexture(
		data,
		resolution,
		resolution,
		THREE.RGBAFormat,
		THREE.UnsignedByteType,
	);
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	return {
		texture,
		extentMeters,
		resolution,
		fullWaveDepthMeters,
		coverageSubsamplesPerAxis,
		deepTexelRatio: deepTexels / texelCount,
		dryTexelRatio: dryTexels / texelCount,
		mixedCoastTexelRatio: mixedCoastTexels / texelCount,
		meanWetCoverage: coverageSum / texelCount,
		bakeMs: performance.now() - startMs,
	};
}

/**
 * Releases the baked texture's GPU/CPU memory. `world/water.js` already does this for an attached
 * field; callers only need this helper for a field that was baked but never attached.
 */
export function disposeWaterDepthField(depthField) {
	depthField.texture.dispose();
}
