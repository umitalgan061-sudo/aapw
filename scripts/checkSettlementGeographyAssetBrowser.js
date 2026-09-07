#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'settlement-geography-asset');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright is required for shipped settlement geography proof');
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
		const pageErrors = [];
		const consoleErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		await page.goto(`http://127.0.0.1:${port}/scripts/village-architecture-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');
			const {
				createVillages,
				disposeVillages,
				resolveVillageArchitectureProfile,
			} = await import('/src/3d/world/villages.js');
			const {
				REGION_IDS,
				SETTLEMENT_GEOGRAPHY_POLICY,
				scoreSettlementArchitectureSite,
				selectSettlementArchitectureVariant,
			} = await import('/src/3d/world/settlementGeographyPolicy.js');

			const seats = [
				{ id: 'berkalp', x: -900, z: -700 },
				{ id: 'ziya', x: -640, z: 520 },
				{ id: 'stannis', x: -180, z: 440 },
				{ id: 'doran', x: 160, z: 700 },
				{ id: 'robin', x: 470, z: 260 },
				{ id: 'twin', x: 780, z: -220 },
				{ id: 'umit', x: 1020, z: 600 },
			];
			const roadEdges = seats.slice(1).map((seat, index) => ({
				points: [
					{ x: seats[index].x, z: seats[index].z },
					{ x: seat.x, z: seat.z },
				],
			}));
			const sampleHeightMeters = (x, z) => 32 + Math.sin(x * 0.0019) * 8 + Math.cos(z * 0.0017) * 5 + Math.max(0, z) * 0.012;
			const options = {
				sampleHeightMeters,
				seaLevelMeters: 6,
				seed: 7331,
				seats,
				roadEdges,
				radiusMeters: 2200,
				mulberry32,
				housesPerVillage: 12,
			};

			const first = createVillages(options);
			const second = createVillages(options);
			const serialise = (result) => result.landmarkSites.map((site) => ({
				seatId: site.seatId,
				assetIndex: site.assetIndex,
				assetVariant: site.assetVariant,
				architectureScore: Number(site.architectureScore?.toFixed(9)),
				distributionDistanceMeters: Number(site.distributionDistanceMeters?.toFixed(6)),
				surfaceContext: {
					height: Number(site.surfaceContext?.height?.toFixed(4)),
					slopeDegrees: Number(site.surfaceContext?.slopeDegrees?.toFixed(4)),
					roadDistanceMeters: Number(site.surfaceContext?.roadDistanceMeters?.toFixed(4)),
					waterDepth: Number(site.surfaceContext?.waterDepth?.toFixed(4)),
				},
			}));
			const firstSites = serialise(first);
			const secondSites = serialise(second);

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x91a6b0);
			scene.add(new THREE.HemisphereLight(0xf1f4ef, 0x3a3b34, 1.9));
			const sun = new THREE.DirectionalLight(0xffedcf, 3.4);
			sun.position.set(140, 210, 100);
			scene.add(sun, first.group);
			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(2500, 1800),
				new THREE.MeshStandardMaterial({ color: 0x657951, roughness: 0.97 }),
			);
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = 30;
			scene.add(ground);
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1440, 900, false);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(44, 1440 / 900, 0.1, 5000);
			camera.position.set(0, 720, 1320);
			camera.lookAt(0, 35, 80);
			renderer.render(scene, camera);
			await first.group.userData.villageArchitecturePromise;
			await second.group.userData.villageArchitecturePromise;

			const upgradedChildren = first.group.getObjectByName('village-architectural-assets')?.children || [];
			const manifests = upgradedChildren.map((object) => object.userData?.worldPlacementManifest || null).filter(Boolean);
			const manifestGeography = upgradedChildren.map((object) => ({
				name: object.name,
				assetSrc: object.userData?.assetSrc || null,
				surface: object.userData?.worldPlacementSurface || null,
				footprint: object.userData?.worldPlacementFootprint || null,
			}));

			return {
				regionIds: REGION_IDS,
				policyId: SETTLEMENT_GEOGRAPHY_POLICY.id,
				profileIds: seats.map((seat) => resolveVillageArchitectureProfile(seat.id)?.id || null),
				firstSites,
				secondSites,
				deterministic: JSON.stringify(firstSites) === JSON.stringify(secondSites),
				villageCount: first.villageCount,
				houseCount: first.houseCount,
				landmarkCount: first.landmarkSites.length,
				uniqueVariants: [...new Set(firstSites.map((site) => site.assetVariant))],
				variantProbe: {
					fertileFlat: selectSettlementArchitectureVariant('fertile', { height: 34, seaLevel: 6, slopeDegrees: 2, roadDistance: 18, waterDepth: 0 }, 0.99),
					fertileSteep: selectSettlementArchitectureVariant('fertile', { height: 34, seaLevel: 6, slopeDegrees: 22, roadDistance: 120, waterDepth: 0 }, 0),
				},
				scoreProbe: {
					fertileFlat: scoreSettlementArchitectureSite('fertile', { height: 34, seaLevel: 6, slopeDegrees: 2, roadDistance: 18, waterDepth: 0 }),
					fertileSteep: scoreSettlementArchitectureSite('fertile', { height: 34, seaLevel: 6, slopeDegrees: 22, roadDistance: 120, waterDepth: 0 }),
				},
				evidence: first.group.userData.villageArchitectureEvidence || null,
				manifests,
				manifestGeography,
			};
		});

		assert.equal(result.deterministic, true, 'same seed/terrain must produce identical geography routing');
		assert.deepEqual(result.regionIds, ['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);
		assert.equal(result.profileIds.length, 7);
		assert.ok(result.landmarkCount > 0, 'geography-aware landmark selection must produce candidates');
		assert.ok(result.firstSites.every((site) => Number.isFinite(site.architectureScore)), 'each landmark needs a geography score');
		assert.ok(result.firstSites.every((site) => Number.isFinite(site.surfaceContext.slopeDegrees)), 'each landmark needs terrain slope evidence');
		assert.ok(result.firstSites.every((site) => Number.isFinite(site.surfaceContext.roadDistanceMeters)), 'each landmark needs road-distance evidence');
		assert.equal(result.variantProbe.fertileFlat, 'primary');
		assert.equal(result.variantProbe.fertileSteep, 'secondary');
		assert.ok(result.scoreProbe.fertileFlat > result.scoreProbe.fertileSteep);
		assert.ok(result.manifests.length > 0, 'real residential assets must reach the shared placement manifest');
		assert.ok(result.manifestGeography.every((entry) => entry.assetSrc && entry.surface && entry.footprint), 'placement manifests must retain geographic surface evidence');

		await page.screenshot({ path: path.join(ARTIFACT_DIR, 'settlement-geography-assets.png'), fullPage: true });
		assert.equal(pageErrors.length, 0, `browser page errors: ${JSON.stringify(pageErrors)}`);
		assert.equal(consoleErrors.length, 0, `browser console errors: ${JSON.stringify(consoleErrors)}`);
		console.log('SETTLEMENT_GEOGRAPHY_ASSET_BROWSER_PASS', JSON.stringify({
			policyId: result.policyId,
			villageCount: result.villageCount,
			houseCount: result.houseCount,
			landmarkCount: result.landmarkCount,
			uniqueVariants: result.uniqueVariants,
			manifestCount: result.manifests.length,
			deterministic: result.deterministic,
			variantProbe: result.variantProbe,
			scoreProbe: result.scoreProbe,
		}));
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkSettlementGeographyAssetBrowser] FAILED', error);
	process.exitCode = 1;
});