/**
 * Water depth field — a baked, world-space lookup that lets `world/water.js` combine physically
 * safe geometric swell with terrain-authoritative shoreline coverage and render-only offshore optics.
 *
 * The authoritative RGBA texture keeps its established signals unchanged:
 * - red: normalized physical water depth used to bound geometric swell;
 * - green: fractional canonical wet coverage used to decide whether water may render.
 * A second one-channel render-only texture stores normalized marine distance from shoreline so broad
 * offshore shelves can optically deepen without mutating the qualified depth/coverage bytes.
 *
 * The offshore field is derived *after* depth/coverage are baked, using only green-channel topology.
 * A boundary flood-fill identifies the open marine body, so enclosed lakes remain optical-distance 0
 * even when broad. The field never changes height, collision, wet/dry ownership or wave amplitude.
 * This preserves ADR-0048 shallow-lake safety while giving open sea a coast-to-offshore gradient.
 *
 * P0 shoreline raster quality:
 * A single centre sample per ~34m texel made diagonal/curved coasts quantize into large rectangular
 * coverage steps in full-world orthographic views. Coverage is supersampled at a deterministic 2x2
 * pattern inside each texel. Green can encode 0%, 25%, 50%, 75% or 100% wet area before GPU bilinear
 * filtering, giving the shader a sub-texel coastline envelope without inventing geography.
 *
 * The depth channel uses wet subsamples only. Dry subsamples do not dilute nearby shallow-water depth
 * toward zero, which would incorrectly suppress swell in a narrow but genuinely wet part of a mixed
 * coastline texel. The offshore-distance pass adds no terrain probes: it is an O(N) two-pass chamfer
 * transform plus boundary connectivity over the already-baked green channel, so startup terrain
 * sampling cost remains exactly unchanged.
 *
 * Determinism: a pure function of `(sampleHeightMeters, waterLevelMeters, extent, resolution,
 * fullWaveDepthMeters, coverageSubsamplesPerAxis, offshoreOpticalFullDistanceMeters)`.
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
 * Distance from canonical shoreline at which the render-only offshore optical signal reaches 1.
 * At the production 384² field this is ~32 texels: broad shelves graduate offshore, while ordinary
 * lakes and near-shore coves remain governed almost entirely by their real physical depth.
 */
export const WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS = 1100;

/**
 * Deterministic coverage supersampling grid. Two samples per axis gives four terrain probes per
 * texel and fractional 0/25/50/75/100% coverage. This is intentionally exported so acceptance can
 * prove the production constant rather than duplicating it.
 */
export const WATER_COVERAGE_SUBSAMPLES_PER_AXIS = 2;

/**
 * Mixed cells at or below 50% wet remain shoreline seeds. A 75%-wet, boundary-connected marine cell
 * may carry offshore distance so one dry supersample cannot carve a kilometre-scale false shallow
 * halo through open sea. Real coasts still contain <=50%-wet/dry neighbours and remain distance zero.
 */
export const WATER_OFFSHORE_SHORELINE_MAX_COVERAGE = 0.5;

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
	let fullyDeepSamples = 0;

	for (const [offsetX, offsetZ] of coverageOffsets) {
		const sampleX = worldX + offsetX * stepMeters;
		const sampleZ = worldZ + offsetZ * stepMeters;
		const depthMeters = waterLevelMeters - sampleHeightMeters(sampleX, sampleZ);
		if (depthMeters <= 0) continue;

		wetSamples++;
		const normalizedDepth = Math.min(1, depthMeters / fullWaveDepthMeters);
		normalizedDepthSum += normalizedDepth;
		if (normalizedDepth >= 1) fullyDeepSamples++;
	}

	const sampleCount = coverageOffsets.length;
	return {
		normalizedDepth: wetSamples > 0 ? normalizedDepthSum / wetSamples : 0,
		coverage: wetSamples / sampleCount,
		hasAnyWater: wetSamples > 0,
		fullyDeep: wetSamples === sampleCount && fullyDeepSamples === sampleCount,
	};
}

/**
 * Builds render-only marine shoreline distance without any extra terrain probes.
 *
 * The boundary flood-fill is the lake/sea discriminator: only canonical wet cells connected to the
 * owner-field boundary are eligible for offshore optical depth. Enclosed lake cells remain zero.
 * Eligible marine cells receive an 8-neighbour chamfer distance from the nearest non-marine or
 * <=50%-wet shoreline cell; 75%-wet marine supersample noise can carry distance instead of resetting it.
 */
function buildOffshoreDistanceData(data, resolution, stepMeters, fullDistanceMeters) {
	const texelCount = resolution * resolution;
	const marine = new Uint8Array(texelCount);
	const queue = new Int32Array(texelCount);
	let queueRead = 0;
	let queueWrite = 0;

	const enqueueMarine = (index) => {
		if (marine[index] || data[index * 4 + 1] <= 0) return;
		marine[index] = 1;
		queue[queueWrite++] = index;
	};
	for (let column = 0; column < resolution; column += 1) {
		enqueueMarine(column);
		enqueueMarine((resolution - 1) * resolution + column);
	}
	for (let row = 1; row + 1 < resolution; row += 1) {
		enqueueMarine(row * resolution);
		enqueueMarine(row * resolution + resolution - 1);
	}
	while (queueRead < queueWrite) {
		const index = queue[queueRead++];
		const row = Math.floor(index / resolution);
		const column = index - row * resolution;
		for (let dz = -1; dz <= 1; dz += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				if (dx === 0 && dz === 0) continue;
				const nx = column + dx;
				const nz = row + dz;
				if (nx < 0 || nx >= resolution || nz < 0 || nz >= resolution) continue;
				enqueueMarine(nz * resolution + nx);
			}
		}
	}

	const shorelineCoverageByte = Math.round(WATER_OFFSHORE_SHORELINE_MAX_COVERAGE * 255);
	const distances = new Float32Array(texelCount);
	distances.fill(Number.POSITIVE_INFINITY);
	for (let index = 0; index < texelCount; index += 1) {
		if (!marine[index] || data[index * 4 + 1] <= shorelineCoverageByte) distances[index] = 0;
	}
	const diagonal = Math.SQRT2;
	for (let row = 0; row < resolution; row += 1) {
		for (let column = 0; column < resolution; column += 1) {
			const index = row * resolution + column;
			let best = distances[index];
			if (column > 0) best = Math.min(best, distances[index - 1] + 1);
			if (row > 0) {
				best = Math.min(best, distances[index - resolution] + 1);
				if (column > 0) best = Math.min(best, distances[index - resolution - 1] + diagonal);
				if (column + 1 < resolution) best = Math.min(best, distances[index - resolution + 1] + diagonal);
			}
			distances[index] = best;
		}
	}
	for (let row = resolution - 1; row >= 0; row -= 1) {
		for (let column = resolution - 1; column >= 0; column -= 1) {
			const index = row * resolution + column;
			let best = distances[index];
			if (column + 1 < resolution) best = Math.min(best, distances[index + 1] + 1);
			if (row + 1 < resolution) {
				best = Math.min(best, distances[index + resolution] + 1);
				if (column > 0) best = Math.min(best, distances[index + resolution - 1] + diagonal);
				if (column + 1 < resolution) best = Math.min(best, distances[index + resolution + 1] + diagonal);
			}
			distances[index] = best;
		}
	}

	const offshoreData = new Uint8Array(texelCount);
	let wetCoverage = 0;
	let marineCoverage = 0;
	let offshoreWeightedSum = 0;
	let fullOffshoreTexels = 0;
	for (let index = 0; index < texelCount; index += 1) {
		const coverageByte = data[index * 4 + 1];
		const coverage = coverageByte / 255;
		wetCoverage += coverage;
		if (coverage <= 0 || !marine[index]) continue;
		marineCoverage += coverage;
		const offshoreFactor = coverageByte > shorelineCoverageByte
			? Math.min(1, (distances[index] * stepMeters) / fullDistanceMeters)
			: 0;
		offshoreData[index] = Math.round(offshoreFactor * 255);
		offshoreWeightedSum += offshoreFactor * coverage;
		if (offshoreFactor >= 1) fullOffshoreTexels++;
	}
	return {
		offshoreData,
		marineFractionOfWetCoverage: wetCoverage > 0 ? marineCoverage / wetCoverage : 0,
		meanOffshoreOpticalFactor: marineCoverage > 0 ? offshoreWeightedSum / marineCoverage : 0,
		offshoreFullTexelRatio: fullOffshoreTexels / texelCount,
	};
}

/**
 * Bakes the terrain-authoritative water field.
 *
 * RGBA byte layout:
 * - R = normalized wet-sample physical depth, 0..255
 * - G = fractional canonical wet coverage, 0..255
 * - B = reserved 255 (unchanged)
 * - A = 255
 *
 * @param {object} options
 * @param {(worldX:number, worldZ:number)=>number} options.sampleHeightMeters
 * @param {number} options.waterLevelMeters
 * @param {number} [options.extentMeters]
 * @param {number} [options.resolution]
 * @param {number} [options.fullWaveDepthMeters]
 * @param {number} [options.coverageSubsamplesPerAxis]
 * @param {number} [options.offshoreOpticalFullDistanceMeters]
 * @returns {{
 *   texture: THREE.DataTexture,
 *   offshoreTexture: THREE.DataTexture,
 *   extentMeters:number,
 *   resolution:number,
 *   fullWaveDepthMeters:number,
 *   coverageSubsamplesPerAxis:number,
 *   offshoreOpticalFullDistanceMeters:number,
 *   deepTexelRatio:number,
 *   dryTexelRatio:number,
 *   mixedCoastTexelRatio:number,
 *   meanWetCoverage:number,
 *   marineFractionOfWetCoverage:number,
 *   meanOffshoreOpticalFactor:number,
 *   offshoreFullTexelRatio:number,
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
	offshoreOpticalFullDistanceMeters = WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS,
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
	if (!Number.isFinite(offshoreOpticalFullDistanceMeters) || offshoreOpticalFullDistanceMeters <= 0) {
		throw new RangeError('offshoreOpticalFullDistanceMeters must be > 0');
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
			data[offset + 2] = 255;
			data[offset + 3] = 255;
		}
	}

	const offshore = buildOffshoreDistanceData(
		data,
		resolution,
		stepMeters,
		offshoreOpticalFullDistanceMeters,
	);

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

	const offshoreTexture = new THREE.DataTexture(
		offshore.offshoreData,
		resolution,
		resolution,
		THREE.RedFormat,
		THREE.UnsignedByteType,
	);
	offshoreTexture.magFilter = THREE.LinearFilter;
	offshoreTexture.minFilter = THREE.LinearFilter;
	offshoreTexture.wrapS = THREE.ClampToEdgeWrapping;
	offshoreTexture.wrapT = THREE.ClampToEdgeWrapping;
	offshoreTexture.generateMipmaps = false;
	offshoreTexture.needsUpdate = true;

	return {
		texture,
		offshoreTexture,
		extentMeters,
		resolution,
		fullWaveDepthMeters,
		coverageSubsamplesPerAxis,
		offshoreOpticalFullDistanceMeters,
		deepTexelRatio: deepTexels / texelCount,
		dryTexelRatio: dryTexels / texelCount,
		mixedCoastTexelRatio: mixedCoastTexels / texelCount,
		meanWetCoverage: coverageSum / texelCount,
		marineFractionOfWetCoverage: offshore.marineFractionOfWetCoverage,
		meanOffshoreOpticalFactor: offshore.meanOffshoreOpticalFactor,
		offshoreFullTexelRatio: offshore.offshoreFullTexelRatio,
		bakeMs: performance.now() - startMs,
	};
}

/**
 * Releases the baked texture's GPU/CPU memory. `world/water.js` already does this for an attached
 * field; callers only need this helper for a field that was baked but never attached.
 */
export function disposeWaterDepthField(depthField) {
	depthField.texture.dispose();
	depthField.offshoreTexture?.dispose();
}