#!/usr/bin/env node
/**
 * checkGroundColorVariety.js — guards that the world's regions do not all look the same.
 *
 * The owner: "map.png'ye bakarak zemin renk palet çeşitliliğini arttıralım ama gerçek coğrafi renkler
 * olsun ve renkleri hem gerçekçi hem de map.png ile uyumlu hale getirelim." Three requirements that
 * pull against each other — more variety, real geography, and agreement with the map — so this measures
 * the first two and leaves the third to `checkRegionGeographyFidelity.js`, which already owns it.
 *
 * **Variety is measured as mean pairwise colour distance between regions.** Not as "is there more than
 * one colour in the world": there always was, because altitude and slope alone produce grass, rock and
 * snow. The complaint was that *places* looked alike — that the Reach, the Westerlands, the Dothraki
 * Sea and Yi Ti were one olive. So the metric compares regions to each other, sampling a patch of land
 * in each and averaging what the shading resolves.
 *
 * **This number is what rejected the first implementation**, which blended each vertex toward its local
 * map colour. That reads as the obvious way to "use the map's colours", and it measured 39.4 against a
 * 40.1 baseline: the map is a pale, evenly-inked painting whose land averages (163,166,126), so
 * blending toward it drags every region to one parchment tone. Taking the map colour as a *ratio* to
 * its own land mean instead scores 47.7. Without a number, the wrong version would have shipped —
 * it does use map.png's colours, it just makes the world more uniform rather than less.
 *
 * Usage: `node scripts/checkGroundColorVariety.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkGroundColorVariety
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/**
 * Minimum mean pairwise distance, in 0-255 RGB, between the sampled regions' mean ground colours.
 *
 * The measured baseline with no map colour at all is 40.1 and the shipped value is 47.7. 43 sits above
 * the baseline — so this cannot pass by simply deleting the feature — with room for the shading
 * thresholds to be re-tuned without a false alarm.
 */
const MIN_MEAN_PAIRWISE_DISTANCE = 43;
/** No two distinct regions may be closer than this: it catches two regions collapsing onto each other. */
const MIN_ANY_PAIRWISE_DISTANCE = 3;

/** Land patches, one per region, chosen inside each region rather than on its border. */
const REGIONS = [
	{ id: 'north', nx: 0.175, ny: 0.285 },
	{ id: 'reach', nx: 0.155, ny: 0.585 },
	{ id: 'dorne', nx: 0.180, ny: 0.665 },
	{ id: 'westerlands', nx: 0.135, ny: 0.505 },
	{ id: 'dothraki-sea', nx: 0.545, ny: 0.535 },
	{ id: 'yi-ti', nx: 0.790, ny: 0.705 },
];

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[ground-colour] SKIP: Playwright unavailable');
		process.exit(2);
	}
	const server = await startStaticServer();
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async (regions) => {
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

			return regions.map((region) => {
				let count = 0;
				let r = 0;
				let g = 0;
				let b = 0;
				for (let dx = -4; dx <= 4; dx += 1) {
					for (let dy = -4; dy <= 4; dy += 1) {
						const world = toWorld(region.nx + dx * 0.004, region.ny + dy * 0.004);
						const surface = { rockWeight: 0, snowWeight: 0, waterWeight: 0 };
						const height = live(world.x, world.z, undefined, surface);
						if (height <= sea) continue;
						resolveTerrainBiomeColor(colour, {
							heightAboveSeaMeters: height - sea,
							slopeDegrees: 4,
							rockWeight: surface.rockWeight,
							snowWeight: surface.snowWeight,
							worldX: world.x, worldZ: world.z,
						});
						r += colour.r; g += colour.g; b += colour.b; count += 1;
					}
				}
				return count
					? { id: region.id, rgb: [Math.round(r / count * 255), Math.round(g / count * 255), Math.round(b / count * 255)], samples: count }
					: { id: region.id, rgb: null, samples: 0 };
			});
		}, REGIONS);

		const measured = result.filter((region) => region.rgb);
		const distances = [];
		let closest = { distance: Infinity, pair: '' };
		for (let i = 0; i < measured.length; i += 1) {
			for (let j = i + 1; j < measured.length; j += 1) {
				const a = measured[i].rgb;
				const b = measured[j].rgb;
				const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
				distances.push(distance);
				if (distance < closest.distance) closest = { distance, pair: `${measured[i].id} / ${measured[j].id}` };
			}
		}
		const mean = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);

		const failures = [];
		if (measured.length < REGIONS.length) {
			failures.push(`only ${measured.length} of ${REGIONS.length} regions had land to sample`);
		}
		if (mean < MIN_MEAN_PAIRWISE_DISTANCE) {
			failures.push(`regions average ${mean.toFixed(1)} apart in colour (min ${MIN_MEAN_PAIRWISE_DISTANCE}) — the world is reading as one palette again`);
		}
		if (closest.distance < MIN_ANY_PAIRWISE_DISTANCE) {
			failures.push(`${closest.pair} are ${closest.distance.toFixed(1)} apart — two regions have collapsed onto the same colour`);
		}

		for (const region of measured) console.log(`[ground-colour] ${region.id.padEnd(14)} rgb(${region.rgb.join(',')}) over ${region.samples} land samples`);
		console.log(`[ground-colour] mean pairwise distance ${mean.toFixed(1)} (min ${MIN_MEAN_PAIRWISE_DISTANCE}); closest ${closest.pair} at ${closest.distance.toFixed(1)}`);

		if (failures.length) {
			for (const failure of failures) console.error(`[ground-colour] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[ground-colour] PASS: the regions of the world are told apart by their ground colour.');
		process.exit(0);
	} catch (error) {
		console.error('[ground-colour] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
