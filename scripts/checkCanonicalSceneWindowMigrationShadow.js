#!/usr/bin/env node
/** Run 194: all-bridge ownership + planned 27x21 canonical chunk-grid edge lifecycle proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run194-canonical-window-ownership');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function hash(value) {
	return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const relative = clean === '/' ? 'game3d.html' : clean.replace(/^\//, '');
			const file = path.join(ROOT, relative);
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function cleanDispose(snapshot) {
	return snapshot && snapshot.disposed === true
		&& snapshot.rootChildren === 0
		&& snapshot.terrainChildren === 0
		&& snapshot.bridgeChildren === 0
		&& snapshot.rockChildren === 0;
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	let initial;
	let bridges;
	let finish;
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		initial = await page.evaluate(async () => {
			const THREE = await import('three');
			const { STONE_BRIDGE_OWNER_POLICY } = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');
			const {
				CANONICAL_SCENE_SHADOW_POLICY,
				updateCanonicalSceneShadowWindow,
			} = await import('/src/3d/world/worldReferenceSceneShadowAdapter.js');
			const {
				CANONICAL_SCENE_WINDOW_MIGRATION_POLICY,
				buildCanonicalSceneChunkOwnershipGrid,
				buildCanonicalSceneGridEdgeCoverage,
				createCanonicalSceneWindowMigrationHarness,
			} = await import('/src/3d/world/worldReferenceSceneWindowMigrationShadow.js');

			const grid = buildCanonicalSceneChunkOwnershipGrid();
			if (grid.columns !== 27 || grid.rows !== 21 || grid.cellCount !== 567) throw new Error(`planned grid drifted ${grid.columns}x${grid.rows}/${grid.cellCount}`);
			if (grid.minChunkX !== -13 || grid.maxChunkX !== 13 || grid.minChunkZ !== -10 || grid.maxChunkZ !== 10) throw new Error('centered canonical grid limits drifted');
			if (grid.edgeOverhangXMeters < 0 || grid.edgeOverhangXMeters > grid.chunkSizeMeters * 0.5) throw new Error(`X edge overhang invalid ${grid.edgeOverhangXMeters}`);
			if (grid.edgeOverhangZMeters < 0 || grid.edgeOverhangZMeters > grid.chunkSizeMeters * 0.5) throw new Error(`Z edge overhang invalid ${grid.edgeOverhangZMeters}`);

			const edgeCoverage = buildCanonicalSceneGridEdgeCoverage('mobile');
			const radius = CANONICAL_SCENE_SHADOW_POLICY.profiles.mobile.terrainChunkRadius;
			const expectedResident = (radius * 2 + 1) ** 2;
			const expectedFull = (grid.columns - radius * 2) * (grid.rows - radius * 2);
			const expectedEdgeOwners = grid.columns * 2 + (grid.rows - 2) * 2;
			if (edgeCoverage.visitedOwnerCellCount !== 567 || edgeCoverage.coveredCanonicalCellCount !== 567) throw new Error('567-cell ownership coverage incomplete');
			if (edgeCoverage.minCanonicalResidentCount !== 9 || edgeCoverage.maxCanonicalResidentCount !== expectedResident) throw new Error(`edge resident bounds drifted ${edgeCoverage.minCanonicalResidentCount}-${edgeCoverage.maxCanonicalResidentCount}`);
			if (edgeCoverage.maxPaddingResidentCount !== 16) throw new Error(`edge padding bound drifted ${edgeCoverage.maxPaddingResidentCount}`);
			if (edgeCoverage.fullCanonicalWindowCount !== expectedFull) throw new Error(`full-window count drifted ${edgeCoverage.fullCanonicalWindowCount}/${expectedFull}`);
			if (edgeCoverage.edgeOwnerCellCount !== expectedEdgeOwners) throw new Error(`edge-owner count drifted ${edgeCoverage.edgeOwnerCellCount}/${expectedEdgeOwners}`);

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9aacb8);
			const hemisphere = new THREE.HemisphereLight(0xeaf2ff, 0x4b513e, 1.7);
			const sun = new THREE.DirectionalLight(0xffe2b6, 2.1);
			scene.add(hemisphere, sun);
			const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1440, 900, false);
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.style.overflow = 'hidden';
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(58, 1440 / 900, 0.5, 3200);
			const harness = createCanonicalSceneWindowMigrationHarness({ scene, profile: 'mobile' });
			if (harness.targets.length !== 7 || harness.plan.bridgePlan.totalArchCount !== 177) throw new Error('Run191 bridge topology drifted');
			if (harness.plan.totalWaterRoutePoints !== 399 || harness.plan.coveredWaterRoutePoints !== 399) throw new Error('Run192 suppression drifted');

			const cornerAnchor = { x: grid.worldWidthMeters * 0.5, z: grid.worldDepthMeters * 0.5 };
			const corner = harness.replace({ anchor: cornerAnchor });
			if (corner.generation !== 1 || corner.previousDisposed !== null) throw new Error('first generation lifecycle drifted');
			if (!corner.ownership.actualMatchesPredicted) throw new Error('edge terrain coordinates disagree with ownership prediction');
			if (corner.ownership.canonicalResidentCount !== 9 || corner.ownership.paddingResidentCount !== 16) throw new Error(`corner ownership drifted ${corner.ownership.canonicalResidentCount}/${corner.ownership.paddingResidentCount}`);
			if (!corner.ownership.ownerResident || corner.ownership.ownerChunk.clamped) throw new Error('corner owner chunk not resident/unique');
			const sceneWindowCount = () => scene.children.filter((child) => child.name.startsWith('run193-canonical-scene-window-')).length;
			if (sceneWindowCount() !== 1) throw new Error('shadow scene does not have exactly one active window');

			const cornerY = corner.windowState.plan.context.sampler(cornerAnchor.x, cornerAnchor.z);
			camera.position.set(cornerAnchor.x - 680, cornerY + 460, cornerAnchor.z - 680);
			camera.lookAt(cornerAnchor.x, cornerY, cornerAnchor.z);
			camera.updateMatrixWorld(true);
			sun.position.set(cornerAnchor.x - 200, cornerY + 800, cornerAnchor.z - 240);
			updateCanonicalSceneShadowWindow(corner.windowState, camera.position, 5);
			renderer.render(scene, camera);
			const edgeRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
			if (edgeRender.calls >= 500 || edgeRender.triangles >= 500000) throw new Error(`edge mobile budget exceeded ${JSON.stringify(edgeRender)}`);

			window.__run194 = { THREE, STONE_BRIDGE_OWNER_POLICY, updateCanonicalSceneShadowWindow, scene, renderer, camera, sun, harness, sceneWindowCount };
			window.__run194BridgeSequence = () => {
				const state = window.__run194;
				const targets = state.harness.targets.slice().sort((a, b) => a.bridgeId.localeCompare(b.bridgeId));
				const bridgeOwnership = [];
				let minDeckClearanceMeters = Infinity;
				for (const target of targets) {
					const entry = state.harness.replaceAtBridge(target.bridgeId);
					if (!entry.previousDisposed || !entry.previousDisposed.disposed || entry.previousDisposed.rootChildren !== 0 || entry.previousDisposed.terrainChildren !== 0 || entry.previousDisposed.bridgeChildren !== 0 || entry.previousDisposed.rockChildren !== 0) throw new Error(`${target.bridgeId}: previous window did not dispose cleanly`);
					if (state.sceneWindowCount() !== 1) throw new Error(`${target.bridgeId}: multiple active shadow windows`);
					if (!entry.ownership.actualMatchesPredicted || !entry.ownership.ownerResident) throw new Error(`${target.bridgeId}: terrain ownership mismatch`);
					if (!entry.summary.selectedBridgeIds.includes(target.bridgeId)) throw new Error(`${target.bridgeId}: target bridge not resident`);
					if (!entry.ownership.actualCanonicalCoords.some((coord) => coord.x === target.ownerChunk.x && coord.z === target.ownerChunk.z)) throw new Error(`${target.bridgeId}: owner chunk not canonical-resident`);
					const bridge = entry.windowState.selectedBridges.find((candidate) => candidate.id === target.bridgeId);
					if (!bridge) throw new Error(`${target.bridgeId}: selected bridge object missing`);
					const deckTop = bridge.deckY + state.STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
					const resolved = entry.windowState.groundCollider.getGroundHeight(bridge.centerX, bridge.centerZ);
					if (Math.abs(resolved - deckTop) > 1e-6) throw new Error(`${target.bridgeId}: collider did not resolve deck top`);
					const clearance = resolved - entry.windowState.plan.context.sampler(bridge.centerX, bridge.centerZ);
					if (!(clearance > 0.1)) throw new Error(`${target.bridgeId}: deck clearance ${clearance}`);
					minDeckClearanceMeters = Math.min(minDeckClearanceMeters, clearance);
					bridgeOwnership.push({
						bridgeId: target.bridgeId,
						edgeId: target.edgeId,
						generation: entry.generation,
						ownerChunk: { x: target.ownerChunk.x, z: target.ownerChunk.z },
						canonicalResidentCount: entry.ownership.canonicalResidentCount,
						paddingResidentCount: entry.ownership.paddingResidentCount,
						selectedBridgeIds: [...entry.summary.selectedBridgeIds].sort(),
						deckClearanceMeters: Math.round(clearance * 1000) / 1000,
					});
				}
				const active = state.harness.getActive();
				const bridge = active.windowState.selectedBridges.find((candidate) => candidate.id === active.targetBridgeId);
				const y = active.windowState.groundCollider.getGroundHeight(bridge.centerX, bridge.centerZ);
				state.camera.position.set(bridge.centerX + 360, y + 230, bridge.centerZ + 360);
				state.camera.lookAt(bridge.centerX, y, bridge.centerZ);
				state.camera.updateMatrixWorld(true);
				state.sun.position.set(bridge.centerX + 180, y + 700, bridge.centerZ - 220);
				state.updateCanonicalSceneShadowWindow(active.windowState, state.camera.position, 12);
				state.renderer.render(state.scene, state.camera);
				const bridgeRender = { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles };
				if (bridgeRender.calls >= 500 || bridgeRender.triangles >= 500000) throw new Error(`bridge mobile budget exceeded ${JSON.stringify(bridgeRender)}`);
				return {
					bridgeOwnership,
					bridgeRender,
					minDeckClearanceMeters: Math.round(minDeckClearanceMeters * 1000) / 1000,
					activeGeneration: active.generation,
					activeTargetBridgeId: active.targetBridgeId,
				};
			};
			window.__run194Finish = () => {
				const state = window.__run194;
				const finalDisposed = state.harness.dispose();
				const history = state.harness.getHistory();
				const remainingWindowRoots = state.sceneWindowCount();
				state.renderer.dispose();
				state.renderer.domElement.remove();
				return {
					finalDisposed,
					history,
					remainingWindowRoots,
					canvasCount: document.querySelectorAll('canvas').length,
				};
			};

			return {
				policy: CANONICAL_SCENE_WINDOW_MIGRATION_POLICY.key,
				grid: {
					columns: grid.columns,
					rows: grid.rows,
					cellCount: grid.cellCount,
					minChunkX: grid.minChunkX,
					maxChunkX: grid.maxChunkX,
					minChunkZ: grid.minChunkZ,
					maxChunkZ: grid.maxChunkZ,
					edgeOverhangXMeters: Math.round(grid.edgeOverhangXMeters * 1000) / 1000,
					edgeOverhangZMeters: Math.round(grid.edgeOverhangZMeters * 1000) / 1000,
				},
				edgeCoverage,
				cornerOwnership: {
					ownerChunk: corner.ownership.ownerChunk,
					canonicalResidentCount: corner.ownership.canonicalResidentCount,
					paddingResidentCount: corner.ownership.paddingResidentCount,
				},
				edgeRender,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'grid-edge-window.png') });
		bridges = await page.evaluate(() => window.__run194BridgeSequence());
		await page.screenshot({ path: path.join(OUT, 'bridge-ownership-window.png') });
		finish = await page.evaluate(() => window.__run194Finish());
		assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}

	assert(initial.grid.cellCount === 567, 'planned grid cell count failed');
	assert(initial.edgeCoverage.visitedOwnerCellCount === 567 && initial.edgeCoverage.coveredCanonicalCellCount === 567, 'full grid ownership coverage failed');
	assert(initial.cornerOwnership.canonicalResidentCount === 9 && initial.cornerOwnership.paddingResidentCount === 16, 'corner padding classification failed');
	assert(initial.edgeRender.calls < 500 && initial.edgeRender.triangles < 500000, 'edge render budget failed');
	assert(bridges.bridgeOwnership.length === 7, 'all seven bridges were not visited');
	assert(new Set(bridges.bridgeOwnership.map((entry) => entry.bridgeId)).size === 7, 'bridge ownership targets duplicated');
	assert(bridges.activeGeneration === 8, `replacement generation drifted ${bridges.activeGeneration}`);
	assert(bridges.bridgeRender.calls < 500 && bridges.bridgeRender.triangles < 500000, 'bridge render budget failed');
	assert(finish.history.length === 8, `dispose history drifted ${finish.history.length}`);
	assert(finish.history.every(cleanDispose), `one or more replacement windows leaked: ${JSON.stringify(finish.history)}`);
	assert(cleanDispose(finish.finalDisposed), 'final active window did not dispose cleanly');
	assert(finish.remainingWindowRoots === 0, `shadow scene retained ${finish.remainingWindowRoots} window root(s)`);
	assert(finish.canvasCount === 0, `renderer canvas leaked: ${finish.canvasCount}`);
	assert(fs.statSync(path.join(OUT, 'grid-edge-window.png')).size > 0, 'grid edge screenshot missing');
	assert(fs.statSync(path.join(OUT, 'bridge-ownership-window.png')).size > 0, 'bridge ownership screenshot missing');

	const deterministic = {
		policy: initial.policy,
		grid: initial.grid,
		edgeCoverage: initial.edgeCoverage,
		cornerOwnership: initial.cornerOwnership,
		bridgeOwnership: bridges.bridgeOwnership,
		minDeckClearanceMeters: bridges.minDeckClearanceMeters,
		generations: bridges.activeGeneration,
		disposeCount: finish.history.length,
	};
	const proof = {
		version: 'run194-canonical-window-ownership-v1',
		checksum: hash(deterministic),
		deterministic,
		edgeRender: initial.edgeRender,
		bridgeRender: bridges.bridgeRender,
		finalTargetBridgeId: bridges.activeTargetBridgeId,
		dispose: {
			history: finish.history,
			remainingWindowRoots: finish.remainingWindowRoots,
			canvasCount: finish.canvasCount,
		},
	};
	fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
	console.log(`[checkCanonicalSceneWindowMigrationShadow] BUDGET: ${JSON.stringify({ edge: initial.edgeRender, bridge: bridges.bridgeRender })}`);
	console.log(`[checkCanonicalSceneWindowMigrationShadow] PASS: grid=${initial.grid.columns}x${initial.grid.rows}/${initial.grid.cellCount}; edgeOwners=${initial.edgeCoverage.edgeOwnerCellCount}; canonicalResident=${initial.edgeCoverage.minCanonicalResidentCount}-${initial.edgeCoverage.maxCanonicalResidentCount}; maxPadding=${initial.edgeCoverage.maxPaddingResidentCount}; bridges=${bridges.bridgeOwnership.length}/7; generations=${bridges.activeGeneration}; minDeckClearance=${bridges.minDeckClearanceMeters}m; checksum=${proof.checksum}`);
}

main().catch((error) => {
	console.error('[checkCanonicalSceneWindowMigrationShadow] FAIL:', error && error.stack ? error.stack : error);
	process.exit(1);
});
