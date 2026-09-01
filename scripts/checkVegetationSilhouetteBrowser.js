#!/usr/bin/env node
/**
 * Real WebGL proof for the production procedural vegetation silhouettes.
 * Renders one evergreen and one broadleaf from createVegetation() in isolation so the artifact
 * judges the actual instanced production geometry/materials rather than full-game boot timing.
 */
const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkVegetationSilhouetteBrowser] SKIP: Playwright is not available.');
		process.exit(2);
	}

	const outputDir = path.resolve('artifacts/vegetation-silhouette-exact-head');
	fs.mkdirSync(outputDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
		await page.goto(`http://127.0.0.1:${port}/scripts/vegetationSilhouetteHarness.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		});

		const metrics = await page.evaluate(async () => {
			const THREE = await import('three');
			const vegetation = await import('/src/3d/world/vegetation.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const created = vegetation.createVegetation({
				sampleHeightMeters: () => 0,
				seaLevelMeters: -100,
				seed: 0x53494c48,
				seats: [],
				roadEdges: [],
				radiusMeters: 90,
				densityPerKm2: 1400,
			});

			const find = (name) => created.group.children.find((mesh) => mesh.name === name);
			const pairs = [
				{
					id: 'pine',
					x: -4.1,
					trunk: find('vegetation-pine-trunks'),
					foliage: find('vegetation-pine-foliage'),
				},
				{
					id: 'round',
					x: 4.1,
					trunk: find('vegetation-round-trunks'),
					foliage: find('vegetation-round-foliage'),
				},
			];
			for (const pair of pairs) {
				fail(pair.trunk?.isInstancedMesh && pair.foliage?.isInstancedMesh, `${pair.id} production pair missing`);
				fail(pair.trunk.count > 0 && pair.foliage.count > 0, `${pair.id} fixture placed no instances`);
				fail(pair.trunk.geometry.userData?.vegetationSilhouette, `${pair.id} trunk silhouette metadata missing`);
				fail(pair.foliage.geometry.userData?.vegetationSilhouette, `${pair.id} foliage silhouette metadata missing`);
			}

			const canvas = document.getElementById('view');
			const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1000, 700, false);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE.PCFSoftShadowMap;

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x91a6b3);
			const camera = new THREE.PerspectiveCamera(38, 1000 / 700, 0.1, 100);
			camera.position.set(0, 5.7, 20.5);
			camera.lookAt(0, 4.2, 0);

			const hemi = new THREE.HemisphereLight(0xdbe7ef, 0x4c553c, 1.45);
			scene.add(hemi);
			const sun = new THREE.DirectionalLight(0xfff1d5, 2.6);
			sun.position.set(-7, 14, 11);
			sun.castShadow = true;
			scene.add(sun);

			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(30, 16),
				new THREE.MeshStandardMaterial({ color: 0x596647, roughness: 0.96, metalness: 0 }),
			);
			ground.rotation.x = -Math.PI / 2;
			ground.receiveShadow = true;
			scene.add(ground);

			const displayMeshes = [];
			const matrix = new THREE.Matrix4();
			const position = new THREE.Vector3();
			const rotation = new THREE.Quaternion();
			const scale = new THREE.Vector3(1.2, 1.2, 1.2);
			for (const pair of pairs) {
				position.set(pair.x, 0, 0);
				rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pair.id === 'pine' ? -0.22 : 0.31);
				matrix.compose(position, rotation, scale);
				for (const source of [pair.trunk, pair.foliage]) {
					const mesh = new THREE.InstancedMesh(source.geometry, source.material, 1);
					mesh.setMatrixAt(0, matrix);
					mesh.instanceMatrix.needsUpdate = true;
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					displayMeshes.push(mesh);
					scene.add(mesh);
				}
			}

			renderer.render(scene, camera);
			const gl = renderer.getContext();
			const error = gl.getError();
			fail(error === gl.NO_ERROR, `WebGL error ${error}`);
			const silhouettes = pairs.map((pair) => ({
				id: pair.id,
				trunk: pair.trunk.geometry.userData.vegetationSilhouette,
				foliage: pair.foliage.geometry.userData.vegetationSilhouette,
			}));
			const render = {
				calls: renderer.info.render.calls,
				triangles: renderer.info.render.triangles,
				points: renderer.info.render.points,
				lines: renderer.info.render.lines,
			};
			window.__vegetationSilhouetteQa = { renderer, created, vegetation, ground };
			return { render, silhouettes, placedCount: created.placedCount };
		});

		assert(metrics.placedCount > 0, 'production fixture rendered no vegetation');
		assert(metrics.render.calls >= 5 && metrics.render.calls <= 7,
			`unexpected draw-call count ${metrics.render.calls}; silhouette upgrade must remain instanced`);
		assert(metrics.render.triangles > 150, `rendered triangle count ${metrics.render.triangles} is implausibly low`);
		const pine = metrics.silhouettes.find((entry) => entry.id === 'pine');
		const round = metrics.silhouettes.find((entry) => entry.id === 'round');
		assert(pine?.foliage?.profile === 'continuous-evergreen-crown',
			'pine did not render continuous evergreen production geometry');
		assert(pine?.foliage?.connectedSurface === true && pine?.foliage?.componentCount === 1,
			'pine crown is no longer a single connected surface');
		assert(pine?.foliage?.profileRingCount >= 9 && pine?.foliage?.radialSegments >= 8,
			'pine crown topology is too coarse to preserve an organic connected silhouette');
		assert(round?.foliage?.profile === 'lobed-broadleaf', 'round tree did not render lobed-broadleaf production geometry');

		const screenshotPath = path.join(outputDir, 'vegetation-silhouette.png');
		await page.locator('#view').screenshot({ path: screenshotPath });
		fs.writeFileSync(path.join(outputDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);

		await page.evaluate(() => {
			const qa = window.__vegetationSilhouetteQa;
			if (!qa) return;
			qa.vegetation.disposeVegetation(qa.created.group);
			qa.ground.geometry.dispose();
			qa.ground.material.dispose();
			qa.renderer.dispose();
			delete window.__vegetationSilhouetteQa;
		});
		console.log('[checkVegetationSilhouetteBrowser] PASS', JSON.stringify(metrics));
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkVegetationSilhouetteBrowser] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
