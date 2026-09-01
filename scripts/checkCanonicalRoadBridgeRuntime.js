#!/usr/bin/env node
/** Exact-head shipped-scene proof for canonical road/water stone bridges. */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'canonical-road-bridge-runtime');
const SCENE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/sceneManager.js'), 'utf8');
const RUNTIME_SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/world/canonicalRoadBridgeRuntime.js'), 'utf8');

function assert(condition, message) {
	if (!condition) throw new Error(`[checkCanonicalRoadBridgeRuntime] ${message}`);
}

function assertSourceOrdering() {
	const adoption = SCENE_SOURCE.indexOf('installCanonicalRoadBridgeRuntime(roadsResult');
	const geology = SCENE_SOURCE.indexOf('const naturalGeologyResult = createNaturalGeology');
	const vegetation = SCENE_SOURCE.indexOf('const vegetationResult = createVegetation');
	const villages = SCENE_SOURCE.indexOf('const villagesResult = createVillages');
	const groundResolver = SCENE_SOURCE.indexOf('createCanonicalRoadBridgeGroundHeightResolver(');
	assert(adoption >= 0, 'sceneManager does not install the canonical bridge runtime');
	assert(geology > adoption && vegetation > adoption && villages > adoption,
		'bridge-restored road edges must exist before geology/vegetation/village placement consumes roadEdges');
	assert(groundResolver > villages,
		'bridge traversal height must be installed only after geography/biome placement has used canonical terrain');
	assert(RUNTIME_SOURCE.includes("transportGapReason !== 'submerged-route'"), 'runtime must only adopt submerged road gaps');
	assert(RUNTIME_SOURCE.includes('coveredWaterPointCount !== waterPointCount'), 'partial water suppression must fail closed');
	assert(RUNTIME_SOURCE.includes('canonicalBridgeRuntimeMesh'), 'bridge meshes must be flattened into road lifecycle ownership');
	assert(!RUNTIME_SOURCE.includes('OBJLoader'), 'runtime must not bypass the repository loader/licensing gap with an ad-hoc OBJ loader');
}

async function main() {
	assertSourceOrdering();
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalRoadBridgeRuntime] SKIP: Playwright is not available.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	let report;
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/scripts/geographicMaterialHarness.html`, {
			waitUntil: 'domcontentloaded', timeout: 30000,
		});
		report = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { disposeRoadNetwork } = await import('/src/3d/world/roads.js');
			const canvas = document.createElement('canvas');
			canvas.id = 'canonical-road-bridge-runtime-canvas';
			canvas.style.width = '1440px';
			canvas.style.height = '900px';
			document.body.appendChild(canvas);
			const state = createScene(canvas);
			state.renderer.setSize(1440, 900, false);
			state.camera.aspect = 1440 / 900;
			state.camera.updateProjectionMatrix();
			const runtime = state.bridgeRuntime;
			const bridgeMeshes = state.roads.children.filter((child) => child.userData?.canonicalBridgeRuntimeMesh);
			const restorationMesh = state.roads.getObjectByName('canonical-bridge-road-restoration');
			const decks = runtime?.groundSurfaces?.filter((surface) => surface.kind === 'deck') ?? [];
			const approaches = runtime?.groundSurfaces?.filter((surface) => surface.kind === 'approach') ?? [];
			const deck = decks[0];
			const center = deck ? {
				x: (deck.from.x + deck.to.x) * 0.5,
				y: (deck.from.y + deck.to.y) * 0.5,
				z: (deck.from.z + deck.to.z) * 0.5,
			} : null;
			let groundAtDeck = null;
			let outsideGround = null;
			if (deck && center) {
				groundAtDeck = state.groundCollider.getGroundHeight(center.x, center.z);
				const dx = deck.to.x - deck.from.x;
				const dz = deck.to.z - deck.from.z;
				const len = Math.hypot(dx, dz) || 1;
				const sideOffset = deck.widthMeters * 0.9;
				outsideGround = state.groundCollider.getGroundHeight(
					center.x - (dz / len) * sideOffset,
					center.z + (dx / len) * sideOffset,
				);
			}

			window.__canonicalBridgeShoot = (mode) => {
				if (!deck || !center) return null;
				const dx = deck.to.x - deck.from.x;
				const dz = deck.to.z - deck.from.z;
				const len = Math.hypot(dx, dz) || 1;
				const px = -dz / len;
				const pz = dx / len;
				if (mode === 'near') {
					state.camera.position.set(center.x + px * 72 - (dx / len) * 42, center.y + 28, center.z + pz * 72 - (dz / len) * 42);
				} else {
					state.camera.position.set(center.x + px * 360 - (dx / len) * 210, center.y + 190, center.z + pz * 360 - (dz / len) * 210);
				}
				state.camera.lookAt(center.x, center.y + 1.5, center.z);
				state.camera.updateMatrixWorld(true);
				state.renderer.render(state.scene, state.camera);
				return canvas.toDataURL('image/png');
			};
			window.__canonicalBridgeDispose = () => {
				let error = null;
				try { disposeRoadNetwork(state.roads); } catch (caught) { error = String(caught?.message || caught); }
				state.renderer.dispose();
				return error;
			};
			return {
				status: runtime?.status ?? null,
				bridgeCount: runtime?.bridgeCount ?? 0,
				affectedEdgeCount: runtime?.affectedEdgeCount ?? 0,
				approachCount: runtime?.approachCount ?? 0,
				maxApproachGradeDegrees: runtime?.maxApproachGradeDegrees ?? null,
				maxApproachLengthMeters: runtime?.maxApproachLengthMeters ?? null,
				waterSuppression: runtime?.waterSuppression ?? null,
				bridgeMeshCount: bridgeMeshes.length,
				allRoadChildrenAreMeshes: state.roads.children.every((child) => child.isMesh),
				restorationMesh: Boolean(restorationMesh?.isMesh),
				bridgeTextureCount: bridgeMeshes.filter((mesh) => mesh.material?.map?.isTexture).length,
				deckSurfaceCount: decks.length,
				approachSurfaceCount: approaches.length,
				groundAtDeck,
				deckY: center?.y ?? null,
				outsideGround,
			};
		});

		assert(report.status === 'active-render-topology', `runtime status ${report.status}`);
		assert(report.bridgeCount === 7, `expected 7 canonical bridges, got ${report.bridgeCount}`);
		assert(report.affectedEdgeCount === 6, `expected 6 restored road edges, got ${report.affectedEdgeCount}`);
		assert(report.approachCount === 14, `expected 14 bounded approaches, got ${report.approachCount}`);
		assert(report.maxApproachGradeDegrees <= 18 + 1e-9, `approach grade ${report.maxApproachGradeDegrees} > 18deg`);
		assert(report.maxApproachLengthMeters <= 320 + 1e-9, `approach length ${report.maxApproachLengthMeters} > 320m`);
		assert(report.waterSuppression?.total > 0, 'live road network exposed no water-route samples');
		assert(report.waterSuppression.covered === report.waterSuppression.total,
			`water suppression ${report.waterSuppression.covered}/${report.waterSuppression.total}`);
		assert(report.bridgeMeshCount > 0 && report.allRoadChildrenAreMeshes,
			'road lifecycle must own only direct Mesh children after bridge adoption');
		assert(report.restorationMesh, 'dry-road/approach restoration mesh missing');
		assert(report.bridgeTextureCount > 0, 'stone bridge meshes lost their masonry texture');
		assert(report.deckSurfaceCount === 7 && report.approachSurfaceCount === 14,
			`ground surface count deck=${report.deckSurfaceCount} approach=${report.approachSurfaceCount}`);
		assert(Math.abs(report.groundAtDeck - report.deckY) < 0.06,
			`player ground ${report.groundAtDeck} does not follow bridge deck ${report.deckY}`);
		assert(Math.abs(report.outsideGround - report.deckY) > 0.1,
			'bridge ground resolver leaks materially outside the deck width');
		assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

		for (const mode of ['near', 'far']) {
			const dataUrl = await page.evaluate((view) => window.__canonicalBridgeShoot(view), mode);
			assert(dataUrl?.startsWith('data:image/png;base64,'), `${mode} screenshot missing`);
			fs.writeFileSync(path.join(ARTIFACT_DIR, `${mode}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
		}
		const disposeError = await page.evaluate(() => window.__canonicalBridgeDispose());
		assert(disposeError === null, `disposeRoadNetwork failed after bridge adoption: ${disposeError}`);
	} finally {
		await browser.close();
		server.close();
	}
	fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify(report, null, 2));
	console.log(`[checkCanonicalRoadBridgeRuntime] PASS: ${report.bridgeCount} bridges / ${report.affectedEdgeCount} edges / ${report.approachCount} approaches / water ${report.waterSuppression.covered}/${report.waterSuppression.total}`);
}

main().catch((error) => {
	console.error(error.stack || error);
	process.exit(1);
});
