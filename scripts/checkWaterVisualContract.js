#!/usr/bin/env node
/**
 * checkWaterVisualContract.js — live-browser rendered water regression contract.
 * Validates the existing flat water plane topology, shader/material/uniform signature,
 * camera-follow update semantics, fog participation and teardown without runtime changes.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkWaterVisualContract] SKIP: Playwright is not available in this environment.');
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
			const { createWater, updateWater, disposeWater } = await import('/src/3d/world/water.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const vectorClose = (actual, expected, tolerance = 1e-6) =>
				close(actual.x, expected.x, tolerance) && close(actual.y, expected.y, tolerance) && close(actual.z, expected.z, tolerance);
			const waterLevel = 6;
			const first = createWater(waterLevel);
			const twin = createWater(waterLevel);

			fail(first?.isMesh === true && twin?.isMesh === true, 'water output is not THREE.Mesh');
			fail(first.geometry?.type === 'PlaneGeometry', `water geometry type ${first.geometry?.type} != PlaneGeometry`);
			fail(first.geometry.parameters?.width === 4000 && first.geometry.parameters?.height === 4000, 'water plane extent drifted');
			fail(first.geometry.parameters?.widthSegments === 128 && first.geometry.parameters?.heightSegments === 128, 'water segment count drifted');
			fail(first.material?.isShaderMaterial === true, 'water material is not ShaderMaterial');
			fail(first.material.transparent === true && first.material.depthWrite === true && first.material.fog === true, 'water material transparent/depthWrite/fog signature drifted');
			fail(first.frustumCulled === false, 'water frustumCulled must remain false for camera-follow plane');
			fail(close(first.position.x, 0) && close(first.position.y, waterLevel) && close(first.position.z, 0), 'initial water position drifted');

			const uniforms = first.material.uniforms;
			fail(Boolean(uniforms?.uTime && uniforms?.uShallowColor && uniforms?.uDeepColor && uniforms?.uSunDirection && uniforms?.uCameraPosition), 'water custom uniform set drifted');
			fail(Boolean(uniforms?.uDepthMap && uniforms?.uDepthFieldExtentMeters && uniforms?.uSwellStrength), 'water depth/coverage uniform set drifted');
			fail(Boolean(uniforms?.fogColor && uniforms?.fogNear && uniforms?.fogFar && uniforms?.fogDensity), 'water fog uniforms are missing');
			fail(close(uniforms.uTime.value, 0), 'water uTime must start at 0');
			// Retuned 2026-08-19 to the owner's aerial reference: blue ocean rather than green-teal, with
			// a deeper far tone so bathymetry reads from altitude. The original point of pinning these —
			// that shallow water must never go back to neon cyan — is now asserted directly below on
			// saturation, which is the property that actually mattered, rather than on one exact hex.
			// Re-pinned 2026-08-21 (run 388) when the shader stopped mixing these two across a smoothstep
			// and started running per-channel Beer-Lambert extinction between them. The endpoints changed
			// role: `uShallowColor` is now the tint of water thin enough to see straight through and
			// `uDeepColor` the colour nothing returns from, so the shallow end went brighter and more
			// turquoise and the deep end considerably darker. The saturation assertion below is unchanged
			// and still owns the property that actually matters.
			fail(uniforms.uShallowColor.value?.isColor === true && uniforms.uShallowColor.value.getHex() === 0x7fc9c4, 'water shallow color drifted');
			fail(uniforms.uDeepColor.value?.isColor === true && uniforms.uDeepColor.value.getHex() === 0x05182e, 'water deep color drifted');
			// The extinction contract itself: red must die fastest and blue slowest, or water stops
			// behaving like water and the shore-to-deep progression collapses back to a two-tone ramp.
			const extinction = uniforms.uExtinctionPerMeter ? uniforms.uExtinctionPerMeter.value : null;
			fail(Boolean(extinction) && extinction.x > extinction.y && extinction.y > extinction.z, 'water extinction must absorb red fastest and blue slowest');
			fail(Boolean(uniforms.uFullOpticalDepthMeters) && uniforms.uFullOpticalDepthMeters.value === 60, 'water optical depth range drifted');
			fail(Boolean(uniforms.uMinSurfaceAlpha) && uniforms.uMinSurfaceAlpha.value < 0.15, 'water shallow alpha clamp drifted, shallows must stay see-through');
			fail(Boolean(uniforms.uMaxSurfaceAlpha) && uniforms.uMaxSurfaceAlpha.value > 0.85, 'water deep alpha clamp drifted, deeps must stay opaque');
			// Judged in sRGB, not in THREE.Color's linear working space: "neon" is a perceptual claim,
			// and the same colour reads far more saturated in linear (0x53899a is 0.46 in sRGB but 0.73
			// in linear), which would reject ordinary sea blues.
			const shallow = uniforms.uShallowColor.value.clone().convertLinearToSRGB();
			const shallowMax = Math.max(shallow.r, shallow.g, shallow.b);
			const shallowSaturation = shallowMax <= 0 ? 0 : (shallowMax - Math.min(shallow.r, shallow.g, shallow.b)) / shallowMax;
			fail(shallowSaturation < 0.6, `shallow water must stay desaturated from neon cyan (sRGB saturation ${shallowSaturation.toFixed(3)})`);
			const expectedSun = new THREE.Vector3(300, 400, 200).normalize();
			fail(vectorClose(uniforms.uSunDirection.value, expectedSun), 'water sun direction drifted');
			fail(vectorClose(uniforms.uCameraPosition.value, new THREE.Vector3(0, 0, 0)), 'water camera uniform must start at origin');
			fail(first.userData.waterCoverage?.fullWorld === true && first.userData.waterCoverage?.fullWorldExtentMeters === 17000, 'full-world water coverage metadata drifted');
			fail(first.userData.farWater?.isMesh === true && first.userData.farWater.geometry?.parameters?.width === 17000 && first.userData.farWater.geometry?.parameters?.height === 17000, 'full-world far-water geometry drifted');

			const vertexShader = first.material.vertexShader;
			const fragmentShader = first.material.fragmentShader;
			// ADR-0270 replaced ADR-0048's "no vertex animation at all" rule with a depth-tapered
			// displacement. The invariant worth guarding is no longer the *absence* of wave maths but
			// the presence of the taper that makes it safe over shallow lakes, plus the fresh-mesh
			// default of zero swell (nothing is displaced until real bathymetry is attached). The
			// numeric side of that contract — total amplitude vs. full-wave depth — is asserted by the
			// smoke suite's `checkWaterDepthTaperedSwell`, not duplicated here.
			fail(vertexShader.includes('uSwellStrength') && vertexShader.includes('sampleDepthFactor'), 'water vertex depth-taper contract drifted');
			fail(/worldPos\.y\s*\+=\s*swellHeight\s*\*\s*amplitudeScale/.test(vertexShader), 'water vertex displacement is no longer depth-tapered');
			fail(uniforms.uSwellStrength.value === 0, 'fresh water mesh must start with swell disabled until a depth field is attached');
			fail(vertexShader.includes('#include <fog_pars_vertex>') && vertexShader.includes('#include <fog_vertex>'), 'water vertex fog chunks drifted');
			fail(fragmentShader.includes('uniform float uTime') && fragmentShader.includes('rippleSlope'), 'water fragment ripple contract drifted');
			fail(fragmentShader.includes('sampleWaterField') && fragmentShader.includes('waterCoverage') && fragmentShader.includes('discard'), 'water canonical coverage masking drifted');
			fail(fragmentShader.includes('#include <fog_pars_fragment>') && fragmentShader.includes('#include <fog_fragment>'), 'water fragment fog chunks drifted');
			fail(fragmentShader.includes('gl_FragColor = vec4(color, max(alpha, foam * 0.78))'), 'water coverage-gated alpha/specular output signature drifted');

			const positions = first.geometry.getAttribute('position');
			const normals = first.geometry.getAttribute('normal');
			const uvs = first.geometry.getAttribute('uv');
			const index = first.geometry.index;
			const twinPositions = twin.geometry.getAttribute('position');
			const twinNormals = twin.geometry.getAttribute('normal');
			const twinUvs = twin.geometry.getAttribute('uv');
			fail(positions?.count === 16641, `water position count ${positions?.count} != 16641`);
			fail(normals?.count === positions.count && uvs?.count === positions.count, 'water normal/uv attribute count mismatch');
			fail(index?.count === 98304, `water index count ${index?.count} != 98304`);
			fail(twinPositions?.count === positions.count && twinNormals?.count === normals.count && twinUvs?.count === uvs.count, 'deterministic twin topology drifted');

			let minX = Infinity;
			let maxX = -Infinity;
			let minZ = Infinity;
			let maxZ = -Infinity;
			for (let i = 0; i < positions.count; i++) {
				const x = positions.getX(i);
				const y = positions.getY(i);
				const z = positions.getZ(i);
				const nx = normals.getX(i);
				const ny = normals.getY(i);
				const nz = normals.getZ(i);
				const u = uvs.getX(i);
				const v = uvs.getY(i);
				fail(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite water position at ${i}`);
				fail(Math.abs(y) <= 1e-6, `water local geometry is not flat at vertex ${i}: y=${y}`);
				fail(close(nx, 0, 2e-6) && close(ny, 1, 2e-6) && close(nz, 0, 2e-6), `water normal drift at ${i}: ${nx},${ny},${nz}`);
				fail(Number.isFinite(u) && Number.isFinite(v) && u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6, `water uv drift at ${i}`);
				fail(close(x, twinPositions.getX(i), 0) && close(y, twinPositions.getY(i), 0) && close(z, twinPositions.getZ(i), 0), `water deterministic position drift at ${i}`);
				fail(close(nx, twinNormals.getX(i), 0) && close(ny, twinNormals.getY(i), 0) && close(nz, twinNormals.getZ(i), 0), `water deterministic normal drift at ${i}`);
				fail(close(u, twinUvs.getX(i), 0) && close(v, twinUvs.getY(i), 0), `water deterministic uv drift at ${i}`);
				minX = Math.min(minX, x); maxX = Math.max(maxX, x);
				minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
			}
			fail(close(minX, -2000) && close(maxX, 2000) && close(minZ, -2000) && close(maxZ, 2000), `water local bounds drifted: x=${minX}..${maxX}, z=${minZ}..${maxZ}`);
			for (let i = 0; i < index.count; i++) {
				const value = index.getX(i);
				fail(Number.isInteger(value) && value >= 0 && value < positions.count, `invalid water index ${value} at ${i}`);
				fail(value === twin.geometry.index.getX(i), `water deterministic index drift at ${i}`);
			}

			const camera = new THREE.Vector3(123.25, 87.5, -678.75);
			const cameraUniform = uniforms.uCameraPosition.value;
			fail(cameraUniform !== camera, 'water camera uniform must own its vector instead of aliasing caller state');
			updateWater(first, camera, 12.5);
			fail(close(first.position.x, camera.x) && close(first.position.z, camera.z) && close(first.position.y, waterLevel), 'water camera-follow position contract drifted');
			fail(close(uniforms.uTime.value, 12.5), 'water uTime update drifted');
			fail(vectorClose(cameraUniform, camera), 'water camera-position uniform update drifted');
			camera.set(999, 999, 999);
			fail(close(first.position.x, 123.25) && close(first.position.z, -678.75) && vectorClose(cameraUniform, new THREE.Vector3(123.25, 87.5, -678.75)), 'water update retained caller vector by reference');

			let geometryDisposeCount = 0;
			let materialDisposeCount = 0;
			first.geometry.addEventListener('dispose', () => geometryDisposeCount++);
			first.material.addEventListener('dispose', () => materialDisposeCount++);
			disposeWater(first);
			fail(geometryDisposeCount === 1 && materialDisposeCount === 1, `water dispose counts ${geometryDisposeCount}/${materialDisposeCount} != 1/1`);
			disposeWater(twin);
			return {
				vertexCount: positions.count,
				indexCount: index.count,
				geometryDisposeCount,
				materialDisposeCount,
				bounds: [minX, maxX, minZ, maxZ],
			};
		});
		assert(result.vertexCount === 16641 && result.indexCount === 98304, 'water topology mismatch escaped browser contract');
		console.log(`[checkWaterVisualContract] PASS: ${result.vertexCount} vertices, ${result.indexCount} indices, flat 4000m camera-follow plane, shader/fog/uniform contract PASS, disposal ${result.geometryDisposeCount}/${result.materialDisposeCount}.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkWaterVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
