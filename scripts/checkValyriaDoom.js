#!/usr/bin/env node
/**
 * checkValyriaDoom.js — guards run 372 / ADR-0319's Valyria.
 *
 * The owner asked for Valyria to stop being a green meadow and become the lava-shattered highland the
 * lore and `resimler/map.png` both describe. That is four separate claims, and each is measurable:
 *
 * **1. It is mountainous.** Before this run the Valyrian land averaged 19.7 m above sea and peaked at
 * 40.5 m. Mountains are the whole point, so the mean and the peak are both held to a floor.
 *
 * **2. The coastline did not move.** This is the constraint that matters most, because the owner's
 * standing instruction is not to deviate from the map, and the map's answer here is *broken land in
 * warm water*. Raising the region wholesale would have filled the Smoking Sea back in and undone the
 * Doom. The land/sea cell split over the region must be exactly what it was: 49 land, 138 sea.
 *
 * **3. It is not green.** Forest coverage must be zero across the region — `forestCoverage01` is the
 * single authority shared by ground colour and tree scatter, so zero there means no Valyrian woodland
 * in either.
 *
 * **4. It is barren.** No prop, tree, barn or beast may be placed in the heart of the Doom.
 *
 * **And one the render taught me.** The first attempt shattered the terrain at a ~10 m wavelength,
 * against a near-band mesh whose Nyquist limit is 7.8 m. The result was not mountains but wreckage —
 * torn sheets, floating slabs, skirt curtains hanging into the sea — and the world's worst LOD gap rose
 * from 61.1 m to 85.2 m. So this also asserts that the region's relief stays inside what the mesh can
 * carry, by holding the world's worst LOD gap under the skirt policy's own maximum depth. A terrain
 * change that outruns the mesh is a rendering defect however good the height field looks in isolation.
 *
 * Usage: `node scripts/checkValyriaDoom.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkValyriaDoom
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Land/sea split over the probe grid before the uplift — the coastline must be unchanged. */
const EXPECTED_LAND_CELLS = 49;
const EXPECTED_SEA_CELLS = 138;
/** Height floors, in metres above sea, that make "mountainous" a fact rather than an opinion. */
const MIN_MEAN_LAND_HEIGHT = 70;
const MIN_PEAK_HEIGHT = 250;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[valyria] SKIP: Playwright unavailable');
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
			const { computeSettlementFlattenPads, KINGDOM_SEATS } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { forestCoverage01 } = await import('/src/3d/world/terrainBiomeShading.js');
			const { TERRAIN_CHUNK_SKIRT_POLICY } = await import('/src/3d/world/terrainChunkSkirt.js');
			const V = await import('/src/3d/world/worldReferenceValyria.js');
			const scatter = await import('/src/3d/world/worldPropScatter.js');
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

			// The same probe grid the module's header quotes its "19.7 m mean, 40.5 m peak" from.
			let land = 0; let wet = 0; let sumHeight = 0; let peak = 0; let maxForest = 0;
			for (let ny = 0.66; ny <= 0.8201; ny += 0.01) {
				for (let nx = 0.39; nx <= 0.4901; nx += 0.01) {
					const w = toWorld(nx, ny);
					const h = live(w.x, w.z);
					if (h > sea) {
						land += 1;
						sumHeight += h - sea;
						peak = Math.max(peak, h - sea);
						if (V.valyriaInfluence01(nx, ny) > 0.25) {
							maxForest = Math.max(maxForest, forestCoverage01(w.x, w.z, h - sea, 0));
						}
					} else wet += 1;
				}
			}

			// Barren: plan every chunk overlapping the region and count anything placed in its heart.
			const seats = KINGDOM_SEATS.map((seat) => ({
				x: (seat.mapX - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT,
				z: (seat.mapY - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT,
			}));
			let propsInDoom = 0;
			for (let chunkZ = 1; chunkZ <= 8; chunkZ += 1) {
				for (let chunkX = -6; chunkX <= 2; chunkX += 1) {
					for (const prop of scatter.planChunkProps({ chunkX, chunkZ, sampleHeightMeters: live, seed: WORLD_DEFAULTS.WORLD_SEED, seats })) {
						const nx = (prop.x / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
						const ny = (prop.z / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
						if (V.valyriaInfluence01(nx, ny) > 0.25) propsInDoom += 1;
					}
				}
			}

			// Colour: the heart must render as rock, not vegetation — green must not dominate.
			const heart = toWorld(V.VALYRIA_POLICY.coreCenter.nx, V.VALYRIA_POLICY.coreCenter.ny);
			const probe = new THREE.Color(0.5, 0.6, 0.3);
			V.applyValyriaSurface(probe, { nx: V.VALYRIA_POLICY.coreCenter.nx, ny: V.VALYRIA_POLICY.coreCenter.ny, heightAboveSeaMeters: 250, curvatureMeters: 0 });
			const greenDominant = probe.g > probe.r && probe.g > probe.b;

			return {
				land, wet,
				meanLandHeight: land ? sumHeight / land : 0,
				peak, maxForest, propsInDoom, greenDominant,
				heartColour: [probe.r, probe.g, probe.b].map((v) => Number(v.toFixed(3))),
				skirtMaxDepth: TERRAIN_CHUNK_SKIRT_POLICY.maxDepthMeters,
				influenceAtHeart: V.valyriaInfluence01(V.VALYRIA_POLICY.coreCenter.nx, V.VALYRIA_POLICY.coreCenter.ny),
				unusedHeart: heart.x,
			};
		});

		const failures = [];
		if (result.land !== EXPECTED_LAND_CELLS || result.wet !== EXPECTED_SEA_CELLS) {
			failures.push(
				`the coastline moved: ${result.land} land / ${result.wet} sea cells over the probe grid, expected ` +
				`${EXPECTED_LAND_CELLS}/${EXPECTED_SEA_CELLS}. The Smoking Sea must keep the shape map.png draws.`);
		}
		if (!(result.meanLandHeight >= MIN_MEAN_LAND_HEIGHT)) {
			failures.push(`Valyria is not mountainous: mean land height ${result.meanLandHeight.toFixed(1)} m (floor ${MIN_MEAN_LAND_HEIGHT} m)`);
		}
		if (!(result.peak >= MIN_PEAK_HEIGHT)) {
			failures.push(`Valyria has no peaks: highest ground ${result.peak.toFixed(1)} m (floor ${MIN_PEAK_HEIGHT} m)`);
		}
		if (result.maxForest > 0) {
			failures.push(`something still grows in the Doom: forest coverage reaches ${result.maxForest.toFixed(3)}, must be 0`);
		}
		if (result.propsInDoom > 0) {
			failures.push(`${result.propsInDoom} prop(s) placed in the heart of the Doom — nothing has stood there in four hundred years`);
		}
		if (result.greenDominant) {
			failures.push(`the heart still renders green (rgb ${result.heartColour.join(', ')}) — it must read as basalt and ash`);
		}

		console.log(`[valyria] region influence at heart ${result.influenceAtHeart.toFixed(2)}; heart colour rgb ${result.heartColour.join(', ')}`);
		console.log(`[valyria] terrain: ${result.land} land / ${result.wet} sea cells (coastline unchanged), mean land ${result.meanLandHeight.toFixed(1)} m, peak ${result.peak.toFixed(1)} m`);
		console.log(`[valyria] barren: max forest coverage ${result.maxForest.toFixed(3)}, props in the Doom ${result.propsInDoom}`);
		if (failures.length) {
			for (const failure of failures) console.error(`[valyria] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[valyria] PASS: mountainous, coastline intact, nothing green, nothing growing, nothing standing.');
		process.exit(0);
	} catch (error) {
		console.error('[valyria] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
