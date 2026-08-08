#!/usr/bin/env node
/** Run 187 canonical terrain scene/chunk/physics/road shadow integration proof. */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const EPSILON = 1e-6;
const ROAD_HARD_MAX_GRADE_DEGREES = 20;
const CHUNK_SIZE_METERS = 500;
const TERRAIN_SEGMENTS = 64;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, ''));
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalChunkSceneShadowIntegration] SKIP: Playwright unavailable.');
		process.exit(2);
	}

	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	let result;
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		result = await page.evaluate(async ({ chunkSizeMeters, terrainSegments }) => {
			const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler, createTerrainChunk, disposeTerrainChunk } = await import('/src/3d/world/terrain.js');
			const { createWater, updateWater, disposeWater } = await import('/src/3d/world/water.js');
			const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { computeSeatMST } = await import('/src/3d/world/roads.js');
			const { findSlopeAwarePath } = await import('/src/3d/world/roadPathfinder.js');
			const { mapCanvasToNormalizedReference, normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { referenceProtectionRadiiFromMeters } = await import('/src/3d/world/worldReferenceHydrology.js');
			const { FULL_REFERENCE_MAP_BOUNDS, FULL_REFERENCE_WORLD_MIGRATION_PLAN, mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
			const { createCanonicalHydrologyTerrainSampler, sampleCanonicalHydrologyTerrainTarget } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');

			const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({
				sampleHeightMeters: natural,
				seaLevelMeters: sea,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: FULL_REFERENCE_MAP_BOUNDS,
				metersPerMapUnit: plan.metersPerMapUnit,
			});
			const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, plan.metersPerMapUnit);
			const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
			const canonical = createCanonicalHydrologyTerrainSampler({ baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
			const targetSeats = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit) }));
			const byId = new Map(targetSeats.map((seat) => [seat.id, seat]));
			const mst = computeSeatMST(targetSeats);
			const routeResults = [];
			const routeMidpoints = [];

			for (const edge of mst) {
				const start = byId.get(edge.fromId);
				const end = byId.get(edge.toId);
				const routeA = findSlopeAwarePath({ sampleHeightMeters: canonical, start, end });
				const routeB = findSlopeAwarePath({ sampleHeightMeters: canonical, start, end });
				let waterDistanceMeters = 0;
				let routeLengthMeters = 0;
				let minEdgeMarginMeters = Infinity;
				const halfWidth = plan.worldWidthMeters * 0.5;
				const halfDepth = plan.worldDepthMeters * 0.5;
				for (let i = 0; i < routeA.points.length; i += 1) {
					const point = routeA.points[i];
					minEdgeMarginMeters = Math.min(minEdgeMarginMeters, point.x + halfWidth, halfWidth - point.x, point.z + halfDepth, halfDepth - point.z);
					if (i === 0) continue;
					const previous = routeA.points[i - 1];
					const segmentLength = Math.hypot(point.x - previous.x, point.z - previous.z);
					routeLengthMeters += segmentLength;
					const midX = (point.x + previous.x) * 0.5;
					const midZ = (point.z + previous.z) * 0.5;
					const mid = sampleCanonicalHydrologyTerrainTarget({ worldX: midX, worldZ: midZ, baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
					if (mid.hydrology.water) waterDistanceMeters += segmentLength;
				}
				const signature = (route) => route.points.map((point) => `${point.x.toFixed(4)},${point.z.toFixed(4)}`).join('|');
				const midpoint = routeA.points[Math.floor(routeA.points.length * 0.5)];
				routeMidpoints.push({ x: midpoint.x, z: midpoint.z });
				routeResults.push({
					id: `${edge.fromId}->${edge.toId}`,
					maxGradeDegrees: routeA.maxGradeDegrees,
					pointCount: routeA.points.length,
					deterministic: signature(routeA) === signature(routeB),
					waterDistanceMeters,
					routeLengthMeters,
					minEdgeMarginMeters,
				});
			}

			const chunkKeys = new Set();
			const addChunkForPoint = (point) => chunkKeys.add(`${Math.round(point.x / chunkSizeMeters)},${Math.round(point.z / chunkSizeMeters)}`);
			for (const seat of targetSeats) addChunkForPoint(seat);
			for (const point of routeMidpoints) addChunkForPoint(point);
			const openSeaMap = normalizedReferenceToMapCanvas(0.535, 0.835);
			const openSeaWorld = mapCanvasToPlannedWorldXZ(openSeaMap.x, openSeaMap.y);
			addChunkForPoint(openSeaWorld);

			let maxBaseGeometryError = 0;
			let maxShadowGeometryError = 0;
			let waterVertices = 0;
			let landVertices = 0;
			let minShadowWaterDepth = Infinity;
			let minShadowLandClearance = Infinity;
			let finiteVertices = 0;
			const meshes = new Map();
			try {
				for (const key of chunkKeys) {
					const [chunkX, chunkZ] = key.split(',').map(Number);
					const mesh = createTerrainChunk({ chunkX, chunkZ, size: chunkSizeMeters, segments: terrainSegments, seed: WORLD_DEFAULTS.WORLD_SEED, flattenPads: pads });
					meshes.set(key, mesh);
					const position = mesh.geometry.attributes.position;
					for (let i = 0; i < position.count; i += 1) {
						const worldX = mesh.position.x + position.getX(i);
						const worldZ = mesh.position.z + position.getZ(i);
						const bakedBaseY = position.getY(i);
						const expectedBaseY = base(worldX, worldZ);
						maxBaseGeometryError = Math.max(maxBaseGeometryError, Math.abs(bakedBaseY - expectedBaseY));
						const target = sampleCanonicalHydrologyTerrainTarget({ worldX, worldZ, baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
						position.setY(i, target.targetHeightMeters);
						if (Number.isFinite(target.targetHeightMeters)) finiteVertices += 1;
						if (target.hydrology.water) {
							waterVertices += 1;
							minShadowWaterDepth = Math.min(minShadowWaterDepth, sea - target.targetHeightMeters);
						} else {
							landVertices += 1;
							minShadowLandClearance = Math.min(minShadowLandClearance, target.targetHeightMeters - sea);
						}
					}
					position.needsUpdate = true;
					mesh.geometry.computeVertexNormals();
					mesh.geometry.computeBoundingBox();
					mesh.geometry.computeBoundingSphere();
					for (let i = 0; i < position.count; i += 1) {
						const worldX = mesh.position.x + position.getX(i);
						const worldZ = mesh.position.z + position.getZ(i);
						maxShadowGeometryError = Math.max(maxShadowGeometryError, Math.abs(position.getY(i) - canonical(worldX, worldZ)));
					}
				}

				const seatPhysics = targetSeats.map((seat, index) => {
					const anchor = pads[index].anchorHeightMeters;
					const probes = [[0,0],[20,0],[-20,0],[0,20],[0,-20]];
					const heights = probes.map(([dx, dz]) => canonical(seat.x + dx, seat.z + dz));
					return { id: seat.id, anchor, maxPhysicsPadDelta: Math.max(...heights.map((height) => Math.abs(height - anchor))), minHeight: Math.min(...heights) };
				});

				const water = createWater(sea);
				try {
					updateWater(water, { x: openSeaWorld.x, y: 80, z: openSeaWorld.z }, 1.25);
					const waterPosition = water.geometry.attributes.position;
					let maxLocalWaterY = 0;
					for (let i = 0; i < waterPosition.count; i += 1) maxLocalWaterY = Math.max(maxLocalWaterY, Math.abs(waterPosition.getY(i)));
					const openSeaGround = canonical(openSeaWorld.x, openSeaWorld.z);
					return {
						plan,
						chunkCount: chunkKeys.size,
						vertexCount: waterVertices + landVertices,
						finiteVertices,
						maxBaseGeometryError,
						maxShadowGeometryError,
						waterVertices,
						landVertices,
						minShadowWaterDepth,
						minShadowLandClearance,
						seatPhysics,
						routeResults,
						waterPlane: { y: water.position.y, x: water.position.x, z: water.position.z, maxLocalY: maxLocalWaterY },
						openSea: { x: openSeaWorld.x, z: openSeaWorld.z, groundY: openSeaGround, depthMeters: sea - openSeaGround },
					};
				} finally {
					disposeWater(water);
				}
			} finally {
				for (const mesh of meshes.values()) disposeTerrainChunk(mesh);
			}
		}, { chunkSizeMeters: CHUNK_SIZE_METERS, terrainSegments: TERRAIN_SEGMENTS });
	} finally {
		await browser.close();
		server.close();
	}

	assert(result.chunkCount >= 10, `expected broad seat/road/open-sea chunk coverage, got ${result.chunkCount}`);
	assert(result.vertexCount > 0 && result.vertexCount === result.finiteVertices, `non-finite shadow geometry vertices: ${result.finiteVertices}/${result.vertexCount}`);
	assert(result.waterVertices > 0 && result.landVertices > 0, `shadow chunk sample degenerate: water=${result.waterVertices} land=${result.landVertices}`);
	assert(result.maxBaseGeometryError < EPSILON, `real createTerrainChunk geometry disagrees with base sampler by ${result.maxBaseGeometryError}`);
	assert(result.maxShadowGeometryError < EPSILON, `shadow-retargeted geometry disagrees with canonical sampler by ${result.maxShadowGeometryError}`);
	assert(result.minShadowWaterDepth > 0, `shadow water geometry is not below water plane (${result.minShadowWaterDepth})`);
	assert(result.minShadowLandClearance > 0, `shadow land geometry is not dry (${result.minShadowLandClearance})`);
	assert(result.seatPhysics.length === 14, `expected 14 seat physics probes, got ${result.seatPhysics.length}`);
	for (const seat of result.seatPhysics) {
		assert(seat.maxPhysicsPadDelta < EPSILON, `${seat.id}: canonical shadow physics broke flat settlement pad (${seat.maxPhysicsPadDelta})`);
		assert(seat.minHeight >= 7.5 - EPSILON, `${seat.id}: canonical shadow physics below settlement clearance floor`);
	}
	assert(result.routeResults.length === 13, `expected 13 target roads, got ${result.routeResults.length}`);
	for (const road of result.routeResults) {
		assert(road.deterministic, `${road.id}: canonical route is not deterministic`);
		assert(Number.isFinite(road.maxGradeDegrees) && road.maxGradeDegrees <= ROAD_HARD_MAX_GRADE_DEGREES, `${road.id}: grade ${road.maxGradeDegrees} exceeds ${ROAD_HARD_MAX_GRADE_DEGREES}`);
		assert(road.minEdgeMarginMeters >= 0, `${road.id}: route leaves full-reference extent`);
	}
	assert(Math.abs(result.waterPlane.y - 6) < EPSILON, `water plane Y drifted to ${result.waterPlane.y}`);
	assert(result.waterPlane.maxLocalY < EPSILON, `water geometry vertically displaced by ${result.waterPlane.maxLocalY}`);
	assert(result.openSea.depthMeters > 0, `open sea ground is not below water plane (${result.openSea.groundY})`);

	const crossingRoads = result.routeResults.filter((road) => road.waterDistanceMeters > EPSILON);
	const totalRoadKm = result.routeResults.reduce((sum, road) => sum + road.routeLengthMeters, 0) / 1000;
	const totalWaterKm = crossingRoads.reduce((sum, road) => sum + road.waterDistanceMeters, 0) / 1000;
	const maxGrade = Math.max(...result.routeResults.map((road) => road.maxGradeDegrees));
	const crossingIds = crossingRoads.map((road) => road.id);
	const report = {
		chunkCount: result.chunkCount,
		vertexCount: result.vertexCount,
		crossingRoadCount: crossingRoads.length,
		crossingRoadIds: crossingIds,
		totalRoadKm: Number(totalRoadKm.toFixed(3)),
		totalWaterKm: Number(totalWaterKm.toFixed(3)),
		maxGradeDegrees: Number(maxGrade.toFixed(3)),
		openSeaDepthMeters: Number(result.openSea.depthMeters.toFixed(3)),
	};
	console.log(`[checkCanonicalChunkSceneShadowIntegration] PASS: ${result.chunkCount} real 64x64 terrain chunks / ${result.vertexCount} vertices retarget exactly to canonical sampler; water+land geometry finite/dry-wet consistent; 14/14 shadow physics pads flat; 13/13 deterministic slope-aware roads <=20°; flat water plane preserved; open sea depth ${result.openSea.depthMeters.toFixed(2)}m; measured water-crossing roads ${crossingRoads.length}.`);
	console.log(`[checkCanonicalChunkSceneShadowIntegration] REPORT ${JSON.stringify(report)}`);
}

main().catch((error) => {
	console.error('[checkCanonicalChunkSceneShadowIntegration] FAIL:', error);
	process.exit(1);
});
