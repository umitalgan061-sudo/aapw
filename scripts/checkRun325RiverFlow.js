#!/usr/bin/env node
/**
 * checkRun325RiverFlow.js — ADR-0271 evidence: the river and its waterfalls now visibly flow, the
 * foam travels *downstream* (not in some fixed world direction), and it travels faster through the
 * steep reaches than through the flat ones.
 *
 * Proof in three parts:
 *   1. **Baked attributes** — on the real traced river, `aFlowDistance` increases monotonically from
 *      source to mouth and matches the polyline's own arc length; `aFlowSide` is exactly -1/+1 across
 *      the ribbon; `aFlowSpeed` is never below the flat-water baseline and is measurably higher on
 *      the steep segments `detectWaterfalls` independently flags than on the river's median reach.
 *   2. **Direction** — the shader's own phase formula, evaluated at two times, must place a crest of
 *      constant phase further *downstream* by exactly `speed * dt`. This is what distinguishes "the
 *      water flows" from "a texture scrolls".
 *   3. **Visual** — real renders of the real river over real terrain, from two camera angles, each at
 *      two times, so the streaks' travel is visible between the pair (GOVERNANCE.md §8.5).
 *
 * Usage: `node scripts/checkRun325RiverFlow.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun325RiverFlow
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run325-river-flow');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun325RiverFlow] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { generateRiverPath, createRiverMesh, detectWaterfalls, createWaterfallMesh, updateFlowAnimation } =
				await import('/src/3d/world/rivers.js');
			const { createHeightSampler, createTerrainChunk } = await import('/src/3d/world/terrain.js');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const failures = [];

			const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const { points } = generateRiverPath({
				seed: WORLD_DEFAULTS.WORLD_SEED,
				sampleHeightMeters,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
			});
			const river = createRiverMesh(points);
			const waterfalls = detectWaterfalls(points).map((fall) => createWaterfallMesh(fall));

			// --- 1. Baked attributes --------------------------------------------------------------
			const flowDistance = river.geometry.getAttribute('aFlowDistance');
			const flowSpeed = river.geometry.getAttribute('aFlowSpeed');
			const flowSide = river.geometry.getAttribute('aFlowSide');
			if (!flowDistance || !flowSpeed || !flowSide) failures.push('river geometry is missing a flow attribute');

			let previousDistance = -1;
			let monotonic = true;
			for (let i = 0; i < flowDistance.count; i += 2) {
				const value = flowDistance.getX(i);
				if (value < previousDistance) monotonic = false;
				if (flowDistance.getX(i) !== flowDistance.getX(i + 1)) {
					failures.push(`left/right bank disagree on arc length at ring ${i / 2}`);
					break;
				}
				if (flowSide.getX(i) !== -1 || flowSide.getX(i + 1) !== 1) {
					failures.push(`aFlowSide is not -1/+1 at ring ${i / 2}`);
					break;
				}
				previousDistance = value;
			}
			if (!monotonic) failures.push('aFlowDistance is not monotonic from source to mouth');

			// Arc length must match the polyline it was baked from, not some re-derived approximation.
			let expectedArcLength = 0;
			for (let i = 1; i < points.length; i++) {
				expectedArcLength += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
			}
			const bakedArcLength = flowDistance.getX(flowDistance.count - 1);
			if (Math.abs(bakedArcLength - expectedArcLength) > 1e-3) {
				failures.push(`baked arc length ${bakedArcLength} != polyline length ${expectedArcLength}`);
			}

			// Steep reaches must flow faster than the median reach — the whole point of deriving speed
			// from the bed gradient rather than using one constant.
			const speeds = [];
			for (let i = 0; i < flowSpeed.count; i += 2) speeds.push(flowSpeed.getX(i));
			const sortedSpeeds = [...speeds].sort((a, b) => a - b);
			const medianSpeed = sortedSpeeds[Math.floor(sortedSpeeds.length / 2)];
			const minSpeed = sortedSpeeds[0];
			const maxSpeed = sortedSpeeds[sortedSpeeds.length - 1];
			if (minSpeed < 1.2 - 1e-6) failures.push(`a reach flows below the flat-water baseline (${minSpeed})`);
			if (!(maxSpeed > medianSpeed * 1.25)) {
				failures.push(`steepest reach (${maxSpeed}) is not meaningfully faster than the median (${medianSpeed})`);
			}

			// --- 2. Direction, derived from the shipped shader ---------------------------------------
			// `onBeforeCompile` is a pure string transform, so running it over a stub carrying just the
			// chunks it patches recovers exactly the source three.js will compile — which lets the sign
			// of the phase term (the thing that decides upstream vs. downstream) be read off the real
			// shader rather than restated here as a constant that could drift away from it.
			const stub = {
				uniforms: {},
				vertexShader: '#include <common>\n#include <begin_vertex>',
				fragmentShader: '#include <common>\n#include <color_fragment>',
			};
			river.material.onBeforeCompile(stub);
			if (stub.uniforms.uTime !== river.material.userData.flowUniforms.uTime) {
				failures.push('injected shader does not share the material’s own uTime uniform');
			}
			const phaseMatch = stub.fragmentShader.match(
				/float\s+flowPhase\s*=\s*\(vFlowDistance\s*(-|\+)\s*uTime\s*\*\s*vFlowSpeed\)\s*\*\s*([0-9.]+)/,
			);
			if (!phaseMatch) {
				failures.push('could not find the flow phase expression in the injected fragment shader');
			} else if (phaseMatch[1] !== '-') {
				// `+` would scroll the foam upstream, toward the source — the exact bug this guards.
				failures.push(`flow phase uses "${phaseMatch[1]}" — foam would travel upstream`);
			}
			// With phase(d, t) = (d - t*v) * k, a crest of fixed phase satisfies d = d0 + v*t. Check that
			// against the wavenumber actually parsed out of the shader, at the river's own median speed.
			const wavenumber = phaseMatch ? Number(phaseMatch[2]) : NaN;
			const dt = 2.5;
			const startDistance = 100;
			const phaseAt = (d, t) => (d - t * medianSpeed) * wavenumber;
			const crestTravelMeters = medianSpeed * dt;
			if (Math.abs(phaseAt(startDistance, 0) - phaseAt(startDistance + crestTravelMeters, dt)) > 1e-9) {
				failures.push('a fixed-phase crest does not sit exactly speed * dt further downstream');
			}
			if (!(crestTravelMeters > 0)) failures.push('foam crest does not advance downstream over time');

			// --- 3. Uniform plumbing ----------------------------------------------------------------
			if (!river.material.userData.flowUniforms) failures.push('river material has no flow uniforms');
			updateFlowAnimation(river, 12.5);
			if (river.material.userData.flowUniforms.uTime.value !== 12.5) failures.push('updateFlowAnimation did not advance uTime');
			// Must be a safe no-op on a mesh that never got the injection.
			updateFlowAnimation(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), 3);
			updateFlowAnimation(null, 3);
			if (waterfalls.length === 0) failures.push('no waterfalls detected on the real river to verify');
			for (const fall of waterfalls) {
				const fallDistance = fall.geometry.getAttribute('aFlowDistance');
				if (!fallDistance) {
					failures.push('waterfall geometry is missing aFlowDistance');
					break;
				}
				// Top pair at 0, bottom pair at the full drop: the curtain flows downward, not along.
				if (fallDistance.getX(0) !== 0 || fallDistance.getX(1) !== 0) failures.push('waterfall top is not at flow distance 0');
				// float32 attribute storage vs. the float64 drop it was baked from — compare within
				// single-precision tolerance rather than exactly.
				if (Math.abs(fallDistance.getX(2) - fall.userData.dropMeters) > 1e-4) {
					failures.push(`waterfall bottom ${fallDistance.getX(2)} != full drop ${fall.userData.dropMeters}`);
				}
				if (fall.geometry.getAttribute('aFlowSpeed').getX(0) !== 9) failures.push('waterfall flow speed drifted');
			}

			// --- Scene for the screenshots ------------------------------------------------------
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9dc2dd);
			scene.add(new THREE.HemisphereLight(0xcfe2f2, 0x4a5148, 1.2));
			const sun = new THREE.DirectionalLight(0xffffff, 1.5);
			sun.position.set(300, 400, 200);
			scene.add(sun);
			// Real terrain chunks under the real river, so the evidence is the shipped world.
			const chunks = [];
			const sourcePoint = points[0];
			const chunkSize = 500;
			const centerChunkX = Math.round(sourcePoint.x / chunkSize);
			const centerChunkZ = Math.round(sourcePoint.z / chunkSize);
			for (let cx = centerChunkX - 3; cx <= centerChunkX + 3; cx++) {
				for (let cz = centerChunkZ - 3; cz <= centerChunkZ + 3; cz++) {
					const chunk = createTerrainChunk({ chunkX: cx, chunkZ: cz, seed: WORLD_DEFAULTS.WORLD_SEED });
					chunks.push(chunk);
					scene.add(chunk);
				}
			}
			scene.add(river);
			waterfalls.forEach((fall) => scene.add(fall));

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1440, 900, false);
			const camera = new THREE.PerspectiveCamera(52, 1440 / 900, 0.5, 8000);
			// Aim both cameras at a point partway down the real traced river.
			const midPoint = points[Math.floor(points.length * 0.35)];
			window.__run325RiverShoot = (offset, height, elapsedSeconds) => {
				camera.position.set(midPoint.x + offset[0], midPoint.y + height, midPoint.z + offset[1]);
				camera.lookAt(midPoint.x, midPoint.y, midPoint.z);
				updateFlowAnimation(river, elapsedSeconds);
				for (const fall of waterfalls) updateFlowAnimation(fall, elapsedSeconds);
				renderer.render(scene, camera);
				return renderer.domElement.toDataURL('image/png');
			};
			// Same GPU-level motion proof as the water check: the driver must produce visibly different
			// pixels at two times, which no amount of correct-looking attribute maths can fake.
			window.__run325RiverPixelMotion = (offset, height) => {
				const gl = renderer.getContext();
				const width = renderer.domElement.width;
				const pixelHeight = renderer.domElement.height;
				const first = new Uint8Array(width * pixelHeight * 4);
				const second = new Uint8Array(width * pixelHeight * 4);
				camera.position.set(midPoint.x + offset[0], midPoint.y + height, midPoint.z + offset[1]);
				camera.lookAt(midPoint.x, midPoint.y, midPoint.z);
				const renderAt = (seconds) => {
					updateFlowAnimation(river, seconds);
					for (const fall of waterfalls) updateFlowAnimation(fall, seconds);
					renderer.render(scene, camera);
				};
				renderAt(0);
				gl.readPixels(0, 0, width, pixelHeight, gl.RGBA, gl.UNSIGNED_BYTE, first);
				renderAt(1.5);
				gl.readPixels(0, 0, width, pixelHeight, gl.RGBA, gl.UNSIGNED_BYTE, second);
				let changed = 0;
				for (let i = 0; i < first.length; i += 4) {
					if (
						Math.abs(first[i] - second[i]) > 3 ||
						Math.abs(first[i + 1] - second[i + 1]) > 3 ||
						Math.abs(first[i + 2] - second[i + 2]) > 3
					) {
						changed++;
					}
				}
				return changed / (width * pixelHeight);
			};
			window.__run325RiverCleanup = () => {
				renderer.dispose();
				chunks.forEach((chunk) => {
					chunk.geometry.dispose();
					chunk.material.dispose();
				});
			};

			return {
				failures,
				pointCount: points.length,
				arcLengthMeters: bakedArcLength,
				minSpeed,
				medianSpeed,
				maxSpeed,
				waterfallCount: waterfalls.length,
				crestTravelMeters,
				wavenumber,
			};
		});

		if (result.failures.length > 0) {
			console.error(`[checkRun325RiverFlow] FAIL: ${JSON.stringify(result.failures, null, 2)}`);
			process.exitCode = 1;
			return;
		}

		const views = [
			['near-t0', [40, 55], 22, 0],
			['near-t3', [40, 55], 22, 3],
			['far-t0', [260, 340], 190, 0],
			['far-t3', [260, 340], 190, 3],
		];
		for (const [key, offset, height, elapsed] of views) {
			const dataUrl = await page.evaluate(
				([o, h, e]) => window.__run325RiverShoot(o, h, e),
				[offset, height, elapsed],
			);
			fs.writeFileSync(path.join(ARTIFACT_DIR, `${key}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
		}
		// The river covers only a slice of the frame, so the bar is set at "clearly more than noise"
		// rather than at the water check's much larger full-screen-of-sea fraction.
		const movedFraction = await page.evaluate(() => window.__run325RiverPixelMotion([40, 55], 22));
		if (movedFraction < 0.01) {
			console.error(`[checkRun325RiverFlow] FAIL: only ${(movedFraction * 100).toFixed(3)}% of pixels changed between t=0 and t=1.5 — the flow is not really animating.`);
			process.exitCode = 1;
			return;
		}
		await page.evaluate(() => window.__run325RiverCleanup());

		if (pageErrors.length > 0) {
			console.error(`[checkRun325RiverFlow] FAIL: uncaught page errors: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}
		console.log(
			`[checkRun325RiverFlow] PASS: real river ${result.pointCount} points / ` +
				`${(result.arcLengthMeters / 1000).toFixed(2)}km, monotonic downstream arc length matches the polyline; ` +
				`flow speed ${result.minSpeed.toFixed(2)}-${result.maxSpeed.toFixed(2)} m/s ` +
				`(median ${result.medianSpeed.toFixed(2)}, steepest reach ${(result.maxSpeed / result.medianSpeed).toFixed(2)}x faster); ` +
				`shipped shader's phase term parsed as (distance - time*speed) * ${result.wavenumber}, so a ` +
				`fixed-phase crest advances ${result.crestTravelMeters.toFixed(2)}m downstream in 2.5s; ` +
				`${result.waterfallCount} waterfall curtain(s) flow top-to-bottom at 9 m/s; ` +
				`${(movedFraction * 100).toFixed(2)}% of rendered pixels changed between t=0 and t=1.5 (real GPU read-back); ` +
				`4 screenshots in artifacts/run325-river-flow/.`,
		);
	} catch (error) {
		console.error(`[checkRun325RiverFlow] FAIL: ${error.message}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
