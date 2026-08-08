#!/usr/bin/env node
/**
 * checkVegetationVisualContract.js — live-browser rendered vegetation contract.
 *
 * Existing vegetation regressions validate deterministic placement, mobile LOD/culling and spawn
 * behavior. This companion guard validates the desktop-rendered InstancedMesh structure itself:
 * two species, trunk/foliage pairing, stable primitive/material signatures, finite transforms,
 * static instance buffers, non-zero deterministic placement, and complete geometry/material
 * teardown. Runtime sources are not modified by this check.
 *
 * Usage: node scripts/checkVegetationVisualContract.js
 * Exit codes: 0 = PASS, 1 = contract failure, 2 = Playwright unavailable.
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
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const { createVegetation, disposeVegetation } = await import('/src/3d/world/vegetation.js');

			const fail = (condition, message) => {
				if (!condition) throw new Error(message);
			};
			const nearlyEqual = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

			const sampleHeightMeters = () => 25;
			const options = {
				sampleHeightMeters,
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
			fail(first.group.children.length === 4, `expected 4 vegetation meshes, got ${first.group.children.length}`);
			fail(first.targetCount > 0, `expected positive targetCount, got ${first.targetCount}`);
			fail(first.placedCount === first.targetCount, `flat safe terrain should place all trees: ${first.placedCount}/${first.targetCount}`);
			fail(first.clusterSeatCount === 0, `expected no seat clusters, got ${first.clusterSeatCount}`);
			fail(second.placedCount === first.placedCount, 'same seed/options changed vegetation placedCount');

			const expectedColors = [0x5b4028, 0x2f5c26, 0x5b4028, 0x4a7a2e].map((hex) => new THREE.Color(hex));
			const expectedRoughness = [1, 0.9, 1, 0.9];
			const matrixA = new THREE.Matrix4();
			const matrixB = new THREE.Matrix4();
			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			let totalRenderedInstances = 0;
			const perMeshCounts = [];

			for (let i = 0; i < first.group.children.length; i++) {
				const mesh = first.group.children[i];
				const twin = second.group.children[i];
				fail(mesh?.isInstancedMesh === true, `child ${i} is not an InstancedMesh`);
				fail(twin?.isInstancedMesh === true, `determinism twin child ${i} is not an InstancedMesh`);
				fail(mesh.geometry?.isBufferGeometry === true, `child ${i} geometry is not BufferGeometry`);
				fail(mesh.material?.isMeshStandardMaterial === true, `child ${i} material is not MeshStandardMaterial`);
				fail(mesh.instanceMatrix.usage === THREE.StaticDrawUsage, `child ${i} instance buffer is not StaticDrawUsage`);
				fail(mesh.count === twin.count, `child ${i} instance count changed for identical seed/options`);
				fail(mesh.count >= 0 && mesh.count <= first.targetCount, `child ${i} instance count out of range: ${mesh.count}`);
				fail(nearlyEqual(mesh.material.roughness, expectedRoughness[i]), `child ${i} roughness drifted to ${mesh.material.roughness}`);
				fail(nearlyEqual(mesh.material.metalness, 0), `child ${i} metalness drifted to ${mesh.material.metalness}`);
				fail(mesh.material.color.distanceTo(expectedColors[i]) <= 1e-9, `child ${i} material color drifted`);

				const positions = mesh.geometry.getAttribute('position');
				const normals = mesh.geometry.getAttribute('normal');
				fail(Boolean(positions && normals), `child ${i} geometry is missing position/normal attributes`);
				fail(positions.count > 0 && normals.count === positions.count, `child ${i} geometry attribute counts are invalid`);
				for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
					fail(Number.isFinite(positions.getX(vertexIndex)) && Number.isFinite(positions.getY(vertexIndex)) && Number.isFinite(positions.getZ(vertexIndex)), `child ${i} has non-finite position at ${vertexIndex}`);
					fail(Number.isFinite(normals.getX(vertexIndex)) && Number.isFinite(normals.getY(vertexIndex)) && Number.isFinite(normals.getZ(vertexIndex)), `child ${i} has non-finite normal at ${vertexIndex}`);
				}

				for (let instanceIndex = 0; instanceIndex < mesh.count; instanceIndex++) {
					mesh.getMatrixAt(instanceIndex, matrixA);
					twin.getMatrixAt(instanceIndex, matrixB);
					for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
						const a = matrixA.elements[elementIndex];
						const b = matrixB.elements[elementIndex];
						fail(Number.isFinite(a), `child ${i} instance ${instanceIndex} has non-finite matrix element`);
						fail(nearlyEqual(a, b, 1e-8), `child ${i} instance ${instanceIndex} matrix changed for identical seed/options`);
					}
				}

				mesh.geometry.addEventListener('dispose', () => geometryDisposeCount++);
				mesh.material.addEventListener('dispose', () => materialDisposeCount++);
				totalRenderedInstances += mesh.count;
				perMeshCounts.push(mesh.count);
			}

			fail(first.group.children[0].count === first.group.children[1].count, 'pine trunk/foliage counts diverged');
			fail(first.group.children[2].count === first.group.children[3].count, 'round trunk/foliage counts diverged');
			fail(totalRenderedInstances === first.placedCount * 2, `rendered instance total ${totalRenderedInstances} != placedCount*2 ${first.placedCount * 2}`);
			fail(first.group.children[0].count > 0, 'pine species unexpectedly placed zero trees');
			fail(first.group.children[2].count > 0, 'round species unexpectedly placed zero trees');

			disposeVegetation(first.group);
			fail(geometryDisposeCount === 4, `geometry dispose count ${geometryDisposeCount} != 4`);
			fail(materialDisposeCount === 4, `material dispose count ${materialDisposeCount} != 4`);
			disposeVegetation(second.group);

			return {
				targetCount: first.targetCount,
				placedCount: first.placedCount,
				perMeshCounts,
				geometryDisposeCount,
				materialDisposeCount,
			};
		});

		assert(result.targetCount === result.placedCount, 'target/placed count mismatch escaped browser contract');
		console.log(
			'[checkVegetationVisualContract] PASS: ' +
				`${result.placedCount} deterministic trees, mesh counts ${result.perMeshCounts.join('/')}, ` +
				`4 InstancedMeshes, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`,
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkVegetationVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
