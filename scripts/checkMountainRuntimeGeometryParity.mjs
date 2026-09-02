#!/usr/bin/env node
import assert from 'node:assert/strict';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const playwright = loadPlaywright();
if (!playwright) {
	console.error('[checkMountainRuntimeGeometryParity] Playwright unavailable');
	process.exit(2);
}

const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	const pageErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	await page.goto(`${server.baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 90_000 });

	const result = await page.evaluate(async () => {
		const [configModule, terrainModule, physicsModule, mapModule, reliefModule] = await Promise.all([
			import('/src/3d/config.js'),
			import('/src/3d/world/terrain.js'),
			import('/src/3d/physics.js'),
			import('/src/3d/world/worldReferenceMap.js'),
			import('/src/3d/world/worldReferenceMountainRelief.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		const { createHeightSampler, createTerrainChunk, disposeTerrainChunk } = terrainModule;
		const { createGroundCollider } = physicsModule;
		const { REFERENCE_RELIEF_CHAINS } = mapModule;
		const { sampleWorldReferenceMountainReliefMeters } = reliefModule;
		const size = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const segments = CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP;
		const sampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
		const collider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED);
		const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
		const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
		const toWorld = (nx, ny) => ({
			x: (nx * (WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX) + WORLD_SCALE.MAP_BOUNDS.minX - centerMapX)
				* WORLD_SCALE.METERS_PER_MAP_UNIT,
			z: (ny * (WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY) + WORLD_SCALE.MAP_BOUNDS.minY - centerMapY)
				* WORLD_SCALE.METERS_PER_MAP_UNIT,
		});
		const reports = [];
		let globalMaxMeshSamplerDelta = 0;
		let globalMaxColliderSamplerDelta = 0;
		let globalMountainVertices = 0;
		let globalVertices = 0;

		for (const chain of REFERENCE_RELIEF_CHAINS) {
			const middleSegment = Math.max(0, Math.floor((chain.points.length - 1) / 2));
			const a = chain.points[middleSegment];
			const b = chain.points[middleSegment + 1];
			const target = toWorld((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
			const chunkX = Math.round(target.x / size);
			const chunkZ = Math.round(target.z / size);
			const mesh = createTerrainChunk({
				chunkX,
				chunkZ,
				size,
				segments,
				seed: WORLD_DEFAULTS.WORLD_SEED,
			});
			mesh.updateMatrixWorld(true);
			const position = mesh.geometry.attributes.position;
			let maxMeshSamplerDelta = 0;
			let maxColliderSamplerDelta = 0;
			let mountainVertices = 0;
			let sampledVertices = 0;
			let minimumHeight = Infinity;
			let maximumHeight = -Infinity;
			let maximumRelief = 0;

			for (let index = 0; index < position.count; index += 1) {
				const localX = position.getX(index);
				const localZ = position.getZ(index);
				const meshY = position.getY(index);
				const worldX = mesh.position.x + localX;
				const worldZ = mesh.position.z + localZ;
				const sampledY = sampler(worldX, worldZ);
				const colliderY = collider.getGroundHeight(worldX, worldZ);
				const relief = sampleWorldReferenceMountainReliefMeters(worldX, worldZ);
				const meshDelta = Math.abs(meshY - sampledY);
				const colliderDelta = Math.abs(colliderY - sampledY);
				maxMeshSamplerDelta = Math.max(maxMeshSamplerDelta, meshDelta);
				maxColliderSamplerDelta = Math.max(maxColliderSamplerDelta, colliderDelta);
				minimumHeight = Math.min(minimumHeight, meshY);
				maximumHeight = Math.max(maximumHeight, meshY);
				maximumRelief = Math.max(maximumRelief, relief);
				if (relief > 4) mountainVertices += 1;
				sampledVertices += 1;
			}

			globalMaxMeshSamplerDelta = Math.max(globalMaxMeshSamplerDelta, maxMeshSamplerDelta);
			globalMaxColliderSamplerDelta = Math.max(globalMaxColliderSamplerDelta, maxColliderSamplerDelta);
			globalMountainVertices += mountainVertices;
			globalVertices += sampledVertices;
			reports.push({
				chainId: chain.id,
				chunkX,
				chunkZ,
				vertexCount: sampledVertices,
				mountainVertices,
				maxMeshSamplerDelta,
				maxColliderSamplerDelta,
				minimumHeight,
				maximumHeight,
				maximumRelief,
				geometryPolicy: mesh.userData.currentTerrainPolicy,
				singleSource: mesh.userData.currentTerrainSingleSource,
			});
			disposeTerrainChunk(mesh);
		}

		return {
			chunkSizeMeters: size,
			segments,
			reports,
			globalMaxMeshSamplerDelta,
			globalMaxColliderSamplerDelta,
			globalMountainVertices,
			globalVertices,
		};
	});

	assert.equal(consoleErrors.length, 0, `browser console errors: ${consoleErrors.join(' | ')}`);
	assert.equal(pageErrors.length, 0, `browser page errors: ${pageErrors.join(' | ')}`);
	assert.equal(result.reports.length, 4, 'expected one shipped terrain chunk around each canonical mountain chain');
	assert(result.globalVertices >= 4 * 4000, 'runtime geometry parity sampled too few terrain vertices');
	assert(result.globalMountainVertices > 100, 'runtime parity did not actually sample mountain relief vertices');
	assert(result.globalMaxMeshSamplerDelta <= 1e-9,
		`render mesh diverged from canonical height sampler by ${result.globalMaxMeshSamplerDelta}m`);
	assert(result.globalMaxColliderSamplerDelta <= 1e-9,
		`ground collider diverged from canonical height sampler by ${result.globalMaxColliderSamplerDelta}m`);
	for (const report of result.reports) {
		assert.equal(report.singleSource, true, `${report.chainId}: terrain mesh lost single-source marker`);
		assert(report.maximumHeight > report.minimumHeight, `${report.chainId}: terrain chunk became flat`);
		assert(report.maximumRelief > 2, `${report.chainId}: chosen runtime chunk does not contain canonical mountain relief`);
		assert(report.maxMeshSamplerDelta <= 1e-9, `${report.chainId}: mesh/sampler parity failed`);
		assert(report.maxColliderSamplerDelta <= 1e-9, `${report.chainId}: collider/sampler parity failed`);
	}

	console.log('MOUNTAIN_RUNTIME_GEOMETRY_PARITY_OK', JSON.stringify(result));
} finally {
	await browser.close();
	await server.stop();
}
