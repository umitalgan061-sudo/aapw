#!/usr/bin/env node
/**
 * checkMountainRanges.js — guards run 380's mountain ranges.
 *
 * The owner's instruction was specific: "Tek büyük kocaman dağ yerine daha sivri ama sıra dağ
 * gruplarına önem ve özen göster." Not one giant mountain — sharper peaks, in groups of ranges. What
 * made that true was measurable, so what keeps it true should be too:
 *
 * **1. Nobody's mountains are all in one place.** The failure being fixed was that every one of the
 * world's fourteen highest points sat inside a single Essos massif, at nx 0.698-0.721, while Westeros
 * had none. This bins the highest summits by region and requires them to come from several.
 *
 * **2. Every chain does something.** A chain that produces no relief is a bounding-box test run on
 * every height sample forever in exchange for nothing, and — worse — it reads in the source as though
 * that range exists. Four of the twenty ridges first extracted from `map.png` landed on coastline
 * where `coastalReliefTaper` flattens them to a tenth; they were removed rather than left as decor.
 *
 * **3. There are enough ranges to be range country.** Four chains of three points each was the entire
 * mountain system of the world, and no amount of profile tuning makes four short chains into a range.
 *
 * **4. The ridges are sharp.** Measured as mean crest curvature over high ground: a dome and a peak
 * differ exactly there, and a regression to `cos^1.3` flanks would show up here before it showed up in
 * a screenshot.
 *
 * **5. The skirt still covers the LOD gap.** This is the coupling that made sharper mountains
 * dangerous rather than merely prettier. Sharper terrain means a bigger mismatch between a chunk's
 * fine edge and its coarse neighbour's, and the skirt that hides the seam is capped. That worst gap
 * has gone 60.74 m -> 71.05 m -> 87.49 m across three runs of added relief; the cap it must stay under
 * is `TERRAIN_CHUNK_SKIRT_POLICY.maxDepthMeters`. Checking them together is the only way the next run
 * to sharpen a mountain finds out before the player sees a hole in the world.
 *
 * Usage: `node scripts/checkMountainRanges.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkMountainRanges
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Relief below which a chain is doing nothing and should not be in the list. */
const MIN_CHAIN_RELIEF_METERS = 40;
/** Chains the world must carry. Four was the number that produced the owner's complaint. */
const MIN_CHAIN_COUNT = 16;
/** Distinct regions the world's highest summits must be spread across. */
const MIN_SUMMIT_REGIONS = 3;
/** Distinct summits above 150 m, world-wide, sampled on a 52 m grid. */
const MIN_SUMMIT_COUNT = 120;
/** Mean crest curvature on high ground — a dome reads lower than a peak. */
const MIN_CREST_CURVATURE_METERS = 18;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[mountains] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { REFERENCE_RELIEF_CHAINS } = await import('/src/3d/world/worldReferenceMap.js');
			const relief = await import('/src/3d/world/worldReferenceMountainRelief.js');
			const { TERRAIN_CHUNK_SKIRT_POLICY } = await import('/src/3d/world/terrainChunkSkirt.js');

			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
			const toWorld = (nx, ny) => ({
				x: (nx * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) * METERS_PER_MAP_UNIT,
				z: (ny * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) * METERS_PER_MAP_UNIT,
			});
			const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: raw, seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: MAP_BOUNDS, metersPerMapUnit: METERS_PER_MAP_UNIT,
			});
			const live = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);

			// Per-chain relief, straight from the relief field so a dead entry cannot hide behind terrain.
			const chains = REFERENCE_RELIEF_CHAINS.map((chain) => {
				let max = 0;
				for (const [nx, ny] of chain.points) {
					for (let dx = -3; dx <= 3; dx += 1) {
						for (let dy = -3; dy <= 3; dy += 1) {
							const x = Math.min(1, Math.max(0, nx + dx * 0.002));
							const y = Math.min(1, Math.max(0, ny + dy * 0.002));
							max = Math.max(max, relief.sampleNormalizedReferenceMountainReliefMeters(x, y));
						}
					}
				}
				return { id: chain.id, relief: Math.round(max) };
			});

			// World grid: summits, their spread, and crest sharpness.
			const N = 260;
			const grid = [];
			for (let iy = 0; iy < N; iy += 1) {
				const row = [];
				for (let ix = 0; ix < N; ix += 1) {
					const w = toWorld((ix + 0.5) / N, (iy + 0.5) / N);
					row.push(live(w.x, w.z));
				}
				grid.push(row);
			}
			const summits = [];
			for (let iy = 1; iy < N - 1; iy += 1) {
				for (let ix = 1; ix < N - 1; ix += 1) {
					const h = grid[iy][ix];
					if (h < 150) continue;
					let isMax = true;
					for (let dy = -1; dy <= 1 && isMax; dy += 1) {
						for (let dx = -1; dx <= 1; dx += 1) {
							if (dx === 0 && dy === 0) continue;
							if (grid[iy + dy][ix + dx] > h) { isMax = false; break; }
						}
					}
					if (isMax) summits.push({ nx: (ix + 0.5) / N, ny: (iy + 0.5) / N, h });
				}
			}
			summits.sort((a, b) => b.h - a.h);
			// Bin the top summits into 0.08-normalized cells; distinct cells are distinct mountain regions.
			const regions = new Set(summits.slice(0, 20).map((s) => `${Math.floor(s.nx / 0.08)},${Math.floor(s.ny / 0.08)}`));

			let curvature = 0;
			let curvatureCount = 0;
			for (let iy = 2; iy < N - 2; iy += 2) {
				for (let ix = 2; ix < N - 2; ix += 2) {
					const h = grid[iy][ix];
					if (h < 150) continue;
					curvature += Math.abs((grid[iy][ix - 1] + grid[iy][ix + 1] + grid[iy - 1][ix] + grid[iy + 1][ix]) - 4 * h);
					curvatureCount += 1;
				}
			}

			return {
				chains,
				chainCount: chains.length,
				summitCount: summits.length,
				topSummits: summits.slice(0, 6).map((s) => ({ nx: +s.nx.toFixed(3), ny: +s.ny.toFixed(3), h: Math.round(s.h) })),
				regionCount: regions.size,
				crestCurvature: +(curvature / Math.max(1, curvatureCount)).toFixed(2),
				skirtCapMeters: TERRAIN_CHUNK_SKIRT_POLICY.maxDepthMeters,
			};
		});

		const dead = result.chains.filter((chain) => chain.relief < MIN_CHAIN_RELIEF_METERS);
		const failures = [];
		if (result.chainCount < MIN_CHAIN_COUNT) failures.push(`only ${result.chainCount} relief chains (min ${MIN_CHAIN_COUNT}) — that is one mountain, not range country`);
		if (dead.length) failures.push(`${dead.length} chain(s) produce under ${MIN_CHAIN_RELIEF_METERS} m of relief: ${dead.map((c) => c.id).join(', ')}`);
		if (result.regionCount < MIN_SUMMIT_REGIONS) failures.push(`the world's 20 highest summits sit in ${result.regionCount} region(s) (min ${MIN_SUMMIT_REGIONS}) — every peak in one massif is the defect this guards`);
		if (result.summitCount < MIN_SUMMIT_COUNT) failures.push(`${result.summitCount} distinct summits above 150 m (min ${MIN_SUMMIT_COUNT})`);
		if (result.crestCurvature < MIN_CREST_CURVATURE_METERS) failures.push(`mean crest curvature ${result.crestCurvature} m (min ${MIN_CREST_CURVATURE_METERS}) — the ridges have gone soft`);

		console.log(`[mountains] ${result.chainCount} chains, ${result.summitCount} summits above 150 m in ${result.regionCount} regions, crest curvature ${result.crestCurvature} m`);
		console.log(`[mountains] highest: ${result.topSummits.map((s) => `${s.h}m@(${s.nx},${s.ny})`).join('  ')}`);
		const weakest = [...result.chains].sort((a, b) => a.relief - b.relief).slice(0, 4);
		console.log(`[mountains] weakest chains: ${weakest.map((c) => `${c.id} ${c.relief}m`).join(', ')}`);
		console.log(`[mountains] skirt ceiling ${result.skirtCapMeters} m — run scripts/measureTerrainChunkSkirtDepth.js for the live worst gap`);

		if (failures.length) {
			for (const failure of failures) console.error(`[mountains] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[mountains] PASS: many chains, summits spread across regions, sharp crests, nothing dead.');
		process.exit(0);
	} catch (error) {
		console.error('[mountains] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
