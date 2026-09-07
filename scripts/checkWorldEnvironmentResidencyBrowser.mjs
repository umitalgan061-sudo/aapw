#!/usr/bin/env node

/**
 * Browser-side proof for the environment residency production slice.
 *
 * The check intentionally calls the shipped `sceneManager.createScene()` rather than constructing a
 * synthetic terrain graph. This means the result observes the exact runtime ChunkManager instance,
 * canonical terrain sampler, settlement flatten pads, environment material lifecycle and renderer
 * boot used by the game. No pixels are altered after render.
 *
 * The browser can be pointed at mobile-class or desktop-class device emulation. The default mobile
 * profile is used for CI because the shipped desktop preview is intentionally large (23x23 chunks),
 * while the visual frame itself remains 1536x1024 so the artifact can be compared with the established
 * full-world acceptance captures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, loadPlaywright } from './devServerHelper.js';

const OUTPUT_DIR = path.resolve(process.env.WORLD_ENVIRONMENT_ARTIFACT_DIR ?? 'artifacts/world-environment-residency');
const WIDTH = 1536;
const HEIGHT = 1024;
const MOBILE_MODE = process.env.WORLD_RESIDENCY_DESKTOP !== '1';
const SCREENSHOT_NAME = MOBILE_MODE ? 'createScene-mobile-1536x1024.png' : 'createScene-desktop-1536x1024.png';

function fail(message) {
	console.error(`[world-environment-residency-browser] FAIL ${message}`);
	process.exit(1);
}

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function serializeEntry(entry) {
	if (!entry) return null;
	return {
		key: entry.key,
		band: entry.band,
		distanceMeters: finite(entry.distanceMeters),
		centerWorldXZ: entry.centerWorldXZ,
		assetPriority: entry.assetPriority,
	};
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({
		headless: true,
		args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
	});

	try {
		const context = await browser.newContext({
			viewport: { width: WIDTH, height: HEIGHT },
			isMobile: MOBILE_MODE,
			hasTouch: MOBILE_MODE,
			deviceScaleFactor: 1,
		});
		const page = await context.newPage();
		const consoleLines = [];
		const pageErrors = [];
		page.on('console', (message) => {
			const line = `[${message.type()}] ${message.text()}`;
			consoleLines.push(line);
			if (message.type() === 'error') console.error(line);
		});
		page.on('pageerror', (error) => {
			pageErrors.push(String(error?.stack ?? error));
		});

		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
		await page.waitForTimeout(1500);

		const result = await page.evaluate(async ({ width, height, mobile }) => {
			const { createScene } = await import('/src/3d/sceneManager.js');
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			document.body.appendChild(canvas);

			const state = createScene(canvas);
			state.camera.position.set(0, 1850, 2300);
			state.controls.target.set(0, 0, 0);
			state.controls.update();
			state.renderer.setSize(width, height, false);
			state.renderer.render(state.scene, state.camera);

			const centerMesh = state.chunkManager.getLoadedChunkMesh(0, 0);
			const edgeMesh = state.chunkManager.getLoadedChunkMesh(mobile ? 2 : 5, 0);
			const centerManifest = centerMesh?.userData?.environmentResidency ?? null;
			const edgeManifest = edgeMesh?.userData?.environmentResidency ?? null;
			const environmentStats = state.chunkManager.getEnvironmentResidencyStats();
			const allResident = [];
			for (const [key, mesh] of state.chunkManager.loaded.entries()) {
				allResident.push({
					key,
					visible: mesh.visible,
					band: mesh.userData?.environmentResidencyBand,
					distanceMeters: mesh.userData?.environmentResidencyDistanceMeters,
					hasManifest: Boolean(mesh.userData?.environmentResidency),
					receiveShadow: mesh.receiveShadow,
					castShadow: mesh.castShadow,
				});
			}
			allResident.sort((a, b) => a.key.localeCompare(b.key));
			return {
				mobile,
				canvas: { width, height },
				loadedCount: state.chunkManager.loadedCount,
				environmentStats,
				center: serializeEntry(centerManifest),
				edge: serializeEntry(edgeManifest),
				centerManifest,
				edgeManifest,
				resident: allResident,
				renderer: {
					isWebGL2: Boolean(state.renderer.capabilities.isWebGL2),
					pixelRatio: state.renderer.getPixelRatio(),
				},
			};
		}, { width: WIDTH, height: HEIGHT, mobile: MOBILE_MODE });

		await page.screenshot({ path: path.join(OUTPUT_DIR, SCREENSHOT_NAME), fullPage: false });
		await fs.promises.writeFile(path.join(OUTPUT_DIR, 'runtime-proof.json'), JSON.stringify({ result, consoleLines, pageErrors }, null, 2));
		await context.close();

		assert(pageErrors.length === 0, `page errors detected: ${pageErrors.join('\n')}`);
		assert(result.loadedCount > 0, 'createScene returned no terrain chunks');
		assert(result.environmentStats.residentManifests === result.loadedCount, 'every resident terrain chunk must carry residency manifest');
		assert(result.center?.band === 'near', `origin chunk must be near, got ${result.center?.band}`);
		assert(result.centerManifest?.families?.length > 4, 'center manifest must expose multiple environment families');
		assert(result.centerManifest.families.every((family) => family.maxAssets >= 0), 'family budgets must be non-negative');
		assert(result.centerManifest.families.every((family) => family.requirements?.singleColorMaterialForbidden === true), 'single-color contract must be active');
		assert(result.renderer.pixelRatio >= 1, 'renderer pixel ratio not configured');
		assert(result.resident.every((entry) => entry.hasManifest), 'resident chunk missing manifest');
		assert(result.resident.every((entry) => entry.castShadow === false), 'terrain must not cast environment shadows');
		assert(result.resident.every((entry) => entry.distanceMeters >= 0), 'invalid resident distance');

		const bandCounts = result.resident.reduce((counts, entry) => {
			counts[entry.band] = (counts[entry.band] ?? 0) + 1;
			return counts;
		}, {});
		assert((bandCounts.near ?? 0) > 0, 'near residency band missing');
		assert((bandCounts.far ?? 0) >= 0, 'far residency band invalid');

		console.log(`[world-environment-residency-browser] PASS ${MOBILE_MODE ? 'mobile' : 'desktop'} createScene ${WIDTH}x${HEIGHT}; loaded=${result.loadedCount}; bands=${JSON.stringify(bandCounts)}; screenshot=${path.join(OUTPUT_DIR, SCREENSHOT_NAME)}`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[world-environment-residency-browser] FAIL:', error);
	process.exit(1);
});
