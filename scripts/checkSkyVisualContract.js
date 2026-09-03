#!/usr/bin/env node
/**
 * Live-browser sky regression contract.
 * Pins camera-follow topology, final V4/V5 runtime shader/profile wiring, day/night updates and
 * teardown. Assertions inspect the fragment source that WebGL actually receives, not superseded
 * pre-V4 shader text.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkSkyVisualContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		const browserErrors = [];
		page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
		page.on('console', (message) => {
			if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
		});
		// This contract owns the sky module, not the full shipped world boot. Keep game3d.html's real
		// import map/origin while preventing unrelated LFS/world startup from delaying module proof.
		await page.route('**/src/3d/game3d.js', async (route) => {
			await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'export function initGame3D() {}\n' });
		});
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const {
				createAuroraSky,
				updateAuroraSky,
				disposeAuroraSky,
				sampleSkyAtmosphereProfile,
				SKY_ATMOSPHERE_PROFILE_POLICY,
			} = await import('/src/3d/sky.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const colorHex = (color) => color?.isColor === true ? color.getHex() : null;
			const first = createAuroraSky();
			const twin = createAuroraSky();

			fail(first?.isMesh === true && twin?.isMesh === true, 'sky output is not THREE.Mesh');
			fail(first.geometry?.type === 'SphereGeometry', `sky geometry type ${first.geometry?.type} != SphereGeometry`);
			fail(first.geometry.parameters?.radius === 1900, `sky radius ${first.geometry.parameters?.radius} != 1900`);
			fail(first.geometry.parameters?.widthSegments === 32 && first.geometry.parameters?.heightSegments === 16, 'sky segment count drifted');
			fail(first.material?.isShaderMaterial === true, 'sky material is not ShaderMaterial');
			fail(first.material.side === THREE.BackSide, 'sky material must render BackSide');
			fail(first.material.depthWrite === false && first.material.fog === false, 'sky depthWrite/fog signature drifted');
			fail(first.frustumCulled === false && first.renderOrder === -1, 'sky camera-surround render flags drifted');
			fail(close(first.position.x, 0) && close(first.position.y, 0) && close(first.position.z, 0), 'initial sky position drifted');
			fail(SKY_ATMOSPHERE_PROFILE_POLICY.finalShaderConsumesProfile === true, 'profile policy lost final-shader ownership');

			const uniforms = first.material.uniforms;
			for (const name of [
				'uTime', 'uHorizonColor', 'uZenithColor', 'uAuroraColorA', 'uAuroraColorB', 'uNightFactor',
				'uHorizonHazeStrength', 'uHorizonVariationStrength', 'uGroundBounceStrength',
				'uUpperAirStrength', 'uUpperAirVariationStrength', 'uBandingDitherStrength',
			]) fail(Boolean(uniforms?.[name]), `sky uniform missing: ${name}`);
			fail(close(uniforms.uTime.value, 0) && close(uniforms.uNightFactor.value, 1), 'sky initial time/night uniforms drifted');
			fail(colorHex(uniforms.uHorizonColor.value) === 0xd98a52, 'sky default horizon color drifted');
			fail(colorHex(uniforms.uZenithColor.value) === 0x0b1633, 'sky default zenith color drifted');
			fail(colorHex(uniforms.uAuroraColorA.value) === 0x2ce8a0 && colorHex(uniforms.uAuroraColorB.value) === 0x6a3fd6, 'sky aurora palette drifted');

			const vertexShader = first.material.vertexShader;
			const fragmentShader = first.material.fragmentShader;
			fail(vertexShader.includes('vWorldPosition'), 'sky vertex position contract drifted');
			for (const token of [
				'ray4HorizonAirmassVariation', 'ray4UpperAirVariation', 'ray4AtmosphericBase',
				'uHorizonHazeStrength', 'uHorizonVariationStrength', 'uGroundBounceStrength',
				'uUpperAirStrength', 'uUpperAirVariationStrength', 'uBandingDitherStrength',
				'ray4VerticalField', 'ray4ArcEdge', 'patchMask', 'cameraPosition',
			]) fail(fragmentShader.includes(token), `final sky shader token missing: ${token}`);
			fail(fragmentShader.includes('vec3(0.050, 0.092, 0.165)') && fragmentShader.includes('vec3(0.009, 0.020, 0.052)'),
				'V5 deep-night calibration is not present in final shader');
			fail(first.material.userData.auroraCurtainRaysV4 === true, 'V4 final shader marker missing');
			fail(first.material.userData.auroraNightAtmosphereV5 === true, 'V5 atmosphere marker missing');
			fail(first.material.userData.finalAtmosphereProfile === 'camera-relative-horizon-upper-air-v6',
				'final atmosphere profile marker missing');

			const positions = first.geometry.getAttribute('position');
			const normals = first.geometry.getAttribute('normal');
			const uvs = first.geometry.getAttribute('uv');
			const index = first.geometry.index;
			const twinPositions = twin.geometry.getAttribute('position');
			const twinNormals = twin.geometry.getAttribute('normal');
			const twinUvs = twin.geometry.getAttribute('uv');
			fail(positions?.count === 561, `sky position count ${positions?.count} != 561`);
			fail(normals?.count === positions.count && uvs?.count === positions.count, 'sky normal/uv attribute count mismatch');
			fail(index?.count === 2880, `sky index count ${index?.count} != 2880`);
			fail(twinPositions?.count === positions.count && twinNormals?.count === normals.count && twinUvs?.count === uvs.count, 'deterministic twin topology drifted');

			const poleUvPadding = 0.5 / first.geometry.parameters.widthSegments;
			let maxRadiusError = 0;
			let minU = Infinity;
			let maxU = -Infinity;
			let minV = Infinity;
			let maxV = -Infinity;
			for (let i = 0; i < positions.count; i++) {
				const x = positions.getX(i); const y = positions.getY(i); const z = positions.getZ(i);
				const nx = normals.getX(i); const ny = normals.getY(i); const nz = normals.getZ(i);
				const u = uvs.getX(i); const v = uvs.getY(i);
				fail([x, y, z, nx, ny, nz, u, v].every(Number.isFinite), `non-finite sky attribute at ${i}`);
				maxRadiusError = Math.max(maxRadiusError, Math.abs(Math.hypot(x, y, z) - 1900));
				fail(close(Math.hypot(nx, ny, nz), 1, 2e-6), `sky normal length drift at ${i}`);
				fail(u >= -poleUvPadding - 1e-6 && u <= 1 + poleUvPadding + 1e-6, `sky u drift at ${i}: ${u}`);
				fail(v >= -1e-6 && v <= 1 + 1e-6, `sky v drift at ${i}: ${v}`);
				fail(x === twinPositions.getX(i) && y === twinPositions.getY(i) && z === twinPositions.getZ(i), `sky deterministic position drift at ${i}`);
				fail(nx === twinNormals.getX(i) && ny === twinNormals.getY(i) && nz === twinNormals.getZ(i), `sky deterministic normal drift at ${i}`);
				fail(u === twinUvs.getX(i) && v === twinUvs.getY(i), `sky deterministic uv drift at ${i}`);
				minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
			}
			fail(maxRadiusError <= 0.0002, `sky sphere radius error ${maxRadiusError}m is too large`);
			fail(close(maxU, 1 + poleUvPadding, 1e-6) && close(minU, -poleUvPadding, 1e-6), 'sky pole UV seam drifted');
			fail(close(minV, 0, 1e-6) && close(maxV, 1, 1e-6), `sky v range drifted: ${minV}..${maxV}`);
			for (let i = 0; i < index.count; i++) {
				const value = index.getX(i);
				fail(Number.isInteger(value) && value >= 0 && value < positions.count, `invalid sky index ${value} at ${i}`);
				fail(value === twin.geometry.index.getX(i), `sky deterministic index drift at ${i}`);
			}

			const camera = new THREE.Vector3(321.5, 44.25, -812.75);
			const dayNight = {
				horizonColor: new THREE.Color(0x6f92b7),
				zenithColor: new THREE.Color(0x10234a),
				nightFactor: 0.625,
			};
			const expectedProfile = sampleSkyAtmosphereProfile(dayNight.nightFactor);
			updateAuroraSky(first, camera, 23.75, dayNight);
			fail(first.position !== camera && first.position.equals(camera), 'sky camera-follow copy contract drifted');
			fail(close(uniforms.uTime.value, 23.75) && close(uniforms.uNightFactor.value, 0.625), 'sky update time/night uniforms drifted');
			fail(colorHex(uniforms.uHorizonColor.value) === 0x6f92b7 && colorHex(uniforms.uZenithColor.value) === 0x10234a, 'sky day/night gradient update drifted');
			for (const [uniformName, profileName] of [
				['uHorizonHazeStrength', 'horizonHazeStrength'],
				['uHorizonVariationStrength', 'horizonVariationStrength'],
				['uGroundBounceStrength', 'groundBounceStrength'],
				['uUpperAirStrength', 'upperAirStrength'],
				['uUpperAirVariationStrength', 'upperAirVariationStrength'],
				['uBandingDitherStrength', 'bandingDitherStrength'],
			]) fail(close(uniforms[uniformName].value, expectedProfile[profileName]), `${uniformName} does not match sampled atmosphere profile`);

			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			first.geometry.addEventListener('dispose', () => geometryDisposeCount++);
			first.material.addEventListener('dispose', () => materialDisposeCount++);
			disposeAuroraSky(first);
			disposeAuroraSky(twin);
			fail(geometryDisposeCount === 1 && materialDisposeCount === 1, `sky dispose counts ${geometryDisposeCount}/${materialDisposeCount} != 1/1`);
			return {
				vertexCount: positions.count,
				indexCount: index.count,
				poleUvPadding,
				minU,
				maxU,
				maxRadiusError,
				profile: expectedProfile,
				geometryDisposeCount,
				materialDisposeCount,
			};
		});
		assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
		assert(result.vertexCount === 561 && result.indexCount === 2880, 'sky topology mismatch escaped browser contract');
		console.log(`[checkSkyVisualContract] PASS: final V4/V5 shader consumes camera-relative horizon/upper-air profile; ${result.vertexCount} vertices, ${result.indexCount} indices, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkSkyVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
