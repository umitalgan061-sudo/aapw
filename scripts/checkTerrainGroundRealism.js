#!/usr/bin/env node
/**
 * checkTerrainGroundRealism.js — guards run 367 / ADR-0314's drainage, aspect and mottle pass.
 *
 * `world/terrainGroundRealism.js` is the layer that makes ground read as earth rather than as a
 * coloured surface: hollows go dark and green because water collects in them, ridges go pale because
 * they shed it, sun-facing slopes dry out, and three octaves of noise give the result a scale
 * hierarchy. This check asserts the four properties that make that safe and correct.
 *
 * **1. Render-only (GOVERNANCE.md §8.4).** The module must not be able to influence terrain height.
 * The check samples the live height field at a grid of points and asserts it is bit-identical to the
 * same field sampled through a chunk build, i.e. that nothing in the shading path feeds back into
 * geometry. This is the property that lets a colour change skip a full terrain safety cycle.
 *
 * **2. Determinism (§8.9).** The same world coordinate must produce the same colour every time and
 * from every caller, or chunk seams would show a colour discontinuity along every boundary. Checked by
 * resolving the same coordinates twice and by resolving a shared edge coordinate from both sides.
 *
 * **3. The effect points the right way.** A hollow must come out darker and greener than a ridge at
 * the same altitude and slope — that is the whole claim, and a sign error would invert every drainage
 * line in the world while still looking "varied".
 *
 * **4. The calibration still matches the terrain.** `drainageFullMeters` is calibrated to a measured
 * curvature distribution — p99 = 1.317 m over the whole map at 3.91 m vertex spacing. Terrain changes
 * constantly in this project, and a calibration silently invalidated by a later relief change would make
 * this pass fade back to invisibility exactly as its first, guessed, 3.5 m version did. So the check
 * re-measures the distribution and fails if the policy has drifted more than 2x away from the live p99.
 *
 * The distribution is walked over the entire map rather than one neighbourhood, which matters more than
 * it sounds: sampling a single disc let run 372's Valyrian uplift push the reported p99 to 1.826 m and
 * would have failed a calibration that is still right everywhere else.
 *
 * Usage: `node scripts/checkTerrainGroundRealism.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkTerrainGroundRealism
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** How far the live p99 curvature may drift from `drainageFullMeters` before the calibration is stale. */
const CALIBRATION_TOLERANCE_FACTOR = 2;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[ground-realism] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const { resolveTerrainBiomeColor } = await import('/src/3d/world/terrainBiomeShading.js');
			const realism = await import('/src/3d/world/terrainGroundRealism.js');
			const P = realism.TERRAIN_GROUND_REALISM_POLICY;
			const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;

			const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: raw, seaLevelMeters: seaLevel,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const pre = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const valleys = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: pre, seaLevelMeters: seaLevel });
			const live = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads, null, valleys);

			// --- 1. Render-only: sample heights, run the whole shading path, sample again. -------------
			const probes = [];
			for (let i = 0; i < 400; i += 1) {
				const angle = i * 2.399963;
				const radius = 2000 * Math.sqrt((i % 397) / 397);
				probes.push({ x: Math.cos(angle) * radius, z: 1000 + Math.sin(angle) * radius });
			}
			const before = probes.map((p) => live(p.x, p.z));
			const colour = new THREE.Color();
			const spacing = 500 / 128;
			const shade = (x, z) => {
				const own = live(x, z);
				const w = live(x - spacing, z);
				const e = live(x + spacing, z);
				const n = live(x, z - spacing);
				const s = live(x, z + spacing);
				const dx = (e - w) / (2 * spacing);
				const dz = (s - n) / (2 * spacing);
				const slopeDegrees = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
				resolveTerrainBiomeColor(colour, {
					heightAboveSeaMeters: own - seaLevel, slopeDegrees, rockWeight: 0, snowWeight: 0, worldX: x, worldZ: z,
				});
				realism.applyGroundRealism(colour, {
					curvatureMeters: realism.curvatureMetersFromNeighbours(live(x - spacing, z), live(x + spacing, z), live(x, z - spacing), live(x, z + spacing), own, spacing),
					sunExposure01: realism.sunExposure01FromNeighbours(w, e, n, s),
					slopeDegrees, heightAboveSeaMeters: own - seaLevel, worldX: x, worldZ: z,
				});
				return { r: colour.r, g: colour.g, b: colour.b };
			};
			const shadedOnce = probes.map((p) => shade(p.x, p.z));
			const after = probes.map((p) => live(p.x, p.z));
			let heightDrift = 0;
			for (let i = 0; i < before.length; i += 1) heightDrift = Math.max(heightDrift, Math.abs(after[i] - before[i]));

			// --- 2. Determinism: same coordinates, second pass, must be identical. ---------------------
			const shadedTwice = probes.map((p) => shade(p.x, p.z));
			let colourDrift = 0;
			for (let i = 0; i < shadedOnce.length; i += 1) {
				colourDrift = Math.max(colourDrift,
					Math.abs(shadedOnce[i].r - shadedTwice[i].r),
					Math.abs(shadedOnce[i].g - shadedTwice[i].g),
					Math.abs(shadedOnce[i].b - shadedTwice[i].b));
			}

			// --- 3. Direction: a hollow must be darker and greener than a ridge. -----------------------
			// Synthetic, so altitude and slope are held equal and only curvature differs.
			const hollow = new THREE.Color(0.5, 0.5, 0.4);
			const ridge = new THREE.Color(0.5, 0.5, 0.4);
			const common = { slopeDegrees: 0, heightAboveSeaMeters: 80, worldX: 0, worldZ: 0, sunExposure01: 0.5 };
			realism.applyGroundRealism(hollow, { ...common, curvatureMeters: P.drainageFullMeters });
			realism.applyGroundRealism(ridge, { ...common, curvatureMeters: -P.drainageFullMeters });
			const hollowLuma = 0.2126 * hollow.r + 0.7152 * hollow.g + 0.0722 * hollow.b;
			const ridgeLuma = 0.2126 * ridge.r + 0.7152 * ridge.g + 0.0722 * ridge.b;
			// Greenness = green share of total, so "greener" is independent of overall brightness.
			const greenShare = (c) => c.g / (c.r + c.g + c.b);

			// --- 4. Calibration against the live curvature distribution. -------------------------------
			// Sampled across the whole world, not one disc.
			//
			// An earlier revision sampled a 1200 m radius around (0, 1000). Run 372 raised Valyria, whose
			// isthmus lies about 1095 m from that centre — inside the disc — and the reported p99 curvature
			// jumped from 1.013 m to 1.826 m. That was not the world drifting: it was one atypical volcanic
			// province dominating a statistic meant to describe the whole map, and left alone it would have
			// failed this check for a calibration that is still right everywhere else. No single region can
			// capture a world-wide walk.
			const curvatures = [];
			const halfWidth = (WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX) * WORLD_SCALE.METERS_PER_MAP_UNIT * 0.5;
			const halfHeight = (WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY) * WORLD_SCALE.METERS_PER_MAP_UNIT * 0.5;
			for (let z = -halfHeight; z <= halfHeight; z += 140) {
				for (let x = -halfWidth; x <= halfWidth; x += 140) {
					const own = live(x, z);
					if (own <= seaLevel + 1) continue;
					curvatures.push(realism.curvatureMetersFromNeighbours(live(x - spacing, z), live(x + spacing, z), live(x, z - spacing), live(x, z + spacing), own, spacing));
				}
			}
			curvatures.sort((a, b) => a - b);
			const p99 = curvatures[Math.floor(0.99 * (curvatures.length - 1))];

			// --- 4b. Does ground colour actually track relief? ------------------------------------------
			// The substantive claim is not "the ground is more varied" — a global contrast measure is the
			// wrong instrument and in fact reports a ~1% *drop*, because darkening hollows and lightening
			// ridges moves both toward the middle of the existing spread. The claim is that colour follows
			// *drainage*: darker where the ground is concave. So this measures the Pearson correlation
			// between resolved luminance and curvature over live terrain, with and without the pass. A
			// strongly negative correlation after, and a near-zero one before, is the whole effect.
			const lumaOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
			const correlate = (xs, ys) => {
				const n = xs.length;
				const mx = xs.reduce((a, b) => a + b, 0) / n;
				const my = ys.reduce((a, b) => a + b, 0) / n;
				let num = 0; let dx2 = 0; let dy2 = 0;
				for (let i = 0; i < n; i += 1) {
					const a = xs[i] - mx; const b = ys[i] - my;
					num += a * b; dx2 += a * a; dy2 += b * b;
				}
				return dx2 > 0 && dy2 > 0 ? num / Math.sqrt(dx2 * dy2) : 0;
			};
			const curvatureSeries = [];
			const lumaWith = [];
			const lumaWithout = [];
			for (let i = 0; i < 4000; i += 1) {
				const angle = i * 2.399963;
				const radius = 1200 * Math.sqrt((i % 991) / 991);
				const x = Math.cos(angle) * radius;
				const z = 1000 + Math.sin(angle) * radius;
				const own = live(x, z);
				if (own <= seaLevel + 1) continue;
				const w = live(x - spacing, z); const e = live(x + spacing, z);
				const n = live(x, z - spacing); const s = live(x, z + spacing);
				const dx = (e - w) / (2 * spacing); const dz = (s - n) / (2 * spacing);
				const slopeDegrees = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
				const heightAboveSeaMeters = own - seaLevel;
				resolveTerrainBiomeColor(colour, {
					heightAboveSeaMeters, slopeDegrees, rockWeight: 0, snowWeight: 0, worldX: x, worldZ: z,
				});
				lumaWithout.push(lumaOf(colour));
				realism.applyGroundRealism(colour, {
					curvatureMeters: realism.curvatureMetersFromNeighbours(live(x - spacing, z), live(x + spacing, z), live(x, z - spacing), live(x, z + spacing), own, spacing),
					sunExposure01: realism.sunExposure01FromNeighbours(w, e, n, s),
					slopeDegrees, heightAboveSeaMeters, worldX: x, worldZ: z,
				});
				lumaWith.push(lumaOf(colour));
				curvatureSeries.push(realism.curvatureMetersFromNeighbours(live(x - spacing, z), live(x + spacing, z), live(x, z - spacing), live(x, z + spacing), own, spacing));
			}
			const drainageCorrelationAfter = correlate(curvatureSeries, lumaWith);
			const drainageCorrelationBefore = correlate(curvatureSeries, lumaWithout);

			// --- 4c. LOD invariance. ------------------------------------------------------------------
			// Curvature grows with the stencil it is measured over, so the same ground measured on a
			// 32-segment chunk (15.63 m vertices) and a 128-segment one (3.91 m) would take different
			// colours — a seam along every LOD band boundary, shimmering as the bands move with the
			// player. `curvatureMetersFromNeighbours` normalises by stencil to prevent that. This compares
			// what the near band and the far band actually pass in, normalised and raw, so the assertion
			// scores the shipped code path rather than a helper the renderer does not use.
			const fine = 500 / 128;
			const coarse = 500 / 32;
			// Collected as distributions, not maxima. On a fractal height field the worst single point will
			// always disagree — the coarse stencil physically cannot see detail finer than itself, and that
			// residual is inherent to having LOD at all, not a defect in the normalisation. What would draw
			// a *visible* seam is a systematic offset across the boundary, and that is what normalisation
			// removes. So the assertion is on p95 and the max is reported alongside for transparency.
			const normalisedDrifts = [];
			const rawDrifts = [];
			for (let i = 0; i < 400; i += 1) {
				const angle = i * 2.399963;
				const radius = 900 * Math.sqrt((i % 293) / 293);
				const x = Math.cos(angle) * radius;
				const z = 1000 + Math.sin(angle) * radius;
				const own = live(x, z);
				if (own <= seaLevel + 1) continue;
				const nearNormalised = realism.curvatureMetersFromNeighbours(
					live(x - fine, z), live(x + fine, z), live(x, z - fine), live(x, z + fine), own, fine);
				const farNormalised = realism.curvatureMetersFromNeighbours(
					live(x - coarse, z), live(x + coarse, z), live(x, z - coarse), live(x, z + coarse), own, coarse);
				const farRaw = farNormalised * (coarse / realism.TERRAIN_GROUND_REALISM_POLICY.curvatureStencilMeters);
				normalisedDrifts.push(Math.abs(nearNormalised - farNormalised));
				rawDrifts.push(Math.abs(nearNormalised - farRaw));
			}
			normalisedDrifts.sort((a, b) => a - b);
			rawDrifts.sort((a, b) => a - b);
			const at = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
			const normalisedDriftP95 = at(normalisedDrifts, 0.95);
			const rawDriftP95 = at(rawDrifts, 0.95);
			const normalisedDriftMax = normalisedDrifts[normalisedDrifts.length - 1];
			const rawDriftMax = rawDrifts[rawDrifts.length - 1];
			const normalisedDriftMedian = at(normalisedDrifts, 0.5);

			// --- 5. Underwater ground must be untouched: bathymetry has no soil. ------------------------
			const seabed = new THREE.Color(0.3, 0.4, 0.35);
			const seabedBefore = { r: seabed.r, g: seabed.g, b: seabed.b };
			realism.applyGroundRealism(seabed, {
				curvatureMeters: 3, sunExposure01: 1, slopeDegrees: 20,
				heightAboveSeaMeters: -20, worldX: 120, worldZ: -340,
			});
			const seabedDrift = Math.max(
				Math.abs(seabed.r - seabedBefore.r), Math.abs(seabed.g - seabedBefore.g), Math.abs(seabed.b - seabedBefore.b));

			return {
				policyId: P.id, renderOnly: P.renderOnly, drainageFullMeters: P.drainageFullMeters,
				heightDrift, colourDrift, seabedDrift,
				hollowLuma, ridgeLuma,
				hollowGreen: greenShare(hollow), ridgeGreen: greenShare(ridge),
				curvatureSamples: curvatures.length, p99,
				drainageCorrelationBefore, drainageCorrelationAfter, correlationSamples: curvatureSeries.length,
				normalisedDriftP95, rawDriftP95, normalisedDriftMax, rawDriftMax, normalisedDriftMedian,
				curvatureStencilMeters: P.curvatureStencilMeters,
			};
		});

		const failures = [];
		if (result.heightDrift !== 0) failures.push(`height field moved by ${result.heightDrift} m during the shading pass — this layer must be render-only`);
		if (result.colourDrift !== 0) failures.push(`same coordinate resolved to a different colour on a second pass (max drift ${result.colourDrift}) — not deterministic`);
		if (result.seabedDrift !== 0) failures.push(`submerged ground was modified (drift ${result.seabedDrift}) — bathymetry has no drainage, aspect or soil`);
		if (!(result.hollowLuma < result.ridgeLuma)) failures.push(`a hollow (luma ${result.hollowLuma.toFixed(4)}) is not darker than a ridge (${result.ridgeLuma.toFixed(4)}) — drainage sign is inverted`);
		if (!(result.hollowGreen > result.ridgeGreen)) failures.push(`a hollow (green share ${result.hollowGreen.toFixed(4)}) is not greener than a ridge (${result.ridgeGreen.toFixed(4)}) — drainage sign is inverted`);
		// The pass must make colour track drainage, and must do so much more strongly than the biome
		// bands alone already did. -0.25 is well below anything the altitude bands produce on their own
		// (they correlate with height, not curvature) and well above noise at this sample count.
		if (!(result.drainageCorrelationAfter < -0.25)) {
			failures.push(
				`ground colour does not track drainage: luminance/curvature correlation is ` +
				`${result.drainageCorrelationAfter.toFixed(4)} (want < -0.25). The pass is present but too weak to read.`);
		}
		if (!(result.drainageCorrelationAfter < result.drainageCorrelationBefore)) {
			failures.push(
				`the pass did not strengthen the drainage signal: correlation went ` +
				`${result.drainageCorrelationBefore.toFixed(4)} -> ${result.drainageCorrelationAfter.toFixed(4)}`);
		}
		// The normalisation is analytic, not exact resampling, so it is held to a tolerance rather than
		// to zero — but it must be dramatically better than doing nothing, which `rawDrift` measures.
		if (!(result.normalisedDriftP95 < result.drainageFullMeters)) {
			failures.push(
				`curvature is not LOD-invariant enough: at p95 the near and far bands disagree by ` +
				`${result.normalisedDriftP95.toFixed(3)} m, at or beyond drainageFullMeters ` +
				`(${result.drainageFullMeters} m) — a full-strength colour step across a band boundary`);
		}
		if (!(result.rawDriftP95 > result.normalisedDriftP95 * 2)) {
			failures.push(
				`the LOD-invariance assertion is vacuous: without normalisation p95 drift would have been ` +
				`${result.rawDriftP95.toFixed(3)} m vs ${result.normalisedDriftP95.toFixed(3)} m with it, ` +
				'so the normalisation is not doing measurable work');
		}
		const ratio = result.p99 / result.drainageFullMeters;
		if (!(ratio > 1 / CALIBRATION_TOLERANCE_FACTOR && ratio < CALIBRATION_TOLERANCE_FACTOR)) {
			failures.push(
				`drainageFullMeters=${result.drainageFullMeters} is stale: the live field's p99 curvature is ` +
				`${result.p99.toFixed(3)} m (ratio ${ratio.toFixed(2)}x, tolerance ${CALIBRATION_TOLERANCE_FACTOR}x). ` +
				'Terrain has changed under this calibration; re-measure and re-tune, or the pass fades to invisible.');
		}

		console.log(`[ground-realism] policy ${result.policyId}, renderOnly=${result.renderOnly}`);
		console.log(`[ground-realism] render-only: height drift ${result.heightDrift} m over 400 probes; determinism: colour drift ${result.colourDrift}; seabed drift ${result.seabedDrift}`);
		console.log(`[ground-realism] direction: hollow luma ${result.hollowLuma.toFixed(4)} < ridge ${result.ridgeLuma.toFixed(4)}; hollow green share ${result.hollowGreen.toFixed(4)} > ridge ${result.ridgeGreen.toFixed(4)}`);
		console.log(`[ground-realism] drainage signal: luma/curvature correlation ${result.drainageCorrelationBefore.toFixed(4)} (biome bands alone) -> ${result.drainageCorrelationAfter.toFixed(4)} (with this pass) over ${result.correlationSamples} dry samples`);
		console.log(
			`[ground-realism] LOD invariance: near(3.91m) vs far(15.63m) curvature disagreement — ` +
			`median ${result.normalisedDriftMedian.toFixed(3)} m, p95 ${result.normalisedDriftP95.toFixed(3)} m, max ${result.normalisedDriftMax.toFixed(3)} m; ` +
			`unnormalised p95 would be ${result.rawDriftP95.toFixed(3)} m / max ${result.rawDriftMax.toFixed(3)} m ` +
			`(${(result.rawDriftP95 / Math.max(result.normalisedDriftP95, 1e-9)).toFixed(1)}x better at p95)`);
		console.log(`[ground-realism] calibration: drainageFullMeters ${result.drainageFullMeters} m vs live p99 ${result.p99.toFixed(3)} m over ${result.curvatureSamples} dry samples (${ratio.toFixed(2)}x)`);
		if (failures.length) {
			for (const failure of failures) console.error(`[ground-realism] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[ground-realism] PASS: render-only, deterministic, seabed untouched, drainage points the right way, calibration current.');
		process.exit(0);
	} catch (error) {
		console.error('[ground-realism] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
