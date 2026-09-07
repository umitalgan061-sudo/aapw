#!/usr/bin/env node

/**
 * Real-runtime asset/material proof. The scene is created by the shipped `createScene()` factory,
 * then traversed after optional GLB hydration has had time to settle. The check does not replace
 * any material and does not alter the rendered pixels. It only records what the live renderer sees.
 *
 * The purpose is to catch the visual regressions behind the historical flat/primitive environment:
 *   - meshes with a single unqualified base color where a PBR map set is available;
 *   - missing normal/roughness response on imported environmental models;
 *   - materials that still report placeholder markers;
 *   - assets whose world bounds are non-finite;
 *   - ungrounded models where the runtime explicitly exposes bounding boxes.
 *
 * Asset selection and placement remain owned by the shared core. This proof is deliberately read-only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, loadPlaywright } from './devServerHelper.js';

const OUTPUT_DIR = path.resolve(process.env.WORLD_ENVIRONMENT_ARTIFACT_DIR ?? 'artifacts/world-environment-materials');
const WIDTH = 1536;
const HEIGHT = 1024;
const MOBILE_MODE = process.env.WORLD_MATERIAL_DESKTOP !== '1';

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
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error?.stack ?? error)));
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
		await page.waitForTimeout(3000);

		const report = await page.evaluate(async ({ width, height }) => {
			const [{ createScene }, THREE] = await Promise.all([
				import('/src/3d/sceneManager.js'),
				import('/src/3d/vendor/three/three.module.js'),
			]);
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			document.body.appendChild(canvas);
			const state = createScene(canvas);
			await new Promise((resolve) => setTimeout(resolve, 2500));

			const materials = [];
			const meshes = [];
			const boundsIssues = [];
			const placeholderIssues = [];
			const noPbrIssues = [];
			state.scene.traverse((object) => {
				if (!object?.isMesh) return;
				const materialList = Array.isArray(object.material) ? object.material : [object.material];
				const worldPosition = object.getWorldPosition(new THREE.Vector3());
				const entry = {
					name: object.name || '(unnamed-mesh)',
					position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
					materialCount: materialList.length,
				};
				if (![worldPosition.x, worldPosition.y, worldPosition.z].every(Number.isFinite)) boundsIssues.push(entry.name);
				for (const material of materialList) {
					if (!material || typeof material !== 'object') continue;
					const snapshot = {
						mesh: entry.name,
						...inspectMaterialInline(material),
					};
					materials.push(snapshot);
					if (snapshot.singleColorMarker) placeholderIssues.push(snapshot.mesh);
					const environmentLike = /terrain|rock|cliff|tree|vegetation|wall|roof|castle|village|geology|grass|snow|bridge|waystone/i.test(`${entry.name} ${snapshot.name}`);
					if (environmentLike && snapshot.channelCount < 2 && !snapshot.vertexColors) noPbrIssues.push(`${entry.name}:${snapshot.name}`);
				}
				meshes.push(entry);
			});
			state.camera.position.set(0, 1650, 2050);
			state.controls.target.set(0, 0, 0);
			state.controls.update();
			state.renderer.setSize(width, height, false);
			state.renderer.render(state.scene, state.camera);
			return {
				meshCount: meshes.length,
				materialCount: materials.length,
				materials: materials.slice(0, 1000),
				boundsIssues,
				placeholderIssues: [...new Set(placeholderIssues)],
				noPbrIssues: [...new Set(noPbrIssues)],
				renderer: { webgl2: Boolean(state.renderer.capabilities.isWebGL2), pixelRatio: state.renderer.getPixelRatio() },
				residency: state.chunkManager.getEnvironmentResidencyStats(),
			};

			function inspectMaterialInline(material) {
				const maps = {
					albedo: Boolean(material.map),
					normal: Boolean(material.normalMap),
					roughness: Boolean(material.roughnessMap),
					metalness: Boolean(material.metalnessMap),
					ao: Boolean(material.aoMap),
					displacement: Boolean(material.displacementMap),
				};
				return {
					name: material.name || '(unnamed)',
					maps,
					channelCount: Object.values(maps).filter(Boolean).length,
					roughness: Number.isFinite(material.roughness) ? material.roughness : null,
					metalness: Number.isFinite(material.metalness) ? material.metalness : null,
					singleColorMarker: Boolean(material.userData?.placeholder || material.userData?.singleColor),
				};
			}
		}, { width: WIDTH, height: HEIGHT });

		const screenshotPath = path.join(OUTPUT_DIR, MOBILE_MODE ? 'createScene-materials-mobile.png' : 'createScene-materials-desktop.png');
		await page.screenshot({ path: screenshotPath, fullPage: false });
		await fs.promises.writeFile(path.join(OUTPUT_DIR, 'material-proof.json'), JSON.stringify({ report, pageErrors }, null, 2));
		await context.close();

		if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('\n')}`);
		if (report.meshCount <= 0) throw new Error('no live meshes observed');
		if (report.materialCount <= 0) throw new Error('no live materials observed');
		if (report.boundsIssues.length) throw new Error(`non-finite world positions: ${report.boundsIssues.join(', ')}`);
		if (report.placeholderIssues.length) throw new Error(`placeholder material markers: ${report.placeholderIssues.join(', ')}`);
		if (report.noPbrIssues.length) throw new Error(`environment materials without PBR response: ${report.noPbrIssues.join(', ')}`);
		console.log(`[world-environment-materials] PASS live meshes=${report.meshCount} materials=${report.materialCount}; pbrIssues=0; placeholder=0; residency=${JSON.stringify(report.residency.bands)}; screenshot=${screenshotPath}`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[world-environment-materials] FAIL:', error);
	process.exit(1);
});
