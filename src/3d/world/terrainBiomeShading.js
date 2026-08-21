/**
 * Slope- and altitude-driven terrain biome shading — the render-only layer that gives the world its
 * real geography read: snow-capped peaks, bare rock on cliffs, dark forest on moderate slopes, bright
 * grass lowlands and a pale sand line at the shore.
 *
 * **Why this module exists (GOVERNANCE.md §8.2 Root Cause Analysis).** Before this module,
 * `world/terrain.js`'s `createTerrainChunk` painted *every* land vertex the same constant grey
 * (`CURRENT_TERRAIN_ALBEDO_POLICY.sourceDiffuseFactor`, 0.588) and let the authored
 * `assets/textures/yüzey/overlay/overlay.png` supply 100% of the colour. Two measured facts (see
 * `TERRAIN_BIOME_SHADING_POLICY.measured`, probed against the live field, not assumed) made that a
 * dead end for realism:
 *
 * 1. That overlay is **not** a neutral detail texture — it is a saturated green photographic texture
 *    (mean saturation 0.42; every probe point green, including the ones over open sea). Multiplying a
 *    biome tint over it would double-tint into mud.
 * 2. Multiplied by 0.588 it lands at a linear albedo around (0.015, 0.031, 0.011) — an almost-black
 *    green, applied uniformly from the shoreline to the 566 m peaks. No altitude, slope, snow, rock
 *    or coast signal reached the screen at all.
 *
 * So the split is inverted here: the authored image is reduced to a **neutral luminance detail
 * multiplier** (`buildNeutralDetailCanvas`, mean normalised to 1.0) and hue ownership moves to the
 * per-vertex biome colour this module resolves. The authored asset still drives surface *detail*
 * exactly as `CURRENT_TERRAIN_ALBEDO_POLICY` intends; it simply stops dictating that the whole world
 * is one shade of dark green.
 *
 * **This is render-only.** No function here is consulted by the height sampler, physics, colliders,
 * hydrology, road/river routing or placement. Canonical geography (the 9000x7000 owner map, the
 * coastline, the 14 seats, the water mask) is untouched — only what colour each already-placed vertex
 * is painted. Terrain heights are byte-identical before and after.
 *
 * **Determinism.** No `Math.random()`. Per-vertex mottling comes from a hash of quantised world
 * metres, so the same coordinate is always the same colour, chunk boundaries agree exactly, and
 * repeated runs are reproducible.
 * @module world/terrainBiomeShading
 */

import * as THREE from 'three';
import { signedFbmNoise } from './terrainReliefDetail.js';
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { canonicalForestAffinity } from './worldReferenceForestAffinity.js';
import { sampleMapAridity01 } from './worldReferenceBiomeField.js';
import { sampleMapGroundColor } from './worldReferenceGroundColorField.js';
import { valyriaInfluence01 } from './worldReferenceValyria.js';

/**
 * World X/Z to normalized owner-map coordinates — the same projection `world/terrain.js`'s private
 * `currentMapPoint` uses, repeated here rather than exported from there so this render-only module
 * keeps no dependency on the height sampler.
 */
function normalizedMapPoint(worldX, worldZ) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	const centerMapX = (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5;
	const nx = (worldX / METERS_PER_MAP_UNIT + centerMapX) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const ny = (worldZ / METERS_PER_MAP_UNIT + centerMapY) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Hermite smoothstep. Returns 0 below `edge0`, 1 above `edge1`, S-curved between. */
function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

/**
 * Measured facts this module's thresholds are calibrated against, plus the thresholds themselves.
 *
 * `measured` was probed from the **live** `createHeightSampler` field over a 220x220 grid spanning the
 * whole owner map (48,400 points) plus a 200x200 land-only pass (13,318 land points), and from
 * decoding `overlay.png` in a real browser canvas. These are recorded here rather than in a comment so
 * a future run can tell at a glance whether a terrain change has invalidated the calibration.
 */
export const TERRAIN_BIOME_SHADING_POLICY = Object.freeze({
	id: 'terrain-slope-altitude-biome-shading-2026-08-19-v1',
	renderOnly: true,
	heightAuthorityUnchanged: true,

	measured: Object.freeze({
		probeGrid: '220x220 full-map + 200x200 land-only, live createHeightSampler',
		seaLevelMeters: 6,
		landFractionOfMap: 0.332,
		/** Re-measured in run 358 over the shipped field (15,964 land samples on a 55 m lattice). The
		 * previous row — p50 5.24, max 566.34 — was taken before ADR-0299's continental uplift and is
		 * kept below for provenance, because every altitude threshold in this file was authored against
		 * it and had to be re-derived from this one. */
		landHeightAboveSeaMeters: Object.freeze({ p10: 14.12, p25: 30.36, p50: 65.72, p60: 90.84, p75: 146.87, p80: 174.87, p85: 215.23, p90: 254.11, p95: 349.1, p97: 419.66, p98: 488.23, p99: 594.7, max: 750.5 }),
		preUpliftLandHeightAboveSeaMeters: Object.freeze({ p10: 1.03, p25: 2.17, p50: 5.24, p75: 13.26, p80: 17.72, p85: 45.2, p90: 114.24, p95: 236.71, p98: 387.69, p99: 455.81, max: 566.34 }),
		landSlopeDegrees: Object.freeze({ p25: 0.34, p50: 0.6, p75: 4.78, p90: 31.67, p95: 44.44, p99: 62.51, max: 84.02 }),
		canonicalSnowCellHeightAboveSeaMeters: Object.freeze({ p25: 14.84, p50: 18.4, p75: 117.46, p90: 371.64 }),
		canonicalRockCellSlopeDegrees: Object.freeze({ p25: 6.16, p50: 23.68, p75: 38.56, p90: 49.86 }),
		overlayPng: Object.freeze({ meanSaturation: 0.4164, verdict: 'coloured-green-photo-texture', neutralisedAtLoad: true }),
	}),

	/** Shore sand is deliberately narrow: measured land p10 is 1.03 m, so a 0.25-1.6 m band paints
	 * roughly the lowest tenth of land as beach — a thin bright shoreline, not a sandy continent. */
	shoreSandTopMeters: 1.6,
	shoreSandFullMeters: 0.25,
	/** 80% of land sits below 17.7 m, so the grass bands are packed low and the dry/alpine ramp only
	 * engages in the thin mountainous tail (p90 = 114 m, p95 = 237 m). */
	/**
	 * Altitude thresholds, all re-derived in run 358 / ADR-0305.
	 *
	 * **Why they all moved at once.** Every number here was authored against a world whose land had a
	 * 5.24 m median; ADR-0299's continental uplift raised that median to 65.72 m and the p90 from 114 m
	 * to 254 m. Nothing about these values drifted — the ground moved out from under them. The effect
	 * was that ordinary Westerosi interior at ~330 m, which the owner map draws as wooded country, was
	 * being painted as fully dry upland shading into bare rock, i.e. the continent read as desert.
	 *
	 * Each threshold is re-derived by taking the *percentile it occupied in the old distribution* and
	 * reading that same percentile off the new one, so the intent behind each band is preserved rather
	 * than re-guessed: `grassMidFull`/`dryUplandStart` sat at ~p87 (60 m then, 230 m now), `dryUplandFull`
	 * at ~p93 (190 -> 295), `rockCoolFull` at ~p97 (320 -> 420), `snowAltitudeStart` at ~p98 (380 -> 490).
	 */
	grassMidStartMeters: 90,
	grassMidFullMeters: 230,
	dryUplandStartMeters: 230,
	dryUplandFullMeters: 295,
	/** Rock takes over on genuinely steep ground. Land slope p90 is 31.7 deg and p95 is 44.4 deg, so a
	 * 22-45 deg ramp turns roughly the steepest tenth of land to exposed rock — every sea cliff and
	 * mountain face, at any altitude. */
	rockSlopeStartDegrees: 22,
	rockSlopeFullDegrees: 45,
	/** The canonical 96x64 mask's own rock classification, blended in alongside the slope term so
	 * flat-but-stony ground still reads as rock. Scaled below 1 so slope stays the dominant cue. */
	canonicalRockGain: 0.85,
	rockCoolStartMeters: 240,
	rockCoolFullMeters: 420,
	/** Altitude snow line. Measured p98 is 387.7 m and p99 is 455.8 m, so a 300-460 m ramp caps only
	 * the highest couple of percent of land — matching the reference image, where just the tallest
	 * massif is white. */
	snowAltitudeStartMeters: 490,
	snowAltitudeFullMeters: 700,
	/** The canonical snow mask sits at a median of only 18.4 m above sea: in this world (and in the
	 * owner's reference image, whose north-west island is white to the waterline) the far north is
	 * genuinely snow-covered lowland, not just high peaks. Honoured at full strength. */
	canonicalSnowGain: 1,
	/** Snow does not hold on a cliff face — above ~40 deg it sheds and the rock beneath shows through,
	 * which is what gives real peaks their rock-ribbed look instead of a smooth white cone. */
	snowShedStartDegrees: 40,
	snowShedFullDegrees: 58,
	/** Forest coverage is a *patch mask*, not a slope rule.
	 *
	 * An earlier revision gated forest on slope alone (`smoothstep(2.5, 9, slope)`), which measured out
	 * to almost nothing: land slope p50 is 0.6 deg and p75 is 4.78 deg, so the lowlands — the great
	 * majority of the world — scored ~0 and rendered as one uniform olive sheet, the single most
	 * obviously wrong thing in the first aerial capture. Real forest cover is decided by climate and
	 * soil, not steepness, so it is driven here by deterministic low-frequency noise and slope only
	 * *excludes* cliffs. `forestPatchStart`/`forestPatchFull` are thresholds on that noise; the gap
	 * between them is the soft edge of a forest, and the midpoint sets roughly how much land is wooded. */
	forestPatchFrequency: 0.00095,
	forestPatchOctaves: 4,
	// Lowered in run 358 from 0.40/0.68. The owner's rule is that land which is not a village or a
	// kingdom seat should read as woodland, so the mask's midpoint has to put most of the map inside a
	// patch rather than a minority of it.
	forestPatchStart: 0.30,
	forestPatchFull: 0.52,
	forestSlopeFalloffStartDegrees: 30,
	forestSlopeFalloffFullDegrees: 46,
	/**
	 * Tree line. Raised from 170/330 m in run 358 — those values predate ADR-0299's continental uplift,
	 * which took inland ground from a ~5 m median to hundreds of metres. Against the world the game
	 * actually has, a 330 m ceiling put essentially the whole Westerosi interior *above* the tree line,
	 * so the forest mask evaluated to zero exactly where the map shows its great woods. The numbers had
	 * not drifted; the ground moved out from under them.
	 *
	 * 520/760 m sits just above the re-derived snow line, so only genuinely snowy summits come out bare
	 * while the whole interior can be wooded — which is what map.png depicts.
	 */
	forestTreeLineStartMeters: 520,
	forestTreeLineFullMeters: 760,
	forestMaxStrength: 0.88,
	/** Independent low-frequency tint drift across the grasslands, so open ground reads as pasture,
	 * heath and scrub rather than one flat colour. */
	grassVariationFrequency: 0.00042,
	grassVariationStrength: 0.30,
	/** Submerged ground darkens toward a seabed tone so shallows read as bathymetry through the
	 * translucent water surface rather than as drowned grass. */
	seabedFullDepthMeters: 2.5,
	/** Deterministic per-vertex mottling, in +/- fraction of albedo. Breaks up otherwise flat bands. */
	mottleAmplitude: 0.075,
	/**
	 * How far the ground's hue is pulled toward the owner map's own painted colour.
	 *
	 * Only chroma moves — the luminance the height/slope/rock/snow terms computed is preserved — so
	 * this cannot flatten relief no matter how high it goes. It is held well below 1 anyway because
	 * the map is a pale, evenly-lit painting: at full strength every region converges on parchment
	 * and the world stops looking lit. 0.55 is enough to tell the Reach from Yi Ti at a glance.
	 */
	mapGroundColorStrength: 1.0,
	/** The map's own land-average colour (162.6, 166.4, 126.1 of 255), measured over its 4,429 land
	 * cells. Regional colour is expressed as a ratio to this, so only what makes a place different
	 * from the average survives — see the note at the transfer itself. */
	mapGroundColorLandMean: Object.freeze({ r: 0.6377, g: 0.6527, b: 0.4946 }),
	/** Exponent on that ratio. 1.0 reproduces the map's own regional differences exactly; above 1 it
	 * stretches them, which is what the owner asked for ("palet çeşitliliğini arttıralım"). Measured by
	 * mean pairwise distance between region colours — see the note at the transfer. */
	mapGroundColorChromaExponent: 1.8,
	mottleCellMeters: 37,
	/** Neutralised authored-detail texture: square resolution, and the clamp applied to
	 * luminance/meanLuminance so one dark photographic blotch cannot black out a whole hillside. */
	detailTextureSize: 2048,
	detailMinMultiplier: 0.62,
	detailMaxMultiplier: 1.45,
	/** A multiplier of exactly 1.0 is stored as this byte. The texture is tagged `NoColorSpace`, not
	 * sRGB: it carries a *ratio*, not a colour, so the sampler must return `byte/255` untransformed
	 * (an sRGB decode would bend 128 to 0.216 and silently darken the world by more than half).
	 * Storing 1.0 at mid-grey leaves headroom for the >1 side of the clamp; `NEUTRAL_DETAIL_GAIN`
	 * restores unit mean at the material. */
	detailEncodePivot: 128,
});

/**
 * Material-side gain that turns the mid-grey-pivot encoding above back into a unit-mean multiplier.
 * Applied as `material.color` (three.js treats it as a plain per-channel multiplier, values above 1
 * included), so `biomeVertexColour x detailTexel x GAIN` reconstructs the intended albedo exactly.
 */
export const NEUTRAL_DETAIL_GAIN = 255 / TERRAIN_BIOME_SHADING_POLICY.detailEncodePivot;

/**
 * Biome albedos, authored as sRGB hex the way an artist reads them off the reference image.
 * `THREE.Color` converts each to linear working space on construction (three.js colour management is
 * on), which is the space the geometry `color` attribute is consumed in — so these land on screen as
 * physically sane terrain albedos (grass ~0.25, snow ~0.9) rather than the near-black the previous
 * constant-grey path produced.
 */
export const TERRAIN_BIOME_PALETTE = Object.freeze({
	SEABED: new THREE.Color(0x3d5148),
	SHORE_SAND: new THREE.Color(0xcfc4a0),
	GRASS_LOW: new THREE.Color(0x7d9a3e),
	GRASS_MID: new THREE.Color(0x87914b),
	DRY_UPLAND: new THREE.Color(0x9a9159),
	FOREST: new THREE.Color(0x3a5226),
	ROCK_WARM: new THREE.Color(0x6b6155),
	ROCK_COOL: new THREE.Color(0x7c7973),
	SNOW: new THREE.Color(0xf4f6f8),
});

/** Deterministic [0,1) hash of a quantised world position. Integer-free trig hash, same family as the
 * micro-signal functions `world/terrain.js` already uses — no `Math.random()`, no state. */
function positionHash01(worldX, worldZ) {
	const cell = TERRAIN_BIOME_SHADING_POLICY.mottleCellMeters;
	const qx = Math.round(worldX / cell);
	const qz = Math.round(worldZ / cell);
	const value = Math.sin(qx * 127.1 + qz * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

const scratchRock = new THREE.Color();
const scratchMapColor = new THREE.Color();

/**
 * Resolves one vertex's terrain albedo from its altitude, local slope and canonical surface weights.
 *
 * Layered the way real ground is: a grass/dry base, forest painted onto moderate slopes, a sand line
 * at the shore, rock exposed by steepness, snow laid on top where it is high or northern enough to
 * survive, and finally a seabed tone below the waterline.
 *
 * @param {THREE.Color} target Mutated in place and returned (avoids per-vertex allocation).
 * @param {object} sample
 * @param {number} sample.heightAboveSeaMeters Signed: negative is submerged.
 * @param {number} sample.slopeDegrees Local ground slope, 0 = flat.
 * @param {number} sample.rockWeight Canonical mask rock weight, 0..1.
 * @param {number} sample.snowWeight Canonical mask snow weight, 0..1.
 * @param {number} sample.worldX Used only for deterministic mottling.
 * @param {number} sample.worldZ Used only for deterministic mottling.
 * @returns {THREE.Color} `target`.
 */
/**
 * How wooded this spot is, in [0, 1] — the single authority for forest, shared by ground colour and by
 * `world/vegetation.js`'s tree scatter.
 *
 * Exported so the two cannot disagree: before run 358 the ground was painted forest-green by this mask
 * while trees were scattered uniformly at 30/km², so woodland colour and actual woodland had no
 * relationship at all. Anything that wants to know "is this forest?" must ask here.
 *
 * @param {number} worldX
 * @param {number} worldZ
 * @param {number} heightAboveSeaMeters
 * @param {number} slopeDegrees
 * @returns {number} 0 = open ground, 1 = fully wooded.
 */
export function forestCoverage01(worldX, worldZ, heightAboveSeaMeters, slopeDegrees) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	// Which *region* this is, per the owner map's transcribed biome zones. Run 358 shipped this mask as
	// pure noise, which meant Dorne's desert and the jungles of Sothoryos were equally likely to be
	// wooded — the map had no say. See `world/worldReferenceForestAffinity.js`.
	const { nx, ny } = normalizedMapPoint(worldX, worldZ);
	// The Doom killed everything that grew here four hundred years ago, and nothing has come back. This
	// is the single authority on forest, so suppressing it here removes Valyrian woodland from the ground
	// colour and from `world/vegetation.js`'s tree scatter in one place rather than two.
	if (valyriaInfluence01(nx, ny) > 0.25) return 0;
	const affinity = canonicalForestAffinity(nx, ny);
	if (affinity <= 0) return 0;
	const forestNoise01 = signedFbmNoise(worldX * P.forestPatchFrequency - 13.1, worldZ * P.forestPatchFrequency + 7.4, P.forestPatchOctaves) * 0.5 + 0.5;
	const forestPatch = smoothstep(P.forestPatchStart, P.forestPatchFull, forestNoise01);
	const notCliff = 1 - smoothstep(P.forestSlopeFalloffStartDegrees, P.forestSlopeFalloffFullDegrees, slopeDegrees);
	const belowTreeLine = 1 - smoothstep(P.forestTreeLineStartMeters, P.forestTreeLineFullMeters, heightAboveSeaMeters);
	return forestPatch * notCliff * belowTreeLine * affinity;
}

/** Dorne and the Red Waste, as the map paints them: pale warm sand rather than the green the rest of
 * the world gets. Run 364 / ADR-0311. */
const ARID_SAND = new THREE.Color(0.72, 0.56, 0.38);

export function resolveTerrainBiomeColor(target, { heightAboveSeaMeters, slopeDegrees, rockWeight = 0, snowWeight = 0, worldX = 0, worldZ = 0 }) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	const height = heightAboveSeaMeters;
	const slope = slopeDegrees;

	// 1. Base ground: bright lowland grass -> mid grass -> dry olive upland, with a slow tint drift so
	// open country is never one flat colour.
	const grassDrift = signedFbmNoise(worldX * P.grassVariationFrequency + 5.3, worldZ * P.grassVariationFrequency - 2.9, 3);
	target.copy(TERRAIN_BIOME_PALETTE.GRASS_LOW)
		.lerp(TERRAIN_BIOME_PALETTE.GRASS_MID, clamp01(smoothstep(P.grassMidStartMeters, P.grassMidFullMeters, height) + grassDrift * P.grassVariationStrength))
		.lerp(TERRAIN_BIOME_PALETTE.DRY_UPLAND, smoothstep(P.dryUplandStartMeters, P.dryUplandFullMeters, height));

	// 2. Forest: low-frequency patch mask, below the tree line, excluded only from cliffs.
	const forestAmount = forestCoverage01(worldX, worldZ, height, slope) * P.forestMaxStrength;
	if (forestAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.FOREST, forestAmount);

	// Desert, straight off the map (ADR-0311). Dorne and the Red Waste are the two places the owner map
	// paints warm sand instead of green, and until now the world rendered them the same olive as the
	// Reach. Applied after forest and before the slope-driven rock below, so a cliff in Dorne is still
	// rock — sand covers the ground, not the crags standing out of it.
	const { nx: aridNx, ny: aridNy } = normalizedMapPoint(worldX, worldZ);
	const aridity = sampleMapAridity01(aridNx, aridNy);
	if (aridity > 0.02) target.lerp(ARID_SAND, aridity * 0.88);

	// 3. Shore sand — suppressed on steep ground so sea cliffs stay rock, not beach.
	const sandAmount = (1 - smoothstep(P.shoreSandFullMeters, P.shoreSandTopMeters, height))
		* (1 - smoothstep(P.rockSlopeStartDegrees, P.rockSlopeFullDegrees, slope))
		* (height > 0 ? 1 : 0);
	if (sandAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SHORE_SAND, sandAmount);

	// 4. Exposed rock: steepness first, canonical stony ground second.
	const rockAmount = clamp01(Math.max(
		smoothstep(P.rockSlopeStartDegrees, P.rockSlopeFullDegrees, slope),
		clamp01(rockWeight) * P.canonicalRockGain,
	));
	if (rockAmount > 0) {
		scratchRock.copy(TERRAIN_BIOME_PALETTE.ROCK_WARM)
			.lerp(TERRAIN_BIOME_PALETTE.ROCK_COOL, smoothstep(P.rockCoolStartMeters, P.rockCoolFullMeters, height));
		target.lerp(scratchRock, rockAmount);
	}

	// 5. Snow: altitude line OR canonical northern snow, minus what a steep face sheds.
	const snowSupply = clamp01(Math.max(
		smoothstep(P.snowAltitudeStartMeters, P.snowAltitudeFullMeters, height),
		clamp01(snowWeight) * P.canonicalSnowGain,
	));
	const snowHold = 1 - smoothstep(P.snowShedStartDegrees, P.snowShedFullDegrees, slope);
	const snowAmount = height > 0 ? snowSupply * snowHold : 0;
	if (snowAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SNOW, snowAmount);

	// 6. Below the waterline, fade to seabed so shallows read as bathymetry.
	const submergedAmount = 1 - smoothstep(-P.seabedFullDepthMeters, 0, height);
	if (submergedAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SEABED, submergedAmount);

	// 6b. Regional hue, straight off the map's own pixels.
	//
	// Everything above reads the *terrain* — height, slope, rock, snow — and reads it correctly. None of
	// it knows *where in the world* a place is, which is why the Reach, the Westerlands and Yi Ti all
	// came out much the same olive: they are all mid-height, low-slope, soil-covered ground.
	//
	// **The map's colour is applied as a deviation from the map's own land average, not as a colour to
	// blend toward.** Blending toward it was tried first and measured *worse*: mean pairwise distance
	// between region colours fell from 41.6 to 39.4. The map is a pale, evenly-inked painting whose land
	// averages (163,166,126), so lerping every region toward its local map colour drags them all toward
	// that one parchment tone — it equalises regions instead of separating them, which is the opposite
	// of what was asked. Taking the *ratio* of a cell to the land mean keeps only what makes that place
	// different from everywhere else and amplifies it, so Dorne's warmth and Yi Ti's green pull apart
	// rather than together.
	//
	// Luminance is preserved exactly: the ratio is renormalised so it can only rotate hue and stretch
	// saturation, never brighten or darken. Relief, cliffs, beaches and snowlines are untouched.
	//
	// Excluded where the ground is not soil — snow stays white, bare rock grey, and anything at or below
	// the waterline keeps its seabed colour rather than picking up the map's painted sea.
	const groundTint = clamp01(1 - Math.max(snowAmount, rockAmount))
		* (height > 0 ? 1 : 0)
		* (1 - submergedAmount)
		* P.mapGroundColorStrength;
	if (groundTint > 0.001) {
		sampleMapGroundColor(scratchMapColor, aridNx, aridNy);
		const mean = P.mapGroundColorLandMean;
		const exponent = P.mapGroundColorChromaExponent;
		const ratioR = Math.pow(scratchMapColor.r / mean.r, exponent);
		const ratioG = Math.pow(scratchMapColor.g / mean.g, exponent);
		const ratioB = Math.pow(scratchMapColor.b / mean.b, exponent);
		// Renormalise the ratio to unit luminance so this cannot change how bright the ground is. The
		// gain must NOT carry `groundTint`: folding the strength into the gain would scale luminance
		// rather than blend, so every partially-tinted vertex — the edge of a snowfield, a shoreline,
		// the foot of a cliff — would come out darker than the ground beside it. Strength belongs in
		// the lerp, which is a blend and cannot change brightness on its own.
		const ratioLuminance = ratioR * 0.2126 + ratioG * 0.7152 + ratioB * 0.0722;
		if (ratioLuminance > 0.05) {
			const gain = 1 / ratioLuminance;
			scratchMapColor.setRGB(
				clamp01(target.r * ratioR * gain),
				clamp01(target.g * ratioG * gain),
				clamp01(target.b * ratioB * gain),
			);
			target.lerp(scratchMapColor, groundTint);
		}
	}

	// 7. Deterministic mottling so the bands above never read as flat vector shapes.
	const mottle = 1 + (positionHash01(worldX, worldZ) - 0.5) * 2 * P.mottleAmplitude;
	target.setRGB(
		clamp01(target.r * mottle),
		clamp01(target.g * mottle),
		clamp01(target.b * mottle),
	);
	return target;
}

/**
 * Converts the authored (saturated, green) overlay image into a **neutral luminance detail canvas**
 * whose mean is normalised to 1.0, so it multiplies the biome colour without imposing a hue.
 *
 * Encoded into 0-255 bytes around `detailEncodePivot` (mid-grey = multiplier 1.0): a texel that was
 * exactly the image's mean luminance comes out neutral, brighter texels lighten and darker texels
 * darken, clamped to `detailMinMultiplier`/`detailMaxMultiplier` so a single dark blotch cannot black
 * out a hillside. The caller must tag the resulting texture `NoColorSpace` and apply
 * `NEUTRAL_DETAIL_GAIN` — see `detailEncodePivot`'s own note for why.
 *
 * @param {HTMLImageElement|ImageBitmap} image Decoded source image.
 * @param {object} [options]
 * @param {number} [options.size] Output square resolution.
 * @returns {HTMLCanvasElement}
 */
export function buildNeutralDetailCanvas(image, { size = TERRAIN_BIOME_SHADING_POLICY.detailTextureSize } = {}) {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	context.drawImage(image, 0, 0, size, size);
	const imageData = context.getImageData(0, 0, size, size);
	const data = imageData.data;

	// Pass 1: mean luminance (Rec. 709 on the stored sRGB bytes — this is a perceptual detail signal,
	// not a radiometric quantity, so it is deliberately computed in the encoded domain).
	let sum = 0;
	for (let i = 0; i < data.length; i += 4) {
		sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
	}
	const mean = sum / (data.length / 4);
	// A degenerate (uniform black) source would divide by ~0; fall back to flat neutral instead.
	const safeMean = mean > 1 ? mean : 1;

	// Pass 2: rewrite as a clamped, mean-normalised neutral multiplier around the encode pivot.
	const { detailMinMultiplier, detailMaxMultiplier, detailEncodePivot } = TERRAIN_BIOME_SHADING_POLICY;
	for (let i = 0; i < data.length; i += 4) {
		const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
		let multiplier = luma / safeMean;
		if (multiplier < detailMinMultiplier) multiplier = detailMinMultiplier;
		else if (multiplier > detailMaxMultiplier) multiplier = detailMaxMultiplier;
		const encoded = Math.max(0, Math.min(255, Math.round(multiplier * detailEncodePivot)));
		data[i] = encoded;
		data[i + 1] = encoded;
		data[i + 2] = encoded;
		data[i + 3] = 255;
	}
	context.putImageData(imageData, 0, 0);
	return canvas;
}

/**
 * A 1x1 canvas encoding a flat multiplier of exactly 1.0.
 *
 * Used as the fail-safe image when neutralisation cannot run: the raw authored image must never be
 * left attached to a `NoColorSpace` sampler, because its saturated green would then be read as raw
 * linear data and tint the whole world. Falling back to flat neutral loses the surface detail but
 * keeps every biome colour exactly correct.
 * @returns {HTMLCanvasElement}
 */
export function buildFlatNeutralCanvas() {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d');
	const pivot = TERRAIN_BIOME_SHADING_POLICY.detailEncodePivot;
	context.fillStyle = `rgb(${pivot}, ${pivot}, ${pivot})`;
	context.fillRect(0, 0, 1, 1);
	return canvas;
}

/**
 * Central-difference ground slope in degrees from four neighbouring heights.
 *
 * Callers pass real world-space neighbours (the chunk builder samples a one-vertex apron beyond its
 * own edge for exactly this reason), so a vertex shared by two chunks resolves to the identical slope
 * from either side and no colour seam can appear at a chunk border.
 *
 * @param {number} heightWest
 * @param {number} heightEast
 * @param {number} heightNorth
 * @param {number} heightSouth
 * @param {number} spacingMeters Distance between the sampled neighbours' centres.
 * @returns {number} Slope in degrees, 0 = flat.
 */
export function slopeDegreesFromNeighbours(heightWest, heightEast, heightNorth, heightSouth, spacingMeters) {
	const gradientX = (heightEast - heightWest) / (2 * spacingMeters);
	const gradientZ = (heightSouth - heightNorth) / (2 * spacingMeters);
	return Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
}
