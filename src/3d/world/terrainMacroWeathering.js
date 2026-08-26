/**
 * Deterministic macro geomorphology/weathering residual for the shipped owner-map terrain.
 *
 * `terrain.js` remains the only height authority. This module contributes a bounded residual after
 * canonical Pindex/mountain/uplift height has been resolved. It never reclassifies land, water,
 * biomes, roads, settlements or collision. The purpose of the residual is visual geography: make
 * broad landforms read as a connected drainage system rather than statistically isotropic noise.
 *
 * v2 keeps the existing basin/tributary, bench, aspect, talus and massif cues and adds explicit
 * interfluves, floodplains and confluence fans. The production entry point is intentionally separate
 * from the rich diagnostic bundle: terrain generation can call it millions of times without creating
 * frozen object graphs or evaluating work that is guaranteed to be invisible over water/coastline.
 *
 * @module world/terrainMacroWeathering
 */

const TAU = Math.PI * 2;
const clamp01 = (value) => value <= 0 ? 0 : value >= 1 ? 1 : value;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (value) => {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
};
const smoother01 = (value) => {
	const t = clamp01(value);
	return t * t * t * (t * (t * 6 - 15) + 10);
};
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export const TERRAIN_MACRO_WEATHERING_POLICY = Object.freeze({
	id: 'terrain-macro-hydrology-weathering-2026-08-26-v1',
	revision: 2,
	renderOnly: false,
	deterministicWorldSpace: true,
	canonicalSurfaceAuthorityPreserved: true,
	settlementTaperOwnedByCaller: true,
	heightAuthority: 'world/terrain.js',
	productionFastPath: true,
	hydrologicHierarchy: true,
	alluvialGeomorphology: true,
	ownerWorldWidthMeters: 13296,
	ownerWorldHeightMeters: 10341,

	shoreFadeStartMeters: 1.6,
	shoreFadeFullMeters: 11,
	negativeCutFullElevationMeters: 34,

	drainageBroadFrequency: 12.5,
	drainageFineFrequency: 31,
	drainageBroadWarpFrequency: 4.4,
	drainageFineWarpFrequency: 10.8,
	drainageBroadWidth: 0.23,
	drainageFineWidth: 0.15,
	drainageBranchMix: 0.43,

	channelCutLowMeters: 1.2,
	channelCutHighMeters: 6.4,
	channelCutMountainMeters: 5.5,
	channelFullElevationMeters: 260,
	channelReliefBoost: 0.55,

	shoulderOffset: 0.095,
	shoulderWidth: 0.18,
	shoulderLiftLowMeters: 0.7,
	shoulderLiftHighMeters: 3.8,

	// Hydrologic geography beyond the channel line itself.
	interfluveLiftLowMeters: 0.55,
	interfluveLiftHighMeters: 2.15,
	floodplainCutMeters: 1.15,
	floodplainFullElevationMeters: 105,
	confluenceFanDepositMeters: 1.55,
	confluenceFanMaxElevationMeters: 180,
	terraceLiftMeters: 0.95,

	benchFrequency: 8.4,
	benchWarpFrequency: 3.7,
	benchBandCount: 7,
	benchSharpness: 0.18,
	benchLiftMeters: 3.4,
	benchCutMeters: 2.1,
	benchMinElevationMeters: 36,

	// Aspect is now analytic multi-wave instead of four finite-difference FBM probes. This keeps the
	// directional weathering cue while removing the largest single hot-path cost from terrain build.
	aspectRegionFrequency: 3.2,
	aspectSampleMeters: 44,
	aspectWeatheringMeters: 1.6,
	aspectReliefBoost: 1.15,

	talusCellFrequency: 18,
	talusWarpFrequency: 6.6,
	talusScarpThreshold: 0.66,
	talusDepositMeters: 3.2,
	talusCutMeters: 1.6,
	talusMinElevationMeters: 54,

	massifFrequency: 4.8,
	massifAmplitudeMeters: 5.4,
	massifMountainAmplitudeMeters: 9,

	maxPositiveResidualMeters: 18,
	maxNegativeResidualMeters: 14,
});

function hash2(ix, iy, seed = 0) {
	let h = Math.imul((ix | 0) ^ Math.imul(seed | 0, 374761393), 668265263);
	h = Math.imul(h ^ ((iy | 0) + Math.imul(seed | 0, 2246822519)), 1274126177);
	h ^= h >>> 15;
	h = Math.imul(h, 2246822519);
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

function noise2(x, y, seed = 0) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const ux = smoother01(fx);
	const uy = smoother01(fy);
	const n00 = hash2(x0, y0, seed) * 2 - 1;
	const n10 = hash2(x0 + 1, y0, seed) * 2 - 1;
	const n01 = hash2(x0, y0 + 1, seed) * 2 - 1;
	const n11 = hash2(x0 + 1, y0 + 1, seed) * 2 - 1;
	return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy);
}

function fbm(x, y, octaves, seed = 0) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalizer = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		sum += noise2(x * frequency, y * frequency, seed + octave * 17) * amplitude;
		normalizer += amplitude;
		amplitude *= 0.5;
		frequency *= 2.037;
	}
	return normalizer > 0 ? sum / normalizer : 0;
}

function ridged(x, y, octaves, seed = 0) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalizer = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		const n = noise2(x * frequency, y * frequency, seed + octave * 29);
		const ridge = 1 - Math.abs(n);
		sum += ridge * ridge * amplitude;
		normalizer += amplitude;
		amplitude *= 0.5;
		frequency *= 2.071;
	}
	return normalizer > 0 ? sum / normalizer : 0;
}

function cellularDistances(x, y, seed = 0) {
	const cx = Math.floor(x);
	const cy = Math.floor(y);
	let nearestSq = Infinity;
	let secondSq = Infinity;
	for (let oy = -1; oy <= 1; oy += 1) {
		for (let ox = -1; ox <= 1; ox += 1) {
			const gx = cx + ox;
			const gy = cy + oy;
			const px = gx + 0.12 + hash2(gx, gy, seed) * 0.76;
			const py = gy + 0.12 + hash2(gx, gy, seed + 97) * 0.76;
			const dx = x - px;
			const dy = y - py;
			const dSq = dx * dx + dy * dy;
			if (dSq < nearestSq) {
				secondSq = nearestSq;
				nearestSq = dSq;
			} else if (dSq < secondSq) {
				secondSq = dSq;
			}
		}
	}
	return {
		nearest: Math.sqrt(nearestSq),
		second: Math.sqrt(secondSq),
	};
}

function warpedCoordinate(nx, ny, frequency, warpFrequency, seed) {
	// Two octaves are enough for basin-scale domain warping; the former third octave cost millions of
	// noise evaluations while being smaller than the mesh's aerially visible geographic scale.
	const warpA = fbm(nx * warpFrequency + 13.7, ny * warpFrequency - 8.9, 2, seed);
	const warpB = fbm(nx * warpFrequency - 31.2, ny * warpFrequency + 19.4, 2, seed + 113);
	return {
		x: nx * frequency + warpA * 0.92,
		y: ny * frequency + warpB * 0.92,
	};
}

function cellularEdgeMask(nx, ny, frequency, warpFrequency, width, seed) {
	const warped = warpedCoordinate(nx, ny, frequency, warpFrequency, seed);
	const { nearest, second } = cellularDistances(warped.x, warped.y, seed + 211);
	const edgeDistance = Math.max(0, second - nearest);
	return {
		mask: 1 - smooth01(edgeDistance / width),
		edgeDistance,
		nearest,
		second,
		warpedX: warped.x,
		warpedY: warped.y,
	};
}

function safeContext(context = {}) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const heightAboveSeaMeters = Math.max(-500, Math.min(2000, finite(context.heightAboveSeaMeters)));
	const reliefInfluence = clamp01(finite(context.reliefInfluence));
	const rockWeight = clamp01(finite(context.rockWeight));
	const snowWeight = clamp01(finite(context.snowWeight));
	const waterWeight = clamp01(finite(context.waterWeight));
	const dryness = 1 - waterWeight;
	const mountainGate = clamp01(Math.max(
		reliefInfluence * reliefInfluence,
		rockWeight * 0.82,
		snowWeight * 0.72,
	));
	const elevationRamp = smooth01(heightAboveSeaMeters / P.channelFullElevationMeters);
	const shoreGate = smooth01(
		(heightAboveSeaMeters - P.shoreFadeStartMeters)
		/ (P.shoreFadeFullMeters - P.shoreFadeStartMeters),
	);
	const negativeGate = smooth01(heightAboveSeaMeters / P.negativeCutFullElevationMeters);
	return {
		heightAboveSeaMeters,
		reliefInfluence,
		rockWeight,
		snowWeight,
		waterWeight,
		dryness,
		mountainGate,
		elevationRamp,
		shoreGate,
		negativeGate,
	};
}

function drainageCore(nx, ny) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const broad = cellularEdgeMask(
		nx, ny,
		P.drainageBroadFrequency,
		P.drainageBroadWarpFrequency,
		P.drainageBroadWidth,
		41,
	);
	const fine = cellularEdgeMask(
		nx + 0.017, ny - 0.023,
		P.drainageFineFrequency,
		P.drainageFineWarpFrequency,
		P.drainageFineWidth,
		173,
	);
	const branchGate = smooth01((broad.mask - 0.18) / 0.72);
	const channel = clamp01(Math.max(
		broad.mask,
		fine.mask * (P.drainageBranchMix + branchGate * (1 - P.drainageBranchMix)),
	));
	const shoulder = clamp01(
		smooth01((channel - P.shoulderOffset) / P.shoulderWidth)
		* (1 - smooth01((channel - 0.72) / 0.24)),
	);
	const confluence = smooth01((broad.mask - 0.48) / 0.42)
		* smooth01((fine.mask - 0.52) / 0.40)
		* (0.35 + branchGate * 0.65);
	const floodplain = smooth01((broad.mask - 0.24) / 0.34)
		* (1 - smooth01((broad.mask - 0.82) / 0.18));
	const divide = smooth01((0.52 - broad.mask) / 0.52)
		* smooth01((0.58 - fine.mask) / 0.58);
	return {
		broad: broad.mask,
		fine: fine.mask,
		branchGate,
		channel,
		shoulder,
		confluence,
		floodplain,
		divide,
	};
}

export function terrainDrainageSignals(normalizedX, normalizedY) {
	return Object.freeze(drainageCore(finite(normalizedX), finite(normalizedY)));
}

function benchCore(nx, ny, heightAboveSeaMeters) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const gate = smooth01((heightAboveSeaMeters - P.benchMinElevationMeters) / 85);
	if (gate <= 0) return { hardness: 0.5, resistantBand: 0, lift: 0, cut: 0, gate: 0 };
	const warp = fbm(nx * P.benchWarpFrequency + 6.1, ny * P.benchWarpFrequency - 17.4, 2, 307);
	const hardness = ridged(
		nx * P.benchFrequency + warp * 0.55 + 18.2,
		ny * P.benchFrequency - warp * 0.43 - 7.6,
		2,
		331,
	);
	const elevationPhase = heightAboveSeaMeters / 28 + warp * 0.8;
	const bandPosition = Math.abs((elevationPhase - Math.floor(elevationPhase)) - 0.5) * 2;
	const resistantBand = 1 - smooth01((bandPosition - (1 - P.benchSharpness)) / P.benchSharpness);
	const lift = resistantBand * smooth01((hardness - 0.42) / 0.45) * gate;
	const cut = (1 - resistantBand) * smooth01((0.62 - hardness) / 0.42) * gate;
	return { hardness, resistantBand, lift, cut, gate };
}

/**
 * Cheap analytic aspect field. Three non-parallel geographic waves provide an explicit derivative,
 * so we get a stable slope-facing vector without sampling a synthetic FBM field four extra times.
 */
function aspectCore(nx, ny) {
	const phaseA = TAU * (nx * 2.15 + ny * 1.05) + 0.71;
	const phaseB = TAU * (nx * -1.30 + ny * 2.70) + 2.13;
	const phaseC = TAU * (nx * 3.85 + ny * -2.20) + 4.41;
	let gx = Math.cos(phaseA) * 2.15 * 0.52
		+ Math.cos(phaseB) * -1.30 * 0.31
		+ Math.cos(phaseC) * 3.85 * 0.17;
	let gy = Math.cos(phaseA) * 1.05 * 0.52
		+ Math.cos(phaseB) * 2.70 * 0.31
		+ Math.cos(phaseC) * -2.20 * 0.17;
	const gradientLength = Math.hypot(gx, gy);
	if (gradientLength > 1e-9) {
		gx /= gradientLength;
		gy /= gradientLength;
	} else {
		gx = 0;
		gy = 0;
	}

	// Regional prevailing direction rotates slowly across the owner map. Two broad harmonic carriers
	// prevent a single map-wide diagonal bias while keeping the calculation trivial compared to FBM.
	const windCarrier = Math.sin(TAU * (nx * 0.63 + ny * 0.31) + 1.37) * 0.62
		+ Math.sin(TAU * (nx * -0.28 + ny * 0.74) + 3.81) * 0.38;
	const windAngle = (windCarrier * 0.5 + 0.5) * TAU;
	const windX = Math.cos(windAngle);
	const windY = Math.sin(windAngle);
	const facing = clamp01((gx * windX + gy * windY) * 0.5 + 0.5);
	return {
		gradientX: gx,
		gradientY: gy,
		windX,
		windY,
		facing,
		signedExposure: facing * 2 - 1,
	};
}

function talusCore(nx, ny, context) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const brokenRock = clamp01(
		context.mountainGate * 0.58
		+ context.rockWeight * 0.52
		+ context.reliefInfluence * 0.34,
	);
	const elevationGate = smooth01((context.heightAboveSeaMeters - P.talusMinElevationMeters) / 120);
	if (brokenRock <= 0.025 || elevationGate <= 0) {
		return { scarpNoise: 0, brokenRock, elevationGate, scarp: 0, deposit: 0, cut: 0 };
	}
	const warped = warpedCoordinate(nx, ny, P.talusCellFrequency, P.talusWarpFrequency, 557);
	const scarpNoise = ridged(warped.x + 4.2, warped.y - 13.6, 2, 601);
	const scarp = smooth01(
		(scarpNoise - P.talusScarpThreshold) / (1 - P.talusScarpThreshold),
	) * brokenRock * elevationGate;
	const downhill = clamp01(0.5 + noise2(warped.x * 0.43 - 8.2, warped.y * 0.43 + 11.9, 643) * 0.5);
	const deposit = scarp * smooth01((downhill - 0.28) / 0.62);
	const cut = scarp * (1 - deposit * 0.55);
	return { scarpNoise, brokenRock, elevationGate, scarp, deposit, cut };
}

function massifCore(nx, ny, context) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const warp = fbm(nx * 2.6 + 8.1, ny * 2.6 - 3.4, 2, 701);
	const ridge = ridged(
		nx * P.massifFrequency + warp * 0.9 + 17.2,
		ny * P.massifFrequency - warp * 0.7 - 20.3,
		3,
		743,
	);
	const value = (ridge - 0.5) * 2;
	const amplitude = lerp(P.massifAmplitudeMeters, P.massifMountainAmplitudeMeters, context.mountainGate);
	return { value, amplitude };
}

function alluvialCore(nx, ny, context, drainage) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const lowlandGate = 1 - smooth01(context.heightAboveSeaMeters / P.floodplainFullElevationMeters);
	const fanElevationGate = 1 - smooth01(context.heightAboveSeaMeters / P.confluenceFanMaxElevationMeters);
	const nonMountain = 1 - context.mountainGate * 0.82;
	const meander = Math.sin(TAU * (nx * 8.7 - ny * 5.1) + Math.sin(TAU * (nx * 1.4 + ny * 1.1)) * 1.15);
	const floodplainCut = drainage.floodplain * P.floodplainCutMeters * lowlandGate * (0.72 + 0.28 * (meander * 0.5 + 0.5));
	const fanDeposit = drainage.confluence * P.confluenceFanDepositMeters * fanElevationGate * nonMountain
		* (0.78 + 0.22 * (1 - meander) * 0.5);
	const terraceBand = drainage.shoulder * drainage.broad
		* smooth01((context.heightAboveSeaMeters - 12) / 58)
		* (1 - smooth01((context.heightAboveSeaMeters - 125) / 105));
	const terraceLift = terraceBand * P.terraceLiftMeters * nonMountain;
	const interfluveAmplitude = lerp(P.interfluveLiftLowMeters, P.interfluveLiftHighMeters, context.elevationRamp);
	const interfluveLift = drainage.divide * interfluveAmplitude * (0.82 + context.mountainGate * 0.28);
	return {
		lowlandGate,
		fanElevationGate,
		floodplainCut,
		fanDeposit,
		terraceLift,
		interfluveLift,
		meters: -floodplainCut + fanDeposit + terraceLift + interfluveLift,
	};
}

function componentMeters(nx, ny, context) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const drainage = drainageCore(nx, ny);
	const bench = benchCore(nx, ny, context.heightAboveSeaMeters);
	const aspect = aspectCore(nx, ny);
	const talus = talusCore(nx, ny, context);
	const massif = massifCore(nx, ny, context);
	const alluvial = alluvialCore(nx, ny, context, drainage);

	const channelAmplitude = lerp(P.channelCutLowMeters, P.channelCutHighMeters, context.elevationRamp)
		+ P.channelCutMountainMeters * context.mountainGate * P.channelReliefBoost;
	const channelMeters = -drainage.channel * channelAmplitude;
	const shoulderAmplitude = lerp(P.shoulderLiftLowMeters, P.shoulderLiftHighMeters, context.elevationRamp)
		* (0.65 + context.mountainGate * 0.6);
	const shoulderMeters = drainage.shoulder * shoulderAmplitude;
	const benchMeters = bench.lift * P.benchLiftMeters - bench.cut * P.benchCutMeters;
	const aspectAmplitude = P.aspectWeatheringMeters
		* (0.35 + context.elevationRamp * 0.65)
		* (1 + context.mountainGate * P.aspectReliefBoost);
	const aspectMeters = aspect.signedExposure * aspectAmplitude;
	const talusMeters = talus.deposit * P.talusDepositMeters - talus.cut * P.talusCutMeters;
	const massifMeters = massif.value * massif.amplitude * (0.25 + context.mountainGate * 0.75);
	return {
		drainage,
		bench,
		aspect,
		talus,
		massif,
		alluvial,
		meters: {
			channel: channelMeters,
			shoulder: shoulderMeters,
			alluvial: alluvial.meters,
			bench: benchMeters,
			aspect: aspectMeters,
			talus: talusMeters,
			massif: massifMeters,
		},
	};
}

function finishResidual(rawResidualMeters, context) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	let gatedResidualMeters = rawResidualMeters * context.dryness * context.shoreGate;
	if (gatedResidualMeters < 0) gatedResidualMeters *= context.negativeGate;
	return {
		gatedResidualMeters,
		residualMeters: Math.max(
			-P.maxNegativeResidualMeters,
			Math.min(P.maxPositiveResidualMeters, gatedResidualMeters),
		),
	};
}

export function terrainMacroWeatheringSignals(normalizedX, normalizedY, rawContext = {}) {
	const nx = finite(normalizedX);
	const ny = finite(normalizedY);
	const context = safeContext(rawContext);

	// Diagnostics preserve a complete, stable shape even where production can early-out.
	const components = componentMeters(nx, ny, context);
	const rawResidualMeters = Object.values(components.meters).reduce((sum, value) => sum + value, 0);
	const finished = finishResidual(rawResidualMeters, context);
	return Object.freeze({
		normalizedX: nx,
		normalizedY: ny,
		context: Object.freeze({ ...context }),
		drainage: Object.freeze({ ...components.drainage }),
		bench: Object.freeze({ ...components.bench }),
		aspect: Object.freeze({ ...components.aspect }),
		talus: Object.freeze({ ...components.talus }),
		massif: Object.freeze({ ...components.massif }),
		alluvial: Object.freeze({ ...components.alluvial }),
		componentsMeters: Object.freeze({ ...components.meters }),
		rawResidualMeters,
		gatedResidualMeters: finished.gatedResidualMeters,
		residualMeters: finished.residualMeters,
	});
}

/**
 * Production hot path. Open water and the protected shoreline return before any cellular/noise work.
 * On dry land this computes the same components as diagnostics but avoids Object.freeze/object graph
 * construction after the scalar residual has been assembled.
 */
export function terrainMacroWeatheringResidualMeters(normalizedX, normalizedY, rawContext = {}) {
	const nx = finite(normalizedX);
	const ny = finite(normalizedY);
	const context = safeContext(rawContext);
	if (context.dryness <= 0 || context.shoreGate <= 0) return 0;
	const components = componentMeters(nx, ny, context);
	const m = components.meters;
	const rawResidualMeters = m.channel + m.shoulder + m.alluvial + m.bench + m.aspect + m.talus + m.massif;
	return finishResidual(rawResidualMeters, context).residualMeters;
}

export function terrainMacroWeatheringSlope(normalizedX, normalizedY, context = {}, sampleMeters = 12) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const distance = Math.max(0.5, finite(sampleMeters, 12));
	const dx = distance / P.ownerWorldWidthMeters;
	const dy = distance / P.ownerWorldHeightMeters;
	const east = terrainMacroWeatheringResidualMeters(normalizedX + dx, normalizedY, context);
	const west = terrainMacroWeatheringResidualMeters(normalizedX - dx, normalizedY, context);
	const north = terrainMacroWeatheringResidualMeters(normalizedX, normalizedY + dy, context);
	const south = terrainMacroWeatheringResidualMeters(normalizedX, normalizedY - dy, context);
	const riseX = (east - west) / (distance * 2);
	const riseY = (north - south) / (distance * 2);
	const slope = Math.hypot(riseX, riseY);
	return Object.freeze({ riseX, riseY, slope, degrees: Math.atan(slope) * 180 / Math.PI });
}

export function summarizeTerrainMacroWeathering({
	width = 64,
	height = 48,
	contextAt = () => ({
		heightAboveSeaMeters: 120,
		reliefInfluence: 0.35,
		rockWeight: 0.25,
		snowWeight: 0,
		waterWeight: 0,
	}),
} = {}) {
	const w = Math.max(2, Math.floor(finite(width, 64)));
	const h = Math.max(2, Math.floor(finite(height, 48)));
	let min = Infinity;
	let max = -Infinity;
	let sum = 0;
	let absoluteSum = 0;
	let negativeCount = 0;
	let positiveCount = 0;
	let channelSum = 0;
	let shoulderSum = 0;
	let confluenceSum = 0;
	let divideSum = 0;
	let maxSlopeDegrees = 0;
	const values = [];
	for (let y = 0; y < h; y += 1) {
		const ny = y / (h - 1);
		for (let x = 0; x < w; x += 1) {
			const nx = x / (w - 1);
			const context = contextAt(nx, ny);
			const signals = terrainMacroWeatheringSignals(nx, ny, context);
			const value = signals.residualMeters;
			values.push(value);
			min = Math.min(min, value);
			max = Math.max(max, value);
			sum += value;
			absoluteSum += Math.abs(value);
			if (value < 0) negativeCount += 1;
			if (value > 0) positiveCount += 1;
			channelSum += signals.drainage.channel;
			shoulderSum += signals.drainage.shoulder;
			confluenceSum += signals.drainage.confluence;
			divideSum += signals.drainage.divide;
			maxSlopeDegrees = Math.max(maxSlopeDegrees, terrainMacroWeatheringSlope(nx, ny, context, 20).degrees);
		}
	}
	values.sort((a, b) => a - b);
	const count = values.length;
	const quantile = (q) => values[Math.min(count - 1, Math.max(0, Math.round((count - 1) * q)))];
	const mean = sum / count;
	let varianceSum = 0;
	for (const value of values) varianceSum += (value - mean) ** 2;
	return Object.freeze({
		policyId: TERRAIN_MACRO_WEATHERING_POLICY.id,
		sampleCount: count,
		min,
		max,
		mean,
		meanAbsolute: absoluteSum / count,
		standardDeviation: Math.sqrt(varianceSum / count),
		negativeFraction: negativeCount / count,
		positiveFraction: positiveCount / count,
		meanChannelMask: channelSum / count,
		meanShoulderMask: shoulderSum / count,
		meanConfluenceMask: confluenceSum / count,
		meanDivideMask: divideSum / count,
		p10: quantile(0.10),
		p50: quantile(0.50),
		p90: quantile(0.90),
		maxSlopeDegrees,
	});
}
