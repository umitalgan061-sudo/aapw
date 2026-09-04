#!/usr/bin/env node
/**
 * checkRun330Villages.js — ADR-0276 evidence for `world/villages.js`: houses, stone stoops and field
 * walls actually cluster into hamlets around the kingdom seats, respect the shared placement
 * exclusions, and stay deterministic.
 *
 * Asserted:
 *   - determinism: the same seed produces byte-identical instance matrices (GOVERNANCE.md §8.9);
 *   - every house obeys `world/vegetation.js`'s `isPlaceablePosition` (no houses in water, on cliffs,
 *     on the castle pad or across a road) — the shared rule, re-checked independently here;
 *   - houses cluster: every house sits within the hamlet radius of its village's own centroid rather
 *     than being smeared around the seat. This is the assertion that distinguishes "a village" from
 *     "scattered farmsteads", which is exactly what the first implementation shipped;
 *   - no two houses interpenetrate (minimum centre spacing respected);
 *   - field walls actually get built — the first pass produced 1 wall for 120 houses because it
 *     paired houses in placement order instead of by position, and only a count assertion catches
 *     that class of "technically ran, achieved nothing" bug;
 *   - every house rests on the sampled ground, not floating or buried;
 *   - a rendered GPU read-back proves houses are visible, lit and textured (not black or flat).
 *
 * Usage: `node scripts/checkRun330Villages.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun330Villages
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run330-villages');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun330Villages] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/scripts/village-architecture-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createVillages } = await import('/src/3d/world/villages.js');
			const { isPlaceablePosition } = await import('/src/3d/world/vegetation.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');

			const failures = [];
			// Gently rolling synthetic ground, well above sea level: isolates the village logic from
			// whatever the real height field happens to do at a given seat.
			const sampleHeightMeters = (x, z) => 40 + Math.sin(x * 0.004) * 3 + Math.cos(z * 0.004) * 3;
			const seaLevelMeters = 0;
			const seats = [{ x: 0, z: 0 }, { x: 1400, z: -900 }, { x: -1100, z: 700 }];
			const args = {
				sampleHeightMeters,
				seaLevelMeters,
				seed: 1337,
				seats,
				roadEdges: [],
				radiusMeters: 6000,
				mulberry32,
				housesPerVillage: 12,
			};

			const first = createVillages(args);
			const second = createVillages({ ...args });

			if (first.houseCount !== second.houseCount || first.wallCount !== second.wallCount) {
				failures.push(`non-deterministic counts: ${first.houseCount}/${first.wallCount} vs ${second.houseCount}/${second.wallCount}`);
			}
			const readMatrices = (group, childIndex, count) => {
				const mesh = group.children[childIndex];
				const out = [];
				const matrix = new THREE.Matrix4();
				for (let i = 0; i < count; i++) {
					mesh.getMatrixAt(i, matrix);
					out.push([...matrix.elements]);
				}
				return out;
			};
			const bodiesA = readMatrices(first.group, 0, first.houseCount);
			const bodiesB = readMatrices(second.group, 0, second.houseCount);
			for (let i = 0; i < bodiesA.length; i++) {
				if (bodiesA[i].some((value, j) => value !== bodiesB[i][j])) {
					failures.push(`house #${i} instance matrix differs between two identical-seed builds`);
					break;
				}
			}

			if (first.houseCount < seats.length * 8) {
				failures.push(`only ${first.houseCount} houses placed for ${seats.length} seats — placement is failing far too often`);
			}
			// The bug the first implementation shipped: walls "built" but effectively none.
			if (first.wallCount < first.houseCount * 0.4) {
				failures.push(`only ${first.wallCount} field walls for ${first.houseCount} houses — neighbour pairing is not finding real neighbours`);
			}

			// Decompose every house transform and check placement, grounding, clustering, spacing.
			const position = new THREE.Vector3();
			const quaternion = new THREE.Quaternion();
			const scale = new THREE.Vector3();
			const matrix = new THREE.Matrix4();
			const houses = [];
			for (let i = 0; i < first.houseCount; i++) {
				first.group.children[0].getMatrixAt(i, matrix);
				matrix.decompose(position, quaternion, scale);
				houses.push({ x: position.x, y: position.y, z: position.z });
			}

			for (const house of houses) {
				if (!isPlaceablePosition(house.x, house.z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges: [] })) {
					failures.push(`house at (${house.x.toFixed(0)}, ${house.z.toFixed(0)}) violates the shared placement exclusions`);
					break;
				}
				const groundY = sampleHeightMeters(house.x, house.z);
				// Houses are deliberately sunk a little (GROUND_BITE_METERS) so a flat base never floats
				// on a slope; anything beyond that is a real grounding bug.
				const drop = groundY - house.y;
				if (drop < 0 || drop > 1) {
					failures.push(`house at (${house.x.toFixed(0)}, ${house.z.toFixed(0)}) sits ${drop.toFixed(2)}m below ground — expected a small deliberate bite, not floating or buried`);
					break;
				}
			}

			// Clustering: group houses by nearest seat, then require each village's houses to sit inside
			// a plausible hamlet disc around their own centroid. A ring-scatter (the first pass) fails
			// this immediately — its spread is the full 95-210m annulus.
			const byNearestSeat = new Map();
			for (const house of houses) {
				let best = null;
				let bestDistance = Infinity;
				for (const seat of seats) {
					const distance = Math.hypot(house.x - seat.x, house.z - seat.z);
					if (distance < bestDistance) {
						bestDistance = distance;
						best = seat;
					}
				}
				const key = `${best.x},${best.z}`;
				if (!byNearestSeat.has(key)) byNearestSeat.set(key, []);
				byNearestSeat.get(key).push(house);
			}
			let worstSpread = 0;
			for (const [key, village] of byNearestSeat) {
				const cx = village.reduce((sum, h) => sum + h.x, 0) / village.length;
				const cz = village.reduce((sum, h) => sum + h.z, 0) / village.length;
				for (const house of village) {
					worstSpread = Math.max(worstSpread, Math.hypot(house.x - cx, house.z - cz));
				}
				// HAMLET_RADIUS_METERS is 38; allow generous slack for the centroid not being the exact
				// sampling centre, but far below the ~115m spread a full-ring scatter would produce.
				const spread = Math.max(...village.map((h) => Math.hypot(h.x - cx, h.z - cz)));
				if (spread > 60) {
					failures.push(`village at seat ${key} spreads ${spread.toFixed(0)}m from its own centroid — houses are scattered around the castle, not clustered into a hamlet`);
				}
			}

			for (let i = 0; i < houses.length; i++) {
				for (let j = i + 1; j < houses.length; j++) {
					const gap = Math.hypot(houses[i].x - houses[j].x, houses[i].z - houses[j].z);
					if (gap < 10.9) {
						failures.push(`two houses are ${gap.toFixed(1)}m apart — closer than the minimum spacing, they will interpenetrate`);
						i = houses.length;
						break;
					}
				}
			}

			return {
				failures,
				houseCount: first.houseCount,
				wallCount: first.wallCount,
				villageCount: first.villageCount,
				drawCalls: first.group.children.length,
				worstSpread: Number(worstSpread.toFixed(1)),
			};
		});

		if (result.failures.length > 0) {
			console.error(`[checkRun330Villages] FAIL:\n  ${result.failures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		// --- rendered proof: houses are visible, lit and textured ----------------------------------
		const pixelProof = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createVillages } = await import('/src/3d/world/villages.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');

			const sampleHeightMeters = (x, z) => 40 + Math.sin(x * 0.004) * 3 + Math.cos(z * 0.004) * 3;
			const result = createVillages({
				sampleHeightMeters,
				seaLevelMeters: 0,
				seed: 1337,
				seats: [{ x: 0, z: 0 }],
				roadEdges: [],
				radiusMeters: 6000,
				mulberry32,
				housesPerVillage: 12,
			});

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9fb8cc);
			scene.add(new THREE.HemisphereLight(0xf0f6ff, 0x55603c, 1.9));
			const sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
			sun.position.set(80, 120, 60);
			scene.add(sun);
			const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x6b8248, roughness: 1 }));
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = 40;
			scene.add(ground);
			scene.add(result.group);

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1400, 800, false);
			const camera = new THREE.PerspectiveCamera(45, 1400 / 800, 0.5, 4000);
			const gl = renderer.getContext();

			// Frame the hamlet from its own centroid so the shot is of the village, not of empty field.
			const matrix = new THREE.Matrix4();
			const point = new THREE.Vector3();
			let cx = 0;
			let cz = 0;
			for (let i = 0; i < result.houseCount; i++) {
				result.group.children[0].getMatrixAt(i, matrix);
				point.setFromMatrixPosition(matrix);
				cx += point.x / result.houseCount;
				cz += point.z / result.houseCount;
			}
			camera.position.set(cx + 70, 46 + 34, cz + 70);
			camera.lookAt(cx, 42, cz);
			renderer.render(scene, camera);
			const shot = renderer.domElement.toDataURL('image/png');

			const buffer = new Uint8Array(1400 * 800 * 4);
			gl.readPixels(0, 0, 1400, 800, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
			// Building pixels: warmer than the green ground and not the blue sky.
			const lumas = [];
			for (let i = 0; i < buffer.length; i += 4) {
				const r = buffer[i];
				const g = buffer[i + 1];
				const b = buffer[i + 2];
				if (b > r + 15) continue; // sky
				if (g > r + 10) continue; // grass
				lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
			}
			renderer.dispose();
			if (lumas.length === 0) return { shot, buildingPixels: 0, meanLuma: 0, stdDev: 0 };
			const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
			const variance = lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length;
			return { shot, buildingPixels: lumas.length, meanLuma: mean, stdDev: Math.sqrt(variance) };
		});

		fs.writeFileSync(path.join(ARTIFACT_DIR, 'regression-hamlet.png'), Buffer.from(pixelProof.shot.split(',')[1], 'base64'));

		const renderFailures = [];
		if (pixelProof.buildingPixels < 2000) renderFailures.push(`only ${pixelProof.buildingPixels} building pixels — the village barely rendered`);
		if (pixelProof.meanLuma < 60) renderFailures.push(`building mean luminance ${pixelProof.meanLuma.toFixed(1)} — rendering dark/unlit`);
		if (pixelProof.stdDev < 8) renderFailures.push(`building luminance std-dev ${pixelProof.stdDev.toFixed(1)} — flat, untextured surfaces`);
		if (renderFailures.length > 0) {
			console.error(`[checkRun330Villages] FAIL:\n  ${renderFailures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		if (pageErrors.length > 0) {
			console.error(`[checkRun330Villages] FAIL: uncaught page errors: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}

		console.log(
			`[checkRun330Villages] PASS: ${result.houseCount} houses + ${result.wallCount} field walls across ` +
				`${result.villageCount} village(s) in ${result.drawCalls} draw calls; deterministic, all inside the shared ` +
				`placement exclusions, grounded, spaced, and clustered (worst spread from a village centroid: ` +
				`${result.worstSpread}m). Rendered proof: ${pixelProof.buildingPixels} building pixels, mean luma ` +
				`${pixelProof.meanLuma.toFixed(1)}, std-dev ${pixelProof.stdDev.toFixed(1)}. Screenshot in artifacts/run330-villages/.`,
		);
	} catch (error) {
		console.error(`[checkRun330Villages] FAIL: ${error.message}\n${error.stack}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();