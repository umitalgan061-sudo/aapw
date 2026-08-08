#!/usr/bin/env node
/**
 * checkRoadVisualContract.js — live-browser visual geometry contract for the kingdom road ribbon.
 *
 * The existing roadNetworkSafetyCheck validates topology/routing/world-safety. This companion guard
 * validates what the routed network actually renders: one merged mesh, stable 8m ribbon width,
 * 0.4m terrain lift, vertex/color/normal/index topology, intended dirt material, and teardown.
 * Runtime sources are not modified by this check.
 *
 * Usage: node scripts/checkRoadVisualContract.js
 * Exit codes: 0 = PASS, 1 = contract failure, 2 = Playwright unavailable.
 */

const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const EXPECTED_ROAD_WIDTH_METERS = 8;
const EXPECTED_VERTICAL_OFFSET_METERS = 0.4;
const POSITION_TOLERANCE_METERS = 0.02;
const WIDTH_TOLERANCE_METERS = 0.05;
const COLOR_TOLERANCE = 1e-6;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRoadVisualContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });

		const result = await page.evaluate(async ({
			expectedWidth,
			expectedOffset,
			positionTolerance,
			widthTolerance,
			colorTolerance,
		}) => {
			const THREE = await import('three');
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { buildRoadNetwork, disposeRoadNetwork } = await import('/src/3d/world/roads.js');

			const fail = (condition, message) => {
				if (!condition) throw new Error(message);
			};
			const nearlyEqual = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

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
				const { x, z } = mapToWorldXZ(
					seat.mapX,
					seat.mapY,
					WORLD_SCALE.MAP_BOUNDS,
					WORLD_SCALE.METERS_PER_MAP_UNIT,
				);
				return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
			});

			const network = buildRoadNetwork({ seats, sampleHeightMeters });
			fail(network.group?.name === 'road-network', `unexpected group name: ${network.group?.name}`);
			fail(network.group.children.length === 1, `expected one merged road mesh, got ${network.group.children.length}`);

			const mesh = network.group.children[0];
			fail(mesh?.name === 'roads', `unexpected mesh name: ${mesh?.name}`);
			fail(mesh.isMesh === true, 'road-network child is not a THREE.Mesh');

			const geometry = mesh.geometry;
			const positions = geometry.getAttribute('position');
			const colors = geometry.getAttribute('color');
			const normals = geometry.getAttribute('normal');
			const index = geometry.getIndex();
			fail(Boolean(positions && colors && normals && index), 'road geometry is missing position/color/normal/index data');

			const totalPointCount = network.edges.reduce((sum, edge) => sum + edge.points.length, 0);
			const expectedVertexCount = totalPointCount * 2;
			const expectedIndexCount = network.edges.reduce((sum, edge) => sum + Math.max(0, edge.points.length - 1) * 6, 0);
			fail(positions.count === expectedVertexCount, `position count ${positions.count} != ${expectedVertexCount}`);
			fail(colors.count === expectedVertexCount, `color count ${colors.count} != ${expectedVertexCount}`);
			fail(normals.count === expectedVertexCount, `normal count ${normals.count} != ${expectedVertexCount}`);
			fail(index.count === expectedIndexCount, `index count ${index.count} != ${expectedIndexCount}`);

			const expectedColor = new THREE.Color(0x9c7b4a);
			let vertexCursor = 0;
			let minMeasuredWidth = Infinity;
			let maxMeasuredWidth = 0;
			for (const edge of network.edges) {
				fail(edge.points.length >= 2, `${edge.fromId}->${edge.toId} has fewer than 2 routed points`);
				for (const point of edge.points) {
					const leftIndex = vertexCursor;
					const rightIndex = vertexCursor + 1;
					const left = { x: positions.getX(leftIndex), y: positions.getY(leftIndex), z: positions.getZ(leftIndex) };
					const right = { x: positions.getX(rightIndex), y: positions.getY(rightIndex), z: positions.getZ(rightIndex) };
					const centerX = (left.x + right.x) / 2;
					const centerY = (left.y + right.y) / 2;
					const centerZ = (left.z + right.z) / 2;
					const measuredWidth = Math.hypot(left.x - right.x, left.z - right.z);
					minMeasuredWidth = Math.min(minMeasuredWidth, measuredWidth);
					maxMeasuredWidth = Math.max(maxMeasuredWidth, measuredWidth);

					fail(nearlyEqual(centerX, point.x, positionTolerance), `ribbon center X drift at vertex ${vertexCursor}`);
					fail(nearlyEqual(centerZ, point.z, positionTolerance), `ribbon center Z drift at vertex ${vertexCursor}`);
					fail(nearlyEqual(centerY, point.y + expectedOffset, positionTolerance), `ribbon vertical offset drift at vertex ${vertexCursor}`);
					fail(nearlyEqual(left.y, right.y, positionTolerance), `left/right road vertices disagree in Y at vertex ${vertexCursor}`);
					fail(nearlyEqual(measuredWidth, expectedWidth, widthTolerance), `road width ${measuredWidth.toFixed(3)}m != ${expectedWidth}m at vertex ${vertexCursor}`);

					for (const i of [leftIndex, rightIndex]) {
						fail(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)), `non-finite position at ${i}`);
						fail(Number.isFinite(normals.getX(i)) && Number.isFinite(normals.getY(i)) && Number.isFinite(normals.getZ(i)), `non-finite normal at ${i}`);
						fail(nearlyEqual(colors.getX(i), expectedColor.r, colorTolerance), `road color R drift at ${i}`);
						fail(nearlyEqual(colors.getY(i), expectedColor.g, colorTolerance), `road color G drift at ${i}`);
						fail(nearlyEqual(colors.getZ(i), expectedColor.b, colorTolerance), `road color B drift at ${i}`);
					}
					vertexCursor += 2;
				}
			}
			fail(vertexCursor === expectedVertexCount, `visited ${vertexCursor} vertices, expected ${expectedVertexCount}`);

			for (let i = 0; i < index.count; i++) {
				const vertexIndex = index.getX(i);
				fail(Number.isInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < expectedVertexCount, `out-of-range road index ${vertexIndex} at ${i}`);
			}

			const material = mesh.material;
			fail(material?.isMeshStandardMaterial === true, 'roads no longer use MeshStandardMaterial');
			fail(material.vertexColors === true, 'roads material vertexColors must stay enabled');
			fail(nearlyEqual(material.roughness, 0.95, 1e-9), `roads roughness drifted to ${material.roughness}`);
			fail(nearlyEqual(material.metalness, 0, 1e-9), `roads metalness drifted to ${material.metalness}`);
			fail(material.side === THREE.DoubleSide, `roads material side ${material.side} != THREE.DoubleSide`);

			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			geometry.addEventListener('dispose', () => geometryDisposeCount++);
			material.addEventListener('dispose', () => materialDisposeCount++);
			disposeRoadNetwork(network.group);
			fail(geometryDisposeCount === 1, `geometry dispose count ${geometryDisposeCount} != 1`);
			fail(materialDisposeCount === 1, `material dispose count ${materialDisposeCount} != 1`);

			return {
				seatCount: seats.length,
				edgeCount: network.edges.length,
				vertexCount: expectedVertexCount,
				indexCount: expectedIndexCount,
				minMeasuredWidth,
				maxMeasuredWidth,
				totalLengthMeters: network.totalLengthMeters,
				geometryDisposeCount,
				materialDisposeCount,
			};
		}, {
			expectedWidth: EXPECTED_ROAD_WIDTH_METERS,
			expectedOffset: EXPECTED_VERTICAL_OFFSET_METERS,
			positionTolerance: POSITION_TOLERANCE_METERS,
			widthTolerance: WIDTH_TOLERANCE_METERS,
			colorTolerance: COLOR_TOLERANCE,
		});

		assert(result.seatCount === 14, `expected 14 kingdom seats, got ${result.seatCount}`);
		assert(result.edgeCount === 13, `expected 13 MST road edges, got ${result.edgeCount}`);
		console.log(
			'[checkRoadVisualContract] PASS: ' +
				`${result.edgeCount} edges, ${result.vertexCount} vertices, ${result.indexCount} indices, ` +
				`width ${result.minMeasuredWidth.toFixed(3)}-${result.maxMeasuredWidth.toFixed(3)}m, ` +
				`road ${(result.totalLengthMeters / 1000).toFixed(2)}km, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`,
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRoadVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
