#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const OUT = path.join(process.cwd(), 'artifacts', 'run221-aurora-diagnostic');

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
	page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
	page.on('pageerror', (error) => errors.push(String(error)));
	page.on('response', (response) => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });

	try {
		await page.route('**/src/3d/game3d.js', async (route) => {
			await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'export function initGame3D() {}\n' });
		});
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		fs.mkdirSync(OUT, { recursive: true });

		const metrics = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createAuroraSky, updateAuroraSky } = await import('/src/3d/sky.js');
			const { createDayNightLighting, updateDayNightLighting } = await import('/src/3d/lighting.js');
			const canvas = document.createElement('canvas');
			canvas.id = 'run221-diagnostic-canvas';
			canvas.width = 960;
			canvas.height = 540;
			canvas.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);width:960px;height:540px;z-index:99999;background:#000';
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
			const sky = createAuroraSky();
			scene.add(sky);
			const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), new THREE.MeshStandardMaterial({ color: 0x52604d, roughness: 0.93 }));
			ground.rotation.x = -Math.PI / 2;
			ground.position.set(420, -6, -430);
			scene.add(ground);
			for (let i = 0; i < 5; i++) {
				const tower = new THREE.Mesh(new THREE.BoxGeometry(18 + i * 2, 42 + i * 9, 18 + i * 2), new THREE.MeshStandardMaterial({ color: 0x667078, roughness: 0.88 }));
				tower.position.set(355 + i * 34, 15 + i * 4.5, -500 - (i % 2) * 24);
				scene.add(tower);
			}
			const gl = renderer.getContext();
			const first = new Uint8Array(960 * 540 * 4);
			const second = new Uint8Array(first.length);
			const summarize = (buffer) => {
				let lum = 0, bright = 0, phosphor = 0;
				for (let i = 0; i < buffer.length; i += 4) {
					const r = buffer[i], g = buffer[i + 1], b = buffer[i + 2];
					const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
					lum += y;
					if (y > 72) bright++;
					if (g > 68 && g > r * 1.12 && g > b * 1.02) phosphor++;
				}
				const count = buffer.length / 4;
				return { averageLuminance: lum / count, brightFraction: bright / count, phosphorFraction: phosphor / count };
			};
			updateAuroraSky(sky, camera.position, 37, midnight);
			renderer.render(scene, camera);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, first);
			window.__RUN221_DIAGNOSTIC__ = { renderer, scene, camera, sky, midnight, updateAuroraSky };
			const firstStats = summarize(first);
			return { firstStats, shaderMarker: sky.material.userData.auroraCurtainRaysV3 === true };
		});
		await page.locator('#run221-diagnostic-canvas').screenshot({ path: path.join(OUT, 'v3-frame-37.png') });

		const second = await page.evaluate(() => {
			const d = window.__RUN221_DIAGNOSTIC__;
			d.updateAuroraSky(d.sky, d.camera.position, 83, d.midnight);
			d.renderer.render(d.scene, d.camera);
			const gl = d.renderer.getContext();
			const buffer = new Uint8Array(960 * 540 * 4);
			gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
			let lum = 0, bright = 0, phosphor = 0;
			for (let i = 0; i < buffer.length; i += 4) {
				const r = buffer[i], g = buffer[i + 1], b = buffer[i + 2];
				const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
				lum += y;
				if (y > 72) bright++;
				if (g > 68 && g > r * 1.12 && g > b * 1.02) phosphor++;
			}
			const count = buffer.length / 4;
			return { averageLuminance: lum / count, brightFraction: bright / count, phosphorFraction: phosphor / count };
		});
		await page.locator('#run221-diagnostic-canvas').screenshot({ path: path.join(OUT, 'v3-frame-83.png') });
		if (errors.length) throw new Error(`Console/page errors: ${errors.join(' | ')}`);
		if (missing.length) throw new Error(`HTTP errors: ${missing.join(' | ')}`);
		console.log(`[captureRun221AuroraDiagnostic] PASS diagnostic-only: ${JSON.stringify({ ...metrics, second })}`);
	} finally {
		await context.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[captureRun221AuroraDiagnostic] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
