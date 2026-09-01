#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const OUT = path.join(process.cwd(), 'artifacts', 'run221-realistic-game-aurora');
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

function writeRawEvidenceDataUrl(dataUrl) {
	const encodedPng = typeof dataUrl === 'string' ? dataUrl.split(',', 2)[1] : null;
	if (!encodedPng) return false;
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(path.join(OUT, 'game-aurora-flow-b.png'), Buffer.from(encodedPng, 'base64'));
	return true;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright bulunamadı.');
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
	const page = await context.newPage();
	const errors = [];
	const missing = [];
	const optionalMoonFallbacks = [];

	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const text = message.text();
		if (
			text.includes('[AssetLoader] loadFBXModel("assets/models/Ay/Moon%202K.fbx") failed, using placeholder box.') &&
			text.includes('THREE.FBXLoader: Cannot find the version number for the file given.')
		) {
			optionalMoonFallbacks.push(text);
			return;
		}
		errors.push(text);
	});
	page.on('pageerror', (error) => errors.push(String(error)));
	page.on('response', (response) => {
		if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`);
	});

	try {
		// Keep game3d.html's real import-map/origin, but skip heavy world boot for this isolated sky
		// proof. Full shipped-scene coverage belongs to the canonical game smoke workflows.
		await page.route('**/src/3d/game3d.js', async (route) => {
			await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'export function initGame3D() {}\n' });
		});
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		});

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createAuroraSky, updateAuroraSky, disposeAuroraSky } = await import('/src/3d/sky.js');
			const { createDayNightLighting, updateDayNightLighting, disposeDayNightLighting } = await import('/src/3d/lighting.js');
			const { getNightVisualEnhancementSnapshot } = await import('/src/3d/nightVisualEnhancement.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };

			const canvas = document.createElement('canvas');
			canvas.id = 'run221-aurora-proof';
			canvas.width = 960;
			canvas.height = 540;
			document.body.appendChild(canvas);

			const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(960, 540, false);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.08;

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(68, 960 / 540, 0.1, 2100);
			camera.position.set(420, 7, -310);
			camera.lookAt(420, 150, -650);

			const lights = createDayNightLighting(scene);
			const midnight = updateDayNightLighting(lights, 0, 100, 0);
			const nightFill = getNightVisualEnhancementSnapshot(lights.hemisphere);
			const readability = lights.hemisphere.getObjectByName('Game Night Readability Fill');
			fail(midnight.nightFactor === 1, `Canonical nightFactor drifted: ${midnight.nightFactor}`);
			fail(nightFill.installed, 'Cinematic night fill was not installed.');
			fail(nightFill.intensity >= 0.7, `Cinematic night fill too dim: ${nightFill.intensity}`);
			fail(readability?.isHemisphereLight && Number.isFinite(readability.intensity), 'Canonical readability fill is unavailable.');
			const nightReadabilityIntensity = readability.intensity;
			fail(nightReadabilityIntensity >= 0.30, `Night readability fill too dim: ${nightReadabilityIntensity}`);

			const sky = createAuroraSky();
			scene.add(sky);
			fail(sky.material.userData.realisticAurora === true, 'Realistic aurora material marker missing.');
			fail(sky.material.userData.finalAtmosphereProfile === 'camera-relative-horizon-upper-air-v6', 'Final atmosphere profile marker missing.');
			fail(sky.material.userData.auroraCurtainMorphology === 'broken-asymmetric-ray-sheets-v8-visible-gaps', 'Final aurora morphology marker missing.');
			fail(sky.material.userData.auroraNightCalibration === 'required-token-deep-blue-v6', 'Final aurora night calibration marker missing.');
			const shader = sky.material.fragmentShader;
			for (const token of [
				'ray4HorizonAirmassVariation', 'ray4UpperAirVariation', 'ray4AtmosphericBase',
				'uHorizonHazeStrength', 'uUpperAirStrength', 'uUpperAirVariationStrength',
				'ray4VerticalField', 'ray4ArcEdge', 'ray4CurtainEnvelope', 'ray4RaySheet', 'cameraPosition',
			]) fail(shader.includes(token), `Final sky shader token missing: ${token}`);
			fail(shader.includes('finalColor += oxygenGreen * haze * 0.084;'), 'Final V5 aurora haze calibration is missing.');

			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(360, 360),
				new THREE.MeshStandardMaterial({ color: 0x52604d, roughness: 0.93, metalness: 0.0 }),
			);
			ground.rotation.x = -Math.PI / 2;
			ground.position.set(420, -6, -430);
			scene.add(ground);
			for (let i = 0; i < 5; i++) {
				const tower = new THREE.Mesh(
					new THREE.BoxGeometry(18 + i * 2, 42 + i * 9, 18 + i * 2),
					new THREE.MeshStandardMaterial({ color: 0x667078, roughness: 0.88 }),
				);
				tower.position.set(355 + i * 34, 15 + i * 4.5, -500 - (i % 2) * 24);
				scene.add(tower);
			}

			const gl = renderer.getContext();
			const pixels = new Uint8Array(960 * 540 * 4);
			const pixelsB = new Uint8Array(pixels.length);
			const stats = (buffer) => {
				let luminance = 0;
				let bright = 0;
				let phosphor = 0;
				for (let i = 0; i < buffer.length; i += 4) {
					const r = buffer[i]; const g = buffer[i + 1]; const b = buffer[i + 2];
					const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
					luminance += lum;
					if (lum > 72) bright++;
					if (g > 68 && g > r * 1.12 && g > b * 1.02) phosphor++;
				}
				const count = buffer.length / 4;
				return { averageLuminance: luminance / count, brightFraction: bright / count, phosphorFraction: phosphor / count };
			};
			const meanRgbDelta = (a, b) => {
				let absoluteDelta = 0;
				for (let i = 0; i < a.length; i += 4) {
					absoluteDelta += Math.abs(a[i] - b[i]);
					absoluteDelta += Math.abs(a[i + 1] - b[i + 1]);
					absoluteDelta += Math.abs(a[i + 2] - b[i + 2]);
				}
				return absoluteDelta / ((a.length / 4) * 3);
			};

			updateAuroraSky(sky, camera.position, 37, midnight);
			renderer.render(scene, camera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			const firstStats = stats(pixels);

			updateAuroraSky(sky, camera.position, 83, midnight);
			renderer.render(scene, camera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, pixelsB);
			const secondStats = stats(pixelsB);
			const meanAnimationDelta = meanRgbDelta(pixels, pixelsB);
			fail(firstStats.averageLuminance > 9, `Night render remains too dark: ${firstStats.averageLuminance}`);
			fail(firstStats.brightFraction > 0.003, `Aurora has too little luminous structure: ${firstStats.brightFraction}`);
			fail(firstStats.phosphorFraction > 0.001, `Aurora phosphorescent signal too weak: ${firstStats.phosphorFraction}`);
			fail(meanAnimationDelta > 0.12, `Aurora curtains are visually static: delta=${meanAnimationDelta}`);

			// Isolate the sky and prove that translating the player/camera does not slide the directional
			// aurora field. Both cameras have the same orientation and elapsed time, only world position differs.
			const invariantScene = new THREE.Scene();
			const invariantSky = createAuroraSky();
			invariantScene.add(invariantSky);
			const invariantCamera = new THREE.PerspectiveCamera(68, 960 / 540, 0.1, 2100);
			const invariantA = new Uint8Array(pixels.length);
			const invariantB = new Uint8Array(pixels.length);
			invariantCamera.position.set(0, 7, 0);
			invariantCamera.lookAt(0, 150, -340);
			updateAuroraSky(invariantSky, invariantCamera.position, 37, midnight);
			renderer.render(invariantScene, invariantCamera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, invariantA);
			invariantCamera.position.set(840, 57, -920);
			invariantCamera.lookAt(840, 200, -1260);
			updateAuroraSky(invariantSky, invariantCamera.position, 37, midnight);
			renderer.render(invariantScene, invariantCamera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, invariantB);
			const cameraTranslationDelta = meanRgbDelta(invariantA, invariantB);
			fail(cameraTranslationDelta < 0.20, `Camera translation slides the sky field: delta=${cameraTranslationDelta}`);
			disposeAuroraSky(invariantSky);

			const noon = updateDayNightLighting(lights, 50, 100, 0);
			const dayFill = getNightVisualEnhancementSnapshot(lights.hemisphere);
			const dayReadabilityIntensity = readability.intensity;
			fail(noon.nightFactor === 0, `Canonical noon nightFactor drifted: ${noon.nightFactor}`);
			fail(dayFill.intensity <= 0.021, `Night-only cinematic fill leaks into day: ${dayFill.intensity}`);
			fail(dayReadabilityIntensity <= 0.06, `Readability fill remains too strong at noon: ${dayReadabilityIntensity}`);
			fail(nightReadabilityIntensity - dayReadabilityIntensity >= 0.25,
				`Readability fill does not respond strongly enough to night: ${nightReadabilityIntensity} -> ${dayReadabilityIntensity}`);

			// Restore the exact midnight artifact frame after isolated invariance measurement.
			updateDayNightLighting(lights, 0, 100, 0);
			updateAuroraSky(sky, camera.position, 83, midnight);
			renderer.render(scene, camera);
			const artifactDataUrl = canvas.toDataURL('image/png');

			disposeAuroraSky(sky);
			disposeDayNightLighting(scene, lights);
			return {
				midnight,
				nightFill,
				dayFill,
				nightReadabilityIntensity,
				dayReadabilityIntensity,
				firstStats,
				secondStats,
				meanAnimationDelta,
				cameraTranslationDelta,
				artifactDataUrl,
			};
		});

		assert(writeRawEvidenceDataUrl(result.artifactDataUrl), 'Raw WebGL evidence PNG could not be encoded.');
		delete result.artifactDataUrl;

		assert(optionalMoonFallbacks.length <= 1, `Unexpected repeated Moon fallback errors: ${optionalMoonFallbacks.length}`);
		assert(missing.length === 0, `HTTP errors: ${missing.join(' | ')}`);
		assert(errors.length === 0, `Console/page errors: ${errors.join(' | ')}`);
		console.log(`[checkRun221RealisticGameAuroraBrowser] PASS: optionalMoonFallbacks=${optionalMoonFallbacks.length} ${JSON.stringify(result)}`);
	} catch (error) {
		// Preserve the real framebuffer even when a visual threshold fails. This turns red CI into an
		// inspectable render regression instead of an opaque number-only failure. The canvas is raw
		// WebGL, so game UI/DOM overlays cannot contaminate the evidence image.
		try {
			const failureDataUrl = await page.evaluate(() => document.getElementById('run221-aurora-proof')?.toDataURL('image/png') || null);
			writeRawEvidenceDataUrl(failureDataUrl);
		} catch {
			// The original failure remains authoritative when the canvas never reached a renderable state.
		}
		throw error;
	} finally {
		await context.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRun221RealisticGameAuroraBrowser] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
