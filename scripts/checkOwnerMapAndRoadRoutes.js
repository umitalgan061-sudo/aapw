#!/usr/bin/env node
/**
 * checkOwnerMapAndRoadRoutes.js — guards the two things run 361 established.
 *
 * **1. The owner map is present and is the right file.** `resimler/map.png` is the source every
 * geography contract in `src/3d/world/worldReference*.js` derives from, and it was gitignored for the
 * whole project's life — so a fresh clone, which is what every remote session gets, had no copy of it
 * and no way to check anything against it. It is now committed and this check asserts its SHA-256
 * still matches `WORLD_REFERENCE_MAP.sha256`. If that ever diverges, every transcription in the
 * repository is describing a different picture than the one on disk.
 *
 * Note the file is a JPEG despite the `.png` name (baseline JPEG, 1536x1024, 3 components). That is
 * how the owner supplied it and how the 2D shell references it, so the name is left alone — but the
 * check asserts the real format so nobody later "fixes" the extension and breaks `style.css`.
 *
 * **2. The road routes read off it are sane.** For each route in
 * `world/worldReferenceRoadRoutes.js`: every waypoint is inside the map, the named seats exist, and —
 * the substantive one — every waypoint sits on canonical *land* per the same 96x64 surface mask the
 * terrain uses. A highway crossing open sea would mean a misread coordinate, and that is exactly the
 * failure a hand transcription is prone to.
 *
 * Usage: `node scripts/checkOwnerMapAndRoadRoutes.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkOwnerMapAndRoadRoutes
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
/** The path the running app actually loads: `style.css` and `index.html` both reference
 * `resimler/map.png`, so this copy is functional, not archival. */
const MAP_PATH = path.join(ROOT, 'resimler/map.png');
/** The owner also pushed the image to `map.png/map.png` (PR #792). Nothing loads that path, but it is
 * the owner's own upload so it stays; the check asserts the two copies have not drifted apart, which
 * is the only way a duplicated source of truth can hurt. */
const OWNER_UPLOAD_PATH = path.join(ROOT, 'map.png/map.png');
const EXPECTED_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
/** Water is allowed within this many normalized units of a waypoint — the coarse mask's own cell is
 * about 0.010 x 0.016, and a coastal road legitimately runs right along the shore. */
const COAST_TOLERANCE_CELLS = 1;

function checkMapFile() {
	if (!fs.existsSync(MAP_PATH)) {
		console.error(`[owner-map] FAIL: ${MAP_PATH} is missing. It is the source of every geography contract in this repo.`);
		return null;
	}
	const bytes = fs.readFileSync(MAP_PATH);
	const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
	const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	if (sha256 !== EXPECTED_SHA256) {
		console.error(`[owner-map] FAIL: checksum ${sha256} != WORLD_REFERENCE_MAP.sha256 ${EXPECTED_SHA256}`);
		return null;
	}
	if (!isJpeg) {
		console.error('[owner-map] FAIL: expected baseline JPEG bytes (the file is a JPEG despite its .png name)');
		return null;
	}
	let duplicateNote = '';
	if (fs.existsSync(OWNER_UPLOAD_PATH)) {
		const otherBytes = fs.readFileSync(OWNER_UPLOAD_PATH);
		// That copy is LFS-tracked (see .gitattributes), so in any checkout that has not run
		// `git lfs pull` it is a ~130-byte pointer rather than the image. Comparing a pointer's hash
		// against real JPEG bytes and calling the difference "drift" reports a transcription error
		// that did not happen -- the same false alarm RCA_RUN344 recorded for the model catalogue.
		// Only a hydrated copy can answer the question this check is asking.
		const isPointerStub = otherBytes.subarray(0, 40).toString('utf8').startsWith('version https://git-lfs');
		if (isPointerStub) {
			duplicateNote = '; map.png/map.png not hydrated (LFS pointer), duplicate comparison skipped';
		} else {
			const otherSha = crypto.createHash('sha256').update(otherBytes).digest('hex');
			if (otherSha !== sha256) {
				console.error(`[owner-map] FAIL: map.png/map.png (${otherSha.slice(0, 12)}…) has drifted from resimler/map.png (${sha256.slice(0, 12)}…)`);
				return null;
			}
			duplicateNote = '; map.png/map.png is byte-identical';
		}
	}
	console.log(`[owner-map] PASS: resimler/map.png present, ${bytes.length} bytes, JPEG, sha256 ${sha256.slice(0, 12)}… matches the contract${duplicateNote}.`);
	return true;
}

async function main() {
	if (!checkMapFile()) process.exit(1);

	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ coastToleranceCells }) => {
			const { KINGDOM_SEATS } = await import('/src/3d/world/settlements.js');
			const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { WORLD_REFERENCE_BASE_SURFACE_MASK } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
			const { REFERENCE_ROAD_ROUTES, expandRouteWaypoints, REFERENCE_ROAD_ROUTES_POLICY } =
				await import('/src/3d/world/worldReferenceRoadRoutes.js');

			const seatsById = new Map(KINGDOM_SEATS.map((seat) => [seat.id, {
				nx: seat.mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
				ny: seat.mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
			}]));

			// Decode the canonical land/sea mask once.
			const { width, height, bitsPerCell, rowsHex, codes } = WORLD_REFERENCE_BASE_SURFACE_MASK;
			const cellCodes = new Uint8Array(width * height);
			const totalBits = BigInt(width * bitsPerCell);
			const codeMask = (1n << BigInt(bitsPerCell)) - 1n;
			for (let y = 0; y < height; y += 1) {
				const row = BigInt(`0x${rowsHex[y]}`);
				for (let x = 0; x < width; x += 1) {
					cellCodes[y * width + x] = Number((row >> (totalBits - BigInt((x + 1) * bitsPerCell))) & codeMask);
				}
			}
			const isLandCell = (cx, cy) => {
				if (cx < 0 || cy < 0 || cx >= width || cy >= height) return false;
				const code = cellCodes[cy * width + cx];
				return code !== codes.sea && code !== codes.lake;
			};
			// Land if the waypoint's own cell, or any cell within tolerance, is land.
			const nearLand = (nx, ny) => {
				const cx = Math.floor(nx * width);
				const cy = Math.floor(ny * height);
				for (let dy = -coastToleranceCells; dy <= coastToleranceCells; dy += 1) {
					for (let dx = -coastToleranceCells; dx <= coastToleranceCells; dx += 1) {
						if (isLandCell(cx + dx, cy + dy)) return true;
					}
				}
				return false;
			};

			const routes = [];
			for (const route of REFERENCE_ROAD_ROUTES) {
				const points = expandRouteWaypoints(route, seatsById);
				const offMap = points.filter((p) => p.nx < 0 || p.nx > 1 || p.ny < 0 || p.ny > 1).length;
				// Sample *along* every segment, not only at its ends. Checking waypoints alone passed a
				// first revision whose opening leg ran from King's Landing straight across the Narrow Sea:
				// both endpoints were on land, and everything between them was open water.
				const overWater = [];
				for (let i = 1; i < points.length; i += 1) {
					const span = Math.hypot(points[i].nx - points[i - 1].nx, points[i].ny - points[i - 1].ny);
					const steps = Math.max(1, Math.ceil(span / 0.005));
					for (let step = 0; step <= steps; step += 1) {
						const t = step / steps;
						const nx = points[i - 1].nx + (points[i].nx - points[i - 1].nx) * t;
						const ny = points[i - 1].ny + (points[i].ny - points[i - 1].ny) * t;
						if (!nearLand(nx, ny)) overWater.push({ nx, ny });
					}
				}
				let lengthNormalized = 0;
				for (let i = 1; i < points.length; i += 1) {
					lengthNormalized += Math.hypot(points[i].nx - points[i - 1].nx, points[i].ny - points[i - 1].ny);
				}
				routes.push({
					id: route.id, kind: route.kind, from: route.from, to: route.to,
					pointCount: points.length,
					endpointsResolved: route.from || route.to
						? Boolean(seatsById.get(route.from) && seatsById.get(route.to))
						: true,
					offMap,
					overWaterCount: overWater.length,
					overWater: overWater.slice(0, 4).map((p) => `${p.nx.toFixed(3)},${p.ny.toFixed(3)}`),
					lengthNormalized,
				});
			}
			// The routes the game actually builds, on the real height field.
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeRiverValleys } = await import('/src/3d/world/terrainValleyCarving.js');
			const { routeReferenceRoads } = await import('/src/3d/world/worldReferenceRoadNetwork.js');
			const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const rawSampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: rawSampler,
				seaLevelMeters: seaLevel,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const preValley = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const valleyField = computeRiverValleys({
				seed: WORLD_DEFAULTS.WORLD_SEED, baseSampleHeightMeters: preValley, seaLevelMeters: seaLevel,
			});
			const liveSampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads, null, valleyField);
			const built = routeReferenceRoads({
				seats: KINGDOM_SEATS, sampleHeightMeters: liveSampler,
				mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			let wetRoutedPoints = 0;
			for (const road of built.routed) {
				for (const point of road.points) if (point.y <= seaLevel) wetRoutedPoints += 1;
			}

			return {
				routes, policy: REFERENCE_ROAD_ROUTES_POLICY, maskCells: `${width}x${height}`,
				builtCount: built.routed.length,
				droppedRoutes: built.droppedRoutes.map((r) => `${r.id} (${r.wetPoints} wet, ${r.deepestBelowSeaMeters.toFixed(1)} m under)`),
				wetRoutedPoints,
			};
		}, { coastToleranceCells: COAST_TOLERANCE_CELLS });

		let allOk = true;
		console.log(`[owner-map] route          kind       pts   length(norm)  endpoints  result`);
		for (const route of result.routes) {
			const ok = route.endpointsResolved && route.offMap === 0 && route.overWaterCount === 0 && route.pointCount >= 2;
			if (!ok) allOk = false;
			console.log(
				`[owner-map] ${route.id.padEnd(21)} ${route.kind.padEnd(9)} ${String(route.pointCount).padStart(3)}  ` +
					`${route.lengthNormalized.toFixed(3).padStart(11)}  ${route.endpointsResolved ? 'ok       ' : 'MISSING  '}  ` +
					`${ok ? 'PASS' : `FAIL (offMap=${route.offMap} overWater=${route.overWaterCount} e.g. [${route.overWater.join(' ')}])`}`,
			);
		}
		console.log(
			`[owner-map] ${allOk ? 'PASS' : 'FAIL'}: ${result.routes.length} canonical routes transcribed from the owner map ` +
				`(${result.policy.method}, +/-${result.policy.readingToleranceNormalized} normalized), every metre of every route on land ` +
				`per the ${result.maskCells} canonical surface mask.`,
		);
		if (result.wetRoutedPoints > 0) {
			allOk = false;
			console.error(`[owner-map] FAIL: ${result.wetRoutedPoints} routed road point(s) below sea level — roads must not run through water.`);
		}
		console.log(
			`[owner-map] ${result.builtCount} route(s) built on the live height field with ${result.wetRoutedPoints} point(s) ` +
				`below sea level` +
				`${result.droppedRoutes.length ? `; dropped for want of a dry path: ${result.droppedRoutes.join(', ')}` : ''}.`,
		);
		process.exit(allOk ? 0 : 1);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[owner-map] FAIL: unexpected error:', error);
	process.exit(1);
});
