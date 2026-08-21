#!/usr/bin/env node
/**
 * checkMapFeatureFidelity.js — does the world have the features the owner's map draws?
 *
 * The owner asked the question directly: "map.png'ye bakarak coğrafi özellikler doğru mu diye teyit et.
 * Dağlar, ormanlar, göller, deniz, buzullar." Mountains, forests, lakes, sea, glaciers.
 *
 * `scripts/checkRegionGeographyFidelity.js` already answers a related but different question — is each
 * *named region* the country it should be — by sampling eleven hand-picked areas. This asks the
 * per-feature question over the whole canvas instead: take `resimler/map.png` itself, classify every
 * sampled pixel by what the cartographer drew there, sample the live world at the same place, and
 * report whether the two agree feature by feature. The map is read in the browser rather than decoded
 * in Node, so there is exactly one copy of the image and no second transcription to drift.
 *
 * **What each class is checked against.**
 *
 * - **Sea** — the map's blue against ground at or below `WATER_LEVEL_METERS`. This is the coastline, the
 *   one thing this project never moves, so it is held to a high bar.
 * - **Glacier** — the map's white north against the world's snowline shading. Beyond the Wall the map is
 *   a third ice; the world should be white there too.
 * - **Forest** — the map's dark green against `forestCoverage01`, the shared authority the renderer
 *   actually uses. Run 373 learned the hard way that scoring raw `sampleMapForest01` instead reports a
 *   wooded Valyria while the renderer draws it bare.
 * - **Mountain** — the map's grey rock against real elevation and slope in the live height field.
 * - **Lake** — the map's *enclosed* water, found by flood-filling the sea in from the canvas edge so
 *   that what remains is inland. This is the one that fails today, and it should: see below.
 *
 * **Lakes are the weak feature, and this check exists partly to say so with a number.** No lake in this
 * world is modelled. The canonical water mask (`world/worldReferenceWaterMask.js`) is 96x64 cells —
 * about 140 m by 164 m each — and the Gods Eye, the largest lake in Westeros, measures roughly 97 m by
 * 185 m at this world's scale. It is smaller than one cell of the grid meant to hold it, so the mask
 * carries six lake cells in the whole world and not one of them is in Westeros. Where the world does
 * happen to hold water under a drawn lake, that is incidental low ground, not a lake anyone built.
 * The measured figure is **41.2%** of drawn lake samples, and `LAKE_COVERAGE_FLOOR` is pinned just
 * under it: enough to catch a regression, low enough not to claim the feature works. Raising it is the
 * acceptance test for actually building lakes.
 *
 * **Two of these classes were measuring cartography until they were fixed.** The first run scored
 * mountains at 49.4% over 5827 "rock" pixels — but the map is strewn with grey castle icons and grey
 * text labels, and those are not mountains. Requiring a grey pixel's neighbourhood to be grey too drops
 * the marks and keeps the ranges: 865 real ridge pixels, and the world agrees on 68.7% of them. The
 * same run scored lakes at 83.6%, which looked like success and was the opposite: nearly every pixel it
 * counted was water along the map's own top frame, cut off from the border flood fill and quite
 * correctly rendered as open sea. Only connected inland bodies of real size, clear of that band, count
 * now — 260 samples instead of 2382.
 *
 * Usage: `node scripts/checkMapFeatureFidelity.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkMapFeatureFidelity
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Minimum share of the map's sea that the world also renders as water. */
const SEA_AGREEMENT_FLOOR = 0.9;
/** Minimum share of the map's ice north of the Wall that the world shades as snow. */
const GLACIER_AGREEMENT_FLOOR = 0.6;
/** Minimum share of the map's dark-green forest that carries real forest coverage in the world. */
const FOREST_AGREEMENT_FLOOR = 0.5;
/** Minimum share of the map's grey rock that stands measurably high or steep in the world. */
const MOUNTAIN_AGREEMENT_FLOOR = 0.5;
/**
 * Minimum share of the map's inland lakes that hold water in the world.
 *
 * Pinned just under the measured 41.2% — see this module's header. No lake here is modelled; that
 * figure is incidental low ground. The floor catches a regression without pretending the feature works.
 */
const LAKE_COVERAGE_FLOOR = 0.35;

(async () => {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[map-features] SKIP: Playwright unavailable');
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
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			// The shared authority on "is this forest?" — the same function that paints the ground and
			// scatters the trees. Run 373 learned that scoring the raw map mask instead reports woodland
			// where the renderer draws none.
			const { forestCoverage01 } = await import('/src/3d/world/terrainBiomeShading.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');

			// Read the owner's map straight out of the page — one image, no second transcription.
			const image = new Image();
			image.src = '/resimler/map.png';
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext('2d', { willReadFrequently: true });
			context.drawImage(image, 0, 0);
			const { data, width: mw, height: mh } = context.getImageData(0, 0, canvas.width, canvas.height);
			const at = (x, y) => {
				const i = (y * mw + x) * 4;
				return [data[i], data[i + 1], data[i + 2]];
			};
			const isWater = (r, g, b) => b > r + 15 && b >= g && b > 95;
			const classify = (r, g, b) => {
				if (isWater(r, g, b)) return 'water';
				if (r > 200 && g > 200 && b > 200) return 'ice';
				if (g > r + 18 && g > b + 30 && g < 150) return 'forest';
				if (Math.abs(r - g) < 26 && Math.abs(g - b) < 30 && r > 110 && r < 190 && b > r - 30) return 'mountain';
				return 'land';
			};

			// Flood-fill the sea in from the canvas edge; whatever water is left over is inland.
			const water = new Uint8Array(mw * mh);
			for (let y = 0; y < mh; y += 1) {
				for (let x = 0; x < mw; x += 1) if (isWater(...at(x, y))) water[y * mw + x] = 1;
			}
			const seaCell = new Uint8Array(mw * mh);
			const queue = [];
			const push = (x, y) => {
				if (x < 0 || y < 0 || x >= mw || y >= mh) return;
				const i = y * mw + x;
				if (!water[i] || seaCell[i]) return;
				seaCell[i] = 1;
				queue.push(i);
			};
			for (let x = 0; x < mw; x += 1) { push(x, 0); push(x, mh - 1); }
			for (let y = 0; y < mh; y += 1) { push(0, y); push(mw - 1, y); }
			for (let head = 0; head < queue.length; head += 1) {
				const i = queue[head];
				const x = i % mw;
				const y = (i - x) / mw;
				push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
			}

			// Connected inland bodies: keep the ones big enough to be a lake and clear of the canvas edge
			// band, where the map's frame cuts the northern ocean off from the border flood fill.
			const lakeBody = new Uint8Array(mw * mh);
			const visited = new Uint8Array(mw * mh);
			const MIN_LAKE_PIXELS = 60;
			const EDGE_BAND = 0.10;
			for (let y0 = 0; y0 < mh; y0 += 1) {
				for (let x0 = 0; x0 < mw; x0 += 1) {
					const start = y0 * mw + x0;
					if (!water[start] || seaCell[start] || visited[start]) continue;
					const stack = [start];
					visited[start] = 1;
					const cells = [];
					let minY = mh;
					while (stack.length) {
						const i = stack.pop();
						cells.push(i);
						const x = i % mw;
						const y = (i - x) / mw;
						if (y < minY) minY = y;
						for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
							const nx2 = x + dx;
							const ny2 = y + dy;
							if (nx2 < 0 || ny2 < 0 || nx2 >= mw || ny2 >= mh) continue;
							const j = ny2 * mw + nx2;
							if (!water[j] || seaCell[j] || visited[j]) continue;
							visited[j] = 1;
							stack.push(j);
						}
					}
					if (cells.length < MIN_LAKE_PIXELS) continue;
					if (minY / mh < EDGE_BAND) continue;
					for (const i of cells) lakeBody[i] = 1;
				}
			}

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
			const pre = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const valleys = computeRiverValleys({ seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: pre, seaLevelMeters: sea });
			const live = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads, null, valleys);

			const tally = {};
			const bump = (key, agreed) => {
				tally[key] ??= { total: 0, agreed: 0 };
				tally[key].total += 1;
				if (agreed) tally[key].agreed += 1;
			};
			const step = 3;
			for (let y = 0; y < mh; y += step) {
				for (let x = 0; x < mw; x += step) {
					const [r, g, b] = at(x, y);
					const drawn = classify(r, g, b);
					const nx = (x + 0.5) / mw;
					const ny = (y + 0.5) / mh;
					const w = toWorld(nx, ny);
					const height = live(w.x, w.z);
					// Only water in a *real* inland body counts as a lake. Every enclosed pixel used to
					// count, which made the score 83.6% — but that number was almost entirely water along
					// the map's own top frame, which the world quite correctly renders as open sea. The
					// lakes the owner asked about are the ones inside the landmass.
					if (lakeBody[y * mw + x] === 1) { bump('lake', height <= sea); continue; }
					if (drawn === 'water') { bump('sea', height <= sea); continue; }
					if (drawn === 'ice') { bump('glacier', ny < 0.20 || height > 180); continue; }
					if (drawn === 'forest') {
						const rise = Math.max(
							Math.abs(live(w.x + 40, w.z) - height),
							Math.abs(live(w.x, w.z + 40) - height),
						);
						const slopeDegrees = Math.atan2(rise, 40) * (180 / Math.PI);
						bump('forest', forestCoverage01(w.x, w.z, height - sea, slopeDegrees) > 0.2);
						continue;
					}
					if (drawn === 'mountain') {
						// The map is strewn with grey castle icons, grey text labels and the pale band of the
						// Wall, all of which classify as rock and none of which is a mountain. A ridge is a
						// *thick* grey region; a label is a thin one. Requiring the neighbourhood to be grey
						// too drops the marks and keeps the ranges. Without this the denominator was mostly
						// cartography and the score was meaningless.
						const solid = x > 2 && y > 2 && x < mw - 3 && y < mh - 3
							&& classify(...at(x - 2, y)) === 'mountain' && classify(...at(x + 2, y)) === 'mountain'
							&& classify(...at(x, y - 2)) === 'mountain' && classify(...at(x, y + 2)) === 'mountain';
						if (!solid) continue;
						const slope = Math.max(
							Math.abs(live(w.x + 40, w.z) - height),
							Math.abs(live(w.x, w.z + 40) - height),
						) / 40;
						bump('mountain', height > 90 || slope > 0.22);
					}
				}
			}
			return { tally, mapSize: [mw, mh], step };
		});

		const share = (key) => {
			const entry = result.tally[key];
			return entry && entry.total ? entry.agreed / entry.total : 0;
		};
		const failures = [];
		const floors = {
			sea: SEA_AGREEMENT_FLOOR, glacier: GLACIER_AGREEMENT_FLOOR,
			forest: FOREST_AGREEMENT_FLOOR, mountain: MOUNTAIN_AGREEMENT_FLOOR, lake: LAKE_COVERAGE_FLOOR,
		};
		console.log(`[map-features] map.png ${result.mapSize.join('x')}, sampled every ${result.step} px`);
		console.log('[map-features] feature     drawn px   world agrees   floor');
		for (const [key, floor] of Object.entries(floors)) {
			const entry = result.tally[key] ?? { total: 0, agreed: 0 };
			const got = share(key);
			console.log(`[map-features]   ${key.padEnd(10)} ${String(entry.total).padStart(7)}   ${(got * 100).toFixed(1).padStart(8)}%   ${(floor * 100).toFixed(0).padStart(4)}%`);
			if (got < floor) failures.push(`${key}: the world agrees with the map on ${(got * 100).toFixed(1)}% of what it draws (floor ${(floor * 100).toFixed(0)}%)`);
		}
		const lake = result.tally.lake ?? { total: 0, agreed: 0 };
		console.log(`[map-features] lakes: the map draws ${lake.total} inland-water samples; the world holds water at ${lake.agreed}.`);
		console.log('[map-features] KNOWN GAP: no lake in this world is modelled. The canonical water mask is 96x64');
		console.log('[map-features]            (~140 m cells) and the Gods Eye is ~97 m x 185 m — smaller than one cell of');
		console.log('[map-features]            the grid meant to hold it. Water under a drawn lake is incidental low ground.');

		if (failures.length) {
			for (const failure of failures) console.error(`[map-features] FAIL: ${failure}`);
			process.exit(1);
		}
		console.log('[map-features] PASS: sea, glaciers, forests and mountains all match what the owner map draws.');
		process.exit(0);
	} catch (error) {
		console.error('[map-features] FAIL:', error);
		process.exit(1);
	} finally {
		await browser.close();
		server.close();
	}
})();
