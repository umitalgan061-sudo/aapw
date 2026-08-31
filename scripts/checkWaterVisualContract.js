#!/usr/bin/env node
/**
 * Live-browser water contract: topology, depth-clear optical response, near/far/backdrop composition
 * and the live celestial key consumed by the custom shader. The terrain-derived depth field is
 * validated by its own checks; this pins how the rendered water turns that authority into visible water.
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
	const browser = await playwright.chromium.launch({
		headless: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/scripts/geographicMaterialHarness.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const {
				createWater,
				updateWater,
				disposeWater,
				WATER_LAYER_TRANSITION_POLICY,
				WATER_FIELD_EDGE_OPTICAL_POLICY,
				WATER_FULL_WORLD_EXTENT_METERS,
				WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
			} = await import('/src/3d/world/water.js');
			const { GEOGRAPHIC_REFERENCE_PALETTE } = await import('/src/3d/world/geographicReferencePalette.js');
			const { publishCelestialLightState } = await import('/src/3d/celestialLightState.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const vectorClose = (actual, expected, tolerance = 1e-6) =>
				close(actual.x, expected.x, tolerance) && close(actual.y, expected.y, tolerance) && close(actual.z, expected.z, tolerance);

			const waterLevel = 6;
			const water = createWater(waterLevel);
			fail(water?.isMesh === true, 'water output is not THREE.Mesh');
			fail(water.geometry?.type === 'PlaneGeometry', 'near water is not PlaneGeometry');
			fail(water.geometry.parameters?.width === 4000 && water.geometry.parameters?.height === 4000, 'near water extent drifted');
			fail(water.geometry.parameters?.widthSegments === 128, 'default near-water resolution drifted');
			fail(water.material?.isShaderMaterial === true, 'water material is not ShaderMaterial');
			fail(water.material.transparent === true && water.material.depthWrite === true && water.material.fog === true, 'near-water render signature drifted');

			const far = water.userData.farWater;
			fail(far?.isMesh === true && far.geometry.parameters?.width === WATER_FULL_WORLD_EXTENT_METERS,
				'full-world far-water underlay drifted');
			fail(far.geometry.parameters?.height === WATER_FULL_WORLD_EXTENT_METERS,
				'full-world far-water underlay must remain square and authority-sized');
			fail(far.material.depthWrite === false, 'far water must not occlude displaced near-water troughs');
			fail(far.renderOrder === -1, 'far water must render before the near layer');
			fail(far.material.uniforms.uFarLayerMask.value === 1, 'far water no longer masks itself under the near detail footprint');

			const backdrop = water.userData.deepOceanBackdrop;
			fail(backdrop?.isMesh === true, 'deep-ocean backdrop mesh is missing');
			fail(backdrop.geometry?.type === 'PlaneGeometry', 'deep-ocean backdrop is not PlaneGeometry');
			fail(backdrop.geometry.parameters?.width === WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
				'deep-ocean backdrop extent drifted');
			fail(backdrop.geometry.parameters?.widthSegments === 1 && backdrop.geometry.parameters?.heightSegments === 1,
				'deep-ocean backdrop must stay two triangles');
			fail(backdrop.material?.isMeshBasicMaterial === true, 'deep-ocean backdrop must stay an unlit base layer');
			fail(backdrop.material.transparent === false && backdrop.material.depthWrite === true && backdrop.material.fog === true,
				'deep-ocean backdrop must remain opaque, depth-writing and fog-aware');
			fail(backdrop.renderOrder === -2 && backdrop.position.y === -32,
				'deep-ocean backdrop must render below/before both transparent water layers');
			fail(water.userData.waterCoverage?.deepOceanBackdropExtentMeters === WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
				'water coverage metadata lost the deep-ocean backdrop extent');
			fail(water.userData.waterCoverage?.worldAnchoredFarLayers === true,
				'full-world water layers must remain world-anchored while the near detail mesh follows camera');

			const uniforms = water.material.uniforms;
			for (const name of [
				'uTime', 'uShallowColor', 'uDeepColor', 'uSunDirection', 'uSunColor', 'uSunIntensity',
				'uNightFactor', 'uCameraPosition', 'uDepthMap', 'uDepthFieldExtentMeters', 'uSwellStrength', 'uFarLayerMask',
			]) fail(Boolean(uniforms?.[name]), `water uniform ${name} is missing`);
			fail(Boolean(uniforms?.fogColor && uniforms?.fogNear && uniforms?.fogFar && uniforms?.fogDensity), 'water fog uniforms are missing');
			fail(uniforms.uShallowColor.value.getHex() === GEOGRAPHIC_REFERENCE_PALETTE.water.shoreClear,
				'reference clear-shore hue drifted from shared geographic palette');
			fail(uniforms.uDeepColor.value.getHex() === GEOGRAPHIC_REFERENCE_PALETTE.water.deepSea,
				'reference deep-sea hue drifted from shared geographic palette');

			const optical = water.userData.opticalProfile;
			fail(optical?.shallowAlpha === 0.14 && optical?.deepAlpha === 0.90, 'depth-clear optical alpha profile drifted');
			fail(optical.attenuation === 3.2 && optical.celestialSpecular === true, 'optical attenuation/celestial profile drifted');
			fail(optical.shallowAlpha < 0.2 && optical.deepAlpha >= 0.88, 'shallow water must stay bed-readable while deep water stays substantial');
			fail(optical.enclosedLakeBedReadable === true && optical.clearCoastalDepthBand === true, 'explicit lake/coast clarity metadata disappeared');
			fail(optical.nightAbsorptionFromCelestialState === true, 'water night-response metadata disappeared');
			fail(WATER_LAYER_TRANSITION_POLICY.distanceMetric === 'camera-relative-euclidean-organic',
				'near/far water distance metric returned to a rectangular policy');
			fail(WATER_FIELD_EDGE_OPTICAL_POLICY.blendEndMeters >= 1400,
				'field-edge optical blend became too narrow for full-world anti-rectangle continuity');

			const vertexShader = water.material.vertexShader;
			const fragmentShader = water.material.fragmentShader;
			fail(vertexShader.includes('sampleDepthFactor') && vertexShader.includes('uSwellStrength'), 'depth-tapered swell contract drifted');
			fail(vertexShader.includes('float localEdgeDistance = length(position.xz);'), 'near-water swell fade returned to a square edge metric');
			fail(fragmentShader.includes('smoothstep(0.04, 0.82, fragmentDepth)'), 'extended shallow-to-deep color grading disappeared');
			fail(fragmentShader.includes('1.0 - exp(-fragmentDepth * 3.2)'), 'Beer-Lambert-inspired optical depth disappeared');
			fail(fragmentShader.includes('uSunColor') && fragmentShader.includes('uSunIntensity') && fragmentShader.includes('celestialSpecular'), 'live celestial water specular disappeared');
			for (const token of ['enclosedLakeMask', 'clearCoastMask', 'referenceLakeClear', 'bedReadability', 'uNightFactor', 'nightAbsorption']) {
				fail(fragmentShader.includes(token), `water reference-optics shader missing ${token}`);
			}
			fail(!fragmentShader.includes('nearLayerDistance < 1999.5'), 'legacy hard rectangular near/far water cutoff returned');
			fail(!fragmentShader.includes('max(abs(vWorldPosition.x - uCameraPosition.x), abs(vWorldPosition.z - uCameraPosition.z))'),
				'near/far water transition returned to axis-aligned Chebyshev contours');
			fail(fragmentShader.includes('float nearLayerDistance = length(cameraLocalXZ) + transitionFabric *'),
				'near/far water transition lost its organic radial distance field');
			fail(fragmentShader.includes(`float layerBlend = smoothstep(${WATER_LAYER_TRANSITION_POLICY.featherStartMeters.toFixed(1)}, ${WATER_LAYER_TRANSITION_POLICY.featherEndMeters.toFixed(1)}, nearLayerDistance);`),
				'near/far water transition lost its policy-bound distance feather');
			fail(fragmentShader.includes('surfaceAlpha *= 1.0 - layerBlend;'), 'near water no longer fades continuously through the transition band');
			fail(fragmentShader.includes('(surfaceAlpha * layerBlend) / max(1.0 - nearAlpha, 0.001)'),
				'far water no longer uses opacity-conserving complementary feathering');
			fail(fragmentShader.includes('fragmentDepth = mix(fragmentDepth, 1.0, edgeOpticalBlend * marineGate);'),
				'open-ocean field-edge convergence disappeared');
			fail(fragmentShader.includes('if (surfaceAlpha <= 0.001) discard;'), 'fully faded water fragments must not leave transparent seam pixels');
			fail(fragmentShader.includes('#include <fog_pars_fragment>') && fragmentShader.includes('#include <fog_fragment>'), 'water fog chunks drifted');

			publishCelestialLightState({
				sunPosition: new THREE.Vector3(30, 40, 0),
				sunColor: new THREE.Color(0xffb366),
				sunIntensity: 1.25,
				moonPosition: new THREE.Vector3(-30, -40, 0),
				moonColor: new THREE.Color(0xc8dcff),
				moonIntensity: 0,
				nightFactor: 0,
			});
			const camera = new THREE.Vector3(123.25, 87.5, -678.75);
			updateWater(water, camera, 12.5);
			fail(vectorClose(uniforms.uSunDirection.value, new THREE.Vector3(0.6, 0.8, 0)), 'water did not copy live sun direction');
			fail(close(uniforms.uSunIntensity.value, 1.25), 'water did not copy live sun intensity');
			fail(close(uniforms.uNightFactor.value, 0), 'water daylight night-factor drifted');
			fail(uniforms.uSunColor.value.getHex() === 0xffb366, 'water did not copy live sun colour');
			fail(vectorClose(uniforms.uCameraPosition.value, camera), 'water camera uniform drifted');
			fail(close(water.position.x, camera.x) && close(water.position.z, camera.z) && close(water.position.y, waterLevel), 'water camera-follow drifted');
			fail(close(far.position.x, -camera.x) && close(far.position.z, -camera.z),
				'full-world far water must counter-translate the camera-follow parent');
			fail(close(backdrop.position.x, -camera.x) && close(backdrop.position.z, -camera.z),
				'deep-ocean backdrop must counter-translate the camera-follow parent');
			const farWorldPosition = far.getWorldPosition(new THREE.Vector3());
			const backdropWorldPosition = backdrop.getWorldPosition(new THREE.Vector3());
			fail(close(farWorldPosition.x, 0) && close(farWorldPosition.z, 0),
				'full-world far water drifted away from canonical world origin');
			fail(close(backdropWorldPosition.x, 0) && close(backdropWorldPosition.z, 0),
				'deep-ocean backdrop drifted away from canonical world origin');

			publishCelestialLightState({
				sunPosition: new THREE.Vector3(0, -1, 0),
				sunColor: new THREE.Color(0xffe2a1),
				sunIntensity: 0,
				moonPosition: new THREE.Vector3(-3, 4, 0),
				moonColor: new THREE.Color(0xc8dcff),
				moonIntensity: 0.5,
				nightFactor: 1,
			});
			updateWater(water, camera, 20);
			fail(vectorClose(uniforms.uSunDirection.value, new THREE.Vector3(-0.6, 0.8, 0)), 'water did not switch specular direction to moon');
			fail(close(uniforms.uSunIntensity.value, 0.5), 'water did not switch specular intensity to moon');
			fail(uniforms.uSunColor.value.getHex() === 0xc8dcff, 'water did not switch specular colour to moon');
			fail(close(uniforms.uNightFactor.value, 1), 'water did not copy live celestial night factor');

			const positions = water.geometry.getAttribute('position');
			const index = water.geometry.index;
			fail(positions?.count === 16641 && index?.count === 98304, 'near-water topology drifted');
			let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
			for (let i = 0; i < positions.count; i++) {
				minX = Math.min(minX, positions.getX(i)); maxX = Math.max(maxX, positions.getX(i));
				minZ = Math.min(minZ, positions.getZ(i)); maxZ = Math.max(maxZ, positions.getZ(i));
			}
			fail(close(minX, -2000) && close(maxX, 2000) && close(minZ, -2000) && close(maxZ, 2000), 'near-water bounds drifted');

			let geometryDisposed = 0;
			let materialDisposed = 0;
			let backdropGeometryDisposed = 0;
			let backdropMaterialDisposed = 0;
			water.geometry.addEventListener('dispose', () => geometryDisposed++);
			water.material.addEventListener('dispose', () => materialDisposed++);
			backdrop.geometry.addEventListener('dispose', () => backdropGeometryDisposed++);
			backdrop.material.addEventListener('dispose', () => backdropMaterialDisposed++);
			disposeWater(water);
			fail(geometryDisposed === 1 && materialDisposed === 1, 'near-water resources were not disposed exactly once');
			fail(backdropGeometryDisposed === 1 && backdropMaterialDisposed === 1,
				'deep-ocean backdrop resources were not disposed exactly once');
			fail(water.userData.deepOceanBackdrop === null, 'disposed water retained deep-ocean backdrop ownership');
			return {
				vertexCount: positions.count,
				indexCount: index.count,
				optical,
				farExtent: WATER_FULL_WORLD_EXTENT_METERS,
				backdropExtent: WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
			};
		});

		assert(result.vertexCount === 16641 && result.indexCount === 98304, 'water topology mismatch escaped browser contract');
		assert(result.farExtent === 28000 && result.backdropExtent === 28000,
			'full-world water extent contract escaped browser validation');
		console.log(`[checkWaterVisualContract] PASS: depth-clear ${result.optical.shallowAlpha.toFixed(2)}→${result.optical.deepAlpha.toFixed(2)} alpha, live sun/moon specular, world-anchored far layers and organic radial composition, ${result.vertexCount} near-water vertices.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkWaterVisualContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});