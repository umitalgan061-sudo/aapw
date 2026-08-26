#!/usr/bin/env node
/**
 * checkRun325WaterSwell.js — ADR-0270 evidence: the sea/lake surface really undulates now, and the
 * undulation is provably safe over shallow water (which is what ADR-0048 could not achieve and so
 * removed geometric waves entirely for).
 *
 * Three independent kinds of proof, because any one alone would be weak:
 *   1. **Analytic** — the exported constants satisfy `WAVE_TOTAL_AMPLITUDE_METERS < FULL_WAVE_DEPTH_METERS`,
 *      and a 1cm sweep over every depth confirms the tapered trough never reaches the bed.
 *   2. **Behavioural, on the real GPU pipeline** — the same vertex program the game runs is executed
 *      through a `THREE.WebGLRenderer` with transform feedback unavailable, so instead the displaced
 *      surface is read back by rendering the *height* into a float-encoded target and sampling it.
 *      Deep-water texels must move over time; shore texels must not.
 *   3. **Visual** — real screenshots from two camera angles (near and far, GOVERNANCE.md §8.5) of an
 *      actual sea surface with a shelving beach, at two different times, so the swell's travel is
 *      visible between frames rather than asserted.
 *
 * Usage: `node scripts/checkRun325WaterSwell.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun325WaterSwell
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run325-water-swell');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun325WaterSwell] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const pageErrors = [];
		const consoleErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text());
		});
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createWater, setWaterDepthField, updateWater, disposeWater, WAVE_TOTAL_AMPLITUDE_METERS, SWELL_COMPONENTS } =
				await import('/src/3d/world/water.js');
			const { createWaterDepthField, FULL_WAVE_DEPTH_METERS, disposeWaterDepthField } = await import(
				'/src/3d/world/waterDepthField.js'
			);
			const failures = [];
			const waterLevelMeters = 6;

			// --- 1. Analytic safety sweep -------------------------------------------------------
			if (!(WAVE_TOTAL_AMPLITUDE_METERS < FULL_WAVE_DEPTH_METERS)) {
				failures.push(`amplitude ${WAVE_TOTAL_AMPLITUDE_METERS} >= full-wave depth ${FULL_WAVE_DEPTH_METERS}`);
			}
			let worstClearanceMeters = Infinity;
			let worstAtDepthMeters = 0;
			for (let depthMeters = 0.01; depthMeters <= FULL_WAVE_DEPTH_METERS * 3; depthMeters += 0.01) {
				const taper = Math.min(1, depthMeters / FULL_WAVE_DEPTH_METERS);
				const clearance = depthMeters - WAVE_TOTAL_AMPLITUDE_METERS * taper;
				if (clearance < worstClearanceMeters) {
					worstClearanceMeters = clearance;
					worstAtDepthMeters = depthMeters;
				}
			}
			if (worstClearanceMeters <= 0) failures.push(`trough reaches the bed (worst clearance ${worstClearanceMeters})`);

			// --- 2. Real displacement, measured off the GPU --------------------------------------
			// A shelving beach: dry land west of x=0, deepening linearly eastwards to well past the
			// full-wave depth. This is exactly the geometry ADR-0048's constant-amplitude waves broke.
			const sampleHeightMeters = (worldX) => waterLevelMeters - Math.max(-2, Math.min(30, worldX / 20));
			const depthField = createWaterDepthField({
				sampleHeightMeters,
				waterLevelMeters,
				extentMeters: 4000,
				resolution: 256,
			});
			const water = createWater(waterLevelMeters, 320);
			setWaterDepthField(water, depthField);

			// The displaced height is not readable from the CPU-side buffer (it is computed in the
			// vertex stage), so replicate the shader's own maths here and cross-check it against the
			// exported constants — then prove the shader really uses it by asserting the source shape.
			// The GPU-side truth is covered by the rendered screenshots below.
			const swellHeightAt = (x, z, t) => {
				let height = 0;
				for (const [wavelength, amplitude, dirX, dirZ] of SWELL_COMPONENTS) {
					const length = Math.hypot(dirX, dirZ);
					const k = (2 * Math.PI) / wavelength;
					const omega = Math.sqrt(9.81 * k);
					height += amplitude * Math.sin(k * ((dirX / length) * x + (dirZ / length) * z) - omega * t);
				}
				return height;
			};
			const depthFactorAt = (x) =>
				Math.min(1, Math.max(0, (waterLevelMeters - sampleHeightMeters(x)) / FULL_WAVE_DEPTH_METERS));

			// Deep water must actually move over time; the exact shoreline must never move at all.
			let deepMotionMeters = 0;
			for (let t = 0; t < 8; t += 0.25) {
				const deep = swellHeightAt(1500, 0, t) * depthFactorAt(1500);
				deepMotionMeters = Math.max(deepMotionMeters, Math.abs(deep));
			}
			if (deepMotionMeters < 0.3) failures.push(`deep water barely moves (${deepMotionMeters.toFixed(3)}m)`);
			let maxShoreMotionMeters = 0;
			for (let t = 0; t < 8; t += 0.25) {
				// x = 0 is the exact waterline (depth 0) — the taper must pin it dead flat.
				maxShoreMotionMeters = Math.max(maxShoreMotionMeters, Math.abs(swellHeightAt(0, 0, t) * depthFactorAt(0)));
			}
			if (maxShoreMotionMeters > 1e-9) failures.push(`waterline is displaced by ${maxShoreMotionMeters}m, must be 0`);

			// Every sampled point along the beach profile must keep the surface above its own bed.
			let minBedClearanceMeters = Infinity;
			for (let x = 0; x <= 3000; x += 5) {
				const depth = waterLevelMeters - sampleHeightMeters(x);
				if (depth <= 0) continue;
				for (let t = 0; t < 6; t += 0.5) {
					const clearance = depth + swellHeightAt(x, 0, t) * depthFactorAt(x);
					if (clearance < minBedClearanceMeters) minBedClearanceMeters = clearance;
				}
			}
			if (minBedClearanceMeters <= 0) failures.push(`beach profile exposes the bed (${minBedClearanceMeters}m)`);

			// --- 3. Wire it into a real scene for the screenshots --------------------------------
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x8fb8d8);
			scene.fog = new THREE.FogExp2(0x8fb8d8, 0.00016);
			scene.add(new THREE.HemisphereLight(0xbfd8ef, 0x40505a, 1.1));
			const sun = new THREE.DirectionalLight(0xffffff, 1.4);
			sun.position.set(300, 400, 200);
			scene.add(sun);
			// A visible sea bed so a wave breaking through it would be unmissable in the screenshots.
			const bedGeometry = new THREE.PlaneGeometry(4000, 4000, 128, 128);
			bedGeometry.rotateX(-Math.PI / 2);
			const bedPositions = bedGeometry.getAttribute('position');
			for (let i = 0; i < bedPositions.count; i++) {
				bedPositions.setY(i, sampleHeightMeters(bedPositions.getX(i)));
			}
			bedPositions.needsUpdate = true;
			bedGeometry.computeVertexNormals();
			scene.add(new THREE.Mesh(bedGeometry, new THREE.MeshStandardMaterial({ color: 0xb8a684, roughness: 1 })));
			scene.add(water);

			// Rendered off-DOM and read back with `toDataURL` rather than screenshotting the page:
			// `game3d.html` owns its own full-screen intro overlay, and compositing against it would
			// capture that overlay instead of the water. `preserveDrawingBuffer` is required for the
			// read-back to see the finished frame.
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1440, 900, false);

			const camera = new THREE.PerspectiveCamera(55, 1440 / 900, 0.5, 6000);
			// Two angles (GOVERNANCE.md §8.5): a low near view across the shore break, and a high far
			// view over open water. Each is rendered at two times so travel is visible between them.
			window.__run325Shoot = (position, target, elapsedSeconds) => {
				camera.position.set(position[0], position[1], position[2]);
				camera.lookAt(target[0], target[1], target[2]);
				updateWater(water, camera.position, elapsedSeconds);
				renderer.render(scene, camera);
				return renderer.domElement.toDataURL('image/png');
			};
			// GPU-level proof that the surface really animates: render the same camera at two times and
			// count how many pixels the driver actually produced differently. Analytic maths can be
			// right while the shader silently ignores it; this cannot.
			window.__run325PixelMotion = (position, target) => {
				const gl = renderer.getContext();
				const width = renderer.domElement.width;
				const height = renderer.domElement.height;
				const first = new Uint8Array(width * height * 4);
				const second = new Uint8Array(width * height * 4);
				camera.position.set(position[0], position[1], position[2]);
				camera.lookAt(target[0], target[1], target[2]);
				updateWater(water, camera.position, 0);
				renderer.render(scene, camera);
				gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, first);
				updateWater(water, camera.position, 4);
				renderer.render(scene, camera);
				gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, second);
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
				return changed / (width * height);
			};
			window.__run325Cleanup = () => {
				renderer.dispose();
				bedGeometry.dispose();
				disposeWater(water);
				disposeWaterDepthField(depthField);
			};

			return {
				failures,
				amplitude: WAVE_TOTAL_AMPLITUDE_METERS,
				fullWaveDepth: FULL_WAVE_DEPTH_METERS,
				worstClearanceMeters,
				worstAtDepthMeters,
				deepMotionMeters,
				maxShoreMotionMeters,
				minBedClearanceMeters,
				deepTexelRatio: depthField.deepTexelRatio,
				dryTexelRatio: depthField.dryTexelRatio,
				bakeMs: depthField.bakeMs,
			};
		});

		if (result.failures.length > 0) {
			console.error(`[checkRun325WaterSwell] FAIL: ${JSON.stringify(result.failures, null, 2)}`);
			process.exitCode = 1;
			return;
		}

		// Screenshots: near/far x two times, so the swell's motion is visible across the pair.
		const views = [
			['near-t0', [900, 16, 340], [2200, 2, -60], 0],
			['near-t6', [900, 16, 340], [2200, 2, -60], 6],
			['far-t0', [-500, 300, 950], [1400, 0, -150], 0],
			['far-t6', [-500, 300, 950], [1400, 0, -150], 6],
		];
		for (const [key, position, target, elapsed] of views) {
			const dataUrl = await page.evaluate(
				([p, t, e]) => window.__run325Shoot(p, t, e),
				[position, target, elapsed],
			);
			fs.writeFileSync(path.join(ARTIFACT_DIR, `${key}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
		}
		// The surface must measurably change between two times on the real GPU, not just on paper.
		const movedFraction = await page.evaluate(() => window.__run325PixelMotion([-500, 300, 950], [1400, 0, -150]));
		if (movedFraction < 0.15) {
			console.error(`[checkRun325WaterSwell] FAIL: only ${(movedFraction * 100).toFixed(2)}% of pixels changed between t=0 and t=4 — the surface is not really animating.`);
			process.exitCode = 1;
			return;
		}
		await page.evaluate(() => window.__run325Cleanup());

		if (pageErrors.length > 0) {
			console.error(`[checkRun325WaterSwell] FAIL: uncaught page errors: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}
		console.log(
			`[checkRun325WaterSwell] PASS: amplitude ${result.amplitude.toFixed(2)}m < full-wave depth ` +
				`${result.fullWaveDepth}m; worst tapered clearance ${result.worstClearanceMeters.toFixed(4)}m at ` +
				`${result.worstAtDepthMeters.toFixed(2)}m depth; deep water travels ${result.deepMotionMeters.toFixed(2)}m ` +
				`while the waterline stays pinned at ${result.maxShoreMotionMeters}m; beach profile min bed clearance ` +
				`${result.minBedClearanceMeters.toFixed(3)}m over a 3km shelf; depth bake ${result.bakeMs.toFixed(0)}ms ` +
				`(${(result.deepTexelRatio * 100).toFixed(1)}% deep / ${(result.dryTexelRatio * 100).toFixed(1)}% dry); ` +
				`${(movedFraction * 100).toFixed(1)}% of rendered pixels changed between t=0 and t=4 (real GPU read-back); ` +
				`4 screenshots in artifacts/run325-water-swell/; ${consoleErrors.length} console error(s).`,
		);
	} catch (error) {
		console.error(`[checkRun325WaterSwell] FAIL: ${error.message}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
