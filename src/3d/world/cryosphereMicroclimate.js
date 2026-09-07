/**
 * Deterministic, render-climate-only microclimate response for the owner-map cryosphere.
 *
 * This module deliberately does NOT decide where Westeros is frozen. The canonical north/always-
 * winter zones remain the sole geography authority. Instead, it explains why two nearby points inside
 * the same authored belt do not carry identical snow, tundra, frost, or coastal chill: wind exposure,
 * sheltered hollows, maritime moderation, frost pockets, and snow persistence vary in world space.
 *
 * Height, hydrology, collider, shoreline classification, settlement coordinates, and canonical map
 * coverage are never modified here. The output is a bounded response field consumed by the existing
 * northReferenceCryosphere renderer and vegetation climate bridge.
 * @module world/cryosphereMicroclimate
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	if (a === b) return value >= b ? 1 : 0;
	const t = clamp01((value - a) / (b - a));
	return t * t * (3 - 2 * t);
};

export const CRYOSPHERE_MICROCLIMATE_POLICY = Object.freeze({
	id: 'cryosphere-microclimate-worldspace-2026-09-07-v1',
	renderClimateOnly: true,
	canonicalZoneAuthorityUnchanged: true,
	canonicalTerrainAuthorityUnchanged: true,
	canonicalHydrologyAuthorityUnchanged: true,
	worldSpaceDeterministic: true,
	cameraIndependent: true,
	boundedResponse: true,
	microclimate: Object.freeze({
		macroScaleMeters: 920,
		mesoScaleMeters: 280,
		fineScaleMeters: 78,
		pocketScaleMeters: 31,
		windAlongScaleMeters: 640,
		windAcrossScaleMeters: 74,
		maritimeScaleMeters: 1500,
		exposureGain: 0.16,
		shelterGain: 0.14,
		frostPocketGain: 0.11,
		snowPersistenceGain: 0.13,
		maritimeModerationGain: 0.10,
		coastalPersistenceGain: 0.09,
		tundraResponseGain: 0.10,
		iceResponseGain: 0.07,
		vegetationSuppressionGain: 0.17,
		coastWarmthRecovery: 0.08,
	}),
	seeds: Object.freeze({
		macro: 0x5a17,
		meso: 0x91e3,
		fine: 0xc47d,
		pocket: 0xa613,
		windAlong: 0x61bd,
		windAcross: 0xe735,
		maritime: 0x2bd1,
		coastal: 0x7f39,
		shelter: 0x8ca1,
	}),
});

function hashCell(ix, iz, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iz | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function smoothNoiseAt(worldX, worldZ, scaleMeters, seed) {
	const scale = Math.max(1, scaleMeters);
	const x = worldX / scale;
	const z = worldZ / scale;
	const x0 = Math.floor(x);
	const z0 = Math.floor(z);
	const fx = x - x0;
	const fz = z - z0;
	const sx = fx * fx * (3 - 2 * fx);
	const sz = fz * fz * (3 - 2 * fz);
	const a = hashCell(x0, z0, seed);
	const b = hashCell(x0 + 1, z0, seed);
	const c = hashCell(x0, z0 + 1, seed);
	const d = hashCell(x0 + 1, z0 + 1, seed);
	return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function signedNoise(worldX, worldZ, scaleMeters, seed) {
	return smoothNoiseAt(worldX, worldZ, scaleMeters, seed) * 2 - 1;
}

function wrappedWindCoordinates(worldX, worldZ) {
	const along = worldX * 0.82 + worldZ * 0.57;
	const across = -worldX * 0.57 + worldZ * 0.82;
	return { along, across };
}

function sampleMacroExposure(worldX, worldZ) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const macro = smoothNoiseAt(worldX, worldZ, P.macroScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.macro);
	const meso = smoothNoiseAt(worldX + 37.1, worldZ - 21.4, P.mesoScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.meso);
	const fine = smoothNoiseAt(worldX - 14.2, worldZ + 19.7, P.fineScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.fine);
	const raw = macro * 0.56 + meso * 0.30 + fine * 0.14;
	return clamp01(raw);
}

function sampleShelter(worldX, worldZ) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const shelterA = smoothNoiseAt(worldX + 62.4, worldZ - 18.1, P.mesoScaleMeters * 0.82, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.shelter);
	const shelterB = smoothNoiseAt(worldX - 28.8, worldZ + 43.7, P.fineScaleMeters * 1.65, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.shelter + 97);
	const basin = smoothNoiseAt(worldX + 11.7, worldZ + 8.3, P.pocketScaleMeters * 1.8, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.pocket + 19);
	return clamp01(shelterA * 0.48 + shelterB * 0.27 + basin * 0.25);
}

function sampleFrostPocket(worldX, worldZ) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const primary = smoothNoiseAt(worldX - 17.4, worldZ + 9.8, P.pocketScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.pocket);
	const secondary = smoothNoiseAt(worldX + 8.6, worldZ - 12.4, P.pocketScaleMeters * 0.61, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.pocket + 41);
	const fringe = smoothNoiseAt(worldX + 29.2, worldZ - 6.4, P.fineScaleMeters * 0.77, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.fine + 131);
	return clamp01(primary * 0.56 + secondary * 0.26 + fringe * 0.18);
}

function sampleWindExposure(worldX, worldZ) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const { along, across } = wrappedWindCoordinates(worldX, worldZ);
	const alongField = smoothNoiseAt(along, across, P.windAlongScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.windAlong);
	const crossField = smoothNoiseAt(along * 0.17, across, P.windAcrossScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.windAcross);
	const streak = smoothstep(0.34, 0.82, alongField * 0.58 + crossField * 0.42);
	return clamp01(streak);
}

function sampleMaritimeModeration(worldX, worldZ, normalizedX) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const base = smoothNoiseAt(worldX + 71.2, worldZ - 51.6, P.maritimeScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.maritime);
	const coast = smoothNoiseAt(worldX - 12.8, worldZ + 44.3, P.mesoScaleMeters, CRYOSPHERE_MICROCLIMATE_POLICY.seeds.coastal);
	const eastBias = clamp01((normalizedX - 0.38) / 0.50);
	return clamp01(base * 0.44 + coast * 0.34 + eastBias * 0.22);
}

function sampleSnowPersistence({ exposure, shelter, frostPocket, maritimeModeration, coastal = 0 }) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const exposed = 1 - exposure;
	return clamp01(
		0.50
		+ shelter * P.shelterGain
		+ frostPocket * P.frostPocketGain
		+ exposed * P.snowPersistenceGain
		+ maritimeModeration * P.maritimeModerationGain
		+ coastal * P.coastalPersistenceGain,
	);
}

function sampleTundraResponse({ exposure, shelter, frostPocket, maritimeModeration }) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	return clamp01(
		0.50
		+ shelter * P.shelterGain * 0.92
		+ frostPocket * P.frostPocketGain * 0.85
		+ (1 - exposure) * P.tundraResponseGain
		- maritimeModeration * P.coastWarmthRecovery,
	);
}

function sampleIceResponse({ exposure, shelter, frostPocket, maritimeModeration }) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	return clamp01(
		0.50
		+ shelter * P.shelterGain * 0.60
		+ frostPocket * P.frostPocketGain * 0.72
		+ (1 - exposure) * P.iceResponseGain
		- maritimeModeration * P.maritimeModerationGain * 0.60,
	);
}

function sampleVegetationSuppression({ permanentIce, tundra, exposure, frostPocket, shelter }) {
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const exposedCold = exposure * P.vegetationSuppressionGain;
	const shelteredRecovery = shelter * (P.shelterGain * 0.55);
	const frostStress = frostPocket * P.frostPocketGain * 0.50;
	return clamp01(permanentIce * 0.88 + tundra * 0.54 + exposedCold + frostStress - shelteredRecovery);
}

export function cryosphereMicroclimateAtWorldXZ(worldX, worldZ, normalizedX = 0.5) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
		throw new TypeError('cryosphere microclimate coordinates must be finite');
	}
	const safeX = clamp01(normalizedX);
	const exposure = sampleWindExposure(worldX, worldZ);
	const shelter = sampleShelter(worldX, worldZ);
	const frostPocket = sampleFrostPocket(worldX, worldZ);
	const macroExposure = sampleMacroExposure(worldX, worldZ);
	const maritimeModeration = sampleMaritimeModeration(worldX, worldZ, safeX);
	const coastal = clamp01((1 - safeX) * 0.62 + maritimeModeration * 0.38);
	const snowPersistence = sampleSnowPersistence({ exposure, shelter, frostPocket, maritimeModeration, coastal });
	const tundraResponse = sampleTundraResponse({ exposure, shelter, frostPocket, maritimeModeration });
	const iceResponse = sampleIceResponse({ exposure, shelter, frostPocket, maritimeModeration });
	return Object.freeze({
		worldX,
		worldZ,
		normalizedX: safeX,
		exposure,
		shelter,
		frostPocket,
		macroExposure,
		maritimeModeration,
		coastal,
		snowPersistence,
		tundraResponse,
		iceResponse,
		vegetationSuppression: sampleVegetationSuppression({ permanentIce: 0, tundra: 0, exposure, frostPocket, shelter }),
	});
}

export function modulateCryosphereWeights(base, microclimate) {
	if (!base || !microclimate) throw new TypeError('base cryosphere weights and microclimate are required');
	const P = CRYOSPHERE_MICROCLIMATE_POLICY.microclimate;
	const permanentIceBase = clamp01(base.permanentIce);
	const tundraBase = clamp01(base.tundra);
	const exposure = clamp01(microclimate.exposure);
	const shelter = clamp01(microclimate.shelter);
	const persistence = clamp01(microclimate.snowPersistence);
	const frostPocket = clamp01(microclimate.frostPocket);
	const maritime = clamp01(microclimate.maritimeModeration);
	const iceResponse = clamp01(microclimate.iceResponse);
	const tundraResponse = clamp01(microclimate.tundraResponse);
	const iceResponseDelta = (iceResponse - 0.5) * P.iceResponseGain;
	const tundraResponseDelta = (tundraResponse - 0.5) * P.tundraResponseGain;
	const exposureDelta = (0.5 - exposure) * P.exposureGain;
	const shelterDelta = (shelter - 0.5) * P.shelterGain;
	const frostDelta = (frostPocket - 0.5) * P.frostPocketGain;
	const maritimeDelta = (0.5 - maritime) * P.maritimeModerationGain;
	const permanentIce = clamp01(
		permanentIceBase
		+ permanentIceBase * (iceResponseDelta + exposureDelta * 0.70 + shelterDelta * 0.36 + frostDelta * 0.44)
		- (1 - permanentIceBase) * maritimeDelta * 0.14,
	);
	const tundra = clamp01(
		tundraBase
		+ tundraBase * (tundraResponseDelta + exposureDelta * 0.42 + shelterDelta * 0.50 + frostDelta * 0.54)
		- (1 - tundraBase) * maritimeDelta * 0.08,
	);
	return Object.freeze({
		...base,
		permanentIce,
		tundra,
		microclimateResponse: Object.freeze({
			exposure,
			shelter,
			frostPocket,
			persistence,
			maritime,
			iceResponse,
			tundraResponse,
			boundedGain: true,
		}),
	});
}

export function vegetationCryosphereSuppressionAtWorldXZ(worldX, worldZ, climate) {
	const micro = cryosphereMicroclimateAtWorldXZ(worldX, worldZ, climate?.normalizedX ?? 0.5);
	const suppression = sampleVegetationSuppression({
		permanentIce: clamp01(climate?.permanentIce),
		tundra: clamp01(climate?.tundra),
		exposure: micro.exposure,
		frostPocket: micro.frostPocket,
		shelter: micro.shelter,
	});
	return clamp01(suppression * (1 - micro.maritimeModeration * 0.08));
}

export function cryosphereTransitionDiagnostics(samples) {
	if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
	let minIce = 1;
	let maxIce = 0;
	let minTundra = 1;
	let maxTundra = 0;
	let minPersistence = 1;
	let maxPersistence = 0;
	for (const sample of samples) {
		const ice = clamp01(sample?.permanentIce);
		const tundra = clamp01(sample?.tundra);
		const persistence = clamp01(sample?.microclimateResponse?.persistence ?? sample?.snowPersistence);
		minIce = Math.min(minIce, ice);
		maxIce = Math.max(maxIce, ice);
		minTundra = Math.min(minTundra, tundra);
		maxTundra = Math.max(maxTundra, tundra);
		minPersistence = Math.min(minPersistence, persistence);
		maxPersistence = Math.max(maxPersistence, persistence);
	}
	return Object.freeze({
		sampleCount: samples.length,
		iceRange: Object.freeze({ min: minIce, max: maxIce }),
		tundraRange: Object.freeze({ min: minTundra, max: maxTundra }),
		snowPersistenceRange: Object.freeze({ min: minPersistence, max: maxPersistence }),
		finite: samples.every((sample) => Number.isFinite(sample?.permanentIce) && Number.isFinite(sample?.tundra)),
	});
}

export function assertCryosphereMicroclimateContract() {
	const probes = [
		[0, 0, 0.12],
		[700, -420, 0.28],
		[-1300, 860, 0.44],
		[2140, 1320, 0.72],
		[-2870, -1040, 0.91],
	];
	for (const [x, z, nx] of probes) {
		const sample = cryosphereMicroclimateAtWorldXZ(x, z, nx);
		for (const value of Object.values(sample)) {
			if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('cryosphere microclimate produced a non-finite value');
		}
		if (sample.exposure < 0 || sample.exposure > 1) throw new Error('exposure out of bounds');
		if (sample.shelter < 0 || sample.shelter > 1) throw new Error('shelter out of bounds');
		if (sample.frostPocket < 0 || sample.frostPocket > 1) throw new Error('frost pocket out of bounds');
		if (sample.snowPersistence < 0 || sample.snowPersistence > 1) throw new Error('persistence out of bounds');
	}
	return true;
}

export const __TEST_ONLY__ = Object.freeze({
	hashCell,
	smoothNoiseAt,
	cryosphereMicroclimateAtWorldXZ,
	modulateCryosphereWeights,
	cryosphereTransitionDiagnostics,
});
