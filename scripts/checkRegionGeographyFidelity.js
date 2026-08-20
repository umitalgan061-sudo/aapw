#!/usr/bin/env node
/**
 * checkRegionGeographyFidelity.js — is every named region of the map actually the country it should be?
 *
 * **Why this exists.** The owner asked to be sure Valyria *and the other regions* are geographically
 * right. Until now that question could only be answered by flying to a place and looking, one region at
 * a time — which is how Valyria spent this whole project rendering as a meadow while every check passed.
 * The checks were all correct and none of them was asking "is Dorne a desert?".
 *
 * This walks a table of named regions, transcribed from `resimler/map.png` and named from the books,
 * samples the live height field and the owner map's own biome answers across each, and compares what the
 * world has against what the region is supposed to be.
 *
 * **Expectations are deliberately loose, and asymmetric.** They are stated as the *contradictions* that
 * would prove a region wrong — a desert with almost no aridity, a mountain range with no mountains, a
 * jungle with no trees — rather than as narrow bands. A check that fails on taste rather than on fact
 * would get tuned into uselessness within a few runs, and this project has already learned that lesson
 * the hard way. Every region's measurements are printed on every run whether it passes or not, so
 * drift is visible before it becomes a failure.
 *
 * **The measurements are the same ones the renderer uses**: `createHeightSampler` for terrain,
 * `sampleMapForest01` / `sampleMapAridity01` for the map's per-cell biome answer. Nothing here is a
 * parallel model of the world that could agree with itself while disagreeing with the game.
 *
 * Usage: `node scripts/checkRegionGeographyFidelity.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkRegionGeographyFidelity
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/**
 * Named regions, with the box they occupy in normalized owner-map coordinates and the contradiction
 * that would prove the world wrong about them.
 *
 * Boxes were read off `resimler/map.png` at 2-3x magnification against the same 0.01 grid every other
 * transcription in this project uses, so they carry the same +/-0.015 caveat. `expect` keys are floors
 * and ceilings on the measured aggregate: `minPeak`/`minMeanHeight` in metres above sea, `minAridity`,
 * `minForest`, `maxForest`, `maxAridity` on the 0-1 map fields, `minLandFraction` on the sampled cells.
 */
const REGIONS = [
	{ id: 'lands-of-always-winter', nx: [0.09, 0.19], ny: [0.02, 0.09], note: 'beyond the Wall — the map draws it white',
		expect: { maxForest: 0.5 } },
	{ id: 'the-north', nx: [0.11, 0.21], ny: [0.15, 0.30], note: 'Winterfell and the wolfswood',
		expect: { minLandFraction: 0.35 } },
	{ id: 'the-reach', nx: [0.10, 0.19], ny: [0.50, 0.59], note: 'Highgarden — the richest farmland in Westeros',
		expect: { maxAridity: 0.45, minLandFraction: 0.3 } },
	{ id: 'dorne', nx: [0.136, 0.237], ny: [0.623, 0.672], note: 'the map paints it orange sand',
		expect: { minAridity: 0.15 } },
	{ id: 'red-mountains', nx: [0.136, 0.194], ny: [0.579, 0.618], note: 'the Dornish Marches range',
		expect: { minPeak: 120 } },
	{ id: 'dothraki-sea', nx: [0.30, 0.50], ny: [0.44, 0.54], note: 'open grassland, no forest, little relief',
		expect: { maxForest: 0.5 } },
	{ id: 'red-waste', nx: [0.56, 0.68], ny: [0.56, 0.66], note: 'the map paints it orange desert',
		expect: { minAridity: 0.15 } },
	{ id: 'great-sand-sea', nx: [0.734, 0.767], ny: [0.506, 0.672], note: 'the brown dune field east of the Bones',
		expect: { minAridity: 0.15 } },
	{ id: 'bone-mountains', nx: [0.700, 0.730], ny: [0.40, 0.68], note: 'the snow-capped spine of eastern Essos',
		expect: { minPeak: 400, minMeanHeight: 150 } },
	{ id: 'valyria', nx: [0.405, 0.478], ny: [0.695, 0.795], note: 'the Doom — volcanic, barren',
		expect: { minPeak: 250, maxForest: 0.01, notGreen: true } },
	{ id: 'sothoryos', nx: [0.45, 0.70], ny: [0.88, 0.99], note: 'the map draws it dark jungle green',
		expect: {} },
];

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[regions] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const measured = await page.evaluate(async (regions) => {
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { sampleMapAridity01 } = await import('/src/3d/world/worldReferenceBiomeField.js');
			// `forestCoverage01` is the *shared authority* — ground colour and `vegetation.js`'s tree scatter
			// both ask it. The raw `sampleMapForest01` field is only one of its inputs, and measuring that
			// instead reported Valyria as 7% wooded when the renderer correctly draws it bare. A check must
			// score what the game does.
			const { forestCoverage01, resolveTerrainBiomeColor } = await import('/src/3d/world/terrainBiomeShading.js');
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			// Valyria's basalt/ash/lava is applied on top of the biome colour by the renderer, so the colour
			// column must include it or it under-reports the Doom as ordinary green ground.
			const { applyValyriaSurface, valyriaInfluence01 } = await import('/src/3d/world/worldReferenceValyria.js');
			const { curvatureMetersFromNeighbours } = await import('/src/3d/world/terrainGroundRealism.js');
			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;

			const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: raw, seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const pre = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const valleys = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: pre, seaLevelMeters: sea });
			const live = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads, null, valleys);
			const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
			const toWorld = (nx, ny) => ({
				x: (nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT,
				z: (ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT,
			});

			const STEP = 0.005;
			return regions.map((region) => {
				let cells = 0; let land = 0; let sumHeight = 0; let peak = 0; let sumForest = 0; let sumArid = 0;
				// Rendered ground colour, averaged — the only way to ask "does this region *look* like what
				// the map paints?" rather than trusting the inputs that feed the colour.
				const colour = new THREE.Color();
				let sumR = 0; let sumG = 0; let sumB = 0;
				for (let ny = region.ny[0]; ny <= region.ny[1] + 1e-9; ny += STEP) {
					for (let nx = region.nx[0]; nx <= region.nx[1] + 1e-9; nx += STEP) {
						const w = toWorld(nx, ny);
						const h = live(w.x, w.z);
						cells += 1;
						if (h <= sea) continue;
						land += 1;
						sumHeight += h - sea;
						peak = Math.max(peak, h - sea);
						const d = 6;
						const slopeDegrees = Math.atan(Math.hypot(
							(live(w.x + d, w.z) - live(w.x - d, w.z)) / (2 * d),
							(live(w.x, w.z + d) - live(w.x, w.z - d)) / (2 * d))) * 180 / Math.PI;
						sumForest += forestCoverage01(w.x, w.z, h - sea, slopeDegrees);
						sumArid += sampleMapAridity01(nx, ny);
						const surface = { rockWeight: 0, snowWeight: 0, waterWeight: 0 };
						live(w.x, w.z, undefined, surface);
						resolveTerrainBiomeColor(colour, {
							heightAboveSeaMeters: h - sea, slopeDegrees,
							rockWeight: surface.rockWeight, snowWeight: surface.snowWeight,
							worldX: w.x, worldZ: w.z,
						});
						if (valyriaInfluence01(nx, ny) > 0) {
							const stencil = 500 / 128;
							applyValyriaSurface(colour, {
								nx, ny, heightAboveSeaMeters: h - sea,
								curvatureMeters: curvatureMetersFromNeighbours(
									live(w.x - stencil, w.z), live(w.x + stencil, w.z),
									live(w.x, w.z - stencil), live(w.x, w.z + stencil), h, stencil),
							});
						}
						sumR += colour.r; sumG += colour.g; sumB += colour.b;
					}
				}
				return {
					id: region.id, cells, land,
					landFraction: cells ? land / cells : 0,
					meanHeight: land ? sumHeight / land : 0,
					peak,
					forest: land ? sumForest / land : 0,
					aridity: land ? sumArid / land : 0,
					colour: land ? [sumR / land, sumG / land, sumB / land] : [0, 0, 0],
				};
			});
		}, REGIONS.map(({ id, nx, ny }) => ({ id, nx, ny })));

		const byId = new Map(measured.map((m) => [m.id, m]));
		const failures = [];
		console.log('[regions] region                  land%   mean m   peak m   forest  aridity  rendered rgb        note');
		for (const region of REGIONS) {
			const m = byId.get(region.id);
			console.log(
				`[regions] ${region.id.padEnd(24)}${(m.landFraction * 100).toFixed(0).padStart(4)}%` +
				`${m.meanHeight.toFixed(0).padStart(9)}${m.peak.toFixed(0).padStart(9)}` +
				`${m.forest.toFixed(3).padStart(9)}${m.aridity.toFixed(3).padStart(9)}` +
				`  ${m.colour.map((v) => v.toFixed(2)).join(',').padEnd(16)}  ${region.note}`);
			const e = region.expect ?? {};
			if (e.minPeak !== undefined && m.peak < e.minPeak) failures.push(`${region.id}: peak ${m.peak.toFixed(0)} m is below the ${e.minPeak} m a range needs — ${region.note}`);
			if (e.minMeanHeight !== undefined && m.meanHeight < e.minMeanHeight) failures.push(`${region.id}: mean height ${m.meanHeight.toFixed(0)} m is below ${e.minMeanHeight} m — ${region.note}`);
			if (e.minAridity !== undefined && m.aridity < e.minAridity) failures.push(`${region.id}: aridity ${m.aridity.toFixed(3)} is below ${e.minAridity} — the map draws desert here`);
			if (e.maxAridity !== undefined && m.aridity > e.maxAridity) failures.push(`${region.id}: aridity ${m.aridity.toFixed(3)} exceeds ${e.maxAridity} — this is not desert country`);
			if (e.minForest !== undefined && m.forest < e.minForest) failures.push(`${region.id}: forest coverage ${m.forest.toFixed(3)} is below ${e.minForest} — ${region.note}`);
			if (e.maxForest !== undefined && m.forest > e.maxForest) failures.push(`${region.id}: forest coverage ${m.forest.toFixed(3)} exceeds ${e.maxForest} — ${region.note}`);
			if (e.minLandFraction !== undefined && m.landFraction < e.minLandFraction) failures.push(`${region.id}: only ${(m.landFraction * 100).toFixed(0)}% of the box is land, expected at least ${(e.minLandFraction * 100).toFixed(0)}%`);
			if (e.notGreen && m.colour[1] > m.colour[0] * 1.15) failures.push(`${region.id}: renders green (rgb ${m.colour.map((v) => v.toFixed(2)).join(', ')}) — ${region.note}`);
		}

		if (failures.length) {
			for (const failure of failures) console.error(`[regions] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log(`[regions] PASS: ${REGIONS.length} named regions measured against the map; none contradicts the country it is supposed to be.`);
		process.exit(0);
	} catch (error) {
		console.error('[regions] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
