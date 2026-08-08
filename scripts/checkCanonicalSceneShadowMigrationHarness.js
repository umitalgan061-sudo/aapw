#!/usr/bin/env node
/** Run 194: all-bridge ownership + planned 27x21 edge-window shadow migration proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run194-canonical-scene-migration-harness');
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

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	let initial;
	let second;
	let finish;
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		initial = await page.evaluate(async () => {
			const THREE = await import('three');
			const {
				CANONICAL_SCENE_SHADOW_POLICY,
				buildCanonicalSceneShadowPlan,
				updateCanonicalSceneShadowWindow,
			} = await import('/src/3d/world/worldReferenceSceneShadowAdapter.js');
			const {
				CANONICAL_SCENE_SHADOW_MIGRATION_POLICY,
				getCanonicalSceneShadowChunkBounds,
				isCanonicalSceneShadowChunkInBounds,
				resolveCanonicalSceneShadowTerrainOwnership,
				createCanonicalSceneShadowMigrationWindow,
				summarizeCanonicalSceneShadowMigrationWindow,
				disposeCanonicalSceneShadowMigrationWindow,
			} = await import('/src/3d/world/worldReferenceSceneShadowMigrationHarness.js');

			const bounds = getCanonicalSceneShadowChunkBounds();
			if (CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridColumns !== 27 || CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridRows !== 21) {
				throw new Error(`planned grid drifted: ${CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridColumns}x${CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridRows}`);
			}
			if (bounds.x.min !== -13 || bounds.x.max !== 13 || bounds.z.min !== -10 || bounds.z.max !== 10) {
				throw new Error(`planned centered chunk bounds drifted: ${JSON.stringify(bounds)}`);
			}
			const size = CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.chunkSizeMeters;
			const profileRadius = CANONICAL_SCENE_SHADOW_POLICY.profiles.mobile.terrainChunkRadius;
			if (profileRadius !== 2) throw new Error(`mobile terrain radius drifted: ${profileRadius}`);

			let minResident = Infinity;
			let maxResident = -Infinity;
			const reachable = new Set();
			const ownershipCore = [];
			for (let x = bounds.x.min; x <= bounds.x.max; x += 1) {
				for (let z = bounds.z.min; z <= bounds.z.max; z += 1) {
					const ownership = resolveCanonicalSceneShadowTerrainOwnership({ profile: 'mobile', anchor: { x: x * size, z: z * size } });
					if (!ownership.some((coord) => coord.x === x && coord.z === z)) throw new Error(`anchor chunk missing from own window ${x},${z}`);
					for (const coord of ownership) {
						if (!isCanonicalSceneShadowChunkInBounds(coord.x, coord.z)) throw new Error(`out-of-grid ownership ${coord.x},${coord.z}`);
						reachable.add(`${coord.x},${coord.z}`);
					}
					minResident = Math.min(minResident, ownership.length);
					maxResident = Math.max(maxResident, ownership.length);
					ownershipCore.push([x, z, ownership.map((coord) => `${coord.x},${coord.z}`)]);
				}
			}
			if (reachable.size !== 27 * 21) throw new Error(`planned chunk reachability drifted: ${reachable.size}/567`);
			if (minResident !== 9 || maxResident !== 25) throw new Error(`edge/interior resident bounds drifted: ${minResident}/${maxResident}`);

			const plan = buildCanonicalSceneShadowPlan();
			if (plan.bridgePlan.bridges.length !== 7) throw new Error(`bridge topology drifted: ${plan.bridgePlan.bridges.length}`);
			const bridgeOwnership = [];
			for (const bridge of plan.bridgePlan.bridges) {
				const state = createCanonicalSceneShadowMigrationWindow({
					profile: 'mobile',
					anchor: { x: bridge.centerX, z: bridge.centerZ, bridgeId: bridge.id },
				});
				const summary = summarizeCanonicalSceneShadowMigrationWindow(state);
				if (!summary.selectedBridgeIds.includes(bridge.id)) throw new Error(`${bridge.id}: bridge not owned by its anchored window`);
				if (summary.terrainChunkCount < 9 || summary.terrainChunkCount > 25) throw new Error(`${bridge.id}: resident chunk count ${summary.terrainChunkCount}`);
				if (summary.terrainOwnership.some((key) => {
					const [x, z] = key.split(',').map(Number);
					return !isCanonicalSceneShadowChunkInBounds(x, z);
				})) throw new Error(`${bridge.id}: out-of-grid terrain ownership`);
				bridgeOwnership.push({ bridgeId: bridge.id, residentChunks: summary.terrainChunkCount, coResidentBridgeIds: summary.selectedBridgeIds });
				disposeCanonicalSceneShadowMigrationWindow(state);
				if (state.root.children.length !== 0 || state.terrainGroup.children.length !== 0) throw new Error(`${bridge.id}: disposal leaked scene children`);
			}
			if (new Set(bridgeOwnership.map((entry) => entry.bridgeId)).size !== 7) throw new Error('all-7 bridge ownership proof incomplete');

			const cornerNW = { x: bounds.x.min * size, z: bounds.z.min * size };
			const cornerSE = { x: bounds.x.max * size, z: bounds.z.max * size };
			const first = createCanonicalSceneShadowMigrationWindow({ profile: 'mobile', anchor: cornerNW });
			const firstSummary = summarizeCanonicalSceneShadowMigrationWindow(first);
			if (firstSummary.terrainChunkCount !== 9) throw new Error(`NW corner expected 9 chunks, got ${firstSummary.terrainChunkCount}`);

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9aafbb);
			scene.add(first.root);
			const hemisphere = new THREE.HemisphereLight(0xeaf2ff, 0x4b513e, 1.7);
			const sun = new THREE.DirectionalLight(0xffe2b6, 2.2);
			sun.position.set(cornerNW.x + 350, 520, cornerNW.z + 260);
			scene.add(hemisphere, sun);
			const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1440, 900, false);
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.style.overflow = 'hidden';
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(58, 1440 / 900, 0.5, 3000);
			const groundNW = plan.context.sampler(cornerNW.x, cornerNW.z);
			camera.position.set(cornerNW.x + 720, groundNW + 360, cornerNW.z + 720);
			camera.lookAt(cornerNW.x, groundNW, cornerNW.z);
			camera.updateMatrixWorld(true);
			updateCanonicalSceneShadowWindow(first, camera.position, 4.5);
			renderer.render(scene, camera);
			const firstRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
			if (firstRender.calls >= 500 || firstRender.triangles >= 500000) throw new Error(`NW mobile edge budget exceeded ${JSON.stringify(firstRender)}`);

			window.__run194RenderSecond = () => {
				scene.remove(first.root);
				disposeCanonicalSceneShadowMigrationWindow(first);
				const firstDisposed = { rootChildren: first.root.children.length, terrainChildren: first.terrainGroup.children.length };
				const next = createCanonicalSceneShadowMigrationWindow({ profile: 'mobile', anchor: cornerSE });
				const nextSummary = summarizeCanonicalSceneShadowMigrationWindow(next);
				if (nextSummary.terrainChunkCount !== 9) throw new Error(`SE corner expected 9 chunks, got ${nextSummary.terrainChunkCount}`);
				scene.add(next.root);
				const groundSE = next.plan.context.sampler(cornerSE.x, cornerSE.z);
				camera.position.set(cornerSE.x - 720, groundSE + 360, cornerSE.z - 720);
				camera.lookAt(cornerSE.x, groundSE, cornerSE.z);
				camera.updateMatrixWorld(true);
				updateCanonicalSceneShadowWindow(next, camera.position, 9.5);
				renderer.render(scene, camera);
				const nextRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
				if (nextRender.calls >= 500 || nextRender.triangles >= 500000) throw new Error(`SE mobile edge budget exceeded ${JSON.stringify(nextRender)}`);
				window.__run194Finish = () => {
					scene.remove(next.root);
					disposeCanonicalSceneShadowMigrationWindow(next);
					const nextDisposed = { rootChildren: next.root.children.length, terrainChildren: next.terrainGroup.children.length };
					renderer.dispose();
					renderer.domElement.remove();
					return { nextDisposed, canvasCount: document.querySelectorAll('canvas').length };
				};
				return { nextSummary, nextRender, firstDisposed };
			};

			const deterministicCore = {
				policy: CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.key,
				grid: [CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridColumns, CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridRows],
				bounds,
				minResident,
				maxResident,
				reachableChunks: reachable.size,
				bridgeOwnership,
				ownershipCore,
			};
			return {
				deterministicCore,
				checksum: null,
				firstSummary,
				firstRender,
				bridgeOwnership,
				minResident,
				maxResident,
				reachableChunks: reachable.size,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'world-edge-northwest.png') });
		second = await page.evaluate(() => window.__run194RenderSecond());
		await page.screenshot({ path: path.join(OUT, 'world-edge-southeast.png') });
		finish = await page.evaluate(() => window.__run194Finish());
		assert(finish.canvasCount === 0, `renderer canvas leak: ${finish.canvasCount}`);
		assert(finish.nextDisposed.rootChildren === 0 && finish.nextDisposed.terrainChildren === 0, 'second edge window disposal incomplete');
		assert(second.firstDisposed.rootChildren === 0 && second.firstDisposed.terrainChildren === 0, 'first edge window disposal incomplete');
		assert(errors.length === 0, `browser console/page errors: ${errors.join(' | ')}`);

		const checksum = hash(initial.deterministicCore);
		const proof = {
			policy: initial.deterministicCore.policy,
			grid: initial.deterministicCore.grid,
			bounds: initial.deterministicCore.bounds,
			reachableChunks: initial.reachableChunks,
			residentRange: [initial.minResident, initial.maxResident],
			bridgeOwnership: initial.bridgeOwnership,
			northwest: { summary: initial.firstSummary, render: initial.firstRender },
			southeast: { summary: second.nextSummary, render: second.nextRender },
			disposal: { northwest: second.firstDisposed, southeast: finish.nextDisposed, canvasCount: finish.canvasCount },
			consoleErrors: errors.length,
			checksum,
		};
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCanonicalSceneShadowMigrationHarness] BUDGET: ${JSON.stringify({ northwest: initial.firstRender, southeast: second.nextRender })}`);
		console.log(`[checkCanonicalSceneShadowMigrationHarness] PASS: grid=27x21 reachable=${initial.reachableChunks}/567 resident=${initial.minResident}-${initial.maxResident} bridges=${initial.bridgeOwnership.length}/7 edge=9+9 checksum=${checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCanonicalSceneShadowMigrationHarness] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
