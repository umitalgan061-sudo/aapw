#!/usr/bin/env node
/** Run 194 V2: exact-reference clipped 27x21 ownership + all-bridge replacement browser proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run194-canonical-clipped-window-ownership');
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
		&& snapshot.bridgeChildren === 0;
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
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		initial = await page.evaluate(async () => {
			const THREE = await import('three');
			const { STONE_BRIDGE_OWNER_POLICY } = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');
			const {
				buildClippedCanonicalOwnershipGrid,
				auditClippedCanonicalOwnershipGrid,
				buildClippedCanonicalWindowFootprints,
				createClippedCanonicalWindowOwnershipHarness,
				updateClippedCanonicalBridgeOwnershipWindow,
			} = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');

			const grid = buildClippedCanonicalOwnershipGrid();
			const audit = auditClippedCanonicalOwnershipGrid(grid);
			if (grid.columns !== 27 || grid.rows !== 21 || grid.cellCount !== 567) throw new Error(`planned grid drifted ${grid.columns}x${grid.rows}/${grid.cellCount}`);
			if (grid.minChunkX !== -13 || grid.maxChunkX !== 13 || grid.minChunkZ !== -10 || grid.maxChunkZ !== 10) throw new Error('centered grid coordinate limits drifted');
			if (audit.fullCellCount !== 475 || audit.clippedCellCount !== 92) throw new Error(`full/clipped owner count drifted ${audit.fullCellCount}/${audit.clippedCellCount}`);
			if (audit.areaErrorM2 > 1e-5) throw new Error(`clipped owner area mismatch ${audit.areaErrorM2}m2`);
			if (audit.maxSeamErrorMeters > 1e-9) throw new Error(`grid seam mismatch ${audit.maxSeamErrorMeters}m`);
			if (!(audit.minWidthMeters > 0 && audit.minWidthMeters < 500)) throw new Error(`X edge width invalid ${audit.minWidthMeters}`);
			if (!(audit.minDepthMeters > 0 && audit.minDepthMeters < 500)) throw new Error(`Z edge depth invalid ${audit.minDepthMeters}`);
			if (Math.abs(grid.targetAreaM2 / 1_000_000 - 137.5) > 1e-9) throw new Error(`target area drifted ${grid.targetAreaM2}`);

			const cornerAnchor = { x: grid.worldMaxX, z: grid.worldMaxZ };
			const cornerFootprints = buildClippedCanonicalWindowFootprints(cornerAnchor, 'mobile', grid);
			if (cornerFootprints.owner.x !== 13 || cornerFootprints.owner.z !== 10) throw new Error('exact corner owner drifted');
			if (cornerFootprints.residentCount !== 9 || cornerFootprints.clippedResidentCount !== 5) throw new Error(`corner clipped window drifted ${cornerFootprints.residentCount}/${cornerFootprints.clippedResidentCount}`);
			for (const cell of cornerFootprints.cells) {
				if (cell.minX < grid.worldMinX - 1e-9 || cell.maxX > grid.worldMaxX + 1e-9 || cell.minZ < grid.worldMinZ - 1e-9 || cell.maxZ > grid.worldMaxZ + 1e-9) throw new Error(`${cell.key}: footprint escaped exact reference bounds`);
			}

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x99abb7);
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
			const camera = new THREE.PerspectiveCamera(58, 1440 / 900, 0.5, 3600);
			const harness = createClippedCanonicalWindowOwnershipHarness({ scene, profile: 'mobile' });
			if (harness.targets.length !== 7 || harness.plan.bridgePlan.totalArchCount !== 177) throw new Error('Run191 bridge topology drifted');
			if (harness.plan.totalWaterRoutePoints !== 399 || harness.plan.coveredWaterRoutePoints !== 399) throw new Error('Run192 water suppression drifted');

			const edge = harness.replace({ anchor: cornerAnchor });
			if (edge.generation !== 1 || edge.previousDisposed !== null) throw new Error('edge generation lifecycle drifted');
			if (edge.summary.terrainChunkCount !== 9 || edge.summary.clippedTerrainChunkCount !== 5) throw new Error('real clipped edge terrain did not match pure footprint plan');
			const sceneWindowCount = () => scene.children.filter((child) => child.name.startsWith('run194-clipped-bridge-ownership-window-')).length;
			if (sceneWindowCount() !== 1) throw new Error('edge proof does not have exactly one active window root');
			for (const mesh of edge.windowState.terrainGroup.children) {
				const owner = mesh.userData.clippedCanonicalOwner;
				if (!owner || !(owner.widthMeters > 0) || !(owner.depthMeters > 0)) throw new Error(`${mesh.name}: clipped owner metadata missing`);
			}

			const edgeGround = edge.windowState.plan.context.sampler(grid.worldMaxX, grid.worldMaxZ);
			camera.position.set(grid.worldMaxX - 760, edgeGround + 520, grid.worldMaxZ - 760);
			camera.lookAt(grid.worldMaxX - 180, edgeGround, grid.worldMaxZ - 180);
			camera.updateMatrixWorld(true);
			sun.position.set(grid.worldMaxX - 260, edgeGround + 820, grid.worldMaxZ - 300);
			updateClippedCanonicalBridgeOwnershipWindow(edge.windowState, camera.position, 4.5);
			renderer.render(scene, camera);
			const edgeRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
			if (edgeRender.calls >= 500 || edgeRender.triangles >= 500000) throw new Error(`edge render budget exceeded ${JSON.stringify(edgeRender)}`);

			window.__run194v2 = { THREE, STONE_BRIDGE_OWNER_POLICY, grid, scene, renderer, camera, sun, harness, sceneWindowCount, updateClippedCanonicalBridgeOwnershipWindow };
			window.__run194v2BridgeSequence = () => {
				const state = window.__run194v2;
				const targets = state.harness.targets.slice().sort((a, b) => {
					const edgeDistanceA = Math.min(a.centerX - state.grid.worldMinX, state.grid.worldMaxX - a.centerX, a.centerZ - state.grid.worldMinZ, state.grid.worldMaxZ - a.centerZ);
					const edgeDistanceB = Math.min(b.centerX - state.grid.worldMinX, state.grid.worldMaxX - b.centerX, b.centerZ - state.grid.worldMinZ, state.grid.worldMaxZ - b.centerZ);
					return edgeDistanceB - edgeDistanceA || a.bridgeId.localeCompare(b.bridgeId);
				});
				const ownership = [];
				let minDeckClearanceMeters = Infinity;
				let maxRenderCalls = 0;
				let maxRenderTriangles = 0;
				for (const target of targets) {
					const entry = state.harness.replaceAtBridge(target.bridgeId);
					if (!entry.previousDisposed || !entry.previousDisposed.disposed || entry.previousDisposed.rootChildren !== 0 || entry.previousDisposed.terrainChildren !== 0 || entry.previousDisposed.bridgeChildren !== 0) throw new Error(`${target.bridgeId}: previous window did not dispose cleanly`);
					if (state.sceneWindowCount() !== 1) throw new Error(`${target.bridgeId}: more than one ownership window active`);
					if (!entry.summary.selectedBridgeIds.includes(target.bridgeId)) throw new Error(`${target.bridgeId}: target bridge not resident`);
					if (entry.summary.ownerChunk.x !== target.owner.x || entry.summary.ownerChunk.z !== target.owner.z) throw new Error(`${target.bridgeId}: owner chunk mismatch`);
					const bridge = entry.windowState.selectedBridges.find((candidate) => candidate.id === target.bridgeId);
					if (!bridge) throw new Error(`${target.bridgeId}: selected bridge object missing`);
					const deckTop = bridge.deckY + state.STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
					const resolved = entry.windowState.groundCollider.getGroundHeight(bridge.centerX, bridge.centerZ);
					if (Math.abs(resolved - deckTop) > 1e-6) throw new Error(`${target.bridgeId}: collider did not resolve deck top`);
					const clearance = resolved - entry.windowState.plan.context.sampler(bridge.centerX, bridge.centerZ);
					if (!(clearance > 0.1)) throw new Error(`${target.bridgeId}: deck clearance ${clearance}`);
					minDeckClearanceMeters = Math.min(minDeckClearanceMeters, clearance);
					state.camera.position.set(bridge.centerX + 360, resolved + 230, bridge.centerZ + 360);
					state.camera.lookAt(bridge.centerX, resolved, bridge.centerZ);
					state.camera.updateMatrixWorld(true);
					state.sun.position.set(bridge.centerX + 180, resolved + 700, bridge.centerZ - 220);
					state.updateClippedCanonicalBridgeOwnershipWindow(entry.windowState, state.camera.position, 8 + entry.generation);
					state.renderer.render(state.scene, state.camera);
					const render = { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles };
					if (render.calls >= 500 || render.triangles >= 500000) throw new Error(`${target.bridgeId}: render budget exceeded ${JSON.stringify(render)}`);
					maxRenderCalls = Math.max(maxRenderCalls, render.calls);
					maxRenderTriangles = Math.max(maxRenderTriangles, render.triangles);
					ownership.push({
						bridgeId: target.bridgeId,
						edgeId: target.edgeId,
						generation: entry.generation,
						ownerChunk: { x: target.owner.x, z: target.owner.z },
						terrainChunkCount: entry.summary.terrainChunkCount,
						clippedTerrainChunkCount: entry.summary.clippedTerrainChunkCount,
						selectedBridgeIds: [...entry.summary.selectedBridgeIds].sort(),
						deckClearanceMeters: Math.round(clearance * 1000) / 1000,
						render,
					});
				}
				const active = state.harness.getActive();
				return {
					ownership,
					minDeckClearanceMeters: Math.round(minDeckClearanceMeters * 1000) / 1000,
					maxBridgeRender: { calls: maxRenderCalls, triangles: maxRenderTriangles },
					activeGeneration: active.generation,
					activeTargetBridgeId: active.targetBridgeId,
				};
			};
			window.__run194v2Finish = () => {
				const state = window.__run194v2;
				const finalDisposed = state.harness.dispose();
				const history = state.harness.getHistory();
				const remainingWindowRoots = state.sceneWindowCount();
				state.renderer.dispose();
				state.renderer.domElement.remove();
				return { finalDisposed, history, remainingWindowRoots, canvasCount: document.querySelectorAll('canvas').length };
			};

			return {
				grid: {
					columns: grid.columns,
					rows: grid.rows,
					cellCount: grid.cellCount,
					minChunkX: grid.minChunkX,
					maxChunkX: grid.maxChunkX,
					minChunkZ: grid.minChunkZ,
					maxChunkZ: grid.maxChunkZ,
					worldWidthMeters: Math.round(grid.worldWidthMeters * 1000) / 1000,
					worldDepthMeters: Math.round(grid.worldDepthMeters * 1000) / 1000,
					targetAreaKm2: grid.targetAreaM2 / 1_000_000,
				},
				audit: {
					fullCellCount: audit.fullCellCount,
					clippedCellCount: audit.clippedCellCount,
					areaErrorM2: audit.areaErrorM2,
					maxSeamErrorMeters: audit.maxSeamErrorMeters,
					minWidthMeters: Math.round(audit.minWidthMeters * 1000) / 1000,
					minDepthMeters: Math.round(audit.minDepthMeters * 1000) / 1000,
					xEdgeTrimMeters: Math.round(audit.xEdgeTrimMeters * 1000) / 1000,
					zEdgeTrimMeters: Math.round(audit.zEdgeTrimMeters * 1000) / 1000,
				},
				corner: { residentCount: cornerFootprints.residentCount, clippedResidentCount: cornerFootprints.clippedResidentCount },
				edgeRender,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'clipped-grid-edge-window.png') });
		bridges = await page.evaluate(() => window.__run194v2BridgeSequence());
		await page.screenshot({ path: path.join(OUT, 'clipped-bridge-ownership-window.png') });
		finish = await page.evaluate(() => window.__run194v2Finish());
		assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}

	assert(initial.grid.cellCount === 567 && initial.audit.fullCellCount === 475 && initial.audit.clippedCellCount === 92, 'clipped grid ownership counts failed');
	assert(initial.audit.areaErrorM2 <= 1e-5 && initial.audit.maxSeamErrorMeters <= 1e-9, 'clipped grid tiling exactness failed');
	assert(initial.corner.residentCount === 9 && initial.corner.clippedResidentCount === 5, 'clipped corner resident set failed');
	assert(initial.edgeRender.calls < 500 && initial.edgeRender.triangles < 500000, 'clipped edge render budget failed');
	assert(bridges.ownership.length === 7 && new Set(bridges.ownership.map((entry) => entry.bridgeId)).size === 7, '7/7 bridge ownership failed');
	assert(bridges.activeGeneration === 8, `replacement generation drifted ${bridges.activeGeneration}`);
	assert(bridges.maxBridgeRender.calls < 500 && bridges.maxBridgeRender.triangles < 500000, 'bridge ownership render budget failed');
	assert(finish.history.length === 8, `dispose history drifted ${finish.history.length}`);
	assert(finish.history.every(cleanDispose), `replacement disposal leak ${JSON.stringify(finish.history)}`);
	assert(cleanDispose(finish.finalDisposed), 'final ownership window did not dispose cleanly');
	assert(finish.remainingWindowRoots === 0, `shadow scene retained ${finish.remainingWindowRoots} window root(s)`);
	assert(finish.canvasCount === 0, `renderer canvas leaked: ${finish.canvasCount}`);
	assert(fs.statSync(path.join(OUT, 'clipped-grid-edge-window.png')).size > 0, 'clipped grid screenshot missing');
	assert(fs.statSync(path.join(OUT, 'clipped-bridge-ownership-window.png')).size > 0, 'clipped bridge screenshot missing');

	const deterministic = {
		grid: initial.grid,
		audit: initial.audit,
		corner: initial.corner,
		bridgeOwnership: bridges.ownership,
		minDeckClearanceMeters: bridges.minDeckClearanceMeters,
		generations: bridges.activeGeneration,
		disposeCount: finish.history.length,
	};
	const proof = {
		version: 'run194-canonical-clipped-window-ownership-v2',
		checksum: hash(deterministic),
		deterministic,
		edgeRender: initial.edgeRender,
		maxBridgeRender: bridges.maxBridgeRender,
		finalTargetBridgeId: bridges.activeTargetBridgeId,
		dispose: { history: finish.history, remainingWindowRoots: finish.remainingWindowRoots, canvasCount: finish.canvasCount },
	};
	fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
	console.log(`[checkCanonicalClippedWindowOwnershipShadow] BUDGET: ${JSON.stringify({ edge: initial.edgeRender, maxBridge: bridges.maxBridgeRender })}`);
	console.log(`[checkCanonicalClippedWindowOwnershipShadow] PASS: grid=${initial.grid.columns}x${initial.grid.rows}/${initial.grid.cellCount}; full/clipped=${initial.audit.fullCellCount}/${initial.audit.clippedCellCount}; area=${initial.grid.targetAreaKm2.toFixed(1)}km2 seam=${initial.audit.maxSeamErrorMeters}m; edgeTrim=${initial.audit.xEdgeTrimMeters.toFixed(1)}x${initial.audit.zEdgeTrimMeters.toFixed(1)}m; corner=${initial.corner.residentCount} chunks/${initial.corner.clippedResidentCount} clipped; bridges=${bridges.ownership.length}/7; generations=${bridges.activeGeneration}; minDeckClearance=${bridges.minDeckClearanceMeters}m; checksum=${proof.checksum}`);
}

main().catch((error) => {
	console.error('[checkCanonicalClippedWindowOwnershipShadow] FAIL:', error && error.stack ? error.stack : error);
	process.exit(1);
});
