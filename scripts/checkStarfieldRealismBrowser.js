#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const OUT = path.join(process.cwd(), 'artifacts', 'starfield-exact-head');
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

function writeEvidenceDataUrl(dataUrl) {
	const encoded = typeof dataUrl === 'string' ? dataUrl.split(',', 2)[1] : null;
	if (!encoded) return false;
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(path.join(OUT, 'starfield-night.png'), Buffer.from(encoded, 'base64'));
	return true;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright is not available.');
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
		await page.route('**/src/3d/game3d.js', async (route) => {
			await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'export function initGame3D() {}\n' });
		});
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		});

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createStarfield, updateStarfield, disposeStarfield } = await import('/src/3d/stars.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const width = 960;
			const height = 540;
			const canvas = document.createElement('canvas');
			canvas.id = 'starfield-realism-proof';
			canvas.width = width;
			canvas.height = height;
			document.body.appendChild(canvas);

			const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(width, height, false);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.setClearColor(0x010207, 1);

			const scene = new THREE.Scene();
			const starfield = createStarfield(1337);
			scene.add(starfield);
			const camera = new THREE.PerspectiveCamera(72, width / height, 0.1, 2100);
			camera.position.set(0, 8, 0);
			camera.lookAt(0, 520, -1450);

			const gl = renderer.getContext();
			const readFrame = () => {
				const pixels = new Uint8Array(width * height * 4);
				gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				return pixels;
			};
			const stats = (pixels) => {
				let luminous = 0;
				let bright = 0;
				let warm = 0;
				let cool = 0;
				let neutral = 0;
				let luminanceTotal = 0;
				for (let i = 0; i < pixels.length; i += 4) {
					const r = pixels[i];
					const g = pixels[i + 1];
					const b = pixels[i + 2];
					const maxChannel = Math.max(r, g, b);
					const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
					luminanceTotal += lum;
					if (maxChannel > 10) {
						luminous++;
						if (lum > 62) bright++;
						if (r > b * 1.08) warm++;
						else if (b > r * 1.08) cool++;
						else neutral++;
					}
				}
				const count = pixels.length / 4;
				return {
					averageLuminance: luminanceTotal / count,
					luminousFraction: luminous / count,
					brightFraction: bright / count,
					luminousPixels: luminous,
					brightPixels: bright,
					warmPixels: warm,
					neutralPixels: neutral,
					coolPixels: cool,
				};
			};
			const meanRgbDelta = (a, b) => {
				let delta = 0;
				for (let i = 0; i < a.length; i += 4) {
					delta += Math.abs(a[i] - b[i]);
					delta += Math.abs(a[i + 1] - b[i + 1]);
					delta += Math.abs(a[i + 2] - b[i + 2]);
				}
				return delta / ((a.length / 4) * 3);
			};

			updateStarfield(starfield, camera.position, 11.0, 1.0);
			renderer.render(scene, camera);
			const nightA = readFrame();
			const nightAStats = stats(nightA);
			const evidenceDataUrl = canvas.toDataURL('image/png');

			updateStarfield(starfield, camera.position, 29.0, 1.0);
			renderer.render(scene, camera);
			const nightB = readFrame();
			const nightBStats = stats(nightB);
			const animationDelta = meanRgbDelta(nightA, nightB);

			const initialQuaternion = camera.quaternion.clone();
			camera.position.set(760, 63, -910);
			camera.quaternion.copy(initialQuaternion);
			updateStarfield(starfield, camera.position, 11.0, 1.0);
			renderer.render(scene, camera);
			const translated = readFrame();
			const translationDelta = meanRgbDelta(nightA, translated);

			updateStarfield(starfield, camera.position, 11.0, 0.0);
			renderer.render(scene, camera);
			const day = readFrame();
			const dayStats = stats(day);

			fail(nightAStats.luminousFraction > 0.00035, `Night star coverage too sparse: ${nightAStats.luminousFraction}`);
			fail(nightAStats.luminousFraction < 0.025, `Night star coverage too dense: ${nightAStats.luminousFraction}`);
			fail(nightAStats.brightPixels >= 8, `No convincing bright stellar anchors: ${nightAStats.brightPixels}`);
			fail(nightAStats.warmPixels >= 8, `Warm stellar signal missing: ${nightAStats.warmPixels}`);
			fail(nightAStats.coolPixels >= 8, `Cool stellar signal missing: ${nightAStats.coolPixels}`);
			fail(nightAStats.neutralPixels > nightAStats.warmPixels + nightAStats.coolPixels,
				`Neutral stellar population no longer dominates: ${nightAStats.neutralPixels}/${nightAStats.warmPixels}/${nightAStats.coolPixels}`);
			fail(animationDelta > 0.01, `Twinkle animation is visually static: ${animationDelta}`);
			fail(animationDelta < 1.5, `Twinkle animation is too aggressive: ${animationDelta}`);
			fail(translationDelta < 0.025, `Camera translation slides the star dome: ${translationDelta}`);
			fail(dayStats.luminousPixels <= 2, `Stars leak into canonical day state: ${dayStats.luminousPixels}`);
			fail(dayStats.averageLuminance < nightAStats.averageLuminance * 0.72,
				`Day fade does not materially reduce stellar luminance: ${nightAStats.averageLuminance} -> ${dayStats.averageLuminance}`);

			disposeStarfield(starfield);
			return { nightAStats, nightBStats, dayStats, animationDelta, translationDelta, evidenceDataUrl };
		});

		assert(writeEvidenceDataUrl(result.evidenceDataUrl), 'Starfield WebGL evidence PNG could not be encoded.');
		delete result.evidenceDataUrl;
		assert(missing.length === 0, `HTTP errors: ${missing.join(' | ')}`);
		assert(errors.length === 0, `Console/page errors: ${errors.join(' | ')}`);
		console.log(`[checkStarfieldRealismBrowser] PASS: ${JSON.stringify(result)}`);
	} catch (error) {
		try {
			const failureDataUrl = await page.evaluate(() => document.getElementById('starfield-realism-proof')?.toDataURL('image/png') || null);
			writeEvidenceDataUrl(failureDataUrl);
		} catch {
			// Keep the original error authoritative if rendering never reached the canvas.
		}
		throw error;
	} finally {
		await context.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkStarfieldRealismBrowser] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
