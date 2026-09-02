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
	assert(WAYSTONE_SOURCE.includes('THREE.DataTexture'), 'waystones must ship a real generated stone texture');
	assert(WAYSTONE_SOURCE.includes('THREE.InstancedMesh'), 'waystones must stay one batched asset layer');
	assert(WAYSTONE_SOURCE.includes('shoreClearanceMeters'), 'waystones must reject wet/shoreline placement');
	assert(WAYSTONE_SOURCE.includes('maxSlopeDegrees'), 'waystones must enforce terrain slope placement');
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

			const firstSite = sites[0] ?? null;
			window.__roadsideWaystoneSetView = () => {
				if (!firstSite) return false;
				state.camera.position.set(firstSite.x + 34, firstSite.y + 15, firstSite.z + 42);
				state.camera.lookAt(firstSite.x, firstSite.y + 1.3, firstSite.z);
				state.camera.updateMatrixWorld(true);
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
				hasTexture: Boolean(mesh?.material?.map?.isTexture),
				textureName: mesh?.material?.map?.name ?? null,
				textureSize: mesh?.material?.map?.image?.width ?? null,
				roughness: mesh?.material?.roughness ?? null,
				metalness: mesh?.material?.metalness ?? null,
				placementAuthority: mesh?.userData?.placementAuthority ?? null,
				materialGeography: mesh?.userData?.materialGeography ?? null,
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
		assert(report.meshCount > 8, `expected a meaningful sparse route layer, got ${report.meshCount} waystones`);
		assert(report.stats?.placedCount === report.meshCount, 'stats/mesh instance count mismatch');
		assert(report.stats?.candidateCount > report.stats?.placedCount, 'placement gate rejected no candidates');
		assert(report.profileTotal === report.meshCount, 'geographic profile counts do not sum to placed count');
		assert((report.stats?.profiles?.temperate ?? 0) > 0, 'no temperate waystone profile was placed');
		assert(report.uniqueTintCount > 3, `instance material variation too flat (${report.uniqueTintCount} unique tints)`);
		assert(report.hasTexture && report.textureName === 'roadside-waystone-weathered-masonry', 'weathered masonry texture missing');
		assert(report.textureSize === 96, `expected 96px generated masonry texture, got ${report.textureSize}`);
		assert(report.roughness >= 0.9 && report.metalness === 0, 'stone PBR response is not rough/non-metallic');
		assert(report.placementAuthority === 'bridge-aware-road-edges-render-only', 'placement authority metadata missing');
		assert(report.materialGeography.includes('north-frost') && report.materialGeography.includes('valyria-basalt'), 'geographic material metadata incomplete');
		assert(report.allSitesFinite && report.allSitesDry && report.allSitesSlopeSafe && report.allSitesShouldered,
			'one or more live waystones violate finite/dry/slope/shoulder policy');
		assert(report.deterministic && report.syntheticCount > 0, 'deterministic site planner proof failed');
		assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

		const viewSet = await page.evaluate(() => window.__roadsideWaystoneSetView());
		assert(viewSet, 'could not resolve a live waystone camera target');
		await page.locator('#roadside-waystone-proof-canvas').screenshot({
			path: path.join(ARTIFACT_DIR, 'near.png'),
		});
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
		+ `${report.uniqueTintCount} material tints / profiles ${JSON.stringify(report.stats.profiles)} / `
		+ `scene ${(report.sceneBuildMs / 1000).toFixed(1)}s`,
	);
}

main().catch((error) => {
	console.error(error.stack || error);
	process.exit(1);
});
