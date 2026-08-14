#!/usr/bin/env node
/**
 * checkTerrainVisualContract.js — live-browser rendered terrain regression contract.
 * Validates the existing desktop terrain mesh topology, deterministic height/color baking,
 * neighboring chunk seam continuity, material signature, metadata and teardown without runtime changes.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkTerrainVisualContract] SKIP: Playwright is not available in this environment.');
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
			const { createTerrainChunk, createHeightSampler, disposeTerrainChunk, DEFAULT_MAX_HEIGHT_METERS } = await import('/src/3d/world/terrain.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const colorClose = (attribute, index, expected, tolerance = 2e-6) =>
				close(attribute.getX(index), expected.r, tolerance) &&
				close(attribute.getY(index), expected.g, tolerance) &&
				close(attribute.getZ(index), expected.b, tolerance);
			const size = 500;
			const segments = 64;
			const seed = WORLD_DEFAULTS.WORLD_SEED;
			const first = createTerrainChunk({ chunkX: 0, chunkZ: 0, size, segments, seed });
			const twin = createTerrainChunk({ chunkX: 0, chunkZ: 0, size, segments, seed });
			const east = createTerrainChunk({ chunkX: 1, chunkZ: 0, size, segments, seed });
			const sampler = createHeightSampler(seed);
			const lowColor = new THREE.Color(0x3d6b28);
			const highColor = new THREE.Color(0x6b6152);
			const expectedColor = new THREE.Color();

			fail(first?.isMesh === true && twin?.isMesh === true && east?.isMesh === true, 'terrain output is not THREE.Mesh');
			fail(first.geometry?.type === 'PlaneGeometry', `terrain geometry type ${first.geometry?.type} != PlaneGeometry`);
			fail(first.geometry.parameters?.width === size && first.geometry.parameters?.height === size, 'terrain plane size drifted');
			fail(first.geometry.parameters?.widthSegments === segments && first.geometry.parameters?.heightSegments === segments, 'terrain segment count drifted');
			fail(first.material?.isMeshStandardMaterial === true, 'terrain material is not MeshStandardMaterial');
			fail(first.material.vertexColors === true, 'terrain material no longer uses vertex colors');
			fail(close(first.material.roughness, 1) && close(first.material.metalness, 0), 'terrain material roughness/metalness drifted');
			fail(close(first.position.x, 0) && close(first.position.y, 0) && close(first.position.z, 0), 'origin chunk mesh position drifted');
			fail(close(east.position.x, size) && close(east.position.z, 0), 'east chunk world position drifted');
			fail(first.userData?.chunkCoord?.x === 0 && first.userData?.chunkCoord?.z === 0, 'chunkCoord metadata drifted');
			fail(close(first.userData?.areaKm2, 0.25), `areaKm2 drifted to ${first.userData?.areaKm2}`);

			const positions = first.geometry.getAttribute('position');
			const normals = first.geometry.getAttribute('normal');
			const colors = first.geometry.getAttribute('color');
			const twinPositions = twin.geometry.getAttribute('position');
			const twinNormals = twin.geometry.getAttribute('normal');
			const twinColors = twin.geometry.getAttribute('color');
			const index = first.geometry.index;
			fail(positions?.count === 4225, `terrain position count ${positions?.count} != 4225`);
			fail(normals?.count === positions.count && colors?.count === positions.count, 'terrain normal/color attribute count mismatch');
			fail(index?.count === 24576, `terrain index count ${index?.count} != 24576`);
			fail(twinPositions?.count === positions.count && twinNormals?.count === normals.count && twinColors?.count === colors.count, 'deterministic twin topology drifted');

			for (let i = 0; i < positions.count; i++) {
				const x = positions.getX(i);
				const y = positions.getY(i);
				const z = positions.getZ(i);
				const nx = normals.getX(i);
				const ny = normals.getY(i);
				const nz = normals.getZ(i);
				fail(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite terrain position at ${i}`);
				fail(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz), `non-finite terrain normal at ${i}`);
				const normalLength = Math.hypot(nx, ny, nz);
				fail(close(normalLength, 1, 2e-5), `terrain normal length drift at ${i}: ${normalLength}`);
				const sampledHeight = sampler(first.position.x + x, first.position.z + z, DEFAULT_MAX_HEIGHT_METERS);
				fail(close(y, sampledHeight, 2e-5), `rendered height != sampler at vertex ${i}: ${y} vs ${sampledHeight}`);
				const fraction = THREE.MathUtils.clamp(sampledHeight / DEFAULT_MAX_HEIGHT_METERS, 0, 1);
				expectedColor.copy(lowColor).lerp(highColor, Math.pow(fraction, 1.5));
				fail(colorClose(colors, i, expectedColor), `terrain vertex color drift at ${i}`);
				fail(close(x, twinPositions.getX(i), 0) && close(y, twinPositions.getY(i), 0) && close(z, twinPositions.getZ(i), 0), `deterministic position drift at ${i}`);
				fail(close(nx, twinNormals.getX(i), 0) && close(ny, twinNormals.getY(i), 0) && close(nz, twinNormals.getZ(i), 0), `deterministic normal drift at ${i}`);
				fail(close(colors.getX(i), twinColors.getX(i), 0) && close(colors.getY(i), twinColors.getY(i), 0) && close(colors.getZ(i), twinColors.getZ(i), 0), `deterministic color drift at ${i}`);
			}
			for (let i = 0; i < index.count; i++) {
				const value = index.getX(i);
				fail(Number.isInteger(value) && value >= 0 && value < positions.count, `invalid terrain index ${value} at ${i}`);
				fail(value === twin.geometry.index.getX(i), `deterministic index drift at ${i}`);
			}

			const eastPositions = east.geometry.getAttribute('position');
			const eastColors = east.geometry.getAttribute('color');
			const eastSeam = new Map();
			for (let i = 0; i < eastPositions.count; i++) {
				if (!close(eastPositions.getX(i), -size / 2, 1e-6)) continue;
				const worldZ = east.position.z + eastPositions.getZ(i);
				eastSeam.set(worldZ.toFixed(6), {
					y: eastPositions.getY(i),
					color: [eastColors.getX(i), eastColors.getY(i), eastColors.getZ(i)],
				});
			}
			let seamCount = 0;
			for (let i = 0; i < positions.count; i++) {
				if (!close(positions.getX(i), size / 2, 1e-6)) continue;
				const worldZ = first.position.z + positions.getZ(i);
				const neighbor = eastSeam.get(worldZ.toFixed(6));
				fail(Boolean(neighbor), `east seam missing worldZ ${worldZ}`);
				fail(close(positions.getY(i), neighbor.y, 2e-5), `east/west seam height mismatch at worldZ ${worldZ}`);
				fail(close(colors.getX(i), neighbor.color[0], 2e-6) && close(colors.getY(i), neighbor.color[1], 2e-6) && close(colors.getZ(i), neighbor.color[2], 2e-6), `east/west seam color mismatch at worldZ ${worldZ}`);
				seamCount++;
			}
			fail(seamCount === segments + 1 && eastSeam.size === segments + 1, `seam vertex count ${seamCount}/${eastSeam.size} != ${segments + 1}`);

			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			first.geometry.addEventListener('dispose', () => geometryDisposeCount++);
			first.material.addEventListener('dispose', () => materialDisposeCount++);
			disposeTerrainChunk(first);
			fail(geometryDisposeCount === 1 && materialDisposeCount === 1, `terrain dispose counts ${geometryDisposeCount}/${materialDisposeCount} != 1/1`);
			disposeTerrainChunk(twin);
			disposeTerrainChunk(east);
			return { vertexCount: positions.count, indexCount: index.count, seamCount, geometryDisposeCount, materialDisposeCount };
		});
		assert(result.vertexCount === 4225 && result.indexCount === 24576, 'terrain topology mismatch escaped browser contract');
		console.log(`[checkTerrainVisualContract] PASS: ${result.vertexCount} vertices, ${result.indexCount} indices, ${result.seamCount}/65 seam vertices continuous, sampler/color/material contract PASS, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkTerrainVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
