#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const OUT = path.join(process.cwd(), 'artifacts', 'run221-realistic-game-aurora');
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

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

	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(String(error)));
	page.on('response', (response) => {
		if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`);
	});

	try {
		// Keep game3d.html's real import-map/origin, but skip the heavy world boot for this isolated
		// shader proof. Full game boot/console/PWA coverage is handled by the canonical smoke below.
		await page.route('**/src/3d/game3d.js', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'text/javascript; charset=utf-8',
				body: 'export function initGame3D() {}\n',
			});
		});
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 60_000,
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
			canvas.style.cssText = 'position:fixed;inset:70px auto auto 50%;transform:translateX(-50%);width:960px;height:540px;z-index:99999;background:#000';
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
			fail(readability?.isHemisphereLight && readability.intensity >= 1.0, `Existing readability fill drifted: ${readability?.intensity}`);

			const sky = createAuroraSky();
			scene.add(sky);
			fail(sky.material.userData.realisticAurora === true, 'Realistic aurora material marker missing.');
			const shader = sky.material.fragmentShader;
			for (const token of ['curtainBand', 'auroraFbm', 'phosphorCore', 'softGlow', 'cameraPosition']) {
				fail(shader.includes(token), `Realistic shader token missing: ${token}`);
			}

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
					const r = buffer[i];
					const g = buffer[i + 1];
					const b = buffer[i + 2];
					const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
					luminance += lum;
					if (lum > 72) bright++;
					if (g > 68 && g > r * 1.12 && g > b * 1.02) phosphor++;
				}
				const count = buffer.length / 4;
				return { averageLuminance: luminance / count, brightFraction: bright / count, phosphorFraction: phosphor / count };
			};

			updateAuroraSky(sky, camera.position, 37, midnight);
			renderer.render(scene, camera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			const firstStats = stats(pixels);

			updateAuroraSky(sky, camera.position, 83, midnight);
			renderer.render(scene, camera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, pixelsB);
			const secondStats = stats(pixelsB);
			let absoluteDelta = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				absoluteDelta += Math.abs(pixels[i] - pixelsB[i]);
				absoluteDelta += Math.abs(pixels[i + 1] - pixelsB[i + 1]);
				absoluteDelta += Math.abs(pixels[i + 2] - pixelsB[i + 2]);
			}
			const meanAnimationDelta = absoluteDelta / ((pixels.length / 4) * 3);

			fail(firstStats.averageLuminance > 9, `Night render remains too dark: ${firstStats.averageLuminance}`);
			fail(firstStats.brightFraction > 0.003, `Aurora has too little luminous structure: ${firstStats.brightFraction}`);
			fail(firstStats.phosphorFraction > 0.001, `Aurora phosphorescent green/cyan signal too weak: ${firstStats.phosphorFraction}`);
			fail(meanAnimationDelta > 0.12, `Aurora curtains are visually static: delta=${meanAnimationDelta}`);

			const noon = updateDayNightLighting(lights, 50, 100, 0);
			const dayFill = getNightVisualEnhancementSnapshot(lights.hemisphere);
			fail(noon.nightFactor === 0, `Canonical noon nightFactor drifted: ${noon.nightFactor}`);
			fail(dayFill.intensity <= 0.021, `Night-only cinematic fill leaks into day: ${dayFill.intensity}`);

			disposeAuroraSky(sky);
			disposeDayNightLighting(scene, lights);
			return { midnight, nightFill, dayFill, firstStats, secondStats, meanAnimationDelta };
		});

		fs.mkdirSync(OUT, { recursive: true });
		await page.locator('#run221-aurora-proof').screenshot({ path: path.join(OUT, 'game-aurora-flow-b.png') });
		await page.evaluate(async () => {
			const { updateAuroraSky } = await import('/src/3d/sky.js');
			void updateAuroraSky;
		});

		assert(missing.length === 0, `HTTP errors: ${missing.join(' | ')}`);
		assert(errors.length === 0, `Console/page errors: ${errors.join(' | ')}`);
		console.log(`[checkRun221RealisticGameAuroraBrowser] PASS: ${JSON.stringify(result)}`);
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
