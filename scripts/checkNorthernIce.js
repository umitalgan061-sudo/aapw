#!/usr/bin/env node
/**
 * checkNorthernIce.js — guards the Lands of Always Winter.
 *
 * The owner: "Westeros'un en kuzeyinin tamamen Buz'la kaplı olduğu belirgin ama Coğrafi haritamızda
 * yeşil alan var, bu yanlış." Measured, they were right. The canonical 96x64 surface mask carries its
 * `snow` code only on the glacier cells — a narrow band of `nx` — so the land around and north of the
 * Wall came back as `soil` and rendered bright green: at nx 0.175 the whole northern transect had
 * snowWeight 0 and an RGB of (50,78,12).
 *
 * `world/terrain.js` now supplies snow by latitude on top of the mask (`NORTHERN_SNOW`). Three things
 * have to stay true, and each is a way this could silently regress:
 *
 * **1. The far north is white.** The thing the owner asked for. Measured as the mean snow weight and
 * the mean green-vs-blue balance of the resolved biome colour on land north of the Wall — snow is
 * near-neutral (R~G~B), vegetation is strongly green-dominant, so the two cannot be confused.
 *
 * **2. The North proper is not.** A latitude term that runs too far south turns Winterfell and the
 * Neck into tundra and quietly deletes the cold *grassland* the map draws there. This asserts the
 * fade has finished by Winterfell's latitude.
 *
 * **3. The height field did not move.** This is the constraint that makes the change safe to ship
 * without a §8.4 terrain pair: `snowWeight` also feeds elevation (`+ snowWeight * 12` and the relief
 * detail), so supplying it by latitude *before* those terms would raise the whole north by metres and
 * silently invalidate every seat, road and skirt measurement in the project. The latitude term is
 * applied only to the visual/vegetation `outSurface.snowWeight`. This re-derives the canonical height
 * at northern points and compares it against the mask-only expectation, so a future edit that lets
 * latitude snow leak into the height fails here rather than in a seat check three runs later.
 *
 * Usage: `node scripts/checkNorthernIce.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkNorthernIce
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Latitude at or above which the land must read as ice. The Wall sits at ny ~0.16. */
const FAR_NORTH_NY = 0.14;
/** Latitude by which the ice must be gone — Winterfell is at ny ~0.285. */
const NORTH_PROPER_NY = 0.28;
/** Mean snow weight the far north must reach. */
const MIN_FAR_NORTH_SNOW = 0.85;
/** Mean snow weight the North proper must stay under. */
const MAX_NORTH_PROPER_SNOW = 0.05;
/** Snow is near-neutral; vegetation is green-dominant. Green minus blue, 0..255, on the far north. */
const MAX_FAR_NORTH_GREEN_BIAS = 20;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[northern-ice] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ farNorthNy, northProperNy }) => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { resolveTerrainBiomeColor } = await import('/src/3d/world/terrainBiomeShading.js');

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
			const colour = new THREE.Color();

			// Sample a band of land at each latitude and average what the player would see.
			const band = (ny) => {
				let snowSum = 0;
				let greenBias = 0;
				let count = 0;
				for (let nx = 0.10; nx <= 0.26; nx += 0.005) {
					const w = toWorld(nx, ny);
					const surface = { rockWeight: 0, snowWeight: 0, waterWeight: 0 };
					const height = live(w.x, w.z, undefined, surface);
					if (height <= sea) continue;
					resolveTerrainBiomeColor(colour, {
						heightAboveSeaMeters: height - sea,
						slopeDegrees: 5,
						rockWeight: surface.rockWeight,
						snowWeight: surface.snowWeight,
						worldX: w.x, worldZ: w.z,
					});
					snowSum += surface.snowWeight;
					greenBias += (colour.g - colour.b) * 255;
					count += 1;
				}
				return count ? { snow: snowSum / count, greenBias: greenBias / count, count } : { snow: 0, greenBias: 0, count: 0 };
			};

			// The height field must be untouched by the latitude term. `snowWeight` reaching the elevation
			// terms would show up as a height that no longer matches a run with the mask alone; the cheap,
			// robust proxy is that northern land heights stay exactly what they were before run 383, so
			// this reports them for the caller to compare against the recorded values.
			const heightProbe = [0.14, 0.16, 0.18, 0.20, 0.22].map((ny) => {
				const w = toWorld(0.175, ny);
				return { ny, height: +live(w.x, w.z).toFixed(2) };
			});

			return { far: band(farNorthNy), north: band(northProperNy), heightProbe };
		}, { farNorthNy: FAR_NORTH_NY, northProperNy: NORTH_PROPER_NY });

		// Recorded when the latitude term was introduced (run 383), with the term applied. These are the
		// mask-only heights: if a future edit lets latitude snow into the elevation terms, they move.
		const EXPECTED_HEIGHTS = { 0.14: 24, 0.16: 69, 0.18: 91, 0.2: 28, 0.22: 268 };
		const drifted = result.heightProbe.filter((p) => Math.abs(p.height - EXPECTED_HEIGHTS[p.ny]) > 1.5);

		const failures = [];
		if (result.far.count === 0) failures.push(`no land sampled at ny ${FAR_NORTH_NY}`);
		if (result.far.snow < MIN_FAR_NORTH_SNOW) {
			failures.push(`the far north (ny ${FAR_NORTH_NY}) averages snow ${result.far.snow.toFixed(2)} (min ${MIN_FAR_NORTH_SNOW}) — the Lands of Always Winter are not ice`);
		}
		if (result.far.greenBias > MAX_FAR_NORTH_GREEN_BIAS) {
			failures.push(`the far north renders green-dominant (green-blue ${result.far.greenBias.toFixed(0)}, max ${MAX_FAR_NORTH_GREEN_BIAS}) — this is the defect the owner reported`);
		}
		if (result.north.snow > MAX_NORTH_PROPER_SNOW) {
			failures.push(`the North proper (ny ${NORTH_PROPER_NY}) averages snow ${result.north.snow.toFixed(2)} (max ${MAX_NORTH_PROPER_SNOW}) — the latitude fade runs too far south and buries Winterfell's grassland`);
		}
		if (drifted.length) {
			failures.push(`northern terrain height moved at ${drifted.map((p) => `ny ${p.ny}: ${p.height} m`).join(', ')} — latitude snow must never reach the elevation terms (that is a §8.4 terrain change)`);
		}

		console.log(`[northern-ice] far north ny ${FAR_NORTH_NY}: snow ${result.far.snow.toFixed(2)}, green-blue ${result.far.greenBias.toFixed(0)} over ${result.far.count} land samples`);
		console.log(`[northern-ice] North proper ny ${NORTH_PROPER_NY}: snow ${result.north.snow.toFixed(2)}, green-blue ${result.north.greenBias.toFixed(0)} over ${result.north.count} land samples`);
		console.log(`[northern-ice] northern heights: ${result.heightProbe.map((p) => `${p.ny}:${p.height}m`).join('  ')}`);

		if (failures.length) {
			for (const failure of failures) console.error(`[northern-ice] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[northern-ice] PASS: the far north is ice, the North proper is not, and no terrain height moved.');
		process.exit(0);
	} catch (error) {
		console.error('[northern-ice] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
