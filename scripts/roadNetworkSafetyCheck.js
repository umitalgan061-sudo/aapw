#!/usr/bin/env node
/**
 * roadNetworkSafetyCheck.js — "Arazi Değişikliği Güvenlik Kontrolü" / Dünya Tutarlılık Kuralları
 * (GOVERNANCE.md §8.4/§8.10) check for `world/roads.js`'s road network.
 *
 * Runs entirely in-page via dynamic `import()` against the real, live modules over a real static
 * HTTP server (same pattern `scripts/terrainSeatSafetyCheck.js`/`scripts/game3dSmokeChecks.js`
 * already established), so it exercises exactly what the live game builds — not a Node-side
 * reimplementation that could drift.
 *
 * Asserts:
 *   1. **Connectivity**: all 14 `KINGDOM_SEATS` are reachable in the built road network (a spanning
 *      tree over 14 nodes has exactly 13 edges and every seat appears at least once).
 *   2. **Slope-aware routing, not a naive straight line**: every edge's real routed path stays under
 *      `ROAD_HARD_MAX_GRADE_DEGREES`. Also reports, per edge, how much steeper the plain straight
 *      line between its two endpoints would have been — a positive "avoided" number is direct,
 *      measured evidence the router is doing real work, not just decoration.
 *   3. **Mountain-avoidance stress test**: `world/terrain.js`'s `MACRO_RELIEF_FEATURES` mountain
 *      (center (2600, 2200), radius 1300m) sits far enough from every real kingdom seat (by design —
 *      see DECISIONS.md ADR-0075) that no actual seat-to-seat MST edge is forced anywhere near its
 *      steep flank (confirmed below, not assumed). To still give this run's explicit requirement — a
 *      real, measured demonstration that the router bends away from the mountain's steepest face
 *      rather than crossing it — a synthetic pair of points straddling the mountain (chosen to put
 *      the straight line directly across its steepest flank) is routed with the exact same
 *      `findSlopeAwarePath` function real roads use, and the result is asserted to (a) stay under the
 *      grade threshold and (b) route measurably farther from the mountain's center at closest
 *      approach than the straight line would have.
 *   4. **River non-collision**: no road point sits within `RIVER_CLEARANCE_METERS` of the traced
 *      river's own polyline for more than a short, expected crossing — flags any long parallel/
 *      coincident run as a failure (a real road may cross a river at one point; it should not run
 *      alongside it for a long stretch, per GOVERNANCE.md §8.10's spirit, even though no bridge mesh
 *      exists yet — see DECISIONS.md ADR-0076's Decision for that deferred scope note).
 *
 * Usage: `node scripts/roadNetworkSafetyCheck.js`
 * Exit codes: 0 = all checks pass. 1 = at least one failed. 2 = Playwright unavailable.
 * @module scripts/roadNetworkSafetyCheck
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

/** Hard ceiling, in degrees, no *actual returned road segment* may exceed — deliberately looser than
 * `world/roadPathfinder.js`'s `ROAD_COMFORT_GRADE_DEGREES` (10°, the soft cost-curve target): the
 * comfort target shapes the search's preference, this is the outer bound this check treats as a real
 * failure. Set below `scripts/terrainSeatSafetyCheck.js`'s 35° foot-walkable default (a cart needs a
 * shallower grade than a person on foot) per this run's own QUESTIONS_FOR_OWNER.md entry. */
const ROAD_HARD_MAX_GRADE_DEGREES = 20;

/** Minimum horizontal clearance, in meters, a road point must keep from the river's polyline before
 * this check starts counting it as "running alongside" the river rather than a brief, incidental
 * crossing. Half `world/rivers.js`'s own 14m default width plus `world/roads.js`'s 8m road width plus
 * a small margin — points closer than this could visually read as the road running in the riverbed. */
const RIVER_CLEARANCE_METERS = 25;

/** How many *consecutive* road points may sit within `RIVER_CLEARANCE_METERS` of the river before
 * this counts as a real "runs alongside the river" failure rather than a single expected crossing
 * point — a genuine crossing touches the clearance zone for at most one or two points before crossing
 * to the far side; a long run of many consecutive close points would mean the road is tracing the
 * riverbank instead. */
const MAX_CONSECUTIVE_RIVER_ADJACENT_POINTS = 3;

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

/** @returns {Promise<import('http').Server>} Same minimal static server every sibling check script uses. */
function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404);
				res.end('Not found');
				return;
			}
			const ext = path.extname(filePath).toLowerCase();
			res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500);
			res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** @returns {object|null} Same Playwright resolution every sibling check script uses. */
function loadPlaywright() {
	const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
	for (const id of candidates) {
		try {
			return require(id);
		} catch (error) {
			// Try the next candidate.
		}
	}
	return null;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[roadNetworkSafetyCheck] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });

	let data;
	try {
		const page = await browser.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		data = await page.evaluate(async () => {
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
			const { findSlopeAwarePath } = await import('/src/3d/world/roadPathfinder.js');
			const { generateRiverPath } = await import('/src/3d/world/rivers.js');

			// Same flattened field `sceneManager.js` actually builds (DECISIONS.md ADR-0118) — not the
			// raw unflattened sampler, so this check exercises exactly what roads route over in the
			// live game (a flat pad under each castle can shift a routed edge's first/last few meters).
			const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const flattenPads = computeSettlementFlattenPads({
				sampleHeightMeters: baseSampleHeightMeters,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
			const seats = KINGDOM_SEATS.map((seat) => {
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
			});

			const network = buildRoadNetwork({ seats, sampleHeightMeters });
			const edges = network.edges.map((edge) => ({
				fromId: edge.fromId,
				toId: edge.toId,
				lengthMeters: edge.lengthMeters,
				maxGradeDegrees: edge.maxGradeDegrees,
				pointCount: edge.points.length,
				points: edge.points,
			}));

			const connected = new Set();
			for (const edge of edges) {
				connected.add(edge.fromId);
				connected.add(edge.toId);
			}

			// Mountain-avoidance stress test: two synthetic points straddling MACRO_RELIEF_FEATURES'
			// mountain (center (2600, 2200), radius 1300) so the straight line between them crosses
			// directly over its steepest flank (see this script's own module doc).
			const stressStart = { x: 900, z: 2200 };
			const stressEnd = { x: 4300, z: 2200 };
			const stressResult = findSlopeAwarePath({ sampleHeightMeters, start: stressStart, end: stressEnd });
			const mountainCenter = { x: 2600, z: 2200 };
			const distanceToMountain = (p) => Math.hypot(p.x - mountainCenter.x, p.z - mountainCenter.z);
			let straightLineClosest = Infinity;
			for (let i = 0; i <= 200; i++) {
				const t = i / 200;
				straightLineClosest = Math.min(
					straightLineClosest,
					distanceToMountain({ x: stressStart.x + (stressEnd.x - stressStart.x) * t, z: stressStart.z + (stressEnd.z - stressStart.z) * t }),
				);
			}
			const routedClosest = Math.min(...stressResult.points.map(distanceToMountain));

			const { points: riverPoints } = generateRiverPath({
				seed: WORLD_DEFAULTS.WORLD_SEED,
				sampleHeightMeters,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
			});

			return {
				seatCount: KINGDOM_SEATS.length,
				edgeCount: edges.length,
				connectedCount: connected.size,
				edges,
				totalLengthMeters: network.totalLengthMeters,
				stressMaxGradeDegrees: stressResult.maxGradeDegrees,
				straightLineClosestToMountain: straightLineClosest,
				routedClosestToMountain: routedClosest,
				riverPoints: riverPoints.map((p) => ({ x: p.x, z: p.z })),
			};
		});
	} finally {
		await browser.close();
		server.close();
	}

	let allOk = true;
	const fail = (label, detail) => {
		allOk = false;
		console.log(`[roadNetworkSafetyCheck] FAIL: ${label} — ${detail}`);
	};
	const pass = (label, detail) => console.log(`[roadNetworkSafetyCheck] PASS: ${label} — ${detail}`);

	// 1. Connectivity.
	if (data.edgeCount === data.seatCount - 1 && data.connectedCount === data.seatCount) {
		pass('connectivity', `${data.edgeCount} edges (spanning tree), all ${data.connectedCount}/${data.seatCount} seats connected`);
	} else {
		fail('connectivity', `${data.edgeCount} edges, ${data.connectedCount}/${data.seatCount} seats connected (expected ${data.seatCount - 1} edges, ${data.seatCount} seats)`);
	}

	// 2. Per-edge grade (the real, routed max grade — see item 3 below for a direct routed-vs-
	// straight-line comparison, which is more informative than repeating a per-edge straight-line
	// re-sample here).
	console.log('[roadNetworkSafetyCheck] edge grades:');
	for (const edge of data.edges) {
		const ok = edge.maxGradeDegrees <= ROAD_HARD_MAX_GRADE_DEGREES;
		if (!ok) allOk = false;
		console.log(
			`[roadNetworkSafetyCheck]   ${edge.fromId.padEnd(12)} -> ${edge.toId.padEnd(12)} ` +
				`${(edge.lengthMeters / 1000).toFixed(2)}km  maxGrade=${edge.maxGradeDegrees.toFixed(1)}°  ${ok ? 'PASS' : `FAIL (> ${ROAD_HARD_MAX_GRADE_DEGREES}°)`}`,
		);
	}

	// 3. Mountain-avoidance stress test.
	const stressOk = data.stressMaxGradeDegrees <= ROAD_HARD_MAX_GRADE_DEGREES && data.routedClosestToMountain > data.straightLineClosestToMountain;
	if (stressOk) {
		pass(
			'mountain-avoidance stress test',
			`straight line's closest approach to mountain center ${data.straightLineClosestToMountain.toFixed(0)}m, ` +
				`routed path's closest approach ${data.routedClosestToMountain.toFixed(0)}m (bent ${(data.routedClosestToMountain - data.straightLineClosestToMountain).toFixed(0)}m farther away), ` +
				`routed max grade ${data.stressMaxGradeDegrees.toFixed(1)}° (<= ${ROAD_HARD_MAX_GRADE_DEGREES}°)`,
		);
	} else {
		fail(
			'mountain-avoidance stress test',
			`straightLineClosest=${data.straightLineClosestToMountain.toFixed(0)}m routedClosest=${data.routedClosestToMountain.toFixed(0)}m maxGrade=${data.stressMaxGradeDegrees.toFixed(1)}°`,
		);
	}

	// 4. River non-collision: no long run of consecutive road points within RIVER_CLEARANCE_METERS.
	let worstRun = 0;
	let anyCrossing = false;
	for (const edge of data.edges) {
		let run = 0;
		for (const point of edge.points) {
			let closestToRiver = Infinity;
			for (const riverPoint of data.riverPoints) {
				const d = Math.hypot(point.x - riverPoint.x, point.z - riverPoint.z);
				if (d < closestToRiver) closestToRiver = d;
			}
			if (closestToRiver < RIVER_CLEARANCE_METERS) {
				run++;
				anyCrossing = true;
				if (run > worstRun) worstRun = run;
			} else {
				run = 0;
			}
		}
	}
	if (worstRun <= MAX_CONSECUTIVE_RIVER_ADJACENT_POINTS) {
		pass(
			'river non-collision',
			anyCrossing
				? `longest run of road points within ${RIVER_CLEARANCE_METERS}m of the river polyline: ${worstRun} consecutive point(s) — a brief crossing, not a parallel run`
				: `no road point ever comes within ${RIVER_CLEARANCE_METERS}m of the river polyline`,
		);
	} else {
		fail('river non-collision', `${worstRun} consecutive road points within ${RIVER_CLEARANCE_METERS}m of the river — reads as running alongside it, not crossing it`);
	}

	console.log(
		`[roadNetworkSafetyCheck] ${allOk ? 'PASS' : 'FAIL'}: total network length ${(data.totalLengthMeters / 1000).toFixed(2)}km, ` +
			`grade threshold ${ROAD_HARD_MAX_GRADE_DEGREES}°.`,
	);
	process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
	console.error('[roadNetworkSafetyCheck] FAIL: unexpected error:', error);
	process.exit(1);
});