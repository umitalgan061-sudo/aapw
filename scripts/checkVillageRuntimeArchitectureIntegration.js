#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'village-architecture-assets');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright is required for shipped createVillages proof');
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const pageErrors = [];
		const consoleErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		await page.goto(`http://127.0.0.1:${port}/scripts/village-architecture-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createVillages, disposeVillages, resolveVillageArchitectureProfile } = await import('/src/3d/world/villages.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');

			const seats = [
				{ id: 'berkalp', x: -420, z: -20 },
				{ id: 'stannis', x: 0, z: 20 },
				{ id: 'doran', x: 420, z: -20 },
			];
			const expectedRegions = { berkalp: 'north', stannis: 'maritime', doran: 'arid' };
			const seed = 0x51A7E;
			const sampleHeightMeters = (x, z) => 92 + Math.sin(x * 0.0025) * 0.45 + Math.cos(z * 0.003) * 0.35;
			const options = {
				sampleHeightMeters,
				seaLevelMeters: 0,
				seed,
				seats,
				roadEdges: [],
				radiusMeters: 1300,
				mulberry32,
				housesPerVillage: 10,
			};

			const first = createVillages(options);
			const replay = createVillages(options);
			const firstSites = first.landmarkSites.map((site) => ({
				seatId: site.seatId,
				assetIndex: site.assetIndex,
				houseIndex: site.houseIndex,
				x: site.x,
				z: site.z,
				yaw: site.yaw,
				targetWidthMeters: site.targetWidthMeters,
				targetDepthMeters: site.targetDepthMeters,
				proceduralType: site.proceduralType,
				distributionDistanceMeters: site.distributionDistanceMeters,
			}));
			const replaySites = replay.landmarkSites.map((site) => ({
				seatId: site.seatId,
				assetIndex: site.assetIndex,
				houseIndex: site.houseIndex,
				x: site.x,
				z: site.z,
				yaw: site.yaw,
				targetWidthMeters: site.targetWidthMeters,
				targetDepthMeters: site.targetDepthMeters,
				proceduralType: site.proceduralType,
				distributionDistanceMeters: site.distributionDistanceMeters,
			}));

			// The replay is used only for deterministic geography evidence. Dispose it immediately so its
			// asynchronously scheduled GLB work exercises the existing late-load fail-closed path rather
			// than doubling the final rendered asset population.
			disposeVillages(replay.group);
			const replayArchitectureEvidence = await replay.group.userData.villageArchitecturePromise;
			const architectureEvidence = await first.group.userData.villageArchitecturePromise;

			const pairs = seats.map((seat) => {
				const sites = firstSites.filter((site) => site.seatId === seat.id).sort((a, b) => a.assetIndex - b.assetIndex);
				const measuredDistance = sites.length >= 2 ? Math.hypot(sites[1].x - sites[0].x, sites[1].z - sites[0].z) : 0;
				return {
					seatId: seat.id,
					region: resolveVillageArchitectureProfile(seat.id)?.id ?? null,
					siteCount: sites.length,
					houseIndices: sites.map((site) => site.houseIndex),
					proceduralTypes: sites.map((site) => site.proceduralType),
					measuredDistance,
					recordedDistances: sites.map((site) => site.distributionDistanceMeters),
				};
			});

			const body = first.group.getObjectByName('village-houses');
			const matrix = new THREE.Matrix4();
			const position = new THREE.Vector3();
			const quaternion = new THREE.Quaternion();
			const scale = new THREE.Vector3();
			const hiddenLandmarks = firstSites.map((site) => {
				body.getMatrixAt(site.houseIndex, matrix);
				matrix.decompose(position, quaternion, scale);
				return { seatId: site.seatId, houseIndex: site.houseIndex, scale: [scale.x, scale.y, scale.z] };
			});
			const landmarkIndices = new Set(firstSites.map((site) => site.houseIndex));
			let visibleProceduralCount = 0;
			for (let index = 0; index < body.count; index++) {
				if (landmarkIndices.has(index)) continue;
				body.getMatrixAt(index, matrix);
				matrix.decompose(position, quaternion, scale);
				if (Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) > 0.001) visibleProceduralCount++;
			}

			const manifestProof = (architectureEvidence?.manifests || []).map((entry) => ({
				seatId: entry.seatId,
				assetIndex: entry.assetIndex,
				region: entry.region,
				assetUrl: entry.assetUrl,
				distributionDistanceMeters: entry.distributionDistanceMeters,
				recipeMode: entry.manifest?.recipe?.mode ?? null,
				generatedMaterialCount: entry.manifest?.validation?.generatedMaterialCount ?? 0,
				groundingMode: entry.manifest?.placementFootprint?.groundingMode ?? null,
				heightRange: entry.manifest?.placementFootprint?.heightRange ?? null,
				fittedWidth: entry.footprint?.fittedWidth ?? null,
				fittedDepth: entry.footprint?.fittedDepth ?? null,
				targetWidth: entry.footprint?.targetWidth ?? null,
				targetDepth: entry.footprint?.targetDepth ?? null,
			}));

			// Render the actual createVillages result, not an authoring preview or a manually arranged model
			// lineup, so the screenshot shows generated hamlet spacing and real replacement silhouettes.
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9fb5c7);
			scene.fog = new THREE.Fog(0x9fb5c7, 850, 1800);
			scene.add(new THREE.HemisphereLight(0xf3f4ef, 0x424632, 2.1));
			const sun = new THREE.DirectionalLight(0xffe7c1, 3.1);
			sun.position.set(-250, 500, 180);
			scene.add(sun);
			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(1500, 620, 1, 1),
				new THREE.MeshStandardMaterial({ color: 0x63744f, roughness: 1 }),
			);
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = 91.1;
			scene.add(ground, first.group);
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1440, 900, false);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(44, 1440 / 900, 0.1, 2600);
			camera.position.set(0, 560, 930);
			camera.lookAt(0, 90, 0);
			renderer.render(scene, camera);

			return {
				first: { villageCount: first.villageCount, houseCount: first.houseCount, wallCount: first.wallCount },
				replay: { villageCount: replay.villageCount, houseCount: replay.houseCount, wallCount: replay.wallCount },
				firstSites,
				replaySites,
				pairs,
				expectedRegions,
				architectureEvidence: architectureEvidence ? {
					ok: architectureEvidence.ok,
					disposed: architectureEvidence.disposed,
					requestedSiteCount: architectureEvidence.requestedSiteCount,
					upgradedCount: architectureEvidence.upgradedCount,
					missingAssetCount: architectureEvidence.missingAssetCount,
					placementFailureCount: architectureEvidence.placementFailureCount,
				} : null,
				replayArchitectureEvidence: replayArchitectureEvidence ? {
					ok: replayArchitectureEvidence.ok,
					disposed: replayArchitectureEvidence.disposed,
					upgradedCount: replayArchitectureEvidence.upgradedCount,
				} : null,
				hiddenLandmarks,
				visibleProceduralCount,
				manifestProof,
			};
		});

		assert.equal(result.first.villageCount, 3, 'all three canonical seat contexts must produce hamlets');
		assert.equal(result.replay.villageCount, result.first.villageCount, 'same seed must replay village count');
		assert.equal(result.replay.houseCount, result.first.houseCount, 'same seed must replay house count');
		assert.equal(result.replay.wallCount, result.first.wallCount, 'same seed must replay wall count');
		assert(result.first.houseCount >= 24, `fixture should produce substantial procedural fabric, got ${result.first.houseCount}`);
		assert.deepEqual(result.replaySites, result.firstSites, 'real createVillages landmark coordinates must replay exactly for the same seed');
		assert.equal(result.firstSites.length, 6, 'three canonical hamlets should expose two bounded real-asset sites each');

		for (const pair of result.pairs) {
			assert.equal(pair.region, result.expectedRegions[pair.seatId], `${pair.seatId}: wrong regional architecture profile`);
			assert.equal(pair.siteCount, 2, `${pair.seatId}: expected two real landmark sites`);
			assert.equal(new Set(pair.houseIndices).size, 2, `${pair.seatId}: landmarks must replace distinct authored houses`);
			assert(pair.measuredDistance >= 22 - 1e-6, `${pair.seatId}: real silhouettes cluster below 22m`);
			assert(pair.recordedDistances.every((distance) => Math.abs(distance - pair.measuredDistance) <= 1e-6), `${pair.seatId}: recorded distribution evidence drifted from coordinates`);
		}

		assert(result.architectureEvidence, 'createVillages must schedule the real architecture upgrade in shipped browser runtime');
		assert.equal(result.architectureEvidence.ok, true, `runtime architecture upgrade failed: ${JSON.stringify(result.architectureEvidence)}`);
		assert.equal(result.architectureEvidence.disposed, false);
		assert.equal(result.architectureEvidence.requestedSiteCount, 6);
		assert.equal(result.architectureEvidence.upgradedCount, 6);
		assert.equal(result.architectureEvidence.missingAssetCount, 0);
		assert.equal(result.architectureEvidence.placementFailureCount, 0);
		assert.equal(result.manifestProof.length, 6);
		const silhouetteUrls = new Set(result.manifestProof.map((entry) => entry.assetUrl));
		const renderedRegions = new Set(result.manifestProof.map((entry) => entry.region));
		assert.equal(renderedRegions.size, 3, 'shipped proof must exercise all three requested geography profiles');
		assert.equal(silhouetteUrls.size >= 4, true, 'three regions should render at least four real repository silhouettes');
		for (const pair of result.pairs) {
			const regionalAssets = result.manifestProof.filter((entry) => entry.seatId === pair.seatId).map((entry) => entry.assetUrl);
			assert.equal(new Set(regionalAssets).size, 2, `${pair.seatId}: a hamlet must not clone one GLB into both landmark slots`);
		}

		for (const proof of result.manifestProof) {
			assert(['north', 'maritime', 'arid'].includes(proof.region), `${proof.seatId}: unexpected region ${proof.region}`);
			assert(['layers', 'surface', 'auto'].includes(proof.recipeMode), `${proof.seatId}: missing shared material recipe`);
			assert(proof.generatedMaterialCount > 0, `${proof.seatId}: shared material validation found no generated PBR surface`);
			assert(['embedded-low-side', 'terrain-conform'].includes(proof.groundingMode), `${proof.seatId}: footprint grounding missing`);
			assert(Number.isFinite(proof.heightRange) && proof.heightRange < 0.25, `${proof.seatId}: synthetic ground range too large`);
			assert(Number.isFinite(proof.fittedWidth) && Number.isFinite(proof.fittedDepth), `${proof.seatId}: fitted footprint evidence missing`);
			assert(proof.fittedWidth <= proof.targetWidth + 1e-6, `${proof.seatId}: real GLB exceeds authored parcel width`);
			assert(proof.fittedDepth <= proof.targetDepth + 1e-6, `${proof.seatId}: real GLB exceeds authored parcel depth`);
		}

		assert.equal(result.hiddenLandmarks.length, 6);
		for (const hidden of result.hiddenLandmarks) {
			assert(hidden.scale.every((component) => Math.abs(component) <= 1e-9), `${hidden.seatId}/${hidden.houseIndex}: primitive fallback was not hidden after successful GLB attach`);
		}
		assert(result.visibleProceduralCount > 0, 'non-upgraded procedural houses must remain visible as settlement fabric');
		assert.equal(result.replayArchitectureEvidence?.disposed, true, 'disposed replay must fail closed when scheduled GLBs complete late');
		assert.equal(result.replayArchitectureEvidence?.ok, false, 'disposed replay must never report a successful visual attach');
		assert.equal(result.replayArchitectureEvidence?.upgradedCount, 0, 'disposed replay must not attach a late model');

		assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
		assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
		await page.screenshot({ path: path.join(ARTIFACT_DIR, 'generated-hamlet-geography.png'), fullPage: true });
		console.log('VILLAGE_RUNTIME_ARCHITECTURE_PASS', JSON.stringify({
			...result,
			pageErrors: pageErrors.length,
			consoleErrors: consoleErrors.length,
		}));
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkVillageRuntimeArchitectureIntegration] FAIL', error);
	process.exit(1);
});
