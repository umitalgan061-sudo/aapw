#!/usr/bin/env node
/** Exact-head shipped-scene proof for geographic roadside waystones. */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'roadside-waystones');
const SCENE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/sceneManager.js'), 'utf8');
const WAYSTONE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/world/roadsideWaystones.js'), 'utf8');

function assert(condition, message) {
	if (!condition) throw new Error(`[checkRoadsideWaystones] ${message}`);
}

function assertSourceContracts() {
	const bridge = SCENE_SOURCE.indexOf('installCanonicalRoadBridgeRuntime(roadsResult');
	const waystones = SCENE_SOURCE.indexOf('createRoadsideWaystones({');
	const geology = SCENE_SOURCE.indexOf('const naturalGeologyResult = createNaturalGeology');
	assert(bridge >= 0 && waystones > bridge, 'waystones must consume bridge-aware road edges');
	assert(geology > waystones, 'waystones must be attached before downstream road-clearance geography');
	assert(WAYSTONE_SOURCE.includes('northReferenceCryosphereAtWorldXZ'), 'north material must use map-aligned cryosphere authority');
	assert(WAYSTONE_SOURCE.includes('valyriaInfluenceAtWorldXZ'), 'Valyria material must use Doom geography authority');
	assert(WAYSTONE_SOURCE.includes('THREE.DataTexture'), 'waystones must ship generated stone textures');
	assert(WAYSTONE_SOURCE.includes('THREE.LatheGeometry'), 'authored plinth/shaft/cap silhouette missing');
	assert(WAYSTONE_SOURCE.includes('bumpMap: textures.relief'), 'masonry relief map contract missing');
	assert(WAYSTONE_SOURCE.includes('THREE.InstancedMesh'), 'waystones must stay one batched asset layer');
	assert(WAYSTONE_SOURCE.includes('shoreClearanceMeters'), 'wet/shoreline placement gate missing');
	assert(WAYSTONE_SOURCE.includes('maxSlopeDegrees'), 'terrain slope placement gate missing');
}

async function main() {
	assertSourceContracts();
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRoadsideWaystones] SKIP: Playwright is not available.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	let report = null;
	let pageErrors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/scripts/geographicMaterialHarness.html`, {
			waitUntil: 'domcontentloaded', timeout: 30000,
		});
		report = await page.evaluate(async () => {
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { disposeRoadNetwork } = await import('/src/3d/world/roads.js');
			const { updateDayNightLighting } = await import('/src/3d/lighting.js');
			const { planRoadsideWaystoneSites, ROADSIDE_WAYSTONE_POLICY } = await import('/src/3d/world/roadsideWaystones.js');
			const canvas = document.createElement('canvas');
			canvas.id = 'roadside-waystone-proof-canvas';
			canvas.style.width = '1440px';
			canvas.style.height = '900px';
			document.body.appendChild(canvas);
			const startedAt = performance.now();
			const state = createScene(canvas);
			const sceneBuildMs = performance.now() - startedAt;
			state.renderer.setSize(1440, 900, false);
			state.camera.aspect = 1440 / 900;
			state.camera.updateProjectionMatrix();
			const mesh = state.roads.getObjectByName('roadside-waystones');
			const stats = state.roadsideWaystoneStats;
			const sites = mesh?.userData?.roadsideWaystoneSites ?? [];
			const profileTotal = stats ? Object.values(stats.profiles).reduce((sum, value) => sum + value, 0) : 0;
			const colorKeys = new Set();
			if (mesh?.instanceColor) {
				for (let index = 0; index < mesh.count; index += 1) {
					const offset = index * 3;
					colorKeys.add(`${mesh.instanceColor.array[offset].toFixed(3)}:${mesh.instanceColor.array[offset + 1].toFixed(3)}:${mesh.instanceColor.array[offset + 2].toFixed(3)}`);
				}
			}

			const syntheticEdges = [{
				fromId: 'proof-a', toId: 'proof-b', lengthMeters: 1600,
				points: [{ x: -800, z: 0 }, { x: 800, z: 0 }],
			}];
			const syntheticSampler = (x, z) => 30 + Math.sin(x * 0.001) * 0.3 + Math.cos(z * 0.001) * 0.2;
			const syntheticOptions = {
				roadEdges: syntheticEdges,
				seats: [],
				sampleHeightMeters: syntheticSampler,
				seaLevelMeters: 6,
				seed: 12345,
				isMobileClass: false,
			};
			const planA = planRoadsideWaystoneSites(syntheticOptions);
			const planB = planRoadsideWaystoneSites(syntheticOptions);
			const deterministic = JSON.stringify(planA.sites) === JSON.stringify(planB.sites);
			const proofSite = sites.find((site) => site.profile === 'north') ?? sites[0] ?? null;

			window.__roadsideWaystoneSetView = () => {
				if (!proofSite) return false;
				const daylight = updateDayNightLighting(state.lights, 0, 1200, 0.5);
				const uniforms = state.sky?.material?.uniforms;
				uniforms?.uHorizonColor?.value?.copy?.(daylight.horizonColor);
				uniforms?.uZenithColor?.value?.copy?.(daylight.zenithColor);
				if (uniforms?.uNightFactor) uniforms.uNightFactor.value = daylight.nightFactor;
				if (uniforms?.uTime) uniforms.uTime.value = 0;
				state.camera.position.set(proofSite.x + 12, proofSite.y + 6, proofSite.z + 16);
				state.camera.lookAt(proofSite.x, proofSite.y + 1.25, proofSite.z);
				state.camera.updateMatrixWorld(true);
				state.sky?.position?.copy?.(state.camera.position);
				state.renderer.render(state.scene, state.camera);
				return true;
			};
			window.__roadsideWaystoneDispose = () => {
				let error = null;
				try { disposeRoadNetwork(state.roads); } catch (caught) { error = String(caught?.message || caught); }
				state.renderer.dispose();
				return error;
			};
			return {
				sceneBuildMs,
				isInstancedMesh: Boolean(mesh?.isInstancedMesh),
				meshCount: mesh?.count ?? 0,
				stats,
				profileTotal,
				uniqueTintCount: colorKeys.size,
				geometryType: mesh?.geometry?.type ?? null,
				geometryName: mesh?.geometry?.name ?? null,
				hasTexture: Boolean(mesh?.material?.map?.isTexture),
				textureName: mesh?.material?.map?.name ?? null,
				textureSize: mesh?.material?.map?.image?.width ?? null,
				hasBumpMap: Boolean(mesh?.material?.bumpMap?.isTexture),
				bumpMapName: mesh?.material?.bumpMap?.name ?? null,
				bumpScale: mesh?.material?.bumpScale ?? null,
				roughness: mesh?.material?.roughness ?? null,
				metalness: mesh?.material?.metalness ?? null,
				placementAuthority: mesh?.userData?.placementAuthority ?? null,
				materialGeography: mesh?.userData?.materialGeography ?? null,
				silhouetteProfile: mesh?.userData?.silhouetteProfile ?? null,
				surfaceRelief: mesh?.userData?.surfaceRelief ?? null,
				proofProfile: proofSite?.profile ?? null,
				proofLighting: 'shipped-day-night-system/noon',
				allSitesFinite: sites.every((site) => [site.x, site.y, site.z, site.slopeDegrees, site.groundClearanceMeters].every(Number.isFinite)),
				allSitesDry: sites.every((site) => site.groundClearanceMeters > ROADSIDE_WAYSTONE_POLICY.shoreClearanceMeters),
				allSitesSlopeSafe: sites.every((site) => site.slopeDegrees <= ROADSIDE_WAYSTONE_POLICY.maxSlopeDegrees + 1e-9),
				allSitesShouldered: sites.every((site) => site.shoulderOffsetMeters >= ROADSIDE_WAYSTONE_POLICY.shoulderOffsetMeters - 0.56),
				deterministic,
				syntheticCount: planA.sites.length,
			};
		});

		fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify({ ...report, pageErrors }, null, 2));
		assert(report.sceneBuildMs < 120000, `createScene took ${(report.sceneBuildMs / 1000).toFixed(1)}s`);
		assert(report.isInstancedMesh, 'roadside-waystones is not an InstancedMesh');
		assert(report.meshCount > 8 && report.stats?.placedCount === report.meshCount, 'live sparse route layer/count mismatch');
		assert(report.stats?.candidateCount > report.stats?.placedCount, 'placement gate rejected no candidates');
		assert(report.profileTotal === report.meshCount && (report.stats?.profiles?.temperate ?? 0) > 0, 'geographic profile accounting failed');
		assert(report.uniqueTintCount > 3, `instance material variation too flat (${report.uniqueTintCount})`);
		assert(report.geometryType === 'LatheGeometry' && report.geometryName === 'roadside-waystone-plinth-shaft-cap', 'authored silhouette missing');
		assert(report.hasTexture && report.textureName === 'roadside-waystone-weathered-masonry' && report.textureSize === 96, 'weathered masonry albedo missing');
		assert(report.hasBumpMap && report.bumpMapName === 'roadside-waystone-masonry-relief', 'masonry relief map missing');
		assert(report.bumpScale > 0 && report.bumpScale <= 0.08, `unexpected bump scale ${report.bumpScale}`);
		assert(report.roughness >= 0.9 && report.metalness === 0, 'stone PBR response is not rough/non-metallic');
		assert(report.placementAuthority === 'bridge-aware-road-edges-render-only', 'placement authority metadata missing');
		assert(report.materialGeography.includes('north-frost') && report.materialGeography.includes('valyria-basalt'), 'material geography metadata incomplete');
		assert(report.silhouetteProfile === 'faceted-plinth-shaft-shoulder-pointed-cap', 'silhouette metadata incomplete');
		assert(report.surfaceRelief === 'procedural-masonry-bump', 'surface-relief metadata incomplete');
		assert(report.proofProfile === 'north' && report.proofLighting === 'shipped-day-night-system/noon', 'visual proof must exercise a northern marker under shipped noon lighting');
		assert(report.allSitesFinite && report.allSitesDry && report.allSitesSlopeSafe && report.allSitesShouldered, 'live placement policy violation');
		assert(report.deterministic && report.syntheticCount > 0, 'deterministic planner proof failed');
		assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

		const viewSet = await page.evaluate(() => window.__roadsideWaystoneSetView());
		assert(viewSet, 'could not resolve a live waystone camera target');
		await page.locator('#roadside-waystone-proof-canvas').screenshot({ path: path.join(ARTIFACT_DIR, 'near.png') });
		const disposeError = await page.evaluate(() => window.__roadsideWaystoneDispose());
		assert(disposeError === null, `disposeRoadNetwork failed with waystones attached: ${disposeError}`);
	} finally {
		if (report && !fs.existsSync(path.join(ARTIFACT_DIR, 'proof.json'))) {
			fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify({ ...report, pageErrors }, null, 2));
		}
		await browser.close();
		server.close();
	}
	console.log(
		`[checkRoadsideWaystones] PASS: ${report.meshCount} waystones from ${report.stats.candidateCount} candidates / `
		+ `${report.uniqueTintCount} tints / profiles ${JSON.stringify(report.stats.profiles)} / scene ${(report.sceneBuildMs / 1000).toFixed(1)}s`,
	);
}

main().catch((error) => {
	console.error(error.stack || error);
	process.exit(1);
});
