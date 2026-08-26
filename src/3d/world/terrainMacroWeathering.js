/**
 * Deterministic macro weathering residual for the shipped owner-map terrain.
 *
 * This module does not classify geography and it never owns canonical land/water, biome, settlement,
 * road or collider state. `terrain.js` remains the single height authority. The residual produced
 * here is consumed by `terrainReliefDetail.js` as one bounded component of that authority, after the
 * map-derived Pindex height has already been resolved.
 *
 * The existing relief stack is strong at isotropic shape: fBm for broad undulation, ridged noise for
 * mountain crags, and high-frequency dissection for local roughness. A full-world orthographic render
 * can still read those forms as procedurally rounded because every octave is statistically similar in
 * all directions. Real landscapes are not isotropic. Water establishes drainage corridors, aspect
 * produces unequal weathering, resistant strata create benches, and broken cliff material forms
 * talus aprons below scarps.
 *
 * The functions below add those missing *directional* cues while preserving four hard boundaries:
 *
 * 1. no effect on open water;
 * 2. a protected shoreline ramp so shallow coastal ground is not cut below sea level;
 * 3. bounded amplitudes that grow with canonical elevation/relief rather than replacing them;
 * 4. pure world-position determinism so adjacent chunks produce identical border heights.
 *
 * All frequency inputs are normalized owner-map coordinates. The policy also carries the physical
 * owner-world dimensions so derivative probes and test diagnostics can convert normalized deltas back
 * to metres without importing the rest of the terrain stack.
 *
 * @module world/terrainMacroWeathering
 */

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
	// Governance metadata: this is a height residual inside terrain.js, never a second terrain owner.
	renderOnly: false,
	deterministicWorldSpace: true,
	canonicalSurfaceAuthorityPreserved: true,
	settlementTaperOwnedByCaller: true,
	heightAuthority: 'world/terrain.js',
	ownerWorldWidthMeters: 13296,
	ownerWorldHeightMeters: 10341,

	// Coastal protection. Negative cuts only reach full strength after this elevation.
	shoreFadeStartMeters: 1.6,
	shoreFadeFullMeters: 11,
	negativeCutFullElevationMeters: 34,

	// Two cellular drainage scales. The broad field establishes basin-scale valleys; the finer field
	// branches inside them. Frequencies are cells across normalized owner-map space.
	drainageBroadFrequency: 12.5,
	drainageFineFrequency: 31,
	drainageBroadWarpFrequency: 4.4,
	drainageFineWarpFrequency: 10.8,
	drainageBroadWidth: 0.23,
	drainageFineWidth: 0.15,
	drainageBranchMix: 0.43,

	// Channel incision grows with elevation because high ground can afford a deeper cut without
	// threatening coast safety. Canonical relief gives mountains an additional bounded multiplier.
	channelCutLowMeters: 1.2,
	channelCutHighMeters: 6.4,
	channelCutMountainMeters: 5.5,
	channelFullElevationMeters: 260,
	channelReliefBoost: 0.55,

	// Convex shoulders sit beside drainage channels. Their positive residual prevents valleys from
	// reading as thin dark scratches by giving the eye an adjacent spur/ridge silhouette.
	shoulderOffset: 0.095,
	shoulderWidth: 0.18,
	shoulderLiftLowMeters: 0.7,
	shoulderLiftHighMeters: 3.8,

	// Plateau/stratal benches. They are deliberately broad and sparse; a hard terracing quantizer
	// would look gamey. The mask instead creates resistant bands only where a low-frequency hardness
	// field agrees with an elevation phase.
	benchFrequency: 8.4,
	benchWarpFrequency: 3.7,
	benchBandCount: 7,
	benchSharpness: 0.18,
	benchLiftMeters: 3.4,
	benchCutMeters: 2.1,
	benchMinElevationMeters: 36,

	// Windward/leeward asymmetry. The world does not need a meteorological wind simulation here; the
	// goal is simply to prevent equal erosion on every side of a landform. The slowly rotating vector
	// varies by region so the bias does not become a single map-wide diagonal stripe.
	aspectRegionFrequency: 3.2,
	aspectSampleMeters: 44,
	aspectWeatheringMeters: 1.6,
	aspectReliefBoost: 1.15,

	// Talus aprons: broad deposition immediately downslope of high-relief scarps. The procedural
	// scarp mask is sparse and multiplied by canonical relief/rock so plains cannot sprout scree fans.
	talusCellFrequency: 18,
	talusWarpFrequency: 6.6,
	talusScarpThreshold: 0.66,
	talusDepositMeters: 3.2,
	talusCutMeters: 1.6,
	talusMinElevationMeters: 54,

	// Very broad erosional asymmetry. This is intentionally sub-dominant but gives whole mountain
	// masses a non-spherical read at orthographic distance.
	massifFrequency: 4.8,
	massifAmplitudeMeters: 5.4,
	massifMountainAmplitudeMeters: 9,

	// Hard final envelope. This protects the established gameplay/road contracts even if component
	// tuning is changed independently later.
	maxPositiveResidualMeters: 18,
	maxNegativeResidualMeters: 14,
});

/**
 * Stable integer hash to [0,1). Math.imul keeps the avalanche deterministic across JS engines.
 */
function hash2(ix, iy, seed = 0) {
	let h = Math.imul((ix | 0) ^ (seed * 374761393), 668265263);
	h = Math.imul(h ^ ((iy | 0) + seed * 2246822519), 1274126177);
	h ^= h >>> 15;
	h = Math.imul(h, 2246822519);
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

/**
 * 2D gradient-like value noise in [-1,1]. Quintic interpolation keeps first/second derivatives
 * visually smooth so the residual does not print square cell boundaries into normals.
 */
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

/**
 * Returns the closest and second-closest jittered cellular feature distances. The difference between
 * them approaches zero on Voronoi boundaries, giving a cheap continuous drainage skeleton rather
 * than a collection of circular pits.
 */
function cellularDistances(x, y, seed = 0) {
	const cx = Math.floor(x);
	const cy = Math.floor(y);
	let nearest = Infinity;
	let second = Infinity;
	for (let oy = -1; oy <= 1; oy += 1) {
		for (let ox = -1; ox <= 1; ox += 1) {
			const gx = cx + ox;
			const gy = cy + oy;
			const px = gx + 0.12 + hash2(gx, gy, seed) * 0.76;
			const py = gy + 0.12 + hash2(gx, gy, seed + 97) * 0.76;
			const dx = x - px;
			const dy = y - py;
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d < nearest) {
				second = nearest;
				nearest = d;
			} else if (d < second) {
				second = d;
			}
		}
	}
	return { nearest, second };
}

function warpedCoordinate(nx, ny, frequency, warpFrequency, seed) {
	const warpA = fbm(nx * warpFrequency + 13.7, ny * warpFrequency - 8.9, 3, seed);
	const warpB = fbm(nx * warpFrequency - 31.2, ny * warpFrequency + 19.4, 3, seed + 113);
	return {
		x: nx * frequency + warpA * 0.92,
		y: ny * frequency + warpB * 0.92,
	};
}

function cellularEdgeMask(nx, ny, frequency, warpFrequency, width, seed) {
	const warped = warpedCoordinate(nx, ny, frequency, warpFrequency, seed);
	const { nearest, second } = cellularDistances(warped.x, warped.y, seed + 211);
	const edgeDistance = Math.max(0, second - nearest);
	const mask = 1 - smooth01(edgeDistance / width);
	return {
		mask,
		edgeDistance,
		nearest,
		second,
		warpedX: warped.x,
		warpedY: warped.y,
	};
}

function safeContext(context = {}) {
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
	const elevationRamp = smooth01(heightAboveSeaMeters / TERRAIN_MACRO_WEATHERING_POLICY.channelFullElevationMeters);
	const shoreGate = smooth01(
		(heightAboveSeaMeters - TERRAIN_MACRO_WEATHERING_POLICY.shoreFadeStartMeters)
		/ (TERRAIN_MACRO_WEATHERING_POLICY.shoreFadeFullMeters - TERRAIN_MACRO_WEATHERING_POLICY.shoreFadeStartMeters),
	);
	const negativeGate = smooth01(
		heightAboveSeaMeters / TERRAIN_MACRO_WEATHERING_POLICY.negativeCutFullElevationMeters,
	);
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

/**
 * Basin-scale and tributary-scale drainage masks.
 *
 * `channel` is intentionally not just max(broad,fine): fine branches are strongest where a broad
 * basin edge already exists, so the result reads as hierarchy rather than two unrelated vein sets.
 */
export function terrainDrainageSignals(normalizedX, normalizedY) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const nx = finite(normalizedX);
	const ny = finite(normalizedY);
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
	// A shoulder ring peaks outside the channel core. Offset masks on either side are combined so it
	// remains orientation-neutral even though the underlying network itself is directional.
	const shoulder = clamp01(
		smooth01((channel - P.shoulderOffset) / P.shoulderWidth)
		* (1 - smooth01((channel - 0.72) / 0.24)),
	);
	return Object.freeze({
		broad: broad.mask,
		fine: fine.mask,
		branchGate,
		channel,
		shoulder,
	});
}

function benchSignals(nx, ny, heightAboveSeaMeters) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const warp = fbm(nx * P.benchWarpFrequency + 6.1, ny * P.benchWarpFrequency - 17.4, 3, 307);
	const hardness = ridged(
		nx * P.benchFrequency + warp * 0.55 + 18.2,
		ny * P.benchFrequency - warp * 0.43 - 7.6,
		3,
		331,
	);
	const elevationPhase = heightAboveSeaMeters / 28 + warp * 0.8;
	const bandPosition = Math.abs((elevationPhase - Math.floor(elevationPhase)) - 0.5) * 2;
	const resistantBand = 1 - smooth01((bandPosition - (1 - P.benchSharpness)) / P.benchSharpness);
	const gate = smooth01((heightAboveSeaMeters - P.benchMinElevationMeters) / 85);
	const lift = resistantBand * smooth01((hardness - 0.42) / 0.45) * gate;
	const cut = (1 - resistantBand) * smooth01((0.62 - hardness) / 0.42) * gate;
	return { hardness, resistantBand, lift, cut, gate };
}

function regionalWind(normalizedX, normalizedY) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const angleNoise = fbm(
		normalizedX * P.aspectRegionFrequency + 2.7,
		normalizedY * P.aspectRegionFrequency - 9.5,
		3,
		419,
	);
	const angle = (angleNoise * 0.5 + 0.5) * Math.PI * 2;
	return { x: Math.cos(angle), y: Math.sin(angle), angle };
}

/**
 * A low-frequency synthetic landform field used only to estimate *aspect*. It does not replace the
 * canonical height and is never added directly. Sampling it a physical 44 m apart gives a stable
 * regional direction cue without importing terrain.js back into this module (which would cycle).
 */
function syntheticAspectField(nx, ny) {
	const a = fbm(nx * 7.2 + 14.1, ny * 7.2 - 4.8, 4, 457);
	const b = ridged(nx * 13.3 - 8.7, ny * 13.3 + 27.1, 3, 503) * 2 - 1;
	return a * 0.68 + b * 0.32;
}

function aspectSignals(nx, ny) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const dx = P.aspectSampleMeters / P.ownerWorldWidthMeters;
	const dy = P.aspectSampleMeters / P.ownerWorldHeightMeters;
	const east = syntheticAspectField(nx + dx, ny);
	const west = syntheticAspectField(nx - dx, ny);
	const north = syntheticAspectField(nx, ny + dy);
	const south = syntheticAspectField(nx, ny - dy);
	let gx = east - west;
	let gy = north - south;
	const length = Math.hypot(gx, gy);
	if (length > 1e-9) {
		gx /= length;
		gy /= length;
	} else {
		gx = 0;
		gy = 0;
	}
	const wind = regionalWind(nx, ny);
	const facing = clamp01((gx * wind.x + gy * wind.y) * 0.5 + 0.5);
	return {
		gradientX: gx,
		gradientY: gy,
		windX: wind.x,
		windY: wind.y,
		facing,
		signedExposure: facing * 2 - 1,
	};
}

function talusSignals(nx, ny, context) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const warped = warpedCoordinate(nx, ny, P.talusCellFrequency, P.talusWarpFrequency, 557);
	const scarpNoise = ridged(warped.x + 4.2, warped.y - 13.6, 3, 601);
	const brokenRock = clamp01(
		context.mountainGate * 0.58
		+ context.rockWeight * 0.52
		+ context.reliefInfluence * 0.34,
	);
	const elevationGate = smooth01((context.heightAboveSeaMeters - P.talusMinElevationMeters) / 120);
	const scarp = smooth01(
		(scarpNoise - P.talusScarpThreshold) / (1 - P.talusScarpThreshold),
	) * brokenRock * elevationGate;
	// Deposit sits on the low-frequency "downhill" side of the same warped cell; this shifts debris
	// away from the scarp instead of symmetrically brightening it.
	const downhill = clamp01(0.5 + noise2(warped.x * 0.43 - 8.2, warped.y * 0.43 + 11.9, 643) * 0.5);
	const deposit = scarp * smooth01((downhill - 0.28) / 0.62);
	const cut = scarp * (1 - deposit * 0.55);
	return { scarpNoise, brokenRock, elevationGate, scarp, deposit, cut };
}

function massifSignal(nx, ny, context) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const warp = fbm(nx * 2.6 + 8.1, ny * 2.6 - 3.4, 3, 701);
	const ridge = ridged(
		nx * P.massifFrequency + warp * 0.9 + 17.2,
		ny * P.massifFrequency - warp * 0.7 - 20.3,
		4,
		743,
	);
	const signed = (ridge - 0.5) * 2;
	const amplitude = lerp(
		P.massifAmplitudeMeters,
		P.massifMountainAmplitudeMeters,
		context.mountainGate,
	);
	return { value: signed, amplitude };
}

/**
 * Returns a complete diagnostic signal bundle. Keeping this public makes realism checks test the
 * production implementation rather than reimplementing its masks in scripts.
 */
export function terrainMacroWeatheringSignals(normalizedX, normalizedY, rawContext = {}) {
	const nx = finite(normalizedX);
	const ny = finite(normalizedY);
	const context = safeContext(rawContext);
	const drainage = terrainDrainageSignals(nx, ny);
	const bench = benchSignals(nx, ny, context.heightAboveSeaMeters);
	const aspect = aspectSignals(nx, ny);
	const talus = talusSignals(nx, ny, context);
	const massif = massifSignal(nx, ny, context);

	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const channelAmplitude = lerp(P.channelCutLowMeters, P.channelCutHighMeters, context.elevationRamp)
		+ P.channelCutMountainMeters * context.mountainGate * P.channelReliefBoost;
	const channelCutMeters = drainage.channel * channelAmplitude;

	const shoulderAmplitude = lerp(P.shoulderLiftLowMeters, P.shoulderLiftHighMeters, context.elevationRamp)
		* (0.65 + context.mountainGate * 0.6);
	const shoulderLiftMeters = drainage.shoulder * shoulderAmplitude;

	const benchMeters = bench.lift * P.benchLiftMeters - bench.cut * P.benchCutMeters;
	const aspectAmplitude = P.aspectWeatheringMeters
		* (0.35 + context.elevationRamp * 0.65)
		* (1 + context.mountainGate * P.aspectReliefBoost);
	const aspectMeters = aspect.signedExposure * aspectAmplitude;

	const talusMeters = talus.deposit * P.talusDepositMeters - talus.cut * P.talusCutMeters;
	const massifMeters = massif.value * massif.amplitude;

	// Broad mass asymmetry is not allowed to dominate lowland ground. Drainage is the strongest
	// everywhere-land signal; benches/talus/aspect are progressively more mountain-oriented.
	const rawResidualMeters =
		-channelCutMeters
		+ shoulderLiftMeters
		+ benchMeters
		+ aspectMeters
		+ talusMeters
		+ massifMeters * (0.25 + context.mountainGate * 0.75);

	let gatedResidualMeters = rawResidualMeters * context.dryness * context.shoreGate;
	if (gatedResidualMeters < 0) gatedResidualMeters *= context.negativeGate;

	const residualMeters = Math.max(
		-P.maxNegativeResidualMeters,
		Math.min(P.maxPositiveResidualMeters, gatedResidualMeters),
	);

	return Object.freeze({
		normalizedX: nx,
		normalizedY: ny,
		context: Object.freeze({ ...context }),
		drainage,
		bench: Object.freeze({ ...bench }),
		aspect: Object.freeze({ ...aspect }),
		talus: Object.freeze({ ...talus }),
		massif: Object.freeze({ ...massif }),
		componentsMeters: Object.freeze({
			channel: -channelCutMeters,
			shoulder: shoulderLiftMeters,
			bench: benchMeters,
			aspect: aspectMeters,
			talus: talusMeters,
			massif: massifMeters * (0.25 + context.mountainGate * 0.75),
		}),
		rawResidualMeters,
		gatedResidualMeters,
		residualMeters,
	});
}

/**
 * Production entry point: bounded residual in metres.
 */
export function terrainMacroWeatheringResidualMeters(normalizedX, normalizedY, context = {}) {
	return terrainMacroWeatheringSignals(normalizedX, normalizedY, context).residualMeters;
}

/**
 * Finite-difference diagnostic for the residual itself. Tests use this to bound added grade without
 * needing to import the canonical terrain sampler. Returned slope is dimensionless rise/run.
 */
export function terrainMacroWeatheringSlope(normalizedX, normalizedY, context = {}, sampleMeters = 12) {
	const P = TERRAIN_MACRO_WEATHERING_POLICY;
	const dx = Math.max(0.5, finite(sampleMeters, 12)) / P.ownerWorldWidthMeters;
	const dy = Math.max(0.5, finite(sampleMeters, 12)) / P.ownerWorldHeightMeters;
	const east = terrainMacroWeatheringResidualMeters(normalizedX + dx, normalizedY, context);
	const west = terrainMacroWeatheringResidualMeters(normalizedX - dx, normalizedY, context);
	const north = terrainMacroWeatheringResidualMeters(normalizedX, normalizedY + dy, context);
	const south = terrainMacroWeatheringResidualMeters(normalizedX, normalizedY - dy, context);
	const riseX = (east - west) / (sampleMeters * 2);
	const riseY = (north - south) / (sampleMeters * 2);
	const slope = Math.hypot(riseX, riseY);
	return Object.freeze({
		riseX,
		riseY,
		slope,
		degrees: Math.atan(slope) * 180 / Math.PI,
	});
}

/**
 * Grid summarizer used by CI/evidence scripts. It intentionally accepts a context factory so checks
 * can exercise lowlands, uplands and mountain regimes without duplicating the sampling loop.
 */
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
			const slope = terrainMacroWeatheringSlope(nx, ny, context, 20);
			maxSlopeDegrees = Math.max(maxSlopeDegrees, slope.degrees);
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
		p10: quantile(0.10),
		p50: quantile(0.50),
		p90: quantile(0.90),
		maxSlopeDegrees,
	});
}
