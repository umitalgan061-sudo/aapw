#!/usr/bin/env node
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkWindGrassContractRun180] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createWindGrassRun180 } = await import('/src/3d/sceneManager.js');
			const { disposeVegetation } = await import('/src/3d/world/vegetation.js');
			const fail = (value, message) => { if (!value) throw new Error(message); };
			const sampler = () => 20;
			const seats = [{ x: 0, z: 0 }];
			const roadEdges = [{ points: [{ x: -1000, z: 0 }, { x: 1000, z: 0 }] }];
			const options = { sampleHeightMeters: sampler, seaLevelMeters: 6, seed: 1337, seats, roadEdges, isMobileClass: true, centerX: 260, centerZ: 260 };
			const mobile = createWindGrassRun180(options);
			const repeat = createWindGrassRun180(options);
			const desktop = createWindGrassRun180({ ...options, isMobileClass: false });
			fail(mobile.mesh.count > 0 && mobile.mesh.count <= 1200, `mobile count ${mobile.mesh.count}`);
			fail(desktop.mesh.count > mobile.mesh.count && desktop.mesh.count <= 4000, `desktop/mobile counts ${desktop.mesh.count}/${mobile.mesh.count}`);
			fail(mobile.group.children.length === 1 && mobile.mesh.isInstancedMesh, 'grass must be one InstancedMesh');
			fail(mobile.mesh.frustumCulled === false && mobile.mesh.userData.run180FirstFrameSafe === true, 'first-frame recenter safety missing');
			fail(mobile.mesh.geometry.getAttribute('run180Flex')?.count > 0, 'flex attribute missing');
			fail(mobile.mesh.geometry.getAttribute('run180Phase')?.count > 0, 'phase attribute missing');
			const a = Array.from(mobile.mesh.instanceMatrix.array.slice(0, mobile.mesh.count * 16));
			const b = Array.from(repeat.mesh.instanceMatrix.array.slice(0, repeat.mesh.count * 16));
			fail(mobile.mesh.count === repeat.mesh.count && a.every((value, index) => value === b[index]), 'same seed/cell grass is not bit-identical');
			const matrix = new THREE.Matrix4();
			for (let i = 0; i < mobile.mesh.count; i++) {
				mobile.mesh.getMatrixAt(i, matrix);
				const x = matrix.elements[12];
				const z = matrix.elements[14];
				fail(Math.hypot(x, z) >= 100 - 1e-5, `seat exclusion failed ${x},${z}`);
				if (x >= -1000 && x <= 1000) fail(Math.abs(z) >= 10 - 1e-5, `road exclusion failed ${x},${z}`);
			}
			const shader = {
				uniforms: {},
				vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
				fragmentShader: '#include <common>\nvoid main(){vec4 diffuseColor=vec4(1.0);\n#include <color_fragment>\n}',
			};
			mobile.mesh.material.onBeforeCompile(shader);
			for (const token of ['uRun180WindTime', 'run180Flex', 'run180Wave', 'vRun180GrassVariation']) fail(shader.vertexShader.includes(token), `vertex shader missing ${token}`);
			fail(shader.fragmentShader.includes('vRun180GrassVariation'), 'fragment variation missing');
			const oldCell = { ...mobile.group.userData.run180WindGrass.centerCell };
			mobile.mesh.onBeforeRender(null, null, { position: new THREE.Vector3(720, 100, 720) });
			fail(shader.uniforms.uRun180WindTime.value > 0, 'wind time not advanced');
			fail(mobile.group.userData.run180WindGrass.centerCell.x !== oldCell.x || mobile.group.userData.run180WindGrass.centerCell.z !== oldCell.z, 'camera recenter did not stream grass');
			const water = createWindGrassRun180({ ...options, sampleHeightMeters: () => 6, centerX: 0, centerZ: 0 });
			fail(water.mesh.count === 0, `shore/water exclusion expected 0, got ${water.mesh.count}`);
			let geometryDisposed = 0;
			let materialDisposed = 0;
			mobile.mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
			mobile.mesh.material.addEventListener('dispose', () => materialDisposed++);
			const holder = new THREE.Group();
			holder.userData.run180GrassGroup = mobile.group;
			disposeVegetation(holder);
			fail(geometryDisposed === 1 && materialDisposed === 1, `grass teardown ${geometryDisposed}/${materialDisposed}`);
			for (const grass of [repeat, desktop, water]) {
				const cleanup = new THREE.Group();
				cleanup.userData.run180GrassGroup = grass.group;
				disposeVegetation(cleanup);
			}
			return { mobile: mobile.mesh.count, desktop: desktop.mesh.count, trianglesPerPatch: mobile.mesh.geometry.index.count / 3 };
		});
		assert(result.mobile <= 1200, 'mobile cap');
		console.log(`[checkWindGrassContractRun180] PASS: one first-frame-safe InstancedMesh, mobile ${result.mobile}/1200 patches, desktop ${result.desktop}/4000, ${result.trianglesPerPatch} triangles/patch; deterministic road/seat/water exclusion, camera-cell streaming, two-frequency GPU wind + teardown PASS.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkWindGrassContractRun180] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
