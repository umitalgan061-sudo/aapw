#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
	console.error('[checkWinterTreeVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
	process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/winter-tree-visual-qa';
const VIEWPORT = Object.freeze({ width: 960, height: 720 });
const PREFERRED_PINE = 'assets/models/vegetation/pine_Zt62gceKXZ.glb';
const ASSET_PATH = process.env.WINTER_VISUAL_ASSET || PREFERRED_PINE;
const ARTIFACT_STEM = process.env.WINTER_VISUAL_STEM || 'snow-pine';
const ASSET_LABEL = path.basename(ASSET_PATH);

function round(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
	if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});

try {
	await page.goto(`${server.baseUrl}/winter-tree-visual-qa.html`, { waitUntil: 'networkidle' });
	const metrics = await page.evaluate(async ({ assetPath, assetLabel, viewport }) => {
		const THREE = await import('three');
		const {
			WINTER_VEGETATION_ASSET_POLICY,
			findProceduralWinterMeshes,
			upgradeWinterVegetationAssets,
		} = await import('./src/3d/world/winterVegetationAsset.js');

		const root = document.getElementById('qa-root');
		const label = document.getElementById('qa-label');
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
		renderer.setPixelRatio(1);
		renderer.setSize(viewport.width, viewport.height, false);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
		root.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0xc8d0d4);
		const camera = new THREE.PerspectiveCamera(39, viewport.width / viewport.height, 0.1, 80);
		const hemisphere = new THREE.HemisphereLight(0xe8f2f5, 0x586068, 1.25);
		scene.add(hemisphere);
		const sun = new THREE.DirectionalLight(0xfff1d6, 3.1);
		sun.position.set(8, 15, 10);
		sun.castShadow = true;
		sun.shadow.mapSize.set(1024, 1024);
		Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 45 });
		scene.add(sun);
		const moon = new THREE.DirectionalLight(0xaec8ff, 0);
		moon.position.set(-9, 12, -7);
		moon.castShadow = true;
		moon.shadow.mapSize.set(1024, 1024);
		Object.assign(moon.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 45 });
		scene.add(moon);

		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry(32, 32),
			new THREE.MeshStandardMaterial({ color: 0xd7d9d5, roughness: 0.94, metalness: 0 }),
		);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);

		const group = new THREE.Group();
		const trunk = new THREE.InstancedMesh(
			new THREE.CylinderGeometry(0.2, 0.35, 3.2, 6),
			new THREE.MeshStandardMaterial({ color: 0x50433a }), 1,
		);
		const foliage = new THREE.InstancedMesh(
			new THREE.ConeGeometry(2.2, 5.9, 7),
			new THREE.MeshStandardMaterial({ color: 0xd9e4e5 }), 1,
		);
		trunk.name = WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName;
		foliage.name = WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName;
		trunk.castShadow = trunk.receiveShadow = true;
		foliage.castShadow = foliage.receiveShadow = true;
		const identity = new THREE.Matrix4();
		trunk.setMatrixAt(0, identity);
		foliage.setMatrixAt(0, identity);
		group.add(trunk, foliage);
		group.userData.northClimateVegetation = { winterTreeCount: 1, liveRepresentation: 'instanced-procedural-snow-pine' };
		scene.add(group);

		const status = await upgradeWinterVegetationAssets(group, { candidates: [assetPath] });
		const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
		const replacements = group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-'));
		group.updateMatrixWorld(true);

		const bounds = new THREE.Box3();
		const corner = new THREE.Vector3();
		const instanceMatrix = new THREE.Matrix4();
		const worldMatrix = new THREE.Matrix4();
		for (const mesh of replacements) {
			mesh.geometry.computeBoundingBox();
			mesh.getMatrixAt(0, instanceMatrix);
			worldMatrix.copy(mesh.matrixWorld).multiply(instanceMatrix);
			const box = mesh.geometry.boundingBox;
			for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
				corner.set(x, y, z).applyMatrix4(worldMatrix);
				bounds.expandByPoint(corner);
			}
		}
		const size = bounds.getSize(new THREE.Vector3());
		const center = bounds.getCenter(new THREE.Vector3());

		function projection() {
			camera.updateMatrixWorld(true);
			camera.updateProjectionMatrix();
			const points = [];
			for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
				points.push(new THREE.Vector3(x, y, z).project(camera));
			}
			const xs = points.map((point) => point.x);
			const ys = points.map((point) => point.y);
			const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
			return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
		}

		function renderView(position, lookAt, text) {
			camera.position.fromArray(position);
			camera.lookAt(...lookAt);
			label.textContent = text;
			renderer.render(scene, camera);
			return projection();
		}

		function setNightLighting(enabled) {
			sun.intensity = enabled ? 0 : 3.1;
			moon.intensity = enabled ? 1.65 : 0;
			hemisphere.intensity = enabled ? 0.45 : 1.25;
			scene.background.set(enabled ? 0x101827 : 0xc8d0d4);
			ground.material.color.set(enabled ? 0xaeb9c5 : 0xd7d9d5);
		}

		const frontProjection = renderView([10.5, 7.4, 14.5], [0, 4.15, 0], `${assetLabel} · three-quarter · 8.6 m target`);
		window.__renderWinterTreeSide = () => renderView([-18.0, 7.0, 0], [0, 4.0, 0], `${assetLabel} · side · shadow/material QA`);
		window.__renderWinterTreeNight = () => {
			setNightLighting(true);
			return {
				projection: renderView([10.5, 7.4, 14.5], [0, 4.15, 0], `${assetLabel} · moonlight · night readability QA`),
				moonIntensity: moon.intensity,
				sunIntensity: sun.intensity,
				hemisphereIntensity: hemisphere.intensity,
			};
		};

		return {
			policyId: WINTER_VEGETATION_ASSET_POLICY.id,
			preferredSnowPineAsset: WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset,
			foliageSnowMix: {
				minimum: WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin,
				maximum: WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin + WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixRange,
			},
			status,
			replacementMeshes: replacements.length,
			proceduralHidden: trunkMesh?.visible === false && foliageMesh?.visible === false,
			bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray(), center: center.toArray() },
			ratio: Math.max(size.x, size.z) / size.y,
			frontProjection,
			materials: replacements.map((mesh) => ({
				type: mesh.material.type,
				color: mesh.material.color?.getHexString?.() ?? null,
				roughness: Number.isFinite(mesh.material.roughness) ? mesh.material.roughness : null,
				metalness: Number.isFinite(mesh.material.metalness) ? mesh.material.metalness : null,
				opacity: mesh.material.opacity,
				transparent: mesh.material.transparent,
				alphaTest: mesh.material.alphaTest ?? 0,
				map: Boolean(mesh.material.map),
				treatment: mesh.material.userData?.winterPineTreatment ?? 'source',
			})),
			shadows: {
				rendererEnabled: renderer.shadowMap.enabled,
				lightCastShadow: sun.castShadow,
				moonCastShadow: moon.castShadow,
				groundReceiveShadow: ground.receiveShadow,
				replacementsCastShadow: replacements.every((mesh) => mesh.castShadow),
				replacementsReceiveShadow: replacements.every((mesh) => mesh.receiveShadow),
			},
			renderInfo: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
		};
	}, { assetPath: ASSET_PATH, assetLabel: ASSET_LABEL, viewport: VIEWPORT });

	await page.screenshot({ path: `${ARTIFACT_DIR}/${ARTIFACT_STEM}-three-quarter.png`, fullPage: true });
	const sideProjection = await page.evaluate(() => window.__renderWinterTreeSide());
	await page.screenshot({ path: `${ARTIFACT_DIR}/${ARTIFACT_STEM}-side.png`, fullPage: true });
	const night = await page.evaluate(() => window.__renderWinterTreeNight());
	await page.screenshot({ path: `${ARTIFACT_DIR}/${ARTIFACT_STEM}-moonlight.png`, fullPage: true });

	const report = {
		assetPath: ASSET_PATH,
		...metrics,
		ratio: round(metrics.ratio),
		bounds: Object.fromEntries(Object.entries(metrics.bounds).map(([key, values]) => [key, values.map((value) => round(value))])),
		frontProjection: Object.fromEntries(Object.entries(metrics.frontProjection).map(([key, value]) => [key, round(value)])),
		sideProjection: Object.fromEntries(Object.entries(sideProjection).map(([key, value]) => [key, round(value)])),
		night: {
			...night,
			projection: Object.fromEntries(Object.entries(night.projection).map(([key, value]) => [key, round(value)])),
		},
		browserErrors,
	};
	await writeFile(`${ARTIFACT_DIR}/${ARTIFACT_STEM}-report.json`, `${JSON.stringify(report, null, 2)}\n`);

	assert.equal(metrics.status.status, 'active', `${ASSET_LABEL} must satisfy the runtime winter-tree validator`);
	assert.equal(metrics.status.assetUrl, ASSET_PATH);
	assert(metrics.replacementMeshes >= 1, 'accepted asset must create at least one rendered replacement mesh');
	assert.equal(metrics.proceduralHidden, true, 'procedural snow-pine must hide after accepted GLB activation');
	assert(Math.abs(metrics.bounds.size[1] - 8.6) < 0.03, `normalized height must be 8.6 m, got ${metrics.bounds.size[1]}`);
	assert(Math.abs(metrics.bounds.min[1]) < 0.03, `tree base must sit on ground, got Y=${metrics.bounds.min[1]}`);
	assert(metrics.ratio <= 1.05, `single-tree width ratio exceeds runtime policy: ${metrics.ratio}`);
	assert(metrics.frontProjection.height > 0.5 && metrics.frontProjection.height < 1.75, 'three-quarter view must frame the full tree');
	assert(metrics.frontProjection.width > 0.2 && metrics.frontProjection.width < 1.4, 'tree crown must occupy a useful frame width');
	assert(sideProjection.height > 0.5 && sideProjection.height < 1.8, 'side view must frame the full tree');
	assert(night.projection.height > 0.5 && night.projection.height < 1.75, 'moonlight view must preserve full-tree framing');
	assert(night.moonIntensity > 0 && night.sunIntensity === 0 && night.hemisphereIntensity > 0,
		'night QA must use moon + restrained ambient light with the sun disabled');
	assert(metrics.materials.every((material) => material.opacity > 0), 'asset materials must remain visible');
	assert(Object.values(metrics.shadows).every(Boolean), 'QA scene must exercise cast/receive shadow behavior');
	assert(metrics.renderInfo.triangles > 0, 'QA scene must render real triangles');
	assert.deepEqual(browserErrors, [], `browser visual QA emitted errors: ${browserErrors.join(' | ')}`);
	if (ASSET_PATH === PREFERRED_PINE) {
		const treatments = new Set(metrics.materials.map((material) => material.treatment));
		assert(treatments.has('snow-foliage-shader'), 'preferred pine must compile the winter snow foliage shader');
		assert(treatments.has('winter-trunk-source-map'), 'preferred pine must preserve a separately textured non-metallic trunk');
		assert(metrics.materials.every((material) => material.metalness === 0), 'winterized pine must not render metallic bark/needles');
		assert(metrics.foliageSnowMix.minimum >= 0.25 && metrics.foliageSnowMix.minimum <= 0.65,
			`winter foliage minimum snow mix must preserve visible source needles, got ${metrics.foliageSnowMix.minimum}`);
		assert(metrics.foliageSnowMix.maximum >= 0.65 && metrics.foliageSnowMix.maximum <= 0.90,
			`winter foliage highlight snow mix must remain visibly snow-laden, got ${metrics.foliageSnowMix.maximum}`);
	}

	console.log('[checkWinterTreeVisualQa] PASS', JSON.stringify({
		asset: ASSET_PATH,
		sizeMeters: report.bounds.size,
		ratio: report.ratio,
		materials: report.materials.map((material) => material.treatment),
		foliageSnowMix: report.foliageSnowMix,
		nightLighting: { moon: report.night.moonIntensity, ambient: report.night.hemisphereIntensity },
		triangles: report.renderInfo.triangles,
	}));
} finally {
	await browser.close();
	await server.stop();
}
