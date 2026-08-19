#!/usr/bin/env node
/**
 * checkVegetationVisualContract.js — live-browser rendered vegetation regression contract.
 * Validates the existing desktop InstancedMesh structure, deterministic transforms/materials,
 * species geometry signatures, trunk/foliage alignment and teardown without changing runtime behavior.
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
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const { createVegetation, disposeVegetation } = await import('/src/3d/world/vegetation.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
			const colorClose = (actual, expected) => close(actual.r, expected.r) && close(actual.g, expected.g) && close(actual.b, expected.b);
			const matrixClose = (a, b, tolerance = 1e-8) => a.elements.every((value, index) => Number.isFinite(value) && close(value, b.elements[index], tolerance));
			const options = {
				sampleHeightMeters: () => 25,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				seed: WORLD_DEFAULTS.WORLD_SEED,
				seats: [], roadEdges: [], radiusMeters: 1000, densityPerKm2: 30,
			};
			const first = createVegetation(options);
			const second = createVegetation(options);
			fail(first.group?.isGroup === true, 'vegetation root is not a THREE.Group');
			fail(first.group.children.length === 4, `expected 4 vegetation meshes, got ${first.group.children.length}`);
			fail(first.targetCount > 0 && first.placedCount === first.targetCount, `unexpected placement ${first.placedCount}/${first.targetCount}`);
			fail(first.clusterSeatCount === 0, `expected no cluster seats, got ${first.clusterSeatCount}`);
			fail(second.placedCount === first.placedCount, 'same seed/options changed placedCount');

			const expectedColors = [0x5b4028, 0x2f5c26, 0x5b4028, 0x4a7a2e].map((hex) => new THREE.Color(hex));
			const expectedRoughness = [1, 0.9, 1, 0.9];
			const expectedGeometry = [
				{ type: 'CylinderGeometry', params: { radiusTop: 0.22, radiusBottom: 0.38, height: 3.4, radialSegments: 6 } },
				{ type: 'ConeGeometry', params: { radius: 2.15, height: 5.6, radialSegments: 7 } },
				{ type: 'CylinderGeometry', params: { radiusTop: 0.2, radiusBottom: 0.34, height: 2.8, radialSegments: 6 } },
				{ type: 'SphereGeometry', params: { radius: 2.4, widthSegments: 7, heightSegments: 6 } },
			];
			const matrixA = new THREE.Matrix4();
			const matrixB = new THREE.Matrix4();
			const perMeshCounts = [];
			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			let totalRenderedInstances = 0;

			for (let meshIndex = 0; meshIndex < 4; meshIndex++) {
				const mesh = first.group.children[meshIndex];
				const twin = second.group.children[meshIndex];
				const signature = expectedGeometry[meshIndex];
				fail(mesh?.isInstancedMesh === true && twin?.isInstancedMesh === true, `child ${meshIndex} is not InstancedMesh`);
				fail(mesh.geometry?.isBufferGeometry === true, `child ${meshIndex} geometry is not BufferGeometry`);
				fail(mesh.geometry.type === signature.type, `child ${meshIndex} geometry type ${mesh.geometry.type} != ${signature.type}`);
				for (const [key, expected] of Object.entries(signature.params)) {
					fail(close(mesh.geometry.parameters?.[key], expected), `child ${meshIndex} geometry ${key} drifted to ${mesh.geometry.parameters?.[key]}`);
				}
				fail(mesh.material?.isMeshStandardMaterial === true, `child ${meshIndex} material is not MeshStandardMaterial`);
				fail(mesh.instanceMatrix.usage === THREE.StaticDrawUsage, `child ${meshIndex} instance matrix is not static`);
				fail(mesh.count === twin.count && mesh.count >= 0 && mesh.count <= first.targetCount, `child ${meshIndex} count invalid`);
				fail(close(mesh.material.roughness, expectedRoughness[meshIndex]), `child ${meshIndex} roughness drift`);
				fail(close(mesh.material.metalness, 0), `child ${meshIndex} metalness drift`);
				fail(colorClose(mesh.material.color, expectedColors[meshIndex]), `child ${meshIndex} color drift`);
				const positions = mesh.geometry.getAttribute('position');
				const normals = mesh.geometry.getAttribute('normal');
				fail(Boolean(positions && normals) && positions.count > 0 && positions.count === normals.count, `child ${meshIndex} geometry attributes invalid`);
				for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
					fail(Number.isFinite(positions.getX(vertexIndex)) && Number.isFinite(positions.getY(vertexIndex)) && Number.isFinite(positions.getZ(vertexIndex)), `child ${meshIndex} non-finite position`);
					fail(Number.isFinite(normals.getX(vertexIndex)) && Number.isFinite(normals.getY(vertexIndex)) && Number.isFinite(normals.getZ(vertexIndex)), `child ${meshIndex} non-finite normal`);
				}
				for (let instanceIndex = 0; instanceIndex < mesh.count; instanceIndex++) {
					mesh.getMatrixAt(instanceIndex, matrixA);
					twin.getMatrixAt(instanceIndex, matrixB);
					fail(matrixClose(matrixA, matrixB), `child ${meshIndex} deterministic matrix drift at instance ${instanceIndex}`);
				}
				mesh.geometry.addEventListener('dispose', () => geometryDisposeCount++);
				mesh.material.addEventListener('dispose', () => materialDisposeCount++);
				perMeshCounts.push(mesh.count);
				totalRenderedInstances += mesh.count;
			}

			const assertPairAligned = (trunkIndex, foliageIndex, label) => {
				const trunk = first.group.children[trunkIndex];
				const foliage = first.group.children[foliageIndex];
				fail(trunk.count === foliage.count, `${label} trunk/foliage count mismatch`);
				for (let instanceIndex = 0; instanceIndex < trunk.count; instanceIndex++) {
					trunk.getMatrixAt(instanceIndex, matrixA);
					foliage.getMatrixAt(instanceIndex, matrixB);
					fail(matrixClose(matrixA, matrixB), `${label} trunk/foliage transform mismatch at instance ${instanceIndex}`);
				}
			};
			assertPairAligned(0, 1, 'pine');
			assertPairAligned(2, 3, 'round');
			fail(first.group.children[0].count > 0 && first.group.children[2].count > 0, 'a vegetation species placed zero trees');
			fail(totalRenderedInstances === first.placedCount * 2, `rendered instances ${totalRenderedInstances} != ${first.placedCount * 2}`);
			disposeVegetation(first.group);
			fail(geometryDisposeCount === 4 && materialDisposeCount === 4, `dispose counts ${geometryDisposeCount}/${materialDisposeCount} != 4/4`);
			disposeVegetation(second.group);
			return { targetCount: first.targetCount, placedCount: first.placedCount, perMeshCounts, geometryDisposeCount, materialDisposeCount };
		});
		assert(result.targetCount === result.placedCount, 'target/placed mismatch escaped browser contract');
		console.log(`[checkVegetationVisualContract] PASS: ${result.placedCount} deterministic trees, mesh counts ${result.perMeshCounts.join('/')}, 4 InstancedMeshes, primitive signatures + pair alignment PASS, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}
main().catch((error) => {
	console.error(`[checkVegetationVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
