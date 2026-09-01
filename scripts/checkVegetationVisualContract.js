#!/usr/bin/env node
/**
 * checkVegetationVisualContract.js — isolated browser contract for live procedural vegetation.
 * Locks deterministic instance transforms, draw-call structure, organic silhouette metadata,
 * bounded geometry complexity, world-space material treatment and teardown without booting game3d.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkVegetationVisualContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
		await page.goto(`http://127.0.0.1:${port}/scripts/vegetationSilhouetteHarness.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		});
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const {
				createVegetation,
				disposeVegetation,
				VEGETATION_SILHOUETTE_POLICY,
				VEGETATION_SPATIAL_PATTERN_POLICY,
			} = await import('/src/3d/world/vegetation.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-8) => Math.abs(a - b) <= tolerance;
			const matrixClose = (a, b) => a.elements.every((value, index) => Number.isFinite(value) && close(value, b.elements[index]));
			const triangleCount = (geometry) => geometry.index
				? geometry.index.count / 3
				: geometry.getAttribute('position').count / 3;
			const options = {
				sampleHeightMeters: () => 25,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				seed: WORLD_DEFAULTS.WORLD_SEED,
				seats: [],
				roadEdges: [],
				radiusMeters: 1000,
				densityPerKm2: 30,
			};
			const first = createVegetation(options);
			const second = createVegetation(options);
			fail(first.group?.isGroup === true, 'vegetation root is not a THREE.Group');
			fail(first.group.children.length === 6, `expected 6 species meshes, got ${first.group.children.length}`);
			fail(first.targetCount > 0 && first.placedCount > 0 && first.placedCount <= first.targetCount,
				`unexpected bounded placement ${first.placedCount}/${first.targetCount}`);
			fail(first.baseHabitatRejected > 0, 'temperate browser fixture never exercised terrain habitat rejection');
			fail(first.group.userData.vegetationSpatialPattern?.temperateHabitatAuthority
				=== VEGETATION_SPATIAL_PATTERN_POLICY.temperateHabitatAuthority,
				'vegetation browser fixture lost terrain habitat authority metadata');
			fail(first.clusterSeatCount === 0 && first.settlementWoodlandSeatCount === 0,
				'seat-free fixture unexpectedly created settlement woodland');
			fail(second.placedCount === first.placedCount, 'same seed/options changed placedCount');
			fail(VEGETATION_SILHOUETTE_POLICY?.drawCallPreserving === true, 'silhouette policy must preserve draw calls');
			fail(VEGETATION_SILHOUETTE_POLICY?.placementAuthorityChanged === false,
				'silhouette policy must not claim placement ownership');

			const expectedNames = [
				'vegetation-pine-trunks',
				'vegetation-pine-foliage',
				'vegetation-round-trunks',
				'vegetation-round-foliage',
				'vegetation-snow-pine-trunks',
				'vegetation-snow-pine-foliage',
			];
			const expectedProfiles = [
				'tapered-evergreen-trunk', 'continuous-evergreen-crown',
				'forked-broadleaf-trunk', 'lobed-broadleaf',
				'tapered-evergreen-trunk', 'continuous-evergreen-crown',
			];
			const matrixA = new THREE.Matrix4();
			const matrixB = new THREE.Matrix4();
			const perMesh = [];
			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			let renderedInstanceSlots = 0;

			for (let meshIndex = 0; meshIndex < expectedNames.length; meshIndex++) {
				const mesh = first.group.children[meshIndex];
				const twin = second.group.children[meshIndex];
				fail(mesh?.isInstancedMesh === true && twin?.isInstancedMesh === true,
					`child ${meshIndex} is not InstancedMesh`);
				fail(mesh.name === expectedNames[meshIndex], `child ${meshIndex} name drifted to ${mesh.name}`);
				fail(mesh.geometry?.isBufferGeometry === true, `child ${meshIndex} geometry is not BufferGeometry`);
				const silhouette = mesh.geometry.userData?.vegetationSilhouette;
				fail(silhouette?.policyId === VEGETATION_SILHOUETTE_POLICY.id,
					`child ${meshIndex} silhouette policy missing/drifted`);
				fail(silhouette.profile === expectedProfiles[meshIndex],
					`child ${meshIndex} profile ${silhouette.profile} != ${expectedProfiles[meshIndex]}`);
				if (silhouette.profile === 'continuous-evergreen-crown') {
					fail(silhouette.componentCount === 1 && silhouette.connectedSurface === true,
						`child ${meshIndex} evergreen crown must remain one connected surface`);
					fail(silhouette.profileRingCount === VEGETATION_SILHOUETTE_POLICY.evergreenProfileRingCount,
						`child ${meshIndex} evergreen profile ring topology drifted`);
					fail(silhouette.radialSegments === VEGETATION_SILHOUETTE_POLICY.evergreenRadialSegments,
						`child ${meshIndex} evergreen radial topology drifted`);
					fail(mesh.geometry.type === 'BufferGeometry', `child ${meshIndex} reverted to a primitive geometry type`);
				} else {
					fail(silhouette.componentCount >= 2, `child ${meshIndex} reverted to a single primitive`);
				}
				fail(mesh.material?.isMeshStandardMaterial === true, `child ${meshIndex} material is not MeshStandardMaterial`);
				fail(mesh.material.metalness === 0, `child ${meshIndex} metalness drift`);
				fail(mesh.material.userData?.vegetationSurfaceFabric?.worldSpace === true,
					`child ${meshIndex} lost world-space surface fabric`);
				fail(mesh.instanceMatrix.usage === THREE.StaticDrawUsage, `child ${meshIndex} instance matrix is not static`);
				fail(mesh.count === twin.count && mesh.count >= 0 && mesh.count <= first.targetCount,
					`child ${meshIndex} count invalid`);
				const positions = mesh.geometry.getAttribute('position');
				const normals = mesh.geometry.getAttribute('normal');
				fail(Boolean(positions && normals) && positions.count > 0 && positions.count === normals.count,
					`child ${meshIndex} geometry attributes invalid`);
				for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
					fail(Number.isFinite(positions.getX(vertexIndex))
						&& Number.isFinite(positions.getY(vertexIndex))
						&& Number.isFinite(positions.getZ(vertexIndex)), `child ${meshIndex} non-finite position`);
					fail(Number.isFinite(normals.getX(vertexIndex))
						&& Number.isFinite(normals.getY(vertexIndex))
						&& Number.isFinite(normals.getZ(vertexIndex)), `child ${meshIndex} non-finite normal`);
				}
				const triangles = triangleCount(mesh.geometry);
				fail(triangles >= silhouette.minTriangles && triangles <= silhouette.maxTriangles,
					`child ${meshIndex} triangles ${triangles} outside ${silhouette.minTriangles}..${silhouette.maxTriangles}`);
				mesh.geometry.computeBoundingBox();
				const bounds = mesh.geometry.boundingBox;
				fail(bounds && [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite),
					`child ${meshIndex} has invalid bounds`);
				fail(bounds.min.y >= -0.05, `child ${meshIndex} sinks below local ground (${bounds.min.y})`);
				for (let instanceIndex = 0; instanceIndex < mesh.count; instanceIndex++) {
					mesh.getMatrixAt(instanceIndex, matrixA);
					twin.getMatrixAt(instanceIndex, matrixB);
					fail(matrixClose(matrixA, matrixB),
						`child ${meshIndex} deterministic matrix drift at instance ${instanceIndex}`);
				}
				mesh.geometry.addEventListener('dispose', () => geometryDisposeCount++);
				mesh.material.addEventListener('dispose', () => materialDisposeCount++);
				renderedInstanceSlots += mesh.count;
				perMesh.push({ name: mesh.name, count: mesh.count, triangles, profile: silhouette.profile });
			}

			const assertPairAligned = (trunkIndex, foliageIndex, label) => {
				const trunk = first.group.children[trunkIndex];
				const foliage = first.group.children[foliageIndex];
				fail(trunk.count === foliage.count, `${label} trunk/foliage count mismatch`);
				for (let instanceIndex = 0; instanceIndex < trunk.count; instanceIndex++) {
					trunk.getMatrixAt(instanceIndex, matrixA);
					foliage.getMatrixAt(instanceIndex, matrixB);
					fail(matrixClose(matrixA, matrixB), `${label} trunk/foliage transform mismatch at ${instanceIndex}`);
				}
			};
			assertPairAligned(0, 1, 'pine');
			assertPairAligned(2, 3, 'round');
			assertPairAligned(4, 5, 'snow-pine');
			fail(first.group.children[0].count > 0 && first.group.children[2].count > 0,
				'temperate fixture must exercise both live species');
			fail(renderedInstanceSlots === first.placedCount * 2,
				`rendered instance slots ${renderedInstanceSlots} != ${first.placedCount * 2}`);

			disposeVegetation(first.group);
			fail(geometryDisposeCount === 6 && materialDisposeCount === 6,
				`dispose counts ${geometryDisposeCount}/${materialDisposeCount} != 6/6`);
			disposeVegetation(second.group);
			return {
				targetCount: first.targetCount,
				placedCount: first.placedCount,
				baseHabitatRejected: first.baseHabitatRejected,
				meshCount: perMesh.length,
				perMesh,
				geometryDisposeCount,
				materialDisposeCount,
				policyId: VEGETATION_SILHOUETTE_POLICY.id,
			};
		});
		assert(result.placedCount > 0 && result.placedCount <= result.targetCount, 'bounded habitat placement escaped browser contract');
		assert(result.baseHabitatRejected > 0, 'habitat rejection metadata escaped browser contract');
		console.log('[checkVegetationVisualContract] PASS', JSON.stringify(result));
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkVegetationVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
