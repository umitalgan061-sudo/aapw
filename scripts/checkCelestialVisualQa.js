#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
	console.error('[checkCelestialVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
	process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/celestial-visual-qa';
const VIEWPORT = Object.freeze({ width: 960, height: 720 });
const PHASES = Object.freeze(['sunrise', 'noon', 'sunset', 'night']);

function round(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function roundedVector(values) {
	return values.map((value) => round(value, 3));
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
	await page.goto(`${server.baseUrl}/celestial-visual-qa.html`, { waitUntil: 'networkidle' });
	await page.waitForFunction(
		() => Boolean(window.__celestialQaModules || window.__celestialQaBootstrapError),
		null,
		{ timeout: 10000 },
	);
	const bootstrapError = await page.evaluate(() => window.__celestialQaBootstrapError ?? null);
	if (bootstrapError) throw new Error(`celestial browser module bootstrap failed: ${bootstrapError}`);

	const bootstrap = await page.evaluate(async ({ viewport }) => {
		const {
			THREE,
			CELESTIAL_ASSET_POLICY,
			createDayNightLighting,
			updateDayNightLighting,
		} = window.__celestialQaModules ?? {};
		if (!THREE || !CELESTIAL_ASSET_POLICY || !createDayNightLighting || !updateDayNightLighting) {
			throw new Error('celestial QA modules did not initialize through the document import map');
		}

		const assetResponse = await fetch(`./${CELESTIAL_ASSET_POLICY.moonAssetUrl}`, { cache: 'no-store' });
		const assetBytes = new Uint8Array(await assetResponse.arrayBuffer());
		const prefix = new TextDecoder('latin1').decode(assetBytes.slice(0, 96));
		const assetKind = prefix.startsWith('Kaydara FBX Binary  \u0000\u001a\u0000')
			? 'fbx-binary'
			: /^\s*;\s*FBX\b/i.test(prefix) ? 'fbx-ascii'
				: prefix.startsWith('version https://git-lfs.github.com/spec/v1') ? 'lfs-pointer' : 'unknown';

		const root = document.getElementById('qa-root');
		const panel = document.getElementById('qa-panel');
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
		renderer.setPixelRatio(1);
		renderer.setSize(viewport.width, viewport.height, false);
		renderer.shadowMap.enabled = true;
		if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
		if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.1;
		root.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(20, viewport.width / viewport.height, 0.1, 1800);
		const skyUniforms = {
			horizonColor: { value: new THREE.Color(0x263752) },
			zenithColor: { value: new THREE.Color(0x071127) },
		};
		const sky = new THREE.Mesh(
			new THREE.SphereGeometry(1280, 32, 20),
			new THREE.ShaderMaterial({
				side: THREE.BackSide,
				depthWrite: false,
				fog: false,
				uniforms: skyUniforms,
				vertexShader: `varying float vSkyY; void main(){ vSkyY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
				fragmentShader: `uniform vec3 horizonColor; uniform vec3 zenithColor; varying float vSkyY; void main(){ float t = smoothstep(-0.08, 0.88, max(vSkyY, 0.0)); gl_FragColor = vec4(mix(horizonColor, zenithColor, t), 1.0); }`,
			}),
		);
		sky.renderOrder = -100;
		scene.add(sky);

		const ground = new THREE.Mesh(
			new THREE.CircleGeometry(420, 96),
			new THREE.MeshStandardMaterial({ color: 0x39434a, roughness: 0.96, metalness: 0 }),
		);
		ground.rotation.x = -Math.PI / 2;
		ground.position.y = -2;
		ground.receiveShadow = true;
		scene.add(ground);

		for (const [x, z, scale] of [[180, -45, 1.0], [235, 32, 1.25], [-190, -30, 0.9], [-250, 45, 1.35]]) {
			const ridge = new THREE.Mesh(
				new THREE.ConeGeometry(38 * scale, 90 * scale, 5),
				new THREE.MeshStandardMaterial({ color: 0x29323a, roughness: 1 }),
			);
			ridge.position.set(x, 35 * scale, z);
			ridge.castShadow = true;
			scene.add(ridge);
		}

		const lights = createDayNightLighting(scene);
		const moonAssetStatus = await Promise.race([
			lights.moonAssetReady,
			new Promise((resolve) => setTimeout(() => resolve({ status: 'qa-timeout' }), 15000)),
		]);

		lights.moonVisual.updateMatrixWorld(true);
		const moonBounds = new THREE.Box3().setFromObject(lights.moonVisual);
		const moonSize = moonBounds.getSize(new THREE.Vector3());
		const moonCenter = moonBounds.getCenter(new THREE.Vector3());
		let moonMeshCount = 0;
		let moonMaterialCount = 0;
		let moonTexturedMaterials = 0;
		lights.moonVisual.traverse((node) => {
			if (!node.isMesh) return;
			moonMeshCount += 1;
			const materials = Array.isArray(node.material) ? node.material : [node.material].filter(Boolean);
			moonMaterialCount += materials.length;
			moonTexturedMaterials += materials.filter((material) => Boolean(material.map)).length;
		});

		const configs = Object.freeze({
			sunrise: { ratio: 0.25, subject: 'sun', heading: 'EAST +X · sunrise horizon' },
			noon: { ratio: 0.50, subject: 'sun', heading: 'UP +Y · solar noon' },
			sunset: { ratio: 0.75, subject: 'sun', heading: 'WEST -X · sunset horizon' },
			night: { ratio: 0.00, subject: 'moon', heading: 'UP +Y · hydrated Moon at night' },
		});

		function renderPhase(name) {
			const config = configs[name];
			const state = updateDayNightLighting(lights, 0, 1, config.ratio);
			skyUniforms.horizonColor.value.copy(state.horizonColor);
			skyUniforms.zenithColor.value.copy(state.zenithColor);
			ground.material.color.copy(state.horizonColor).multiplyScalar(name === 'night' ? 0.42 : 0.62);

			const subject = config.subject === 'moon' ? lights.moonVisual : lights.sunVisual;
			const target = subject.position.clone();
			camera.position.set(0, 18, 0);
			camera.up.set(0, 1, 0);
			if (Math.abs(target.y) > Math.hypot(target.x, target.z) * 1.5) camera.up.set(0, 0, -1);
			camera.lookAt(target);
			camera.updateProjectionMatrix();

			panel.textContent = [
				`${name.toUpperCase()} · ${config.heading}`,
				`time ratio: ${state.timeRatio.toFixed(2)} · night factor: ${state.nightFactor.toFixed(2)}`,
				`sun xyz: ${lights.sun.position.toArray().map((v) => v.toFixed(1)).join(', ')}`,
				`moon xyz: ${lights.moon.position.toArray().map((v) => v.toFixed(1)).join(', ')}`,
				`sun I: ${lights.sun.intensity.toFixed(2)} · moon I: ${lights.moon.intensity.toFixed(2)}`,
				`Moon FBX: ${moonAssetStatus.status} · meshes: ${moonMeshCount}`,
			].join('\n');
			renderer.render(scene, camera);
			return {
				name,
				ratio: state.timeRatio,
				nightFactor: state.nightFactor,
				sunPosition: lights.sun.position.toArray(),
				moonPosition: lights.moon.position.toArray(),
				sunIntensity: lights.sun.intensity,
				moonIntensity: lights.moon.intensity,
				sunVisible: lights.sunVisual.visible,
				moonVisible: lights.moonVisual.visible,
				horizonColor: `#${state.horizonColor.getHexString()}`,
				zenithColor: `#${state.zenithColor.getHexString()}`,
				renderCalls: renderer.info.render.calls,
				triangles: renderer.info.render.triangles,
			};
		}

		window.__renderCelestialPhase = renderPhase;
		return {
			policy: CELESTIAL_ASSET_POLICY,
			assetProbe: { ok: assetResponse.ok, status: assetResponse.status, bytes: assetBytes.byteLength, kind: assetKind },
			moonAssetStatus,
			moonFallbackPresent: Boolean(lights.moonVisual.getObjectByName('Moon Fallback Disc')),
			moonMeshCount,
			moonMaterialCount,
			moonTexturedMaterials,
			moonBounds: { size: moonSize.toArray(), center: moonCenter.toArray() },
		};
	}, { viewport: VIEWPORT });

	const phaseReports = {};
	for (const phase of PHASES) {
		phaseReports[phase] = await page.evaluate((name) => window.__renderCelestialPhase(name), phase);
		await page.screenshot({ path: `${ARTIFACT_DIR}/celestial-${phase}.png`, fullPage: true });
	}

	const report = {
		...bootstrap,
		moonBounds: {
			size: roundedVector(bootstrap.moonBounds.size),
			center: roundedVector(bootstrap.moonBounds.center),
		},
		phases: Object.fromEntries(Object.entries(phaseReports).map(([name, phase]) => [name, {
			...phase,
			ratio: round(phase.ratio),
			nightFactor: round(phase.nightFactor),
			sunPosition: roundedVector(phase.sunPosition),
			moonPosition: roundedVector(phase.moonPosition),
			sunIntensity: round(phase.sunIntensity),
			moonIntensity: round(phase.moonIntensity),
		}])),
		browserErrors,
	};
	await writeFile(`${ARTIFACT_DIR}/celestial-visual-report.json`, `${JSON.stringify(report, null, 2)}\n`);

	assert.equal(bootstrap.assetProbe.ok, true, 'hydrated Moon FBX must be served by the QA checkout');
	assert(['fbx-binary', 'fbx-ascii'].includes(bootstrap.assetProbe.kind),
		`Moon asset must be materialized FBX, got ${bootstrap.assetProbe.kind}`);
	assert(bootstrap.assetProbe.bytes >= 1024, `hydrated Moon FBX is unexpectedly tiny: ${bootstrap.assetProbe.bytes}`);
	assert.equal(bootstrap.moonAssetStatus.status, 'active',
		`runtime must activate the real Moon FBX, got ${bootstrap.moonAssetStatus.status}`);
	assert.equal(bootstrap.moonFallbackPresent, false, 'procedural Moon fallback must hide after real FBX activation');
	assert(bootstrap.moonMeshCount > 0 && bootstrap.moonMaterialCount > 0, 'hydrated Moon must contain renderable mesh/material content');

	const largestMoonAxis = Math.max(...bootstrap.moonBounds.size);
	assert(Math.abs(largestMoonAxis - bootstrap.policy.moonTargetDiameterMeters) < 0.15,
		`Moon must normalize to ${bootstrap.policy.moonTargetDiameterMeters}m, got ${largestMoonAxis}`);
	assert(bootstrap.moonBounds.center.every((value) => Math.abs(value) < 0.08),
		`Moon FBX must be centered on its orbit anchor, got ${bootstrap.moonBounds.center.join(', ')}`);

	const sunrise = phaseReports.sunrise;
	assert(sunrise.sunPosition[0] > 850 && Math.abs(sunrise.sunPosition[1]) < 1,
		`sunrise must place Sun on east +X horizon, got ${sunrise.sunPosition}`);
	const noon = phaseReports.noon;
	assert(noon.sunPosition[1] > 850 && noon.sunIntensity > 1 && noon.nightFactor < 0.01,
		`noon must place a bright Sun overhead, got ${JSON.stringify(noon)}`);
	const sunset = phaseReports.sunset;
	assert(sunset.sunPosition[0] < -850 && Math.abs(sunset.sunPosition[1]) < 1,
		`sunset must place Sun on west -X horizon, got ${sunset.sunPosition}`);
	const night = phaseReports.night;
	assert(night.sunPosition[1] < -850 && night.moonPosition[1] > 850,
		`night must put Sun below and Moon above horizon, got sun=${night.sunPosition} moon=${night.moonPosition}`);
	assert.equal(night.sunVisible, false, 'Sun visual must be hidden below the night horizon');
	assert.equal(night.moonVisible, true, 'Moon visual must be visible at night');
	assert(night.moonIntensity >= 0.5 && night.nightFactor > 0.99, 'night must use the cool Moon directional key');

	for (const [name, phase] of Object.entries(phaseReports)) {
		for (let axis = 0; axis < 3; axis += 1) {
			assert(Math.abs(phase.sunPosition[axis] + phase.moonPosition[axis]) < 0.001,
				`${name} Moon must remain 180 degrees opposite the Sun on axis ${axis}`);
		}
		assert(phase.triangles > 0 && phase.renderCalls > 0, `${name} must render real WebGL geometry`);
	}
	assert.deepEqual(browserErrors, [], `celestial browser QA emitted errors: ${browserErrors.join(' | ')}`);

	console.log('[checkCelestialVisualQa] PASS', JSON.stringify({
		asset: bootstrap.policy.moonRepositoryPath,
		assetBytes: bootstrap.assetProbe.bytes,
		moonMeshes: bootstrap.moonMeshCount,
		moonSize: report.moonBounds.size,
		moonCenter: report.moonBounds.center,
		sunriseSun: report.phases.sunrise.sunPosition,
		noonSun: report.phases.noon.sunPosition,
		sunsetSun: report.phases.sunset.sunPosition,
		nightMoon: report.phases.night.moonPosition,
	}));
} finally {
	await browser.close();
	await server.stop();
}