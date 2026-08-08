#!/usr/bin/env node
/** Run 187: real chunk geometry + existing water plane + collider shadow integration proof. */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const EPSILON = 1e-4;

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
		console.error('[checkCanonicalChunkIntegrationShadow] SKIP: Playwright unavailable.');
		process.exit(2);
	}

	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	let result;
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { computeSeatMST } = await import('/src/3d/world/roads.js');
			const { findSlopeAwarePath } = await import('/src/3d/world/roadPathfinder.js');
			const { createWater, updateWater, disposeWater } = await import('/src/3d/world/water.js');
			const { mapCanvasToNormalizedReference, normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
			const { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } = await import('/src/3d/world/worldReferenceHydrology.js');
			const { FULL_REFERENCE_MAP_BOUNDS, FULL_REFERENCE_WORLD_MIGRATION_PLAN, mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
			const { createCanonicalHydrologyTerrainSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
			const { createCanonicalTerrainShadowChunk, createCanonicalGroundShadowCollider, disposeCanonicalTerrainShadowChunk } = await import('/src/3d/world/worldReferenceChunkShadow.js');

			const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
			const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
			const chunkSize = plan.chunkSizeMeters;
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
			const canonicalSampler = createCanonicalHydrologyTerrainSampler({ baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
			const collider = createCanonicalGroundShadowCollider(canonicalSampler);
			const containingChunk = (worldX, worldZ) => ({ x: Math.round(worldX / chunkSize), z: Math.round(worldZ / chunkSize) });

			const balonSeat = KINGDOM_SEATS.find((seat) => seat.id === 'balon');
			const jonSeat = KINGDOM_SEATS.find((seat) => seat.id === 'jon');
			const balonWorld = mapToWorldXZ(balonSeat.mapX, balonSeat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit);
			const jonWorld = mapToWorldXZ(jonSeat.mapX, jonSeat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit);
			const openSeaMap = normalizedReferenceToMapCanvas(0.535, 0.835);
			const openSeaWorld = mapCanvasToPlannedWorldXZ(openSeaMap.x, openSeaMap.y);

			const probes = [
				{ id: 'balon', world: balonWorld, chunk: containingChunk(balonWorld.x, balonWorld.z), expected: 'land' },
				{ id: 'jon', world: jonWorld, chunk: containingChunk(jonWorld.x, jonWorld.z), expected: 'land' },
				{ id: 'summer-sea', world: openSeaWorld, chunk: containingChunk(openSeaWorld.x, openSeaWorld.z), expected: 'water' },
			];

			const uniqueChunkKeys = [...new Set(probes.map((probe) => `${probe.chunk.x},${probe.chunk.z}`))];
			const scene = new THREE.Scene();
			const chunks = new Map();
			let maxVertexSamplerError = 0;
			let totalVertices = 0;
			let totalSubmergedVertices = 0;
			for (const key of uniqueChunkKeys) {
				const [chunkX, chunkZ] = key.split(',').map(Number);
				const mesh = createCanonicalTerrainShadowChunk({ chunkX, chunkZ, size: chunkSize, segments: 64, sampleHeightMeters: canonicalSampler, seaLevelMeters: sea });
				scene.add(mesh);
				mesh.updateMatrixWorld(true);
				chunks.set(key, mesh);
				const position = mesh.geometry.getAttribute('position');
				totalVertices += position.count;
				totalSubmergedVertices += mesh.userData.canonicalTerrainShadowRun187.submergedVertexCount;
				for (let index = 0; index < position.count; index += 1) {
					const worldX = mesh.position.x + position.getX(index);
					const worldZ = mesh.position.z + position.getZ(index);
					maxVertexSamplerError = Math.max(maxVertexSamplerError, Math.abs(position.getY(index) - canonicalSampler(worldX, worldZ)));
				}
			}

			const water = createWater(sea);
			scene.add(water);
			updateWater(water, new THREE.Vector3(openSeaWorld.x, 50, openSeaWorld.z), 12.5);
			water.updateMatrixWorld(true);

			const raycaster = new THREE.Raycaster();
			const raycastTerrainAt = (probe) => {
				const mesh = chunks.get(`${probe.chunk.x},${probe.chunk.z}`);
				raycaster.set(new THREE.Vector3(probe.world.x, 120, probe.world.z), new THREE.Vector3(0, -1, 0));
				const hits = raycaster.intersectObject(mesh, false);
				return hits.length ? hits[0].point.y : null;
			};

			const probeResults = probes.map((probe) => {
				const meshHeight = raycastTerrainAt(probe);
				const colliderHeight = collider.getGroundHeight(probe.world.x, probe.world.z);
				const mapPoint = { x: probe.world.x / plan.metersPerMapUnit + plan.mapCenter.x, y: probe.world.z / plan.metersPerMapUnit + plan.mapCenter.y };
				const normalized = mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
				const hydrology = sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
				return {
					id: probe.id,
					expected: probe.expected,
					chunk: probe.chunk,
					meshHeight,
					colliderHeight,
					meshColliderError: meshHeight === null ? null : Math.abs(meshHeight - colliderHeight),
					water: hydrology.water,
					protectedLand: hydrology.protectedLand,
					protectedLandWeight: hydrology.protectedLandWeight,
				};
			});

			raycaster.set(new THREE.Vector3(openSeaWorld.x, 120, openSeaWorld.z), new THREE.Vector3(0, -1, 0));
			const waterHits = raycaster.intersectObject(water, false);
			const seaTerrain = probeResults.find((probe) => probe.id === 'summer-sea');
			const waterSurfaceY = waterHits.length ? waterHits[0].point.y : null;

			const seatWorld = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit) }));
			const seatById = new Map(seatWorld.map((seat) => [seat.id, seat]));
			const mst = computeSeatMST(seatWorld);
			let routePointCount = 0;
			let canonicalWaterRoutePointCount = 0;
			const waterCrossingEdges = [];
			let maxCanonicalRouteGrade = 0;
			for (const edge of mst) {
				const route = findSlopeAwarePath({ sampleHeightMeters: canonicalSampler, start: seatById.get(edge.fromId), end: seatById.get(edge.toId) });
				maxCanonicalRouteGrade = Math.max(maxCanonicalRouteGrade, Number.isFinite(route.maxGradeDegrees) ? route.maxGradeDegrees : 0);
				let edgeWaterPoints = 0;
				for (const point of route.points) {
					routePointCount += 1;
					const mapX = point.x / plan.metersPerMapUnit + plan.mapCenter.x;
					const mapY = point.z / plan.metersPerMapUnit + plan.mapCenter.y;
					const normalized = mapCanvasToNormalizedReference(mapX, mapY);
					const hydrology = sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
					if (hydrology.water) {
						edgeWaterPoints += 1;
						canonicalWaterRoutePointCount += 1;
					}
				}
				if (edgeWaterPoints > 0) waterCrossingEdges.push({ edge: `${edge.fromId}->${edge.toId}`, waterPoints: edgeWaterPoints, totalPoints: route.points.length });
			}

			const resourceSummary = {
				chunkCount: chunks.size,
				totalVertices,
				totalSubmergedVertices,
				waterGeometryVertices: water.geometry.getAttribute('position').count,
				waterY: water.position.y,
			};

			for (const mesh of chunks.values()) {
				scene.remove(mesh);
				disposeCanonicalTerrainShadowChunk(mesh);
			}
			scene.remove(water);
			disposeWater(water);

			return {
				sea,
				maxVertexSamplerError,
				probeResults,
				waterSurfaceY,
				seaTerrainHeight: seaTerrain.meshHeight,
				seaColliderHeight: seaTerrain.colliderHeight,
				resourceSummary,
				routePointCount,
				canonicalWaterRoutePointCount,
				waterCrossingEdges,
				maxCanonicalRouteGrade,
			};
		});
	} finally {
		await browser.close();
		server.close();
	}

	assert(result.resourceSummary.chunkCount >= 2, `expected at least 2 distinct shadow chunks, got ${result.resourceSummary.chunkCount}`);
	assert(result.resourceSummary.totalVertices > 0, 'shadow chunks have no vertices');
	assert(result.resourceSummary.totalSubmergedVertices > 0, 'shadow chunk set has no submerged terrain vertices');
	assert(result.maxVertexSamplerError < EPSILON, `mesh vertices disagree with canonical sampler by ${result.maxVertexSamplerError}`);
	for (const probe of result.probeResults) {
		assert(probe.meshHeight !== null && Number.isFinite(probe.meshHeight), `${probe.id}: terrain raycast missed its containing chunk`);
		assert(Number.isFinite(probe.colliderHeight), `${probe.id}: collider returned non-finite height`);
		if (probe.expected === 'land') {
			assert(!probe.water && probe.protectedLand && probe.protectedLandWeight > 0.99, `${probe.id}: expected protected canonical land`);
			assert(probe.meshHeight >= result.sea + 1.49, `${probe.id}: rendered shadow terrain is not safely above water`);
			assert(probe.meshColliderError < 1e-3, `${probe.id}: rendered terrain/collider drift ${probe.meshColliderError}`);
		} else {
			assert(probe.water && !probe.protectedLand, `${probe.id}: expected canonical water`);
			assert(probe.colliderHeight <= result.sea - 2.49, `${probe.id}: canonical collider seabed is too shallow`);
			assert(probe.meshHeight < result.sea, `${probe.id}: rendered shadow seabed is not below water`);
			assert(probe.meshColliderError < 0.75, `${probe.id}: interpolated seabed/collider drift ${probe.meshColliderError}`);
		}
	}
	assert(result.waterSurfaceY !== null && Math.abs(result.waterSurfaceY - result.sea) < 1e-5, `water plane raycast y=${result.waterSurfaceY}, expected ${result.sea}`);
	assert(result.waterSurfaceY > result.seaTerrainHeight, 'water surface must raycast above canonical seabed');
	assert(result.routePointCount > 0, 'canonical route qualification produced no road points');
	assert(Number.isFinite(result.maxCanonicalRouteGrade), 'canonical route max grade must be finite');

	const runtimeConsumers = [
		'src/3d/game3d.js', 'src/3d/config.js', 'src/3d/sceneManager.js', 'src/3d/world/chunkManager.js',
		'src/3d/world/terrain.js', 'src/3d/world/water.js', 'src/3d/world/roads.js', 'src/3d/world/settlements.js', 'src/3d/physics.js',
	];
	for (const file of runtimeConsumers) {
		const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
		assert(!source.includes('worldReferenceChunkShadow'), `${file}: Run187 chunk shadow must remain opt-in`);
	}

	const balon = result.probeResults.find((probe) => probe.id === 'balon');
	const jon = result.probeResults.find((probe) => probe.id === 'jon');
	console.log(`[checkCanonicalChunkIntegrationShadow] PASS: ${result.resourceSummary.chunkCount} real 64-segment shadow chunks / ${result.resourceSummary.totalVertices} vertices agree with canonical sampler (max error ${result.maxVertexSamplerError}); Balon ${balon.meshHeight.toFixed(2)}m + Jon ${jon.meshHeight.toFixed(2)}m render/collider flat+dry; Summer Sea terrain ${result.seaTerrainHeight.toFixed(2)}m under existing water plane ${result.waterSurfaceY.toFixed(2)}m; submerged vertices ${result.resourceSummary.totalSubmergedVertices}; canonical-road diagnostic ${result.canonicalWaterRoutePointCount}/${result.routePointCount} route points in water across ${result.waterCrossingEdges.length}/13 edges, max route grade ${result.maxCanonicalRouteGrade.toFixed(1)}°; live runtime remains unwired.`);
	if (result.waterCrossingEdges.length > 0) {
		console.log('[checkCanonicalChunkIntegrationShadow] ROAD_WATER_DIAGNOSTIC:', JSON.stringify(result.waterCrossingEdges));
	}
}

main().catch((error) => {
	console.error('[checkCanonicalChunkIntegrationShadow] FAIL:', error);
	process.exit(1);
});
