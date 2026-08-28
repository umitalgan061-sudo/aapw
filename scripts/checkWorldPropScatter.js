#!/usr/bin/env node
/**
 * checkWorldPropScatter.js — guards run 370 / ADR-0317's world-wide prop scatter.
 *
 * The owner asked for every model in `assets/` to be distributed across the whole geography, each in
 * country that suits it. That is two claims, and both are measurable rather than matters of opinion:
 * *is the catalogue actually used*, and *is each entry only placed where it belongs*. This walks every
 * chunk in the world — all 27x21 of them — plans its props with the same pure function the renderer
 * uses, and checks the result.
 *
 * **1. Coverage of the map.** Every biome the catalogue defines must actually occur somewhere. A biome
 * with no ground answering to it means its entries are dead weight that will never appear.
 *
 * **2. Coverage of the catalogue.** Nearly all of the catalogue must actually get placed somewhere in
 * the world. This is the check that catches the real risk in a scatter this size: an entry whose biome
 * is so rare, or so crowded, that it never wins a draw. The threshold is deliberately high, because
 * "distribute all the models" is the request — it caught exactly that twice, at 86.7% and again at
 * 93.0%, and the root cause both times was catalogue crowding rather than the selection mechanism.
 *
 * The threshold is 95% rather than 100% for an arithmetic reason worth stating. Coverage of a biome is
 * bounded by how much of the world resolves to it: `upland` (ground above 240 m) yields about 32
 * placements across the whole map, and no selection scheme can show more distinct models than it has
 * placements. Reaching 100% would mean either inventing upland where the map has none, or filing upland
 * models under country they do not belong to — and "her modeli doğru yere" rules both out. The residual
 * is reported by name on every run, so it stays visible rather than becoming invisible slack.
 *
 * **3. Placement is legal everywhere.** No prop below or at sea level, none on ground steeper than the
 * policy allows, none inside a kingdom seat's clearance, and no two props inside their combined
 * footprint. Sampled over the whole world rather than one neighbourhood, because a rule that holds near
 * spawn and fails in Essos is not a rule.
 *
 * **4. Deterministic.** A chunk planned twice must be identical — the streamer builds and tears down
 * chunks as the player moves, so a chunk that changed on revisit would make scenery flicker in and out.
 *
 * Usage: `node scripts/checkWorldPropScatter.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkWorldPropScatter
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Share of the catalogue that must appear somewhere in the world. */
const MIN_CATALOGUE_COVERAGE = 0.95;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[world-props] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG, CHUNK_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads, KINGDOM_SEATS } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const scatter = await import('/src/3d/world/worldPropScatter.js');
			const catalogue = await import('/src/3d/world/worldPropCatalogue.js');
			const P = scatter.PROP_SCATTER_POLICY;
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

			// Seats in world metres, the same projection the scatter uses.
			const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
			const seats = KINGDOM_SEATS.map((seat) => ({
				x: (seat.mapX - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT,
				z: (seat.mapY - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT,
			}));

			const chunkMeters = CHUNK_CONFIG.CHUNK_SIZE_METERS;
			const halfX = Math.ceil((MAP_BOUNDS.maxX - MAP_BOUNDS.minX) * METERS_PER_MAP_UNIT / chunkMeters / 2);
			const halfZ = Math.ceil((MAP_BOUNDS.maxY - MAP_BOUNDS.minY) * METERS_PER_MAP_UNIT / chunkMeters / 2);

			const byBiome = {};
			const usedFiles = new Set();
			const violations = { submerged: 0, tooSteep: 0, insideSeat: 0, overlapping: 0 };
			const worstExamples = [];
			let chunksWalked = 0;
			let totalProps = 0;

			const slopeAt = (x, z) => {
				const d = 6;
				const dx = (live(x + d, z) - live(x - d, z)) / (2 * d);
				const dz = (live(x, z + d) - live(x, z - d)) / (2 * d);
				return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
			};

			for (let chunkZ = -halfZ; chunkZ <= halfZ; chunkZ += 1) {
				for (let chunkX = -halfX; chunkX <= halfX; chunkX += 1) {
					const props = scatter.planChunkProps({
						chunkX, chunkZ, sampleHeightMeters: live, seed: WORLD_DEFAULTS.WORLD_SEED, seats,
					});
					chunksWalked += 1;
					totalProps += props.length;
					for (let i = 0; i < props.length; i += 1) {
						const prop = props[i];
						byBiome[prop.terrain] = (byBiome[prop.terrain] ?? 0) + 1;
						usedFiles.add(prop.file);
						if (prop.y <= seaLevel) {
							violations.submerged += 1;
							if (worstExamples.length < 4) worstExamples.push(`${prop.file} at y=${prop.y.toFixed(1)} (sea ${seaLevel})`);
						}
						if (slopeAt(prop.x, prop.z) > P.maxAnySlopeDegrees) violations.tooSteep += 1;
						if (seats.some((seat) => (prop.x - seat.x) ** 2 + (prop.z - seat.z) ** 2 < P.seatClearanceMeters ** 2)) violations.insideSeat += 1;
						for (let j = i + 1; j < props.length; j += 1) {
							const other = props[j];
							const clearance = (prop.footprintMeters + other.footprintMeters) * 0.5;
							if ((prop.x - other.x) ** 2 + (prop.z - other.z) ** 2 < clearance * clearance) violations.overlapping += 1;
						}
					}
				}
			}

			// Determinism: replan a spread of chunks and compare.
			let determinismDrift = 0;
			for (const [chunkX, chunkZ] of [[0, 2], [-8, -6], [11, 9], [-14, 4], [6, -11]]) {
				const a = scatter.planChunkProps({ chunkX, chunkZ, sampleHeightMeters: live, seed: WORLD_DEFAULTS.WORLD_SEED, seats });
				const b = scatter.planChunkProps({ chunkX, chunkZ, sampleHeightMeters: live, seed: WORLD_DEFAULTS.WORLD_SEED, seats });
				if (JSON.stringify(a) !== JSON.stringify(b)) determinismDrift += 1;
			}

			const catalogueFiles = catalogue.PROP_CATALOGUE.map((entry) => entry.file);
			const unused = catalogueFiles.filter((file) => !usedFiles.has(file));
			return {
				chunksWalked, totalProps, byBiome,
				catalogueSize: catalogueFiles.length,
				usedCount: usedFiles.size,
				unused: unused.slice(0, 12),
				unusedCount: unused.length,
				biomesDefined: catalogue.PROP_BIOMES.slice(),
				violations, worstExamples, determinismDrift,
				exclusions: catalogue.PROP_CATALOGUE_EXCLUSIONS,
			};
		});

		const failures = [];
		const missingBiomes = result.biomesDefined.filter((biome) => !(result.byBiome[biome] > 0));
		if (missingBiomes.length) {
			failures.push(`no ground in the world resolves to these biomes, so their catalogue entries can never appear: ${missingBiomes.join(', ')}`);
		}
		const coverage = result.usedCount / result.catalogueSize;
		if (!(coverage >= MIN_CATALOGUE_COVERAGE)) {
			failures.push(
				`only ${result.usedCount}/${result.catalogueSize} catalogue entries (${(coverage * 100).toFixed(1)}%) appear anywhere in the world, ` +
				`below the ${(MIN_CATALOGUE_COVERAGE * 100).toFixed(0)}% the owner's "distribute all the models" asks for. ` +
				`Unplaced: ${result.unused.join(', ')}${result.unusedCount > result.unused.length ? ', …' : ''}`);
		}
		for (const [kind, count] of Object.entries(result.violations)) {
			if (count > 0) failures.push(`${count} prop placement(s) violate "${kind}"${result.worstExamples.length ? ` — e.g. ${result.worstExamples[0]}` : ''}`);
		}
		if (result.determinismDrift > 0) {
			failures.push(`${result.determinismDrift} chunk(s) planned differently on a second pass — scenery would flicker as chunks stream in and out`);
		}

		console.log(`[world-props] walked ${result.chunksWalked} chunks (the whole map), planned ${result.totalProps} props`);
		console.log(`[world-props] catalogue coverage ${result.usedCount}/${result.catalogueSize} entries (${(coverage * 100).toFixed(1)}%); withheld by category: ${JSON.stringify(result.exclusions)}`);
		console.log(`[world-props] by biome: ${JSON.stringify(result.byBiome)}`);
		// Always reported, not only on failure: knowing *which* entries never appear is what tells the next
		// run whether a biome is overcrowded, and an earlier revision of this check hid the list on PASS.
		if (result.unusedCount > 0) {
			console.log(`[world-props] never placed (${result.unusedCount}): ${result.unused.join(', ')}${result.unusedCount > result.unused.length ? ', …' : ''}`);
		}
		console.log(`[world-props] legality: ${JSON.stringify(result.violations)}; determinism drift ${result.determinismDrift}`);
		if (failures.length) {
			for (const failure of failures) console.error(`[world-props] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[world-props] PASS: every biome occurs, the catalogue is used, every placement is legal, and chunks replan identically.');
		process.exit(0);
	} catch (error) {
		console.error('[world-props] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
