#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startStaticServer } from './devServerHelper.js';

const ARTIFACT_DIR = 'artifacts/winter-tree-visual-qa';
const VIEWPORT = Object.freeze({ width: 960, height: 720 });
const PRIMARY_ASSET = 'assets/models/vegetation/winter_tree.glb';

function round(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await startStaticServer({ port: 5187, logPrefix: '[winter-tree-visual-qa]' });
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
	if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});

try {
	await page.goto(`${server.baseUrl}/winter-tree-visual-qa.html`, { waitUntil: 'networkidle' });
	const metrics = await page.evaluate(async ({ primaryAsset, viewport }) => {
		const THREE = await import('./src/3d/vendor/three.module.js');
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
		sun.shadow.camera.left = -12;
		sun.shadow.camera.right = 12;
		sun.shadow.camera.top = 12;
		sun.shadow.camera.bottom = -12;
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 45;
		scene.add(sun);

		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry(32, 32),
			new THREE.MeshStandardMaterial({ color: 0xd7d9d5, roughness: 0.94, metalness: 0 }),
		);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);

		const group = new THREE.Group();
		group.name = 'winter-tree-visual-qa-group';
		const trunk = new THREE.InstancedMesh(
			new THREE.CylinderGeometry(0.2, 0.35, 3.2, 6),
			new THREE.MeshStandardMaterial({ color: 0x50433a }),
			1,
		);
		const foliage = new THREE.InstancedMesh(
			new THREE.ConeGeometry(2.2, 5.9, 7),
			new THREE.MeshStandardMaterial({ color: 0xd9e4e5 }),
			1,
		);
		trunk.name = WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName;
		foliage.name = WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName;
		trunk.castShadow = trunk.receiveShadow = true;
		foliage.castShadow = foliage.receiveShadow = true;
		const identity = new THREE.Matrix4();
		trunk.setMatrixAt(0, identity);
		foliage.setMatrixAt(0, identity);
		trunk.instanceMatrix.needsUpdate = true;
		foliage.instanceMatrix.needsUpdate = true;
		group.add(trunk, foliage);
		group.userData.northClimateVegetation = { winterTreeCount: 1, liveRepresentation: 'instanced-procedural-snow-pine' };
		scene.add(group);

		const status = await upgradeWinterVegetationAssets(group, { candidates: [primaryAsset] });
		const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
		const replacements = group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-'));

		const bounds = new THREE.Box3();
		const corner = new THREE.Vector3();
		const instanceMatrix = new THREE.Matrix4();
		const worldMatrix = new THREE.Matrix4();
		for (const mesh of replacements) {
			mesh.geometry.computeBoundingBox();
			mesh.getMatrixAt(0, instanceMatrix);
			worldMatrix.copy(mesh.matrixWorld).multiply(instanceMatrix);
			const box = mesh.geometry.boundingBox;
			for (const x of [box.min.x, box.max.x]) {
				for (const y of [box.min.y, box.max.y]) {
					for (const z of [box.min.z, box.max.z]) {
						corner.set(x, y, z).applyMatrix4(worldMatrix);
						bounds.expandByPoint(corner);
					}
				}
			}
		}
		const size = bounds.getSize(new THREE.Vector3());
		const center = bounds.getCenter(new THREE.Vector3());

		function projection(cameraRef) {
			cameraRef.updateMatrixWorld(true);
			cameraRef.updateProjectionMatrix();
			const projected = [];
			for (const x of [bounds.min.x, bounds.max.x]) {
				for (const y of [bounds.min.y, bounds.max.y]) {
					for (const z of [bounds.min.z, bounds.max.z]) projected.push(new THREE.Vector3(x, y, z).project(cameraRef));
				}
			}
			const xs = projected.map((point) => point.x);
			const ys = projected.map((point) => point.y);
			return {
				minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
				width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
			};
		}

		function renderView(position, lookAt, labelText) {
			camera.position.fromArray(position);
			camera.lookAt(...lookAt);
			label.textContent = labelText;
			renderer.render(scene, camera);
			return projection(camera);
		}

		const frontProjection = renderView([10.5, 7.4, 14.5], [0, 4.15, 0], 'winter_tree.glb · three-quarter · 8.6 m target');
		window.__renderWinterTreeSide = () => renderView([-14.5, 6.7, 0], [0, 4.0, 0], 'winter_tree.glb · side · shadow/material QA');
		window.__winterTreeVisualQa = { renderer, scene, camera };

		const materials = replacements.map((mesh) => ({
			type: mesh.material.type,
			color: mesh.material.color?.getHexString?.() ?? null,
			roughness: Number.isFinite(mesh.material.roughness) ? mesh.material.roughness : null,
			metalness: Number.isFinite(mesh.material.metalness) ? mesh.material.metalness : null,
			opacity: mesh.material.opacity,
			transparent: mesh.material.transparent,
			map: Boolean(mesh.material.map),
		}));
		return {
			policyId: WINTER_VEGETATION_ASSET_POLICY.id,
			status,
			replacementMeshes: replacements.length,
			proceduralHidden: trunkMesh?.visible === false && foliageMesh?.visible === false,
			bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray(), center: center.toArray() },
			ratio: Math.max(size.x, size.z) / size.y,
			frontProjection,
			materials,
			shadows: {
				rendererEnabled: renderer.shadowMap.enabled,
				lightCastShadow: sun.castShadow,
				groundReceiveShadow: ground.receiveShadow,
				replacementsCastShadow: replacements.every((mesh) => mesh.castShadow),
				replacementsReceiveShadow: replacements.every((mesh) => mesh.receiveShadow),
			},
			renderInfo: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
		};
	}, { primaryAsset: PRIMARY_ASSET, viewport: VIEWPORT });

	assert.equal(metrics.status.status, 'active', 'hydrated primary winter tree must activate in the browser');
	assert.equal(metrics.status.assetUrl, PRIMARY_ASSET);
	assert.equal(metrics.replacementMeshes, 1, 'primary winter GLB is expected to remain a single rendered mesh');
	assert.equal(metrics.proceduralHidden, true, 'procedural snow-pine must hide only after primary GLB activation');
	assert(Math.abs(metrics.bounds.size[1] - 8.6) < 0.03, `normalized tree height must stay at 8.6 m, got ${metrics.bounds.size[1]}`);
	assert(Math.abs(metrics.bounds.min[1]) < 0.03, `tree base must sit on ground plane, got Y=${metrics.bounds.min[1]}`);
	assert(metrics.ratio <= 1.05, `single-tree width ratio exceeds runtime policy: ${metrics.ratio}`);
	assert(metrics.frontProjection.height > 0.5 && metrics.frontProjection.height < 1.75,
		`tree should be legible without camera clipping; projected height=${metrics.frontProjection.height}`);
	assert(metrics.frontProjection.width > 0.2 && metrics.frontProjection.width < 1.4,
		`tree crown should occupy a useful frame width; projected width=${metrics.frontProjection.width}`);
	assert(metrics.materials.every((material) => material.opacity > 0 && material.transparent === false),
		'winter tree material must remain opaque and visible');
	assert(Object.values(metrics.shadows).every(Boolean), 'visual QA scene must exercise cast/receive shadow behavior');
	assert(metrics.renderInfo.triangles > 0, 'winter tree QA must render real triangles');
	assert.deepEqual(browserErrors, [], `browser visual QA emitted errors: ${browserErrors.join(' | ')}`);

	await page.screenshot({ path: `${ARTIFACT_DIR}/winter-tree-three-quarter.png`, fullPage: true });
	const sideProjection = await page.evaluate(() => window.__renderWinterTreeSide());
	assert(sideProjection.height > 0.5 && sideProjection.height < 1.8, 'side view must keep the full tree legible');
	await page.screenshot({ path: `${ARTIFACT_DIR}/winter-tree-side.png`, fullPage: true });

	const report = {
		...metrics,
		ratio: round(metrics.ratio),
		bounds: {
			min: metrics.bounds.min.map((value) => round(value)),
			max: metrics.bounds.max.map((value) => round(value)),
			size: metrics.bounds.size.map((value) => round(value)),
			center: metrics.bounds.center.map((value) => round(value)),
		},
		frontProjection: Object.fromEntries(Object.entries(metrics.frontProjection).map(([key, value]) => [key, round(value)])),
		sideProjection: Object.fromEntries(Object.entries(sideProjection).map(([key, value]) => [key, round(value)])),
	};
	await writeFile(`${ARTIFACT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log('[checkWinterTreeVisualQa] PASS', JSON.stringify({
		asset: PRIMARY_ASSET,
		sizeMeters: report.bounds.size,
		ratio: report.ratio,
		material: report.materials[0],
		triangles: report.renderInfo.triangles,
	}));
} finally {
	await browser.close();
	await server.stop();
}
