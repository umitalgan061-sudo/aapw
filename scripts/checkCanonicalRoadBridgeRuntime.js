#!/usr/bin/env node
/** Exact-head shipped-scene proof for live road/water stone bridges. */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'canonical-road-bridge-runtime');
const SCENE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/sceneManager.js'), 'utf8');
const RUNTIME_SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/world/canonicalRoadBridgeRuntime.js'), 'utf8');
const EXPECTED_LIVE_WATER_GAP_EDGES = 5;

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
	assert(RUNTIME_SOURCE.includes("transportGapReason === 'submerged-route'"), 'runtime must only adopt live submerged road gaps');
	assert(RUNTIME_SOURCE.includes('roadWaterAuditSpacingMeters: 6'), 'runtime must mirror the shipped road 6m water audit');
	assert(RUNTIME_SOURCE.includes('sampleLiveRoadWater'), 'runtime lost live route water sampling');
	assert(RUNTIME_SOURCE.includes('coveredWaterSampleCount !== waterSampleCount'), 'partial sampled-water suppression must fail closed');
	assert(!RUNTIME_SOURCE.includes('buildCanonicalStoneBridgePlan'), 'live startup must not recompute the shadow canonical pathfinder plan');
	assert(RUNTIME_SOURCE.includes('canonicalBridgeRuntimeMesh'), 'bridge meshes must be flattened into road lifecycle ownership');
	assert(!RUNTIME_SOURCE.includes('OBJLoader'), 'runtime must not bypass repository loader/licensing policy with an ad-hoc OBJ loader');
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
			const { buildRoadNetwork, disposeRoadNetwork } = await import('/src/3d/world/roads.js');
			const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const canvas = document.createElement('canvas');
			canvas.id = 'canonical-road-bridge-runtime-canvas';
			canvas.style.width = '1440px';
			canvas.style.height = '900px';
			document.body.appendChild(canvas);
			const sceneStartedAt = performance.now();
			const state = createScene(canvas);
			const sceneBuildMs = performance.now() - sceneStartedAt;
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

			// Exact live-water rejection diagnostics; never used to alter production acceptance.
			const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const pads = computeSettlementFlattenPads({ sampleHeightMeters: natural,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
			const terrain = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
			const audit = buildRoadNetwork({ seats: state.settlementSeats, sampleHeightMeters: terrain });
			const gapDiagnostics = audit.unroutableEdges.filter((gap) => gap.diagnostics?.transportGapReason === 'submerged-route').map((gap) => {
				const samples = [];
				for (let i = 1; i < gap.points.length; i += 1) {
					const a = gap.points[i - 1]; const b = gap.points[i]; const len = Math.hypot(b.x - a.x, b.z - a.z);
					const n = Math.max(1, Math.ceil(len / 6));
					for (let j = 1; j <= n; j += 1) { const t = j / n; const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
						samples.push({ x, z, wet: terrain(x, z) + 0.4 < WORLD_DEFAULTS.WATER_LEVEL_METERS }); }
				}
				const runs = []; let run = [];
				for (const sample of samples) { if (sample.wet) run.push(sample); else if (run.length) { runs.push(run); run = []; } }
				if (run.length) runs.push(run);
				const crossingDiagnostics = runs.map((water) => {
					const first = water[0]; const last = water[water.length - 1]; let dx = last.x - first.x; let dz = last.z - first.z; let len = Math.hypot(dx, dz);
					if (len < 0.001) { dx = 1; dz = 0; len = 1; } const ux = dx / len; const uz = dz / len;
					const start = { x: first.x - ux * 6, z: first.z - uz * 6 }; const end = { x: last.x + ux * 6, z: last.z + uz * 6 };
					const span = Math.hypot(end.x - start.x, end.z - start.z); const archSpan = span / Math.max(1, Math.ceil(span / 36));
					const rise = Math.min(8.5, Math.max(3.4, archSpan * 0.22)); const deckTop = Math.max(terrain(start.x, start.z), terrain(end.x, end.z), WORLD_DEFAULTS.WATER_LEVEL_METERS + rise + 0.8) + 1.24;
					const maxLateral = Math.max(...water.map((p) => { const vx = end.x - start.x; const vz = end.z - start.z; const l2 = vx * vx + vz * vz;
						const t = ((p.x - start.x) * vx + (p.z - start.z) * vz) / l2; return Math.hypot(p.x - (start.x + vx * t), p.z - (start.z + vz * t)); }));
					const nearest = (target) => gap.points.reduce((best, p, index) => Math.hypot(p.x - target.x, p.z - target.z) < best.d ? { index, d: Math.hypot(p.x - target.x, p.z - target.z) } : best, { index: 0, d: Infinity }).index;
					let si = nearest(start); let ei = nearest(end); if (si > ei) [si, ei] = [ei, si];
					const bestGrade = (from, to, target) => { let best = Infinity; for (let i = from; i <= to; i += 1) { const p = gap.points[i]; const y = terrain(p.x, p.z) + 0.4;
						const d = Math.hypot(p.x - target.x, p.z - target.z); if (y < WORLD_DEFAULTS.WATER_LEVEL_METERS || d > 320) continue; best = Math.min(best, 180 / Math.PI * Math.atan2(Math.abs(deckTop - y), Math.max(0.001, d))); } return best; };
					return { waterSamples: water.length, spanMeters: span, maxLateralMeters: maxLateral, startBestGrade: bestGrade(0, si, start), endBestGrade: bestGrade(ei, gap.points.length - 1, end) };
				});
				return { edgeId: `${gap.fromId}->${gap.toId}`, routePoints: gap.points.length, crossingCount: runs.length, crossingDiagnostics };
			});

			window.__canonicalBridgeSetView = (mode) => {
				if (!deck || !center) return false;
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
				return true;
			};
			window.__canonicalBridgeDispose = () => {
				let error = null;
				try { disposeRoadNetwork(state.roads); } catch (caught) { error = String(caught?.message || caught); }
				state.renderer.dispose();
				return error;
			};
			return {
				sceneBuildMs, gapDiagnostics,
				status: runtime?.status ?? null,
				bridgeCount: runtime?.bridgeCount ?? 0,
				affectedEdgeCount: runtime?.affectedEdgeCount ?? 0,
				sourceWaterGapCount: runtime?.sourceWaterGapCount ?? 0,
				unrestoredWaterGapCount: runtime?.unrestoredWaterGapCount ?? null,
				remainingGradeFallbackCount: runtime?.remainingGradeFallbackCount ?? null,
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

		// Persist diagnostics before acceptance assertions so a failed exact head still uploads evidence.
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify({ ...report, pageErrors }, null, 2));
		assert(report.sceneBuildMs < 120000, `createScene took ${(report.sceneBuildMs / 1000).toFixed(1)}s; bridge adoption must stay startup-bounded`);
		assert(report.status === 'active-render-topology', `runtime status ${report.status}`);
		assert(report.sourceWaterGapCount === EXPECTED_LIVE_WATER_GAP_EDGES,
			`expected ${EXPECTED_LIVE_WATER_GAP_EDGES} live water-gap edges, got ${report.sourceWaterGapCount}`);
		assert(report.affectedEdgeCount === EXPECTED_LIVE_WATER_GAP_EDGES,
			`restored ${report.affectedEdgeCount}/${EXPECTED_LIVE_WATER_GAP_EDGES} live water-gap edges`);
		assert(report.unrestoredWaterGapCount === 0, `${report.unrestoredWaterGapCount} live water-gap edge(s) remain unrestored`);
		assert(report.remainingGradeFallbackCount === 1,
			`grade-fallback authority changed; expected one untouched fallback, got ${report.remainingGradeFallbackCount}`);
		assert(report.bridgeCount >= report.affectedEdgeCount,
			`bridge count ${report.bridgeCount} cannot cover ${report.affectedEdgeCount} water-gap edges`);
		assert(report.approachCount === report.bridgeCount * 2,
			`expected two approaches per bridge; bridge=${report.bridgeCount} approach=${report.approachCount}`);
		assert(report.maxApproachGradeDegrees <= 18 + 1e-9, `approach grade ${report.maxApproachGradeDegrees} > 18deg`);
		assert(report.maxApproachLengthMeters <= 320 + 1e-9, `approach length ${report.maxApproachLengthMeters} > 320m`);
		assert(report.waterSuppression?.total > 0, 'live road network exposed no sampled water intervals');
		assert(report.waterSuppression.covered === report.waterSuppression.total,
			`sampled-water suppression ${report.waterSuppression.covered}/${report.waterSuppression.total}`);
		assert(report.bridgeMeshCount > 0 && report.allRoadChildrenAreMeshes,
			'road lifecycle must own only direct Mesh children after bridge adoption');
		assert(report.restorationMesh, 'dry-road/approach restoration mesh missing');
		assert(report.bridgeTextureCount > 0, 'stone bridge meshes lost their masonry texture');
		assert(report.deckSurfaceCount === report.bridgeCount && report.approachSurfaceCount === report.approachCount,
			`ground surface count deck=${report.deckSurfaceCount}/${report.bridgeCount} approach=${report.approachSurfaceCount}/${report.approachCount}`);
		assert(Math.abs(report.groundAtDeck - report.deckY) < 0.06,
			`player ground ${report.groundAtDeck} does not follow bridge deck ${report.deckY}`);
		assert(Math.abs(report.outsideGround - report.deckY) > 0.1,
			'bridge ground resolver leaks materially outside the deck width');
		assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

		for (const mode of ['near', 'far']) {
			const viewSet = await page.evaluate((view) => window.__canonicalBridgeSetView(view), mode);
			assert(viewSet, `${mode} bridge camera could not be resolved`);
			await page.locator('#canonical-road-bridge-runtime-canvas').screenshot({
				path: path.join(ARTIFACT_DIR, `${mode}.png`),
			});
		}
		const disposeError = await page.evaluate(() => window.__canonicalBridgeDispose());
		assert(disposeError === null, `disposeRoadNetwork failed after bridge adoption: ${disposeError}`);
	} finally {
		if (report && !fs.existsSync(path.join(ARTIFACT_DIR, 'proof.json'))) {
			fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify({ ...report, pageErrors }, null, 2));
		}
		await browser.close();
		server.close();
	}
	console.log(
		`[checkCanonicalRoadBridgeRuntime] PASS: ${report.bridgeCount} bridge(s) / `
		+ `${report.affectedEdgeCount}/${report.sourceWaterGapCount} water-gap edges / `
		+ `${report.approachCount} approaches / sampled water ${report.waterSuppression.covered}/${report.waterSuppression.total} / `
		+ `scene ${(report.sceneBuildMs / 1000).toFixed(1)}s`,
	);
}

main().catch((error) => {
	console.error(error.stack || error);
	process.exit(1);
});
