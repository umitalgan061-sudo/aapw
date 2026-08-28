#!/usr/bin/env node
/**
 * captureGroundCoverEvidence.mjs — GOVERNANCE.md §8.5 evidence for run 366 / ADR-0313's ground cover.
 *
 * **What this run claims.** The owner's editor screenshot showed the wind grass as flat green
 * rectangles standing on the ground, and said plainly that seeing that quality while asking for
 * geographic realism is upsetting. The cause was geometry: `run180GrassGeometry()` built each blade as
 * a *single flat quad* — four vertices, no taper, no cross-section — so a blade was literally a
 * rectangle, and at ten blades per 4.5 m patch there was nothing between the rectangles either. This
 * run rebuilds the blade as two crossed, tapered, three-segment strips with root-to-tip vertex
 * colours, at 24 blades per 3.2 m patch. The mesh is an `InstancedMesh`, so the geometry is built once
 * and reused by every patch: a better blade costs one geometry, not one per patch.
 *
 * **Why it needs a camera and not a unit test.** "Does not read as a rectangle" is a claim about
 * pixels. So this reports, alongside close ground-level framings:
 *
 * - **vertices and triangles per blade**, and per patch — the geometric claim, exactly.
 * - **grass silhouette complexity**: the mean absolute Laplacian of luminance over green-dominant
 *   pixels only. A field of flat rectangles has long uniform interiors and few edges; tapered crossed
 *   blades have an edge every few pixels. The statistic separates the two.
 * - **prop placements**, from `world/worldPropScatter.js`'s pure per-chunk planner. In a checkout
 *   without Git LFS objects the authored `.glb` models are pointer stubs and none of them load, so the
 *   *built* count is legitimately zero here; the *planned* count is what this environment can honestly
 *   measure, and it is what will be placed wherever LFS resolves.
 *
 * Run once per tree state and diff:
 *   node scripts/captureGroundCoverEvidence.mjs after
 *   git stash && node scripts/captureGroundCoverEvidence.mjs before && git stash pop
 *
 * Usage: `node scripts/captureGroundCoverEvidence.mjs [label] [--chunk=X,Z]`
 * Exit codes: 0 = captured. 1 = failure. 2 = Playwright unavailable.
 * @module scripts/captureGroundCoverEvidence
 */
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1280;
const HEIGHT = 860;
const LABEL = process.argv.slice(2).find((value) => !value.startsWith('--')) ?? 'after';
const OUT_DIR = path.resolve('artifacts/ground-cover', LABEL);
/** Lowland grass country by default — the point is what the world normally looks like underfoot, not
 * the steepest edge in it. Overridable as `--chunk=X,Z`. */
const CENTER_CHUNK = (() => {
	const argument = process.argv.find((value) => value.startsWith('--chunk='));
	if (!argument) return { x: 0, z: 2 };
	const [x, z] = argument.slice('--chunk='.length).split(',').map(Number);
	return { x, z };
})();

const playwright = loadPlaywright();
if (!playwright) {
	console.error('[captureGroundCoverEvidence] SKIP: Playwright unavailable');
	process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`));
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load', timeout: 60_000,
	});

	const result = await page.evaluate(async ({ width, height, centerChunk }) => {
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);

		const [THREE, sceneModule, configModule, lightingModule, propModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/lighting.js'),
			import('/src/3d/world/worldPropScatter.js'),
		]);
		const { WORLD_DEFAULTS, CHUNK_CONFIG } = configModule;

		document.body.innerHTML = '<canvas id="runtime-world"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const canvas = document.getElementById('runtime-world');
		Object.assign(canvas.style, { position: 'fixed', inset: '0' });

		const state = sceneModule.createScene(canvas);
		state.controls.enabled = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);

		const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const cx = centerChunk.x * chunkSize;
		const cz = centerChunk.z * chunkSize;
		state.chunkManager.streamTowards(centerChunk.x, centerChunk.z, 4);
		state.scene.updateMatrixWorld(true);
		await new Promise((resolve) => setTimeout(resolve, 2000));
		lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.42);

		// The grass is one InstancedMesh; find it and measure the blade geometry it reuses.
		let grass = null;
		state.scene.traverse((node) => { if (!grass && node.isInstancedMesh && node.name.includes('grass')) grass = node; });
		const grassStats = grass
			? {
				name: grass.name,
				patches: grass.count,
				verticesPerPatch: grass.geometry.getAttribute('position').count,
				trianglesPerPatch: (grass.geometry.getIndex()?.count ?? grass.geometry.getAttribute('position').count) / 3,
				hasVertexColors: Boolean(grass.geometry.getAttribute('color')),
				materialVertexColors: Boolean(grass.material?.vertexColors),
			}
			: null;

		// World props: the pure per-chunk planner, so this measures placement in an environment where the
		// models themselves cannot load. See this script's header.
		const placements = [];
		for (let dz = -2; dz <= 2; dz += 1) {
			for (let dx = -2; dx <= 2; dx += 1) {
				placements.push(...propModule.planChunkProps({
					chunkX: centerChunk.x + dx,
					chunkZ: centerChunk.z + dz,
					sampleHeightMeters: state.groundCollider.getGroundHeight,
					seed: WORLD_DEFAULTS.WORLD_SEED,
					seats: state.settlementSeats ?? [],
				}));
			}
		}
		const byClimate = {};
		for (const placement of placements) byClimate[placement.terrain] = (byClimate[placement.terrain] ?? 0) + 1;

		const ground = state.groundCollider.getGroundHeight(cx, cz);
		const aspect = width / height;
		const perspective = (fov, position, target) => {
			const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 40_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};
		const framings = [
			// Knee height, looking along the ground — the framing the owner's editor screenshot had.
			{ name: 'grass-knee-height', camera: perspective(55, { x: cx, y: ground + 0.6, z: cz }, { x: cx + 30, y: ground + 0.5, z: cz + 8 }) },
			{ name: 'grass-eye-level', camera: perspective(60, { x: cx - 8, y: ground + 1.7, z: cz - 8 }, { x: cx + 40, y: ground + 0.4, z: cz + 40 }) },
			{ name: 'grass-close-oblique', camera: perspective(40, { x: cx + 4, y: ground + 1.1, z: cz + 4 }, { x: cx + 25, y: ground, z: cz + 25 }) },
		];

		const gl = state.renderer.domElement;
		const shots = [];
		// Warm-up render. The grass repopulates in `onBeforeRender` from the camera's cell, so the very
		// first frame from a moved camera still shows the *previous* cell's patches — which silently made
		// the first framing report on bare terrain in an earlier capture.
		state.renderer.render(state.scene, framings[0].camera);
		for (const framing of framings) {
			state.renderer.render(state.scene, framing.camera);
			const c = document.createElement('canvas');
			c.width = gl.width;
			c.height = gl.height;
			const ctx = c.getContext('2d');
			ctx.drawImage(gl, 0, 0);
			const { data } = ctx.getImageData(0, 0, c.width, c.height);

			// Silhouette complexity over green-dominant pixels only: grass and foliage, not sky or rock.
			let energy = 0;
			let counted = 0;
			const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
			for (let y = 1; y < c.height - 1; y += 1) {
				for (let x = 1; x < c.width - 1; x += 1) {
					const i = (y * c.width + x) * 4;
					if (!(data[i + 1] > data[i] + 6 && data[i + 1] > data[i + 2] + 6)) continue;
					const laplacian = 4 * lum(i) - lum(i - 4) - lum(i + 4) - lum(i - c.width * 4) - lum(i + c.width * 4);
					energy += Math.abs(laplacian);
					counted += 1;
				}
			}
			shots.push({
				name: framing.name,
				dataUrl: c.toDataURL('image/png'),
				greenPixels: counted,
				silhouetteComplexity: counted ? energy / counted : 0,
			});
		}
		return { shots, grassStats, ground, props: { planned: placements.length, byClimate } };
	}, { width: WIDTH, height: HEIGHT, centerChunk: CENTER_CHUNK });

	for (const shot of result.shots) {
		fs.writeFileSync(path.join(OUT_DIR, `${shot.name}.png`), Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
		console.log(
			`[captureGroundCoverEvidence] ${LABEL.padEnd(6)} ${shot.name.padEnd(20)} ` +
				`silhouette complexity ${shot.silhouetteComplexity.toFixed(3).padStart(8)} over ${shot.greenPixels} green px`,
		);
	}
	const g = result.grassStats;
	console.log(
		g
			? `[captureGroundCoverEvidence] ${LABEL}: grass "${g.name}" ${g.patches} patches, ` +
				`${g.verticesPerPatch} verts / ${g.trianglesPerPatch} tris per patch, ` +
				`vertex colours ${g.hasVertexColors && g.materialVertexColors ? 'on' : 'OFF'}.`
			: `[captureGroundCoverEvidence] ${LABEL}: no grass InstancedMesh found in the scene.`,
	);
	console.log(
		`[captureGroundCoverEvidence] ${LABEL}: ${result.props.planned} prop placements planned over 5x5 chunks ` +
			`(${JSON.stringify(result.props.byClimate)}); ground ${result.ground.toFixed(1)} m.`,
	);
	if (consoleErrors.length) console.log(`[captureGroundCoverEvidence] console errors: ${consoleErrors.slice(0, 4).join(' | ')}`);
	console.log(`[captureGroundCoverEvidence] Wrote ${result.shots.length} PNGs to ${OUT_DIR}`);
	process.exit(0);
} catch (error) {
	console.error('[captureGroundCoverEvidence] FAIL:', error);
	process.exit(1);
} finally {
	await browser.close();
	server.close();
}
