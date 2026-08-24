#!/usr/bin/env node
/**
 * Live-browser regression guard for the medieval road-surface layer.
 * It keeps the proven 13-edge/14-seat topology and one-mesh geometry contract intact while checking
 * deterministic wheel-rut/mud/stone plus the geographic dry-mineral variation added from the
 * owner-supplied photogrammetry reference.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkMedievalRoadSurface] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

		const result = await page.evaluate(async () => {
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { buildRoadNetwork, disposeRoadNetwork } = await import('/src/3d/world/roads.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };

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
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, x, z, groundY: sampleHeightMeters(x, z) };
			});

			const network = buildRoadNetwork({ seats, sampleHeightMeters });
			fail(seats.length === 14, `expected 14 seats, got ${seats.length}`);
			fail(network.edges.length === 13, `expected 13 connected MST edges, got ${network.edges.length}`);
			const expectedChildCount = network.footpathEdges.length > 0 ? 2 : 1;
			fail(
				network.group.children.length === expectedChildCount,
				`medieval surface added draw meshes: ${network.group.children.length}, expected ${expectedChildCount}`,
			);

			const mesh = network.group.children[0];
			fail(mesh?.name === 'roads', `expected children[0] to stay the cart-road mesh, got ${mesh?.name}`);
			const positions = mesh.geometry.getAttribute('position');
			const roadSide = mesh.geometry.getAttribute('roadSide');
			fail(Boolean(positions && roadSide), 'roadSide attribute missing');
			fail(roadSide.itemSize === 1, `roadSide itemSize ${roadSide.itemSize} != 1`);
			fail(roadSide.count === positions.count, `roadSide count ${roadSide.count} != position count ${positions.count}`);
			for (let i = 0; i < roadSide.count; i += 2) {
				fail(roadSide.getX(i) === -1 && roadSide.getX(i + 1) === 1, `roadSide pair drift at ${i}`);
			}

			const style = mesh.material.userData.medievalRoadSurfaceRun177;
			fail(style?.key === 'run177-medieval-road-surface-v2-geographic', `unexpected style key ${style?.key}`);
			fail(style.wheelRutOffsetNormalized === 0.47, 'wheel-rut offset drifted');
			fail(style.proceduralStoneThreshold === 0.955, 'stone threshold drifted');
			fail(style.dryMineralVariation === true, 'dry-mineral geographic variation disappeared');
			fail(style.extraDrawCalls === 0, 'road surface must not add draw-call meshes');
			fail(mesh.material.customProgramCacheKey() === 'run177-medieval-road-surface-v2-geographic', 'program cache key drifted');

			const shader = {
				vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
				fragmentShader: '#include <common>\nvoid main(){ vec4 diffuseColor = vec4(1.0);\n#include <color_fragment>\n}',
			};
			mesh.material.onBeforeCompile(shader, null);
			for (const token of ['attribute float roadSide', 'vRun177RoadSide', 'vRun177RoadPosition']) {
				fail(shader.vertexShader.includes(token), `vertex shader missing ${token}`);
			}
			for (const token of [
				'run177RoadHash',
				'run177WheelRut',
				'run177MudPatch',
				'run177Stone',
				'run177ShoulderWear',
				'run177DryNoise',
				'run177MineralNoise',
				'run177MineralDust',
			]) {
				fail(shader.fragmentShader.includes(token), `fragment shader missing ${token}`);
			}

			const adjacency = new Map(seats.map((seat) => [seat.id, []]));
			for (const edge of network.edges) {
				adjacency.get(edge.fromId)?.push(edge.toId);
				adjacency.get(edge.toId)?.push(edge.fromId);
			}
			const seen = new Set([seats[0].id]);
			const queue = [seats[0].id];
			while (queue.length) {
				const id = queue.shift();
				for (const next of adjacency.get(id) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
			}
			fail(seen.size === seats.length, `road graph reaches ${seen.size}/${seats.length} seats`);

			const totalLengthMeters = network.totalLengthMeters;
			const vertexCount = positions.count;
			disposeRoadNetwork(network.group);
			return { seatCount: seats.length, edgeCount: network.edges.length, reached: seen.size, totalLengthMeters, vertexCount };
		});

		assert(result.reached === 14, `road network reaches only ${result.reached}/14 seats`);
		console.log(
			`[checkMedievalRoadSurface] PASS: ${result.edgeCount} edges connect ${result.reached}/${result.seatCount} seats, ` +
			`${(result.totalLengthMeters / 1000).toFixed(2)}km one-mesh road, ${result.vertexCount} vertices; ` +
			'wheel-rut/mud/stone + dry mineral surface, +0 draw-call meshes.',
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkMedievalRoadSurface] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
