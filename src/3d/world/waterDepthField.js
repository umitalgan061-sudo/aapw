/**
 * Water depth field — terrain-authoritative depth/coverage plus render-only marine optics.
 *
 * R/G in `texture` remain the qualified physical authorities:
 * - R: normalized physical water depth, used to bound geometric swell;
 * - G: supersampled canonical wet coverage, used to decide whether water may render.
 *
 * `offshoreTexture` is deliberately non-authoritative. It begins with boundary-connected shoreline
 * distance and then applies a bounded, deterministic world-space current/sediment exposure fabric.
 * The fabric is zero at the coast and in enclosed lakes, so it cannot move a shoreline, alter
 * bathymetry, change collision, or change wave amplitude. Its only purpose is to keep kilometre-scale
 * open sea from reading as one uniform optical depth/roughness family in aerial and full-world views.
 *
 * @module world/waterDepthField
 */

import * as THREE from 'three';

export const WATER_DEPTH_FIELD_EXTENT_METERS = 13000;
export const WATER_DEPTH_FIELD_RESOLUTION = 384;
export const FULL_WAVE_DEPTH_METERS = 10;
export const WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS = 1100;
export const WATER_COVERAGE_SUBSAMPLES_PER_AXIS = 2;
export const WATER_OFFSHORE_SHORELINE_MAX_COVERAGE = 0.5;

export const WATER_OFFSHORE_OPTICAL_VARIATION_POLICY = Object.freeze({
	id: 'water-offshore-optical-world-fabric-2026-08-26-v2-scale-qualified',
	renderOnly: true,
	physicalDepthUnchanged: true,
	coverageUnchanged: true,
	lakeIsolationPreserved: true,
	macroScaleMeters: 2600,
	mesoScaleMeters: 920,
	fineScaleMeters: 340,
	warpScaleMeters: 1800,
	maxFactorPerturbation: 0.115,
	shoreFadeStart: 0.12,
	shoreFadeFull: 0.58,
	fullDistanceScaleStartMeters: 240,
	fullDistanceScaleFullMeters: 900,
	currentAxisX: 0.84,
	currentAxisZ: 0.54,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};

function hash2D(ix, iz, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iz | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function valueNoise2D(x, z, seed) {
	const x0 = Math.floor(x);
	const z0 = Math.floor(z);
	const tx0 = x - x0;
	const tz0 = z - z0;
	const tx = tx0 * tx0 * (3 - 2 * tx0);
	const tz = tz0 * tz0 * (3 - 2 * tz0);
	const a = hash2D(x0, z0, seed);
	const b = hash2D(x0 + 1, z0, seed);
	const c = hash2D(x0, z0 + 1, seed);
	const d = hash2D(x0 + 1, z0 + 1, seed);
	return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export function sampleOffshoreOpticalFabric(worldX, worldZ) {
	const P = WATER_OFFSHORE_OPTICAL_VARIATION_POLICY;
	const warp = (valueNoise2D(worldX / P.warpScaleMeters, worldZ / P.warpScaleMeters, 0x4f464653) - 0.5) * 2;
	const axisLength = Math.hypot(P.currentAxisX, P.currentAxisZ) || 1;
	const ax = P.currentAxisX / axisLength;
	const az = P.currentAxisZ / axisLength;
	const crossX = -az;
	const crossZ = ax;
	const along = worldX * ax + worldZ * az;
	const across = worldX * crossX + worldZ * crossZ;
	const macro = valueNoise2D((along + warp * 430) / P.macroScaleMeters, across / (P.macroScaleMeters * 0.58), 0x41d3);
	const meso = valueNoise2D((worldX - warp * 170) / P.mesoScaleMeters, (worldZ + warp * 210) / P.mesoScaleMeters, 0x93a7);
	const fine = valueNoise2D((worldX + worldZ * 0.23) / P.fineScaleMeters, (worldZ - worldX * 0.17) / P.fineScaleMeters, 0xc15b);
	const ridge = 1 - Math.abs(macro * 2 - 1);
	const signed = (macro - 0.5) * 0.94 + (meso - 0.5) * 0.58 + (fine - 0.5) * 0.24 + (ridge - 0.5) * 0.20;
	return Math.max(-1, Math.min(1, signed));
}

export function createCoverageSubsampleOffsets(samplesPerAxis = WATER_COVERAGE_SUBSAMPLES_PER_AXIS) {
	if (!Number.isInteger(samplesPerAxis) || samplesPerAxis < 1 || samplesPerAxis > 4) {
		throw new RangeError('coverageSubsamplesPerAxis must be an integer in [1, 4]');
	}
	const offsets = [];
	for (let row = 0; row < samplesPerAxis; row++) {
		for (let column = 0; column < samplesPerAxis; column++) {
			offsets.push(Object.freeze([
				(column + 0.5) / samplesPerAxis - 0.5,
				(row + 0.5) / samplesPerAxis - 0.5,
			]));
		}
	}
	return Object.freeze(offsets);
}

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
		const depthMeters = waterLevelMeters - sampleHeightMeters(
			worldX + offsetX * stepMeters,
			worldZ + offsetZ * stepMeters,
		);
		if (depthMeters <= 0) continue;
		wetSamples += 1;
		const normalizedDepth = Math.min(1, depthMeters / fullWaveDepthMeters);
		normalizedDepthSum += normalizedDepth;
		if (normalizedDepth >= 1) fullyDeepSamples += 1;
	}
	const sampleCount = coverageOffsets.length;
	return {
		normalizedDepth: wetSamples > 0 ? normalizedDepthSum / wetSamples : 0,
		coverage: wetSamples / sampleCount,
		hasAnyWater: wetSamples > 0,
		fullyDeep: wetSamples === sampleCount && fullyDeepSamples === sampleCount,
	};
}

function buildMarineMask(data, resolution) {
	const texelCount = resolution * resolution;
	const marine = new Uint8Array(texelCount);
	const queue = new Int32Array(texelCount);
	let read = 0;
	let write = 0;
	const enqueue = (index) => {
		if (marine[index] || data[index * 4 + 1] <= 0) return;
		marine[index] = 1;
		queue[write++] = index;
	};
	for (let column = 0; column < resolution; column += 1) {
		enqueue(column);
		enqueue((resolution - 1) * resolution + column);
	}
	for (let row = 1; row + 1 < resolution; row += 1) {
		enqueue(row * resolution);
		enqueue(row * resolution + resolution - 1);
	}
	while (read < write) {
		const index = queue[read++];
		const row = Math.floor(index / resolution);
		const column = index - row * resolution;
		for (let dz = -1; dz <= 1; dz += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				if (dx === 0 && dz === 0) continue;
				const nx = column + dx;
				const nz = row + dz;
				if (nx < 0 || nx >= resolution || nz < 0 || nz >= resolution) continue;
				enqueue(nz * resolution + nx);
			}
		}
	}
	return marine;
}

function buildChamferDistance(data, marine, resolution) {
	const texelCount = resolution * resolution;
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
	return { distances, shorelineCoverageByte };
}

function buildOffshoreDistanceData(data, resolution, stepMeters, fullDistanceMeters, extentMeters) {
	const texelCount = resolution * resolution;
	const marine = buildMarineMask(data, resolution);
	const { distances, shorelineCoverageByte } = buildChamferDistance(data, marine, resolution);
	const offshoreData = new Uint8Array(texelCount);
	const originMeters = -extentMeters / 2;
	const P = WATER_OFFSHORE_OPTICAL_VARIATION_POLICY;
	const worldScaleFade = smoothstep(P.fullDistanceScaleStartMeters, P.fullDistanceScaleFullMeters, fullDistanceMeters);
	let wetCoverage = 0;
	let marineCoverage = 0;
	let offshoreWeightedSum = 0;
	let fullOffshoreTexels = 0;
	let opticalVariationWeightedSum = 0;
	let opticalVariationAbsWeightedSum = 0;
	let variedMarineTexels = 0;

	for (let index = 0; index < texelCount; index += 1) {
		const coverageByte = data[index * 4 + 1];
		const coverage = coverageByte / 255;
		wetCoverage += coverage;
		if (coverage <= 0 || !marine[index]) continue;
		marineCoverage += coverage;
		const baseOffshoreFactor = coverageByte > shorelineCoverageByte
			? Math.min(1, (distances[index] * stepMeters) / fullDistanceMeters)
			: 0;
		const row = Math.floor(index / resolution);
		const column = index - row * resolution;
		const worldX = originMeters + column * stepMeters;
		const worldZ = originMeters + row * stepMeters;
		const shoreFade = smoothstep(P.shoreFadeStart, P.shoreFadeFull, baseOffshoreFactor);
		const fabric = sampleOffshoreOpticalFabric(worldX, worldZ);
		const perturbation = fabric * P.maxFactorPerturbation * shoreFade * worldScaleFade;
		const headroom = 4 * baseOffshoreFactor * (1 - baseOffshoreFactor);
		const offshoreFactor = baseOffshoreFactor <= 0
			? 0
			: baseOffshoreFactor >= 1
				? 1
				: clamp01(baseOffshoreFactor + perturbation * headroom);
		offshoreData[index] = Math.round(offshoreFactor * 255);
		offshoreWeightedSum += offshoreFactor * coverage;
		opticalVariationWeightedSum += (offshoreFactor - baseOffshoreFactor) * coverage;
		opticalVariationAbsWeightedSum += Math.abs(offshoreFactor - baseOffshoreFactor) * coverage;
		if (Math.abs(offshoreFactor - baseOffshoreFactor) > 1 / 255) variedMarineTexels += 1;
		if (offshoreFactor >= 1) fullOffshoreTexels += 1;
	}

	return {
		offshoreData,
		marineFractionOfWetCoverage: wetCoverage > 0 ? marineCoverage / wetCoverage : 0,
		meanOffshoreOpticalFactor: marineCoverage > 0 ? offshoreWeightedSum / marineCoverage : 0,
		offshoreFullTexelRatio: fullOffshoreTexels / texelCount,
		meanOpticalVariation: marineCoverage > 0 ? opticalVariationWeightedSum / marineCoverage : 0,
		meanAbsoluteOpticalVariation: marineCoverage > 0 ? opticalVariationAbsWeightedSum / marineCoverage : 0,
		variedMarineTexelRatio: variedMarineTexels / texelCount,
	};
}

export function createWaterDepthField({
	sampleHeightMeters,
	waterLevelMeters,
	extentMeters = WATER_DEPTH_FIELD_EXTENT_METERS,
	resolution = WATER_DEPTH_FIELD_RESOLUTION,
	fullWaveDepthMeters = FULL_WAVE_DEPTH_METERS,
	coverageSubsamplesPerAxis = WATER_COVERAGE_SUBSAMPLES_PER_AXIS,
	offshoreOpticalFullDistanceMeters = WATER_OFFSHORE_OPTICAL_FULL_DISTANCE_METERS,
}) {
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
	if (!Number.isFinite(waterLevelMeters)) throw new TypeError('waterLevelMeters must be finite');
	if (!Number.isFinite(extentMeters) || extentMeters <= 0) throw new RangeError('extentMeters must be > 0');
	if (!Number.isInteger(resolution) || resolution < 2) throw new RangeError('resolution must be an integer >= 2');
	if (!Number.isFinite(fullWaveDepthMeters) || fullWaveDepthMeters <= 0) throw new RangeError('fullWaveDepthMeters must be > 0');
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

	for (let row = 0; row < resolution; row += 1) {
		const worldZ = originMeters + row * stepMeters;
		for (let column = 0; column < resolution; column += 1) {
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
			if (sample.fullyDeep) deepTexels += 1;
			if (!sample.hasAnyWater) dryTexels += 1;
			if (sample.coverage > 0 && sample.coverage < 1) mixedCoastTexels += 1;
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
		extentMeters,
	);

	const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
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
		meanOpticalVariation: offshore.meanOpticalVariation,
		meanAbsoluteOpticalVariation: offshore.meanAbsoluteOpticalVariation,
		variedMarineTexelRatio: offshore.variedMarineTexelRatio,
		offshoreOpticalVariationPolicy: WATER_OFFSHORE_OPTICAL_VARIATION_POLICY.id,
		bakeMs: performance.now() - startMs,
	};
}

export function disposeWaterDepthField(depthField) {
	depthField.texture.dispose();
	depthField.offshoreTexture?.dispose();
}
