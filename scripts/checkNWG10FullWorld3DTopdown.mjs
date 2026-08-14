#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const RELIEF_EXAGGERATION = 4;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/nw-g10-relief-visual');
const PNG_PATH = path.join(OUT_DIR, 'g10-relief-full-world-3d-topdown.png');
const META_PATH = path.join(OUT_DIR, 'g10-relief-full-world-3d-topdown.json');
const need = (ok, message) => { if (!ok) throw new Error(`[checkNWG10FullWorld3DTopdown] ${message}`); };

const playwright = loadPlaywright();
need(playwright, 'Playwright unavailable');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	const pageErrors = [];
	const requestFailures = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load',
		timeout: 20_000,
	});

	const frame = await page.evaluate(async ({ width, height, reliefExaggeration }) => {
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);

		const [THREE, sceneModule, configModule, surfaceModule, waterModule, lightingModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js'),
			import('/src/3d/world/water.js'),
			import('/src/3d/lighting.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		const installation = surfaceModule.installRuntimePindexTerrainPolish();
		document.body.innerHTML = '<canvas id="runtime-world"></canvas><canvas id="full-world-3d-proof"></canvas>';
		Object.assign(document.documentElement.style, { margin: '0', width: '100%', height: '100%', background: '#0c1720' });
		Object.assign(document.body.style, { margin: '0', width: '100%', height: '100%', overflow: 'hidden', background: '#0c1720' });
		const runtimeCanvas = document.getElementById('runtime-world');
		const proofCanvas = document.getElementById('full-world-3d-proof');
		Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
		Object.assign(proofCanvas.style, { display: 'block', width: `${width}px`, height: `${height}px` });
		proofCanvas.width = width;
		proofCanvas.height = height;

		const state = sceneModule.createScene(runtimeCanvas);
		state.controls.enabled = false;
		state.scene.fog = null;
		state.sky.visible = false;
		state.stars.visible = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);
		state.renderer.outputColorSpace = THREE.SRGBColorSpace;

		const worldBounds = {
			minX: -WORLD_SCALE.WORLD_WIDTH_METERS / 2,
			maxX: WORLD_SCALE.WORLD_WIDTH_METERS / 2,
			minZ: -WORLD_SCALE.WORLD_DEPTH_METERS / 2,
			maxZ: WORLD_SCALE.WORLD_DEPTH_METERS / 2,
		};
		const size = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const minChunkX = Math.ceil(worldBounds.minX / size - 0.5);
		const maxChunkX = Math.floor(worldBounds.maxX / size + 0.5);
		const minChunkZ = Math.ceil(worldBounds.minZ / size - 0.5);
		const maxChunkZ = Math.floor(worldBounds.maxZ / size + 0.5);
		for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
			for (let x = minChunkX; x <= maxChunkX; x += 1) state.chunkManager.loadChunk(x, z);
		}

		const terrainMeshes = [];
		const rawTerrainBounds = new THREE.Box3();
		for (const mesh of state.chunkManager.loaded.values()) {
			const { x, z } = mesh.userData.chunkCoord;
			const inWorld = x >= minChunkX && x <= maxChunkX && z >= minChunkZ && z <= maxChunkZ;
			mesh.visible = inWorld;
			if (!inWorld) continue;
			mesh.geometry.computeBoundingBox();
			rawTerrainBounds.union(mesh.geometry.boundingBox.clone().translate(mesh.position));
			// Full-world orthographic scale compresses ~166 m of relief into a 12 km footprint. Preserve
			// the sea-level contour while exaggerating only vertical distance from it, a standard relief-
			// map treatment that keeps coastlines fixed and makes the real runtime normals readable.
			mesh.scale.y = reliefExaggeration;
			mesh.position.y = WORLD_DEFAULTS.WATER_LEVEL_METERS * (1 - reliefExaggeration);
			terrainMeshes.push(mesh);
		}
		state.scene.updateMatrixWorld(true);
		const terrainBounds = new THREE.Box3();
		for (const mesh of terrainMeshes) {
			terrainBounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
		}

		const centerX = (worldBounds.minX + worldBounds.maxX) / 2;
		const centerZ = (worldBounds.minZ + worldBounds.maxZ) / 2;
		const worldWidth = worldBounds.maxX - worldBounds.minX;
		const worldDepth = worldBounds.maxZ - worldBounds.minZ;
		const daylight = lightingModule.updateDayNightLighting(
			state.lights,
			0,
			WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
			0.5,
		);
		const aspect = width / height;
		const halfWidth = Math.max(worldWidth / 2, worldDepth * aspect / 2) * 1.025;
		const halfHeight = halfWidth / aspect;
		state.water.geometry.computeBoundingBox();
		const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
		const waterCoverageMeters = Math.max(halfWidth * 2, halfHeight * 2) * 1.04;
		const waterScale = waterCoverageMeters / waterExtent;
		state.water.scale.set(waterScale, 1, waterScale);

		// Noon light is nearly parallel with the top-down camera and erases the mountain normals.
		// Keep the runtime lights/materials, but place the proof sun low in the north-west so height
		// becomes legible through genuine MeshStandardMaterial hillshade rather than a 2D overlay.
		state.lights.sun.position.set(-worldWidth * 0.48, worldWidth * 0.31, -worldDepth * 0.56);
		state.lights.sun.color.setHex(0xffead0);
		state.lights.sun.intensity = 2.15;
		state.lights.hemisphere.intensity = 0.28;
		state.scene.background.setHex(0x0a3a4a);
		const cameraHeight = terrainBounds.max.y + Math.max(worldWidth, worldDepth) * 0.72;
		const camera = new THREE.OrthographicCamera(
			-halfWidth,
			halfWidth,
			halfHeight,
			-halfHeight,
			1,
			cameraHeight - terrainBounds.min.y + 2_000,
		);
		camera.up.set(0, 0, -1);
		camera.position.set(centerX, cameraHeight, centerZ);
		camera.lookAt(centerX, 0, centerZ);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		waterModule.updateWater(state.water, camera.position, 0);
		state.water.position.x = centerX;
		state.water.position.z = centerZ;
		// The gameplay water's depth-driven foam/specular is tuned for a near camera. From ~9 km up it
		// aliases into cyan polygon flecks that resemble lakes floating in the sea. Retain the shipped
		// ShaderMaterial, palette and plane, but feed it a deterministic deep/calm proof field so the
		// full-world artifact shows one continuous ocean instead of far-field shimmer artifacts.
		const proofDepthTexture = new THREE.DataTexture(
			new Uint8Array([255, 255, 255, 255]),
			1,
			1,
			THREE.RGBAFormat,
			THREE.UnsignedByteType,
		);
		proofDepthTexture.needsUpdate = true;
		state.water.material.uniforms.uDepthMap.value = proofDepthTexture;
		state.water.material.uniforms.uDepthFieldExtentMeters.value = 1;
		state.water.material.uniforms.uSwellStrength.value = 0;
		state.water.material.uniforms.uSunDirection.value.set(1, 0, 0);

		const keyLightDirection = state.lights.sun.position.clone()
			.sub(state.lights.sun.target.position)
			.normalize();
		let hillshadeSum = 0;
		let hillshadeSquaredSum = 0;
		let hillshadeSamples = 0;
		const normalMatrix = new THREE.Matrix3();
		const normalVector = new THREE.Vector3();
		for (const mesh of terrainMeshes) {
			const normals = mesh.geometry.getAttribute('normal');
			normalMatrix.getNormalMatrix(mesh.matrixWorld);
			for (let index = 0; index < normals.count; index += 8) {
				normalVector.fromBufferAttribute(normals, index).applyNormalMatrix(normalMatrix);
				const lambert = Math.max(0, normalVector.dot(keyLightDirection));
				hillshadeSum += lambert;
				hillshadeSquaredSum += lambert * lambert;
				hillshadeSamples += 1;
			}
		}
		const hillshadeMean = hillshadeSum / hillshadeSamples;
		const hillshadeStdDev = Math.sqrt(Math.max(0, hillshadeSquaredSum / hillshadeSamples - hillshadeMean ** 2));
		const keyLightElevationDegrees = THREE.MathUtils.radToDeg(Math.asin(keyLightDirection.y));

		const overlayObjects = [];
		state.scene.traverse((object) => {
			if (!object.visible) return;
			const explicitOverlay = object.isGridHelper || object.userData?.visibleGeoCellOverlay === true;
			const namedOverlay = /(?:geo.?cell|pindex).*(?:grid|overlay)|(?:grid|overlay).*(?:geo.?cell|pindex)/i.test(`${object.type} ${object.name}`);
			if (explicitOverlay || namedOverlay) overlayObjects.push(`${object.type}:${object.name || '(unnamed)'}`);
		});

		state.renderer.render(state.scene, camera);
		const proofContext = proofCanvas.getContext('2d', { willReadFrequently: true });
		proofContext.drawImage(runtimeCanvas, 0, 0, width, height);
		const pixels = proofContext.getImageData(0, 0, width, height).data;
		const histogram = new Map();
		let luminanceSum = 0;
		let luminanceSquaredSum = 0;
		let opaqueSamples = 0;
		let brightCyanSamples = 0;
		let edgeBrightBlueSamples = 0;
		let edgeSamples = 0;
		const sampleStride = 4;
		for (let y = 0; y < height; y += sampleStride) {
			for (let x = 0; x < width; x += sampleStride) {
				const offset = (y * width + x) * 4;
				const r = pixels[offset];
				const g = pixels[offset + 1];
				const b = pixels[offset + 2];
				const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
				luminanceSum += luminance;
				luminanceSquaredSum += luminance * luminance;
				if (pixels[offset + 3] > 250) opaqueSamples += 1;
				if (g > 125 && b > 125 && g > r * 1.35 && b > r * 1.35) brightCyanSamples += 1;
				if (x < width * 0.08 || x > width * 0.92) {
					edgeSamples += 1;
					if (r > 120 && g > 165 && b > 185 && b > r * 1.15) edgeBrightBlueSamples += 1;
				}
				const bucket = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
				histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
			}
		}
		const sampleCount = Math.ceil(width / sampleStride) * Math.ceil(height / sampleStride);
		const dominantBucketCount = Math.max(...histogram.values());
		const luminanceMean = luminanceSum / sampleCount;
		const luminanceStdDev = Math.sqrt(Math.max(0, luminanceSquaredSum / sampleCount - luminanceMean ** 2));

		const colorDistance = (a, b) => {
			const ar = pixels[a]; const ag = pixels[a + 1]; const ab = pixels[a + 2];
			return (Math.abs(ar - pixels[b]) + Math.abs(ag - pixels[b + 1]) + Math.abs(ab - pixels[b + 2])) / 3;
		};
		const worldToPixelX = (worldX) => (worldX - (centerX - halfWidth)) / (halfWidth * 2) * width;
		const worldToPixelY = (worldZ) => (worldZ - (centerZ - halfHeight)) / (halfHeight * 2) * height;
		const xMinPixel = Math.max(2, Math.ceil(worldToPixelX(worldBounds.minX)));
		const xMaxPixel = Math.min(width - 3, Math.floor(worldToPixelX(worldBounds.maxX)));
		const yMinPixel = Math.max(2, Math.ceil(worldToPixelY(worldBounds.minZ)));
		const yMaxPixel = Math.min(height - 3, Math.floor(worldToPixelY(worldBounds.maxZ)));
		const verticalEnergy = (x) => {
			let sum = 0; let count = 0;
			for (let y = yMinPixel; y <= yMaxPixel; y += 3) {
				sum += colorDistance((y * width + x - 1) * 4, (y * width + x + 1) * 4); count += 1;
			}
			return sum / Math.max(1, count);
		};
		const horizontalEnergy = (y) => {
			let sum = 0; let count = 0;
			for (let x = xMinPixel; x <= xMaxPixel; x += 3) {
				sum += colorDistance(((y - 1) * width + x) * 4, ((y + 1) * width + x) * 4); count += 1;
			}
			return sum / Math.max(1, count);
		};
		const ratios = [];
		for (let edge = minChunkX; edge < maxChunkX; edge += 1) {
			const x = Math.round(worldToPixelX((edge + 0.5) * size));
			if (x < xMinPixel + 8 || x > xMaxPixel - 8) continue;
			const baseline = (verticalEnergy(x - 6) + verticalEnergy(x + 6)) / 2;
			ratios.push(verticalEnergy(x) / Math.max(0.25, baseline));
		}
		for (let edge = minChunkZ; edge < maxChunkZ; edge += 1) {
			const y = Math.round(worldToPixelY((edge + 0.5) * size));
			if (y < yMinPixel + 8 || y > yMaxPixel - 8) continue;
			const baseline = (horizontalEnergy(y - 6) + horizontalEnergy(y + 6)) / 2;
			ratios.push(horizontalEnergy(y) / Math.max(0.25, baseline));
		}
		const meanGridEnergyRatio = ratios.reduce((sum, value) => sum + value, 0) / Math.max(1, ratios.length);
		const maxGridEnergyRatio = Math.max(0, ...ratios);
		const viewDirection = camera.getWorldDirection(new THREE.Vector3());
		const runtimePolishedMeshes = terrainMeshes.filter((mesh) => mesh.userData.runtimePindexTerrainQualityV2?.shaderDetail === true).length;
		return {
			captureWidth: width,
			captureHeight: height,
			worldBounds,
			terrainBounds: { minY: terrainBounds.min.y, maxY: terrainBounds.max.y },
			terrainReliefProbe: {
				rawMinY: rawTerrainBounds.min.y,
				rawMaxY: rawTerrainBounds.max.y,
				rawHeightRangeMeters: rawTerrainBounds.max.y - rawTerrainBounds.min.y,
				renderedHeightRangeMeters: terrainBounds.max.y - terrainBounds.min.y,
				verticalExaggeration: reliefExaggeration,
				keyLightDirection: keyLightDirection.toArray(),
				keyLightElevationDegrees,
				hillshadeSamples,
				hillshadeMean,
				hillshadeStdDev,
			},
			camera: {
				type: camera.type,
				isOrthographicCamera: camera.isOrthographicCamera === true,
				position: camera.position.toArray(),
				target: [centerX, 0, centerZ],
				up: camera.up.toArray(),
				downDot: viewDirection.dot(new THREE.Vector3(0, -1, 0)),
				frustum: { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, near: camera.near, far: camera.far },
			},
			runtime: {
				sceneFactory: 'src/3d/sceneManager.js#createScene',
				terrainBuilder: 'src/3d/world/chunkManager.js#ChunkManager.loadChunk',
				terrainPolishPolicyId: installation.previousPolicyId,
				terrainQualityPolicyId: installation.policyId,
				waterBuilder: 'src/3d/world/water.js#createWater',
			},
			captureOverrides: {
				fogDisabledForFullWorldVisibility: true,
				skyHiddenForExternalOrthographicCamera: true,
				starsHiddenForDaylightCapture: true,
				waterScaledFromRuntimeMeshToCameraFrustum: true,
				waterFarFieldFoamAndSwellSuppressed: true,
				terrainVerticalExaggerationFromSeaLevel: reliefExaggeration,
				obliqueRuntimeKeyLightForHillshade: true,
			},
			scene: {
				terrainMeshCount: terrainMeshes.length,
				terrainVertexCount: terrainMeshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0),
				terrainMaterialTypes: [...new Set(terrainMeshes.map((mesh) => mesh.material.type))].sort(),
				runtimePolishedMeshes,
				waterPresent: state.water.isMesh === true,
				waterMaterialType: state.water.material.type,
				waterScale,
				waterCoverageMeters,
				renderCalls: state.renderer.info.render.calls,
				renderTriangles: state.renderer.info.render.triangles,
			},
			frame: {
				distinctQuantizedColors: histogram.size,
				dominantColorRatio: dominantBucketCount / sampleCount,
				luminanceMean,
				luminanceStdDev,
				opaqueRatio: opaqueSamples / sampleCount,
			},
			waterArtifactProbe: {
				mode: 'runtime-shader-deep-calm-orthographic-proof',
				brightCyanRatio: brightCyanSamples / sampleCount,
				brightCyanThreshold: 0.003,
				edgeBrightBlueRatio: edgeBrightBlueSamples / edgeSamples,
				edgeBrightBlueThreshold: 0.02,
				frustumCovered: waterCoverageMeters > Math.max(halfWidth * 2, halfHeight * 2),
			},
			gridOverlayProbe: {
				objectMatches: overlayObjects,
				lineCount: ratios.length,
				meanEnergyRatio: meanGridEnergyRatio,
				maxEnergyRatio: maxGridEnergyRatio,
				meanThreshold: 2.8,
				maxThreshold: 7.5,
			},
		};
		}, { width: WIDTH, height: HEIGHT, reliefExaggeration: RELIEF_EXAGGERATION });

	const pngBytes = await page.locator('#full-world-3d-proof').screenshot({ type: 'png' });
	const pngWidth = pngBytes.readUInt32BE(16);
	const pngHeight = pngBytes.readUInt32BE(20);
	const renderSha256 = crypto.createHash('sha256').update(pngBytes).digest('hex');
	const visibleGeoCellOverlay = frame.gridOverlayProbe.objectMatches.length > 0 ||
		frame.gridOverlayProbe.meanEnergyRatio >= frame.gridOverlayProbe.meanThreshold ||
		frame.gridOverlayProbe.maxEnergyRatio >= frame.gridOverlayProbe.maxThreshold;
	const metadata = {
		schema: 'westeros-nw-g10-full-world-3d-topdown-v2',
		artifact: path.basename(PNG_PATH),
		renderSha256,
		pngBytes: pngBytes.length,
		pngWidth,
		pngHeight,
		orthographicMode: frame.camera.isOrthographicCamera,
		visibleGeoCellOverlay,
		consoleErrors,
		pageErrors,
		requestFailures,
		...frame,
	};
	fs.writeFileSync(PNG_PATH, pngBytes);
	fs.writeFileSync(META_PATH, `${JSON.stringify(metadata, null, 2)}\n`);

	need(pngWidth === WIDTH && pngHeight === HEIGHT, `unexpected PNG dimensions ${pngWidth}x${pngHeight}`);
	need(pngBytes.length >= 40_000, `PNG is implausibly small: ${pngBytes.length} bytes`);
	need(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
	need(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
	need(requestFailures.length === 0, `request failures: ${requestFailures.join(' | ')}`);
	need(frame.camera.type === 'OrthographicCamera' && frame.camera.isOrthographicCamera, 'camera is not orthographic');
	need(frame.camera.downDot > 0.999999, `camera is not a true 90-degree top-down view: ${frame.camera.downDot}`);
	need(frame.scene.terrainMeshCount >= 550, `full world terrain is incomplete: ${frame.scene.terrainMeshCount} meshes`);
	need(frame.scene.runtimePolishedMeshes === frame.scene.terrainMeshCount, 'runtime terrain material/pindex polish was not applied to every mesh');
	need(frame.scene.terrainMaterialTypes.length === 1 && frame.scene.terrainMaterialTypes[0] === 'MeshStandardMaterial', 'runtime terrain material drift');
	need(frame.scene.waterPresent && frame.scene.waterMaterialType === 'ShaderMaterial', 'runtime water plane/material missing');
	need(frame.waterArtifactProbe.frustumCovered, 'runtime water does not cover the orthographic frustum');
	need(frame.waterArtifactProbe.brightCyanRatio < frame.waterArtifactProbe.brightCyanThreshold, `far-field cyan water artifacts detected: ${frame.waterArtifactProbe.brightCyanRatio}`);
	need(frame.waterArtifactProbe.edgeBrightBlueRatio < frame.waterArtifactProbe.edgeBrightBlueThreshold, `uncovered light-blue frame edge detected: ${frame.waterArtifactProbe.edgeBrightBlueRatio}`);
	need(frame.terrainReliefProbe.rawHeightRangeMeters > 140, `runtime mountain range is missing: ${frame.terrainReliefProbe.rawHeightRangeMeters}m`);
	need(frame.terrainReliefProbe.renderedHeightRangeMeters > 560, `orthographic relief is too compressed: ${frame.terrainReliefProbe.renderedHeightRangeMeters}m`);
	need(frame.terrainReliefProbe.keyLightElevationDegrees > 15 && frame.terrainReliefProbe.keyLightElevationDegrees < 35, `hillshade key-light elevation drift: ${frame.terrainReliefProbe.keyLightElevationDegrees}`);
	need(frame.terrainReliefProbe.hillshadeStdDev > 0.04, `mountain normals do not produce visible hillshade: ${frame.terrainReliefProbe.hillshadeStdDev}`);
	need(frame.scene.renderCalls > 500 && frame.scene.renderTriangles > 1_000_000, 'render did not contain the full runtime world');
	need(frame.frame.distinctQuantizedColors >= 96, `frame lacks visual diversity: ${frame.frame.distinctQuantizedColors} colors`);
	need(frame.frame.dominantColorRatio < 0.92, `frame is effectively blank: dominant=${frame.frame.dominantColorRatio}`);
	need(frame.frame.luminanceStdDev > 5, `frame is effectively flat: sigma=${frame.frame.luminanceStdDev}`);
	need(frame.frame.opaqueRatio > 0.999, `frame contains unexpected transparency: ${frame.frame.opaqueRatio}`);
	need(!visibleGeoCellOverlay, `visible grid/GeoCell overlay detected: ${JSON.stringify(frame.gridOverlayProbe)}`);
	need(/^[a-f0-9]{64}$/.test(renderSha256), 'render checksum missing');
	console.log(`NW_G10_FULL_WORLD_3D_TOPDOWN=${JSON.stringify({ renderSha256, pngBytes: pngBytes.length, terrainMeshes: frame.scene.terrainMeshCount, triangles: frame.scene.renderTriangles, reliefRangeMeters: frame.terrainReliefProbe.renderedHeightRangeMeters, hillshadeStdDev: frame.terrainReliefProbe.hillshadeStdDev, brightCyanRatio: frame.waterArtifactProbe.brightCyanRatio, edgeBrightBlueRatio: frame.waterArtifactProbe.edgeBrightBlueRatio, meanGridEnergyRatio: frame.gridOverlayProbe.meanEnergyRatio })}`);
	console.log('NW_G10_FULL_WORLD_3D_TOPDOWN_OK');
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
