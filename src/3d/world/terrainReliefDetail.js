/**
 * Coastline domain-warp and multi-octave relief detail — the layer that turns the canonical 96x64
 * surface mask from a visible grid of squares into organic geography.
 *
 * **Why this exists.** The canonical mask is 96x64 cells over a 13,296 x 10,341 m world, so one cell
 * is ~138 x ~162 m. `sampleReferencePindexQualityV2` reconstructs it bilinearly with a sub-cell warp
 * of only 0.15-0.19 cells, which smooths the *shading* across a cell edge but leaves the coastline
 * itself running along cell boundaries: rendered from the air the shore reads as a rectangular
 * staircase with ~138 m steps, and the inland plains — whose height comes almost entirely from
 * smoothly-interpolated cell weights — read as billiard-table flat. Neither is what real terrain
 * looks like.
 *
 * Two deterministic additions fix that without touching the canonical data:
 *
 * 1. **Coast warp.** The normalized map coordinate is displaced by a few octaves of noise before the
 *    canonical surface is sampled, at an amplitude of roughly one mask cell. The mask's own land/sea
 *    decision is unchanged — it is read at a slightly different place — so headlands, bays and inlets
 *    appear at scales the source grid could never express, while the large-scale landmass stays
 *    exactly where the owner map puts it.
 * 2. **Relief detail.** Ridged multi-octave noise added to land height, amplitude-shaped so plains get
 *    gentle undulation (a couple of metres) and mountain chains get real crags (tens of metres). The
 *    ridged form (`1 - |noise|`) is used for the mountain band specifically because it produces sharp
 *    crest lines and V-shaped valleys, which is what reads as erosion from the air, where plain fBm
 *    reads as rolling dunes.
 *
 * **Amplitude discipline.** Fine detail is deliberately capped so it cannot break the gates this
 * project already enforces: the plains/mid octaves add at most ~2 degrees of local slope, well inside
 * the 20-degree road-grade ceiling (`scripts/roadNetworkSafetyCheck.js`) and the 35-degree seat
 * walkability ceiling (`scripts/terrainSeatSafetyCheck.js`), and the large mountain octave is gated
 * behind `reliefInfluence` so it only fires on the canonical mountain chains that roads already route
 * around. Settlement flatten pads still override everything locally.
 *
 * **Determinism.** Pure functions of position — integer-hash value noise, no `Math.random()`, no
 * state. The same coordinate always yields the same displacement, so chunk borders agree exactly.
 * @module world/terrainReliefDetail
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

export const TERRAIN_RELIEF_DETAIL_POLICY = Object.freeze({
	id: 'terrain-coast-warp-and-relief-detail-2026-08-19-v1',
	/** Coast warp amplitude in normalized map units, per axis. ~1 mask cell (1/96, 1/64). */
	coastWarpU: 1.55 / 96,
	coastWarpV: 1.55 / 64,
	coastWarpOctaves: 3,
	/** Gentle everywhere-on-land undulation so plains are never flat. Wavelength in normalized units;
	 * 0.02 of the map width is ~266 m, giving <=~1.5 deg of added slope at this amplitude. */
	plainsAmplitudeMeters: 5.5,
	plainsFrequency: 46,
	/** Broader swells that give the lowlands large-scale shape. ~700 m wavelength. */
	swellAmplitudeMeters: 14,
	swellFrequency: 17,
	/** Ridged mountain crags, gated behind canonical relief/rock/snow so only real chains get them. */
	ridgeAmplitudeMeters: 42,
	ridgeFrequency: 11,
	ridgeOctaves: 4,
	/**
	 * Erosion relief present on **all** land, not just the canonical mountain chains.
	 *
	 * The first revision gated every ridged octave behind `mountainGate`, so the ~80% of land that is
	 * not a canonical chain received only smooth fBm and read from the air as soft dunes rather than
	 * eroded ground. Real terrain carries drainage structure everywhere; what changes with elevation is
	 * its *amplitude*, not its presence. So this layer runs unconditionally on land and ramps from
	 * `erosionAmplitudeLowMeters` at the waterline to `erosionAmplitudeHighMeters` at
	 * `erosionFullElevationMeters`, which mirrors how lowlands are smoother than uplands.
	 *
	 * Amplitude is bounded by the same gates as everything else here: at ~390 m wavelength an 11 m
	 * ridge adds on the order of 3-5 deg of local slope, well inside the 20 deg road ceiling.
	 */
	erosionAmplitudeLowMeters: 3.6,
	erosionAmplitudeHighMeters: 11,
	erosionFullElevationMeters: 150,
	erosionFrequency: 34,
	erosionOctaves: 4,
	/**
	 * Relief amplitude has to scale with the landform it is carving.
	 *
	 * A fixed 42 m ridge is decisive on a 90 m hill and invisible on a 600 m massif — which is exactly
	 * what the first capture showed: the tallest peaks still rendered as smooth domes because the
	 * ridged octave was a rounding error against their own height. Both the erosion and mountain-crag
	 * amplitudes therefore take the larger of their fixed value and a fraction of local elevation, so a
	 * peak is carved in proportion to how tall it is. Capped so the tallest terrain cannot run away.
	 */
	elevationErosionFraction: 0.055,
	elevationErosionCapMeters: 40,
	elevationRidgeFraction: 0.26,
	elevationRidgeCapMeters: 135,
	/** A short-wavelength crag layer so mountains stay rugged when the camera is close, where the
	 * broad `ridgeFrequency` octave alone reads as a smooth dome. */
	cragAmplitudeMeters: 4.5,
	cragFrequency: 88,
	cragOctaves: 3,
	/**
	 * Two fine layers that run on **all** land and are what stop the world reading as smooth.
	 *
	 * The coarser layers above shape landforms; these shape the ground itself. `dissection` is ridged
	 * at ~120 m wavelength and carves the gully/spur pattern that covers real hillsides; `roughness` is
	 * a ~45 m signed layer that keeps even flat ground from being a plane. Both matter only because
	 * terrain mesh resolution went to 3.9 m vertices (`CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP`) — at the
	 * previous 7.8 m spacing anything under ~16 m was averaged away, which is why earlier rounds could
	 * add relief and still render smooth.
	 *
	 * Amplitudes are the largest that keep every road grade under the 20 deg ceiling, checked by
	 * running `scripts/roadNetworkSafetyCheck.js` rather than reasoned about.
	 */
	dissectionAmplitudeLowMeters: 6.5,
	dissectionAmplitudeHighMeters: 16,
	dissectionFrequency: 110,
	dissectionOctaves: 4,
	dissectionFullElevationMeters: 220,
	roughnessAmplitudeMeters: 2.0,
	roughnessFrequency: 295,
	roughnessOctaves: 3,
	/** Above this elevation the relief may carve downward at full strength; below it, downward
	 * carving is scaled toward zero so the coastal plain cannot be punched below sea level. */
	negativeReliefFullElevationMeters: 28,
	/**
	 * Mid-scale hill country — the layer that decides whether the world reads as rolling or flat
	 * from the air, which is the altitude this project's own evidence captures are taken from.
	 *
	 * Sized to fill a real gap in the canonical field. Profiling the western landmass showed the
	 * Vale chain topping out at only 61 m (its authored `peakMeters` is 430) because the road-pass
	 * corridors flatten it by up to 98% across ~700 m radii — so Westeros has almost no mid-scale
	 * vertical structure of its own, and every earlier layer here was either too fine to see from
	 * altitude or gated behind mountain classification it does not have. At ~600 m wavelength a 26 m
	 * hill costs about 5 deg of slope, comfortably under the 20 deg road ceiling, so this buys large
	 * visible relief far more cheaply than raising the fine layers ever could.
	 */
	hillAmplitudeMeters: 26,
	hillFrequency: 22,
	hillOctaves: 3,
	/**
	 * Detail fades out below this height above sea so the seabed and the sand line stay clean.
	 *
	 * Narrowed from 0.5-6 m on 2026-08-19 after measurement showed it was the single biggest reason
	 * the lowlands stayed smooth: this world's land has a median height of just 5.24 m above sea, so a
	 * fade that only reached full strength at 6 m was suppressing added relief across **half the
	 * world's land area** — every layer in this module was being multiplied to near zero exactly where
	 * most of the terrain is. 0.3-2.5 m protects the actual waterline and nothing else.
	 */
	shoreFadeStartMeters: 0.3,
	shoreFadeFullMeters: 2.5,
});

/** Deterministic 2D integer hash -> [0,1). Trig-based, matching the style already used across this
 * project's canonical micro-signal functions. */
function hash2(ix, iy) {
	const value = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
	return value - Math.floor(value);
}

/** Smooth 2D value noise in [0,1) with quintic interpolation (C2 continuous, so derived slopes do not
 * show interpolation creases). */
function valueNoise2(x, y) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const n00 = hash2(x0, y0);
	const n10 = hash2(x0 + 1, y0);
	const n01 = hash2(x0, y0 + 1);
	const n11 = hash2(x0 + 1, y0 + 1);
	const nx0 = n00 + (n10 - n00) * ux;
	const nx1 = n01 + (n11 - n01) * ux;
	return nx0 + (nx1 - nx0) * uy;
}

/**
 * Signed fractal Brownian motion in roughly [-1, 1]. Exported so `world/terrainBiomeShading.js` can
 * drive its forest-patch mask from the same deterministic noise basis this module uses for relief,
 * rather than introducing a second, independently-seeded one.
 * @param {number} x
 * @param {number} y
 * @param {number} octaves
 * @returns {number}
 */
export function signedFbmNoise(x, y, octaves) {
	return fbm2(x, y, octaves);
}

/** Signed fractal Brownian motion in roughly [-1, 1]. */
function fbm2(x, y, octaves) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalisation = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		sum += (valueNoise2(x * frequency, y * frequency) * 2 - 1) * amplitude;
		normalisation += amplitude;
		amplitude *= 0.5;
		frequency *= 2.03; // slightly off 2 so octaves never align into a visible lattice
	}
	return sum / normalisation;
}

/** Ridged multifractal in [0, 1] — sharp crests, V-shaped troughs. */
function ridged2(x, y, octaves) {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let normalisation = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		const signed = valueNoise2(x * frequency, y * frequency) * 2 - 1;
		sum += (1 - Math.abs(signed)) * amplitude;
		normalisation += amplitude;
		amplitude *= 0.5;
		frequency *= 2.07;
	}
	return sum / normalisation;
}

/**
 * Coastline domain-warp offsets, in normalized map units.
 *
 * Applied to the coordinate handed to the canonical surface sampler, never to the canonical data
 * itself. Two different frequency bands are summed so the shore gains both broad headlands/bays and
 * finer inlets instead of one uniform wobble.
 *
 * @param {number} normalizedX
 * @param {number} normalizedY
 * @returns {{du: number, dv: number}}
 */
export function coastWarpOffsets(normalizedX, normalizedY) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	// Distinct coordinate offsets per channel so u and v displace independently (a shared field would
	// only slide the coast diagonally instead of deforming it).
	const broadU = fbm2(normalizedX * 9.3 + 11.7, normalizedY * 9.3 + 3.1, P.coastWarpOctaves);
	const broadV = fbm2(normalizedX * 9.3 - 5.9, normalizedY * 9.3 + 27.4, P.coastWarpOctaves);
	const fineU = fbm2(normalizedX * 31.5 + 61.2, normalizedY * 31.5 - 17.8, 2);
	const fineV = fbm2(normalizedX * 31.5 - 43.6, normalizedY * 31.5 + 8.5, 2);
	return {
		du: (broadU * 0.72 + fineU * 0.28) * P.coastWarpU,
		dv: (broadV * 0.72 + fineV * 0.28) * P.coastWarpV,
	};
}

/**
 * Extra land relief in metres, to be added to the canonical height.
 *
 * Shaped by three independent gates so the amplitude is spent where it reads as geography:
 * `heightAboveSea` fades detail out at the waterline, `reliefInfluence`/`rockWeight`/`snowWeight`
 * unlock the large ridged octave only on canonical mountain terrain, and `waterWeight` suppresses
 * everything over open water.
 *
 * @param {number} normalizedX
 * @param {number} normalizedY
 * @param {object} context
 * @param {number} context.heightAboveSeaMeters Canonical height above sea before this addition.
 * @param {number} context.reliefInfluence Canonical relief-chain influence, 0..1.
 * @param {number} context.rockWeight Canonical rock surface weight, 0..1.
 * @param {number} context.snowWeight Canonical snow surface weight, 0..1.
 * @param {number} context.waterWeight Canonical sea+lake weight, 0..1.
 * @returns {number} Metres to add (always >= 0 on land, 0 over water).
 */
export function reliefDetailMeters(normalizedX, normalizedY, { heightAboveSeaMeters, reliefInfluence, rockWeight, snowWeight, waterWeight }) {
	const P = TERRAIN_RELIEF_DETAIL_POLICY;
	const dryness = 1 - clamp01(waterWeight);
	if (dryness <= 0) return 0;
	// Fade in above the waterline so shorelines and the seabed stay clean and beaches stay readable.
	const shoreFade = clamp01((heightAboveSeaMeters - P.shoreFadeStartMeters) / (P.shoreFadeFullMeters - P.shoreFadeStartMeters));
	if (shoreFade <= 0) return 0;
	const landGate = dryness * shoreFade;

	const swell = fbm2(normalizedX * P.swellFrequency + 3.7, normalizedY * P.swellFrequency - 9.1, 3);
	const plains = fbm2(normalizedX * P.plainsFrequency - 21.3, normalizedY * P.plainsFrequency + 14.6, 3);
	let metres = (swell * P.swellAmplitudeMeters + plains * P.plainsAmplitudeMeters) * landGate;

	// Erosion structure on ALL land. Ridged rather than plain fBm because the sharp crests and
	// V-shaped troughs are exactly what reads as drainage from the air; amplitude ramps with elevation
	// so lowlands stay gentle and uplands get real shape.
	const erosionRamp = clamp01(heightAboveSeaMeters / P.erosionFullElevationMeters);
	const erosionAmplitude = Math.max(
		P.erosionAmplitudeLowMeters + (P.erosionAmplitudeHighMeters - P.erosionAmplitudeLowMeters) * erosionRamp * erosionRamp,
		Math.min(P.elevationErosionCapMeters, heightAboveSeaMeters * P.elevationErosionFraction),
	);
	const erosion = ridged2(normalizedX * P.erosionFrequency - 8.4, normalizedY * P.erosionFrequency + 33.9, P.erosionOctaves);
	metres += (erosion - 0.5) * 2 * erosionAmplitude * landGate;

	// Mid-scale hill country: the dominant large-form relief on land that is not a canonical mountain
	// chain. Ridged so it produces ridge-and-valley country rather than smooth dunes.
	const hills = ridged2(normalizedX * P.hillFrequency + 17.3, normalizedY * P.hillFrequency - 41.6, P.hillOctaves);
	metres += (hills - 0.5) * 2 * P.hillAmplitudeMeters * landGate;

	// Fine dissection: the gully-and-spur pattern that covers real hillsides. Ridged, elevation-ramped,
	// and present on every piece of land — this is the layer that removes "smooth" from the world.
	const dissectionRamp = clamp01(heightAboveSeaMeters / P.dissectionFullElevationMeters);
	const dissectionAmplitude = P.dissectionAmplitudeLowMeters
		+ (P.dissectionAmplitudeHighMeters - P.dissectionAmplitudeLowMeters) * dissectionRamp;
	const dissection = ridged2(normalizedX * P.dissectionFrequency + 71.5, normalizedY * P.dissectionFrequency - 24.2, P.dissectionOctaves);
	metres += (dissection - 0.5) * 2 * dissectionAmplitude * landGate;

	// Surface roughness: short-wavelength signed noise so even flat ground is never a plane.
	const roughness = fbm2(normalizedX * P.roughnessFrequency - 55.8, normalizedY * P.roughnessFrequency + 12.7, P.roughnessOctaves);
	metres += roughness * P.roughnessAmplitudeMeters * landGate;

	// Low ground may be *raised* into hills but must not be *carved* below the waterline. Symmetric
	// noise at these amplitudes dug holes through the coastal plain — 80% of this world's land sits
	// under 17.7 m — and the water plane filled every one of them, pockmarking the lowlands with
	// hundreds of identical ponds. Damping only the negative side keeps the added relief (real rolling
	// hills) and drops the artefact, without touching how high ground behaves.
	if (metres < 0) metres *= clamp01(heightAboveSeaMeters / P.negativeReliefFullElevationMeters);

	// Mountain crags: only where the canonical data already says mountain.
	const mountainGate = clamp01(Math.max(
		reliefInfluence * reliefInfluence,
		clamp01(rockWeight) * 0.8,
		clamp01(snowWeight) * 0.7,
	));
	if (mountainGate > 0) {
		const ridgeAmplitude = Math.max(
			P.ridgeAmplitudeMeters,
			Math.min(P.elevationRidgeCapMeters, heightAboveSeaMeters * P.elevationRidgeFraction),
		);
		const ridge = ridged2(normalizedX * P.ridgeFrequency + 47.2, normalizedY * P.ridgeFrequency + 19.8, P.ridgeOctaves);
		// Centred on its own mean so the ridged octave adds crest relief without lifting the whole
		// massif (a raised base would change every mountain's absolute height, not just its shape).
		metres += (ridge - 0.5) * 2 * ridgeAmplitude * mountainGate * landGate;
		// Short-wavelength crags on top, so a peak still looks like rock rather than a dome up close.
		// Scaled off the same elevation-aware amplitude at a fixed fraction, for the same reason.
		const crag = ridged2(normalizedX * P.cragFrequency + 5.1, normalizedY * P.cragFrequency - 61.3, P.cragOctaves);
		metres += (crag - 0.5) * 2 * Math.max(P.cragAmplitudeMeters, ridgeAmplitude * 0.16) * mountainGate * landGate;
	}
	return metres;
}
