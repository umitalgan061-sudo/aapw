#!/usr/bin/env node
/**
 * Run 185 route-qualified full-reference migration dry-run.
 *
 * Exercises the future 9000x7000 / 137.5 km² world scale through the real browser-resolved modules
 * without switching live runtime constants. It proves 14/14 settlement positions/pads, canonical
 * hydrology, MST topology and all 13 slope-aware road routes before a later high-impact migration.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ROAD_HARD_MAX_GRADE_DEGREES = 20;
const EPSILON = 1e-7;
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			const ext = path.extname(filePath).toLowerCase();
			res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkWorldReferenceMigrationDryRun] SKIP: Playwright unavailable.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	let data;
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		data = await page.evaluate(async () => {
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeSeatMST } = await import('/src/3d/world/roads.js');
			const { findSlopeAwarePath } = await import('/src/3d/world/roadPathfinder.js');
			const { mapCanvasToNormalizedReference } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } = await import('/src/3d/world/worldReferenceHydrology.js');
			const {
				FULL_REFERENCE_MAP_BOUNDS,
				FULL_REFERENCE_WORLD_MIGRATION_PLAN,
				mapCanvasToPlannedWorldXZ,
				plannedWorldXZToMapCanvas,
				currentWorldXZToPlannedWorldXZ,
			} = await import('/src/3d/world/worldReferenceMigrationPlan.js');

			const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
			const baseTargetSampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const targetPads = computeSettlementFlattenPads({
				sampleHeightMeters: baseTargetSampler,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: FULL_REFERENCE_MAP_BOUNDS,
				metersPerMapUnit: plan.metersPerMapUnit,
			});
			const targetSampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, targetPads);
			const protectionRadiusMeters = targetPads[0].outerRadiusMeters;
			const protectionRadii = referenceProtectionRadiiFromMeters(protectionRadiusMeters, plan.metersPerMapUnit);
			const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));

			const halfWidth = plan.worldWidthMeters * 0.5;
			const halfDepth = plan.worldDepthMeters * 0.5;
			const seatResults = KINGDOM_SEATS.map((seat, index) => {
				const current = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				const target = mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit);
				const helperTarget = mapCanvasToPlannedWorldXZ(seat.mapX, seat.mapY);
				const migrated = currentWorldXZToPlannedWorldXZ(current.x, current.z, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				const roundTrip = plannedWorldXZToMapCanvas(target.x, target.z);
				const normalized = protectedSites[index];
				const hydrology = sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
				const pad = targetPads[index];
				const centerHeight = targetSampler(target.x, target.z);
				const flatProbeOffsets = [[20,0],[-20,0],[0,20],[0,-20]];
				const maxFlatDelta = Math.max(...flatProbeOffsets.map(([dx,dz]) => Math.abs(targetSampler(target.x + dx, target.z + dz) - centerHeight)));
				const worldEdgeMarginMeters = Math.min(target.x + halfWidth, halfWidth - target.x, target.z + halfDepth, halfDepth - target.z);
				return {
					id: seat.id,
					mapX: seat.mapX, mapY: seat.mapY,
					current, target, helperTarget, migrated, roundTrip,
					migrationDistanceMeters: Math.hypot(target.x - current.x, target.z - current.z),
					worldEdgeMarginMeters,
					padOuterRadiusMeters: pad.outerRadiusMeters,
					centerHeight,
					maxFlatDelta,
					hydrology: { land: hydrology.land, water: hydrology.water, protectedLandWeight: hydrology.protectedLandWeight },
				};
			});

			const currentSeats = seatResults.map((seat) => ({ id: seat.id, x: seat.current.x, z: seat.current.z }));
			const targetSeats = seatResults.map((seat) => ({ id: seat.id, x: seat.target.x, z: seat.target.z }));
			const currentMst = computeSeatMST(currentSeats);
			const targetMst = computeSeatMST(targetSeats);
			const byId = new Map(targetSeats.map((seat) => [seat.id, seat]));
			const roadResults = targetMst.map((edge) => {
				const start = byId.get(edge.fromId);
				const end = byId.get(edge.toId);
				const route = findSlopeAwarePath({ sampleHeightMeters: targetSampler, start, end });
				let lengthMeters = 0;
				let minEdgeMarginMeters = Infinity;
				for (let i = 0; i < route.points.length; i += 1) {
					const point = route.points[i];
					minEdgeMarginMeters = Math.min(minEdgeMarginMeters, point.x + halfWidth, halfWidth - point.x, point.z + halfDepth, halfDepth - point.z);
					if (i > 0) lengthMeters += Math.hypot(point.x - route.points[i - 1].x, point.z - route.points[i - 1].z);
				}
				return { fromId: edge.fromId, toId: edge.toId, maxGradeDegrees: route.maxGradeDegrees, pointCount: route.points.length, lengthMeters, minEdgeMarginMeters };
			});

			const openSea = sampleSeatSafeReferenceHydrology(0.535, 0.835, protectedSites, protectionRadii);
			return {
				plan,
				seatResults,
				currentMst: currentMst.map((edge) => `${edge.fromId}->${edge.toId}`),
				targetMst: targetMst.map((edge) => `${edge.fromId}->${edge.toId}`),
				roadResults,
				openSea: { rawWater: openSea.rawWater, water: openSea.water, protectedLand: openSea.protectedLand },
			};
		});
	} finally {
		await browser.close();
		server.close();
	}

	assert(data.plan.areaKm2 <= data.plan.maxAreaKm2, `planned area ${data.plan.areaKm2} exceeds ${data.plan.maxAreaKm2} km² cap`);
	assert(data.plan.gridColumns === 27 && data.plan.gridRows === 21, `planned grid drifted: ${data.plan.gridColumns}x${data.plan.gridRows}`);
	assert(data.seatResults.length === 14, `expected 14 seats, got ${data.seatResults.length}`);
	for (const seat of data.seatResults) {
		assert(Math.abs(seat.target.x - seat.helperTarget.x) < EPSILON && Math.abs(seat.target.z - seat.helperTarget.z) < EPSILON, `${seat.id}: helper target disagrees with canonical mapToWorldXZ`);
		assert(Math.abs(seat.target.x - seat.migrated.x) < EPSILON && Math.abs(seat.target.z - seat.migrated.z) < EPSILON, `${seat.id}: current->planned migration disagrees`);
		assert(Math.abs(seat.roundTrip.x - seat.mapX) < EPSILON && Math.abs(seat.roundTrip.y - seat.mapY) < EPSILON, `${seat.id}: planned world round-trip drift`);
		assert(seat.worldEdgeMarginMeters >= seat.padOuterRadiusMeters, `${seat.id}: ${seat.worldEdgeMarginMeters.toFixed(1)}m edge margin is smaller than ${seat.padOuterRadiusMeters}m settlement safety radius`);
		assert(seat.centerHeight >= 7.5 - EPSILON, `${seat.id}: flattened center below water-clearance floor (${seat.centerHeight})`);
		assert(seat.maxFlatDelta < 1e-6, `${seat.id}: settlement inner pad is not flat (${seat.maxFlatDelta})`);
		assert(seat.hydrology.land && !seat.hydrology.water && Math.abs(seat.hydrology.protectedLandWeight - 1) < EPSILON, `${seat.id}: planned canonical hydrology is not protected land`);
	}
	assert(data.currentMst.join('|') === data.targetMst.join('|'), `MST topology changed: current=${data.currentMst.join(',')} target=${data.targetMst.join(',')}`);
	assert(data.roadResults.length === 13, `expected 13 planned roads, got ${data.roadResults.length}`);
	for (const road of data.roadResults) {
		assert(Number.isFinite(road.maxGradeDegrees), `${road.fromId}->${road.toId}: pathfinder fell back without a finite grade`);
		assert(road.maxGradeDegrees <= ROAD_HARD_MAX_GRADE_DEGREES, `${road.fromId}->${road.toId}: ${road.maxGradeDegrees.toFixed(2)}° exceeds ${ROAD_HARD_MAX_GRADE_DEGREES}°`);
		assert(road.minEdgeMarginMeters >= 0, `${road.fromId}->${road.toId}: routed point leaves planned full-map extent by ${(-road.minEdgeMarginMeters).toFixed(1)}m`);
	}
	assert(data.openSea.rawWater && data.openSea.water && !data.openSea.protectedLand, 'open Summer Sea must remain water under planned scale');

	const maxShift = Math.max(...data.seatResults.map((seat) => seat.migrationDistanceMeters));
	const minSeatEdgeMargin = Math.min(...data.seatResults.map((seat) => seat.worldEdgeMarginMeters));
	const maxRoadGrade = Math.max(...data.roadResults.map((road) => road.maxGradeDegrees));
	const totalRoadKm = data.roadResults.reduce((sum, road) => sum + road.lengthMeters, 0) / 1000;
	const minRoadEdgeMargin = Math.min(...data.roadResults.map((road) => road.minEdgeMarginMeters));

	const runtimeFiles = ['src/3d/config.js', 'src/3d/sceneManager.js', 'src/3d/world/terrain.js', 'src/3d/world/water.js', 'src/3d/world/roads.js', 'src/3d/world/settlements.js'];
	for (const file of runtimeFiles) {
		assert(!fs.readFileSync(path.join(ROOT, file), 'utf8').includes('worldReferenceMigrationPlan.js'), `${file}: run185 must stay shadow-only`);
	}

	console.log(`[checkWorldReferenceMigrationDryRun] PASS: full-map ${data.plan.areaKm2.toFixed(1)} km² ${data.plan.gridColumns}x${data.plan.gridRows}; 14/14 seats round-trip+flat+hydrology safe; min seat edge margin ${minSeatEdgeMargin.toFixed(1)}m; MST 13/13 invariant; target roads ${totalRoadKm.toFixed(2)}km maxGrade ${maxRoadGrade.toFixed(1)}° min edge margin ${minRoadEdgeMargin.toFixed(1)}m; max seat migration ${maxShift.toFixed(1)}m; open sea water; runtime remains unwired.`);
}

main().catch((error) => {
	console.error('[checkWorldReferenceMigrationDryRun] FAIL:', error);
	process.exit(1);
});
