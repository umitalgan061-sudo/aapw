#!/usr/bin/env node
/**
 * Visual-verification evidence (GOVERNANCE.md §8.5) for run 314/ADR-0264's new "patika" footpath
 * tier: 2 real camera angles (near + far), real terrain chunks around the `ziya`<->`berk` footpath,
 * real `buildRoadNetwork` output (both tiers), real day/night lighting. Not modified by this check —
 * evidence capture only.
 *
 * Usage: node scripts/captureRun314FootpathEvidence.js
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[run314-footpath-visual] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const outDir = path.resolve('artifacts/run314-footpath');
	fs.mkdirSync(outDir, { recursive: true });

	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];

	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		page.on('pageerror', (e) => errors.push(`page:${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

		const summary = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { createHeightSampler, createTerrainChunk } = await import('/src/3d/world/terrain.js');
			const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
			const { createDayNightLighting, updateDayNightLighting } = await import('/src/3d/lighting.js');

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
			const footpathEdge = network.footpathEdges[0];
			if (!footpathEdge) throw new Error('no footpath edge found — nothing to capture');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x98b2c1);
			scene.add(network.group);
			const lights = createDayNightLighting(scene);
			updateDayNightLighting(lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS ?? 600, 0.42); // daylight

			const chunkSize = 500;
			const midX = (footpathEdge.points[0].x + footpathEdge.points[footpathEdge.points.length - 1].x) / 2;
			const midZ = (footpathEdge.points[0].z + footpathEdge.points[footpathEdge.points.length - 1].z) / 2;
			const centerChunkX = Math.floor(midX / chunkSize);
			const centerChunkZ = Math.floor(midZ / chunkSize);
			for (let dx = -1; dx <= 1; dx++) {
				for (let dz = -1; dz <= 1; dz++) {
					const chunk = createTerrainChunk({
						chunkX: centerChunkX + dx,
						chunkZ: centerChunkZ + dz,
						size: chunkSize,
						segments: 48,
						seed: WORLD_DEFAULTS.WORLD_SEED,
						flattenPads,
					});
					scene.add(chunk);
				}
			}

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1280, 720, false);
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.style.overflow = 'hidden';
			document.body.appendChild(renderer.domElement);

			const camera = new THREE.PerspectiveCamera(58, 1280 / 720, 0.5, 3000);
			const midY = (footpathEdge.points[0].y + footpathEdge.points[footpathEdge.points.length - 1].y) / 2;

			window.__RUN314_EVIDENCE__ = { renderer, scene, camera, midX, midY, midZ };
			return {
				footpathEdge: { fromId: footpathEdge.fromId, toId: footpathEdge.toId, lengthMeters: footpathEdge.lengthMeters, maxGradeDegrees: footpathEdge.maxGradeDegrees },
				cartEdgeCount: network.edges.length,
				midX, midY, midZ,
			};
		});

		if (errors.length) throw new Error(`console/page errors during scene build: ${errors.join('\n')}`);

		// Near view: low, close, looking along the footpath.
		await page.evaluate(() => {
			const { renderer, scene, camera, midX, midY, midZ } = window.__RUN314_EVIDENCE__;
			camera.position.set(midX - 22, midY + 9, midZ + 26);
			camera.lookAt(midX, midY + 1, midZ);
			camera.updateMatrixWorld(true);
			renderer.render(scene, camera);
		});
		await page.screenshot({ path: path.join(outDir, 'patika-near.png') });

		// Far view: elevated, wider, showing the footpath alongside the cart-road network around it.
		await page.evaluate(() => {
			const { renderer, scene, camera, midX, midY, midZ } = window.__RUN314_EVIDENCE__;
			camera.position.set(midX - 260, midY + 190, midZ + 300);
			camera.lookAt(midX, midY, midZ);
			camera.updateMatrixWorld(true);
			renderer.render(scene, camera);
		});
		await page.screenshot({ path: path.join(outDir, 'patika-far.png') });

		if (errors.length) throw new Error(`console/page errors: ${errors.join('\n')}`);
		console.log(`[run314-footpath-visual] PASS: 2 screenshots at ${outDir}, zero console/page errors.`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error(`[run314-footpath-visual] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
