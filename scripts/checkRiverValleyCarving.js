#!/usr/bin/env node
/**
 * checkRiverValleyCarving.js — regression guard for run 360 / ADR-0307's river valley carving.
 *
 * Asserts the four properties the module's header commits to:
 *
 *   1. **There is actually a valley.** Ground on the river centreline must sit measurably below the
 *      terrain the same field produces without carving. If this goes to zero the river is back to
 *      lying on top of a plain.
 *   2. **It has a floor, banks and a rim.** Height must be flat across the floodplain, rise across the
 *      banks, and be *byte-identical* to uncarved terrain beyond the rim — this is a landform, not a
 *      world-wide lowering.
 *   3. **It never turns canonical land into water.** The coastline from map.png is the one thing this
 *      project does not move; a carve that dipped below sea level on dry land would invent water the
 *      owner map does not have.
 *   4. **It only cuts down.** The field may never raise ground above what the height field asked for.
 *
 * Usage: `node scripts/checkRiverValleyCarving.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkRiverValleyCarving
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** The centreline must be at least this far below uncarved terrain somewhere along the river. */
const MIN_MAX_CUT_METERS = 5;

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys, TERRAIN_VALLEY_POLICY } = await import('/src/3d/world/terrainValleyCarving.js');

			const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const flattenPads = computeSettlementFlattenPads({
				sampleHeightMeters: base,
				seaLevelMeters: seaLevel,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const uncarved = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
			const valleyField = computeRiverValleys({
				seed: WORLD_DEFAULTS.WORLD_SEED,
				baseSampleHeightMeters: uncarved,
				seaLevelMeters: seaLevel,
			});
			const carved = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads, null, valleyField);
			const points = valleyField.riverPoints;
			// Every river the field actually carves — the primary plus the map's named rivers. The
			// rim-leak invariant below is measured against all of them; see the note at its own site.
			const centrelines = [points, ...(valleyField.namedRivers ?? []).map((river) => river.points)];

			// Walk both banks at a spread of offsets, all along the river.
			const beyondRim = TERRAIN_VALLEY_POLICY.rimHalfWidthMouthMeters + 120;
			let maxCut = 0;
			let landTurnedToWater = 0;
			let raisedGround = 0;
			let touchedBeyondRim = 0;
			let samples = 0;
			for (let i = 1; i < points.length - 1; i += 1) {
				const previous = points[i - 1];
				const next = points[i + 1];
				const dx = next.x - previous.x;
				const dz = next.z - previous.z;
				const length = Math.hypot(dx, dz) || 1;
				for (const distance of [0, 30, 80, 150, 300, beyondRim]) {
					for (const side of [1, -1]) {
						const x = points[i].x + (-dz / length) * distance * side;
						const z = points[i].z + (dx / length) * distance * side;
						const before = uncarved(x, z);
						const after = carved(x, z);
						samples += 1;
						maxCut = Math.max(maxCut, before - after);
						if (after > before + 1e-9) raisedGround += 1;
						if (before > seaLevel && after <= seaLevel) landTurnedToWater += 1;
						// A perpendicular offset from one point can still land inside a *different* bend's
						// valley, because the river meanders — so the invariant is about true distance to
						// the nearest centreline point, not about the offset used to generate the sample.
						//
						// Run 376: "nearest centreline" means the nearest centreline of *any* river in the
						// field, not of the primary one. Once the map's named rivers began carving, this
						// walk — which follows the primary river — started passing within a named river's
						// own rim and scoring its perfectly legitimate valley as a rim leak: one sample at
						// (896, 1873), 347 m from the Skahazadhan and 540.4 m from the primary, cut 0.38 m
						// and failed the gate. The carve was correct; the measurement knew about one river
						// while the field carried eleven.
						if (Math.abs(after - before) > 1e-9) {
							let nearest = Infinity;
							for (const centreline of centrelines) {
								for (const point of centreline) nearest = Math.min(nearest, Math.hypot(x - point.x, z - point.z));
							}
							if (nearest > beyondRim) touchedBeyondRim += 1;
						}
					}
				}
			}

			// One representative cross-section, to prove the floor/bank/rim shape rather than just a dip.
			const mid = Math.floor(points.length * 0.75);
			const previous = points[mid - 1];
			const next = points[mid + 1];
			const dx = next.x - previous.x;
			const dz = next.z - previous.z;
			const length = Math.hypot(dx, dz) || 1;
			const section = [0, 50, 120, 250, 400].map((distance) => {
				const x = points[mid].x + (-dz / length) * distance;
				const z = points[mid].z + (dx / length) * distance;
				return { distance, before: uncarved(x, z), after: carved(x, z) };
			});

			return {
				riverPoints: points.length,
				segmentCount: valleyField.segmentCount,
				maxCut, landTurnedToWater, raisedGround, touchedBeyondRim, samples, section,
			};
		});

		const floor = result.section[0];
		const floodplain = result.section[1];
		const bank = result.section[3];
		const rim = result.section[4];
		const hasFloor = Math.abs(floor.after - floodplain.after) < 1.5;
		const hasBank = bank.after > floodplain.after + 5;
		const rimUntouched = Math.abs(rim.after - rim.before) < 1e-9;

		const ok = result.maxCut >= MIN_MAX_CUT_METERS &&
			result.landTurnedToWater === 0 &&
			result.raisedGround === 0 &&
			result.touchedBeyondRim === 0 &&
			hasFloor && hasBank && rimUntouched;

		if (!ok) {
			console.error('[river-valley] FAIL', JSON.stringify({ ...result, hasFloor, hasBank, rimUntouched }));
			process.exit(1);
		}
		console.log(
			`[river-valley] PASS: ${result.riverPoints}-point river / ${result.segmentCount} segments, deepest cut ` +
				`${result.maxCut.toFixed(1)} m over ${result.samples} samples; cross-section floor ` +
				`${floor.after.toFixed(1)}m flat to ${floodplain.distance}m, bank ${bank.after.toFixed(1)}m at ` +
				`${bank.distance}m, rim untouched at ${rim.distance}m (${rim.before.toFixed(2)}m both ways); ` +
				'no land turned to water, no ground raised, nothing touched beyond the rim.',
		);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[river-valley] FAIL: unexpected error:', error);
	process.exit(1);
});
