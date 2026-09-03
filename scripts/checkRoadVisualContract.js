#!/usr/bin/env node
/**
 * checkRoadVisualContract.js — live-browser visual geometry contract for the kingdom road ribbon.
 *
 * The existing roadNetworkSafetyCheck validates topology/routing/world-safety. This companion guard
 * validates what the routed network actually renders: the cart-road tier's merged mesh (stable 8m
 * ribbon width, 0.06m terrain lift, vertex/color/normal/index topology, intended dirt material) and,
 * since run 314/ADR-0264, the second "patika" footpath tier's own merged mesh (same shape of
 * contract, its own 2.5m width/pale color) when the current seat layout produces at least one
 * footpath edge — plus teardown for both. Runtime sources are not modified by this check.
 *
 * Usage: node scripts/checkRoadVisualContract.js
 * Exit codes: 0 = PASS, 1 = contract failure, 2 = Playwright unavailable.
 */

const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const EXPECTED_ROAD_WIDTH_METERS = 8;
const EXPECTED_FOOTPATH_WIDTH_METERS = 2.5;
const EXPECTED_VERTICAL_OFFSET_METERS = 0.06;
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
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

		const result = await page.evaluate(async ({
			expectedWidth,
			expectedFootpathWidth,
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
			const expectedChildCount = network.footpathEdges.length > 0 ? 2 : 1;
			fail(
				network.group.children.length === expectedChildCount,
				`expected ${expectedChildCount} road-network mesh(es) (cart road + patika if any footpath qualifies), got ${network.group.children.length}`,
			);

			/** Validates one tier's merged mesh against its own expected name/width/color, mirroring
			 * the single-tier checks this file ran before run 314/ADR-0264 — same assertions, now
			 * parameterized so both the cart-road and patika tiers share one implementation instead of
			 * duplicating ~80 lines. Disposal is checked once for the whole network afterward (see
			 * below), not per tier, since `disposeRoadNetwork` tears down every child together. */
			function checkTierMesh(mesh, { expectedName, edges, expectedWidth, expectedColorHex }) {
				fail(mesh?.name === expectedName, `unexpected mesh name: ${mesh?.name}`);
				fail(mesh.isMesh === true, `road-network child '${expectedName}' is not a THREE.Mesh`);

				const geometry = mesh.geometry;
				const positions = geometry.getAttribute('position');
				const colors = geometry.getAttribute('color');
				const normals = geometry.getAttribute('normal');
				const index = geometry.getIndex();
				fail(Boolean(positions && colors && normals && index), `${expectedName} geometry is missing position/color/normal/index data`);

				const totalPointCount = edges.reduce((sum, edge) => sum + edge.points.length, 0);
				const expectedVertexCount = totalPointCount * 2;
				const expectedIndexCount = edges.reduce((sum, edge) => sum + Math.max(0, edge.points.length - 1) * 6, 0);
				fail(positions.count === expectedVertexCount, `${expectedName} position count ${positions.count} != ${expectedVertexCount}`);
				fail(colors.count === expectedVertexCount, `${expectedName} color count ${colors.count} != ${expectedVertexCount}`);
				fail(normals.count === expectedVertexCount, `${expectedName} normal count ${normals.count} != ${expectedVertexCount}`);
				fail(index.count === expectedIndexCount, `${expectedName} index count ${index.count} != ${expectedIndexCount}`);

				const expectedColor = new THREE.Color(expectedColorHex);
				let vertexCursor = 0;
				let minMeasuredWidth = Infinity;
				let maxMeasuredWidth = 0;
				for (const edge of edges) {
					fail(edge.points.length >= 2, `${expectedName} ${edge.fromId}->${edge.toId} has fewer than 2 routed points`);
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

						fail(nearlyEqual(centerX, point.x, positionTolerance), `${expectedName} ribbon center X drift at vertex ${vertexCursor}`);
						fail(nearlyEqual(centerZ, point.z, positionTolerance), `${expectedName} ribbon center Z drift at vertex ${vertexCursor}`);
						// Run 443: these two assertions replace a pair that had been red since run 406 and were
						// therefore guarding nothing — the same failure mode as the wind-grass contract that
						// threw "is not a function" for sixty runs.
						//
						// They asserted that `centerY` equals the *centreline's* ground plus the offset, and
						// that the two edge vertices agree in Y. Run 390 deliberately stopped both being
						// true: each edge of the ribbon is now founded on the terrain **under that edge**,
						// because taking one mid-road sample for something 8 m wide floats the downhill edge
						// on any cross-slope (a 30-degree cross-slope lifts a 4 m half-width by 2.3 m) and
						// buries the uphill one. The contract was forbidding what the fix does.
						//
						// What replaces them is the invariant `appendRoadRibbon` actually implements, and it
						// is a stronger claim than either of the two it retires: every edge vertex sits on
						// the ground beneath *itself*, plus the offset.
						fail(
							nearlyEqual(left.y, sampleHeightMeters(left.x, left.z) + expectedOffset, positionTolerance),
							`${expectedName} left vertex is not grounded on its own terrain at vertex ${vertexCursor}`,
						);
						fail(
							nearlyEqual(right.y, sampleHeightMeters(right.x, right.z) + expectedOffset, positionTolerance),
							`${expectedName} right vertex is not grounded on its own terrain at vertex ${vertexCursor}`,
						);
						fail(nearlyEqual(measuredWidth, expectedWidth, widthTolerance), `${expectedName} width ${measuredWidth.toFixed(3)}m != ${expectedWidth}m at vertex ${vertexCursor}`);

						for (const i of [leftIndex, rightIndex]) {
							fail(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)), `${expectedName} non-finite position at ${i}`);
							fail(Number.isFinite(normals.getX(i)) && Number.isFinite(normals.getY(i)) && Number.isFinite(normals.getZ(i)), `${expectedName} non-finite normal at ${i}`);
							fail(nearlyEqual(colors.getX(i), expectedColor.r, colorTolerance), `${expectedName} color R drift at ${i}`);
							fail(nearlyEqual(colors.getY(i), expectedColor.g, colorTolerance), `${expectedName} color G drift at ${i}`);
							fail(nearlyEqual(colors.getZ(i), expectedColor.b, colorTolerance), `${expectedName} color B drift at ${i}`);
						}
						vertexCursor += 2;
					}
				}
				fail(vertexCursor === expectedVertexCount, `${expectedName} visited ${vertexCursor} vertices, expected ${expectedVertexCount}`);

				for (let i = 0; i < index.count; i++) {
					const vertexIndex = index.getX(i);
					fail(Number.isInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < expectedVertexCount, `${expectedName} out-of-range index ${vertexIndex} at ${i}`);
				}

				const material = mesh.material;
				fail(material?.isMeshStandardMaterial === true, `${expectedName} no longer uses MeshStandardMaterial`);
				fail(material.vertexColors === true, `${expectedName} material vertexColors must stay enabled`);
				fail(nearlyEqual(material.roughness, 0.95, 1e-9), `${expectedName} roughness drifted to ${material.roughness}`);
				fail(nearlyEqual(material.metalness, 0, 1e-9), `${expectedName} metalness drifted to ${material.metalness}`);
				fail(material.side === THREE.DoubleSide, `${expectedName} material side ${material.side} != THREE.DoubleSide`);

				return { vertexCount: expectedVertexCount, indexCount: expectedIndexCount, minMeasuredWidth, maxMeasuredWidth };
			}

			const cartResult = checkTierMesh(network.group.children[0], {
				expectedName: 'roads',
				edges: network.edges,
				expectedWidth,
				expectedColorHex: 0x9c7b4a,
			});
			const footpathResult = network.footpathEdges.length > 0
				? checkTierMesh(network.group.children[1], {
					expectedName: 'patika',
					edges: network.footpathEdges,
					expectedWidth: expectedFootpathWidth,
					expectedColorHex: 0xbfae82,
				})
				: null;

			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			for (const mesh of network.group.children) {
				mesh.geometry.addEventListener('dispose', () => geometryDisposeCount++);
				mesh.material.addEventListener('dispose', () => materialDisposeCount++);
			}
			disposeRoadNetwork(network.group);
			fail(geometryDisposeCount === network.group.children.length, `geometry dispose count ${geometryDisposeCount} != ${network.group.children.length}`);
			fail(materialDisposeCount === network.group.children.length, `material dispose count ${materialDisposeCount} != ${network.group.children.length}`);

			return {
				seatCount: seats.length,
				edgeCount: network.edges.length,
				footpathEdgeCount: network.footpathEdges.length,
				vertexCount: cartResult.vertexCount,
				indexCount: cartResult.indexCount,
				minMeasuredWidth: cartResult.minMeasuredWidth,
				maxMeasuredWidth: cartResult.maxMeasuredWidth,
				footpathMinMeasuredWidth: footpathResult?.minMeasuredWidth ?? null,
				footpathMaxMeasuredWidth: footpathResult?.maxMeasuredWidth ?? null,
				totalLengthMeters: network.totalLengthMeters,
				footpathTotalLengthMeters: network.footpathTotalLengthMeters,
				geometryDisposeCount,
				materialDisposeCount,
			};
		}, {
			expectedWidth: EXPECTED_ROAD_WIDTH_METERS,
			expectedFootpathWidth: EXPECTED_FOOTPATH_WIDTH_METERS,
			expectedOffset: EXPECTED_VERTICAL_OFFSET_METERS,
			positionTolerance: POSITION_TOLERANCE_METERS,
			widthTolerance: WIDTH_TOLERANCE_METERS,
			colorTolerance: COLOR_TOLERANCE,
		});

		assert(result.seatCount === 14, `expected 14 kingdom seats, got ${result.seatCount}`);
		assert(result.edgeCount === 13, `expected 13 MST road edges, got ${result.edgeCount}`);
		const footpathSummary = result.footpathEdgeCount > 0
			? `, patika ${result.footpathEdgeCount} edge(s) width ${result.footpathMinMeasuredWidth.toFixed(3)}-${result.footpathMaxMeasuredWidth.toFixed(3)}m ${(result.footpathTotalLengthMeters / 1000).toFixed(2)}km`
			: ', patika 0 edges (no qualifying local pair for this seat layout)';
		console.log(
			'[checkRoadVisualContract] PASS: ' +
				`${result.edgeCount} edges, ${result.vertexCount} vertices, ${result.indexCount} indices, ` +
				`width ${result.minMeasuredWidth.toFixed(3)}-${result.maxMeasuredWidth.toFixed(3)}m, ` +
				`road ${(result.totalLengthMeters / 1000).toFixed(2)}km${footpathSummary}, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`,
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
