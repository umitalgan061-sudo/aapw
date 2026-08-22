/**
 * Flow-aligned fluvial geomorphology for the shared live terrain height field.
 *
 * Continental uplift supplies the large-scale potential surface. Its local gradient therefore points
 * from interior high ground toward lower coastal ground. This module uses that gradient as a physical
 * fabric: valleys run broadly downhill, interfluve ridges sit between them and tributaries cross-cut
 * the main drainage at bounded angles. It adds no mountain where the map has none and never owns the
 * coastline; it only carves already-dry terrain into ridge/valley/basin forms.
 */
import { WORLD_REFERENCE_MAP } from './worldReferenceMap.js';
import { continentalUpliftMeters } from './terrainContinentalUplift.js';

const TAU = Math.PI * 2;
const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const TERRAIN_GEOMORPHOLOGY_POLICY = Object.freeze({
	id: 'terrain-flow-aligned-geomorphology-2026-08-20-v1',
	gradientStepNormalized: 1 / 192,
	regionalOrientationFrequency: 3.2,
	primaryDrainageFrequency: 13,
	tributaryFrequency: 27,
	meanderFrequency: 8.5,
	meanderStrengthNormalized: 0.018,
	basinFrequency: 7.5,
	basinAmplitudeMeters: 6,
	interfluveAmplitudeLowMeters: 3,
	interfluveAmplitudeHighMeters: 15,
	incisionAmplitudeHighMeters: 18,
	incisionStartElevationMeters: 12,
	incisionFullElevationMeters: 150,
	ruggedFullElevationMeters: 220,
	maximumRaiseMeters: 24,
	maximumCarveMeters: 22,
});

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function hash2(ix, iy) {
	const value = Math.sin(ix * 127.1 + iy * 311.7 + 19.19) * 43758.5453123;
	return value - Math.floor(value);
}

function valueNoise2(x, y) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const a = hash2(x0, y0);
	const b = hash2(x0 + 1, y0);
	const c = hash2(x0, y0 + 1);
	const d = hash2(x0 + 1, y0 + 1);
	return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

function signedFbm(x, y, octaves = 3) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalizer = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		sum += (valueNoise2(x * frequency, y * frequency) * 2 - 1) * amplitude;
		normalizer += amplitude;
		amplitude *= 0.5;
		frequency *= 2.03;
	}
	return sum / normalizer;
}

function upliftDownhillDirection(nx, ny) {
	const step = TERRAIN_GEOMORPHOLOGY_POLICY.gradientStepNormalized;
	const left = continentalUpliftMeters(clamp01(nx - step), ny);
	const right = continentalUpliftMeters(clamp01(nx + step), ny);
	const up = continentalUpliftMeters(nx, clamp01(ny - step));
	const down = continentalUpliftMeters(nx, clamp01(ny + step));
	const gx = (right - left) / (2 * step * MAP_ASPECT);
	const gy = (down - up) / (2 * step);
	const magnitude = Math.hypot(gx, gy);
	if (magnitude > 1e-5) return [-gx / magnitude, -gy / magnitude];
	const angle = valueNoise2(nx * TERRAIN_GEOMORPHOLOGY_POLICY.regionalOrientationFrequency, ny * TERRAIN_GEOMORPHOLOGY_POLICY.regionalOrientationFrequency) * TAU;
	return [Math.cos(angle), Math.sin(angle)];
}

/**
 * Metres of fluvial/structural detail to add to an already map-derived dry-land height.
 * Negative incision fades completely from low coastal ground, preventing artificial pond fields.
 */
export function terrainGeomorphologyMeters(normalizedX, normalizedY, {
	heightAboveSeaMeters,
	waterWeight,
	reliefInfluence = 0,
	rockWeight = 0,
}) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) throw new RangeError('normalized coordinates must be in [0,1]');
	const dryness = 1 - clamp01(waterWeight);
	if (dryness <= 0) return 0;

	const P = TERRAIN_GEOMORPHOLOGY_POLICY;
	const [downhillX, downhillY] = upliftDownhillDirection(normalizedX, normalizedY);
	const mapX = normalizedX * MAP_ASPECT;
	const mapY = normalizedY;
	const along = mapX * downhillX + mapY * downhillY;
	const across = mapX * -downhillY + mapY * downhillX;
	const meander = signedFbm(along * P.meanderFrequency + 13.7, across * 3.1 - 8.2, 3) * P.meanderStrengthNormalized;
	const warpedAcross = across + meander;

	const primaryDistance = Math.abs(Math.sin(TAU * warpedAcross * P.primaryDrainageFrequency));
	const primary = 1 - smoothstep(0.02, 0.22, primaryDistance);
	const tributaryAcross = warpedAcross * 0.74 + along * 0.31
		+ signedFbm(along * 14.3 - 4.8, across * 9.7 + 6.1, 2) * 0.010;
	const tributaryDistance = Math.abs(Math.sin(TAU * tributaryAcross * P.tributaryFrequency));
	const catchment = smoothstep(0.24, 0.82, valueNoise2(mapX * 6.1 + 7, mapY * 6.1 - 3));
	const tributary = (1 - smoothstep(0.015, 0.16, tributaryDistance)) * catchment;
	const drainage = Math.max(primary, tributary * 0.62);

	const elevationRamp = smoothstep(P.incisionStartElevationMeters, P.ruggedFullElevationMeters, heightAboveSeaMeters);
	const mappedRuggedness = clamp01(Math.max(reliefInfluence, rockWeight));
	const ruggedness = Math.max(elevationRamp, mappedRuggedness * 0.85);
	const interfluveAmplitude = P.interfluveAmplitudeLowMeters
		+ (P.interfluveAmplitudeHighMeters - P.interfluveAmplitudeLowMeters) * ruggedness;
	const interfluve = Math.pow(1 - drainage, 1.45)
		* (0.55 + valueNoise2(mapX * 10.5 - 12, mapY * 10.5 + 19) * 0.45)
		* interfluveAmplitude;
	const basin = signedFbm(mapX * P.basinFrequency + 2.4, mapY * P.basinFrequency - 17.1, 3) * P.basinAmplitudeMeters;
	const incisionRamp = smoothstep(P.incisionStartElevationMeters, P.incisionFullElevationMeters, heightAboveSeaMeters);
	const incision = drainage * P.incisionAmplitudeHighMeters * incisionRamp * (0.72 + ruggedness * 0.28);

	let metres = basin + interfluve - incision;
	if (metres < 0) metres *= incisionRamp;
	metres = clamp(metres, -P.maximumCarveMeters, P.maximumRaiseMeters);
	return metres * dryness;
}
