/**
 * Valyria — the Doom, as terrain.
 *
 * **What the owner asked for.** "VALYRIA bölgesini yeşil alan yerine Lav'dan oluşan sert dağlık
 * görünümüne kavuştur." They were right that it was wrong: probed on the live field, the land where
 * `resimler/map.png` draws the Valyrian peninsula averages **19.7 m above sea and peaks at 40.5 m**,
 * with forest coverage 0.05 and aridity 0.05 — which every rule in this project correctly reads as flat
 * green lowland. The ruin of the greatest civilisation in the world was rendering as a meadow.
 *
 * **What the map shows.** Read off `resimler/map.png` at 3x: a shattered rust-and-purple peninsula
 * labelled VALYRIA, with OROS and TYRIA on broken fragments north of it, "The Smoking Sea" written
 * across the drowned water between them, and the isthmus above it named "LANDS OF THE LONG SUMMER"
 * running north toward MANTARYS and the Demon Road. Nothing in that region is drawn green; the
 * cartographer washed smoke over the whole thing.
 *
 * **What the lore says, and how it constrains the terrain.** Valyria was a volcanic peninsula — the
 * Fourteen Flames were its mountains, and the Freehold mined them for dragonglass and worked their
 * heat. The Doom broke them all at once: the peninsula shattered into islands, the sea poured into the
 * wound and boils there still, and four hundred years later the land is ash, slag and smoke where
 * nothing grows. That gives four requirements a green meadow fails: it must be **mountainous** (the
 * Flames), **shattered** rather than smooth (the breaking), **black** rather than green (basalt, ash
 * and obsidian), and **barren** (nothing has grown there since).
 *
 * **What this module does not do: change the coastline.** The uplift is applied only where the
 * canonical surface mask already says land, and it is ramped in from the shoreline, so the Smoking Sea
 * stays sea and the islands stay the shape `map.png` draws. Raising the region wholesale would have
 * filled the drowned water back in and undone the Doom — the owner's standing instruction is not to
 * deviate from the map, and the map's own answer here is *broken land in warm water*.
 *
 * @module world/worldReferenceValyria
 */

import * as THREE from 'three';
import { signedFbmNoise } from './terrainReliefDetail.js';

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export const VALYRIA_POLICY = Object.freeze({
	id: 'valyria-doom-2026-08-20-v1',
	/**
	 * The region, in normalized owner-map coordinates, transcribed from `map.png`.
	 *
	 * `core` is the shattered peninsula around the VALYRIA/OROS/TYRIA labels; `neck` reaches north up the
	 * Lands of the Long Summer isthmus, where the map's smoke wash thins out toward Mantarys. Read at 3x
	 * magnification against the same 0.01 grid every other transcription in this project uses, so the
	 * same +/-0.015 accuracy caveat applies.
	 */
	coreCenter: Object.freeze({ nx: 0.445, ny: 0.735 }),
	coreRadius: Object.freeze({ nx: 0.052, ny: 0.070 }),
	neckCenter: Object.freeze({ nx: 0.442, ny: 0.672 }),
	neckRadius: Object.freeze({ nx: 0.034, ny: 0.045 }),
	/** Influence falls from 1 at the centre to 0 at this multiple of the radius. */
	falloff: 1.45,

	/**
	 * Peak uplift at the core, in metres.
	 *
	 * Sized against the world's own scale rather than picked for drama: the tallest ground in this world
	 * is a little over 700 m, and the Fourteen Flames should read as a major range without out-topping
	 * every canonical mountain chain on the map. Applied on top of the existing 20-40 m land, so the
	 * peninsula finishes in the 300-450 m band — mountainous, and still below the Wall country.
	 */
	upliftMeters: 330,
	/**
	 * Frequency of the shattering, in cycles across the map. Ridged, so it breaks into crests and
	 * ravines rather than swelling into a dome.
	 *
	 * **Sized against the mesh, after getting it wrong.** The first attempt used frequency 150 over four
	 * octaves, which puts the finest octave at 13,500 / (150 x 2.07^3) = about 10 m — right on the 7.8 m
	 * Nyquist limit of the 3.91 m near-band mesh. The render was not mountains but wreckage: torn sheets,
	 * floating slabs and skirt curtains hanging into the sea, and the world's worst LOD gap went from
	 * 61.1 m to 85.2 m. 55 over three octaves puts the finest octave near 57 m, which the mesh can
	 * actually carry, and gives broad shattered peaks instead of razor spikes.
	 */
	shatterFrequency: 55,
	shatterOctaves: 3,
	/** How much of the uplift is carried by the ridged shatter rather than the smooth swell. 1 would be
	 * all crags and no mass; 0 would be a dome. */
	shatterShare: 0.45,
	/**
	 * Metres above sea over which the uplift ramps in from the shoreline.
	 *
	 * Without this the coast would become a wall: land at 6.1 m and land at 6.0 m would differ by the
	 * full uplift. Ramping over the first 30 m makes the islands rise out of the water instead.
	 */
	shoreRampMeters: 30,
});

/** The Doom's palette and its thresholds. Colours are authored as sRGB hex, the way the rest of this
 * project's terrain palette is, and `THREE.Color` converts them to the linear working space on
 * construction. */
export const VALYRIA_SURFACE = Object.freeze({
	/** Cooled basalt — near-black with a faint warm cast, not pure black, so it still takes light. */
	BASALT: new THREE.Color(0x2a2422),
	/** Settled ash on exposed heights. */
	ASH: new THREE.Color(0x6b6560),
	/** Molten rock. Bright and saturated so it reads as emission under this world's daylight. */
	LAVA: new THREE.Color(0xff4d14),
	ashStartMeters: 180,
	ashFullMeters: 380,
	ashStrength: 0.55,
	/** Below this influence the ground has cooled: rim basalt, no lava. */
	lavaCoreInfluence: 0.45,
	/** Curvature, in metres, over which lava fills a hollow. Matched to the same scale
	 * `terrainGroundRealism`'s drainage is calibrated on, so channels read at the same size as gullies. */
	lavaCurvatureStart: 0.45,
	lavaCurvatureFull: 1.6,
	lavaStrength: 0.7,
});

/**
 * How Valyrian is this point, in [0, 1]?
 *
 * The union of two ellipses — the shattered core and the isthmus neck — so the region follows the shape
 * the map draws rather than a circle laid over it.
 *
 * @param {number} nx Normalized owner-map X.
 * @param {number} ny Normalized owner-map Y.
 * @returns {number} 0 outside, 1 in the heart of the Doom.
 */
export function valyriaInfluence01(nx, ny) {
	const P = VALYRIA_POLICY;
	const core = Math.hypot((nx - P.coreCenter.nx) / P.coreRadius.nx, (ny - P.coreCenter.ny) / P.coreRadius.ny);
	const neck = Math.hypot((nx - P.neckCenter.nx) / P.neckRadius.nx, (ny - P.neckCenter.ny) / P.neckRadius.ny);
	const nearest = Math.min(core, neck);
	return 1 - smoothstep(1, P.falloff, nearest);
}

/**
 * Metres of volcanic uplift to add at this point.
 *
 * Returns 0 off the region and 0 at or below the waterline, so the Smoking Sea is never filled in and
 * the coastline the mask draws is never moved. The shape is a smooth swell plus ridged shatter: the
 * swell gives the range its mass, the ridges break it into the crests and ravines a shattered volcanic
 * province should have.
 *
 * @param {number} nx Normalized owner-map X.
 * @param {number} ny Normalized owner-map Y.
 * @param {number} heightAboveSeaMeters Existing land height; <= 0 returns 0.
 * @returns {number} Metres to add.
 */
export function valyriaUpliftMeters(nx, ny, heightAboveSeaMeters) {
	if (heightAboveSeaMeters <= 0) return 0;
	const influence = valyriaInfluence01(nx, ny);
	if (influence <= 0) return 0;
	const P = VALYRIA_POLICY;
	const shoreRamp = smoothstep(0, P.shoreRampMeters, heightAboveSeaMeters);
	// Ridged: 1 - |signed| turns smooth noise into sharp crests with V-shaped troughs between them.
	const signed = signedFbmNoise(nx * P.shatterFrequency + 41.7, ny * P.shatterFrequency - 88.3, P.shatterOctaves);
	const ridged = 1 - Math.abs(signed);
	const shape = (1 - P.shatterShare) + P.shatterShare * ridged;
	// influence^1.5 keeps the rim from rising as fast as the heart, so the range has flanks.
	return P.upliftMeters * Math.pow(influence, 1.5) * shoreRamp * shape;
}

/**
 * Valyrian ground colour: basalt, ash and lava.
 *
 * Applied over whatever the biome pass decided, in proportion to `valyriaInfluence01`, so the Doom
 * fades into the Lands of the Long Summer rather than ending at a line on the ground.
 *
 * Three surfaces, chosen from what the place is rather than for effect:
 *
 *   - **Basalt** everywhere by default — cooled lava is near-black, and it is what a shattered volcanic
 *     province is made of.
 *   - **Ash** on the high, exposed ground, where four centuries of falling ash settle and pale the rock.
 *   - **Lava** in the hollows. This reuses the drainage curvature `world/terrainGroundRealism.js`
 *     already computes for every vertex: molten rock runs downhill and pools exactly where water would,
 *     so the same concavity that makes a wet gully elsewhere makes a lava channel here. It costs nothing
 *     extra to sample and it puts the glow where the ground's own shape says it belongs.
 *
 * @param {import('three').Color} target Mutated in place and returned.
 * @param {object} sample
 * @param {number} sample.nx Normalized owner-map X.
 * @param {number} sample.ny Normalized owner-map Y.
 * @param {number} sample.heightAboveSeaMeters
 * @param {number} sample.curvatureMeters Positive is a hollow — see `terrainGroundRealism`.
 * @returns {import('three').Color} `target`.
 */
export function applyValyriaSurface(target, { nx, ny, heightAboveSeaMeters, curvatureMeters }) {
	const influence = valyriaInfluence01(nx, ny);
	if (influence <= 0 || heightAboveSeaMeters <= 0) return target;
	const P = VALYRIA_SURFACE;

	// 1. Basalt base. Full strength in the heart, fading out through the rim.
	target.lerp(P.BASALT, influence);

	// 2. Ash on the heights.
	const ash = smoothstep(P.ashStartMeters, P.ashFullMeters, heightAboveSeaMeters) * influence;
	if (ash > 0) target.lerp(P.ASH, ash * P.ashStrength);

	// 3. Lava where the ground collects. Only in the hot heart — the rim has cooled.
	const heat = smoothstep(P.lavaCoreInfluence, 1, influence);
	const pooling = smoothstep(P.lavaCurvatureStart, P.lavaCurvatureFull, curvatureMeters);
	const lava = heat * pooling;
	if (lava > 0) target.lerp(P.LAVA, lava * P.lavaStrength);
	return target;
}
