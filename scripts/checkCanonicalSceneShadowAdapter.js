#!/usr/bin/env node
/** Run 193: reusable canonical terrain+roads+bridges+rocks bounded scene-window proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run193-canonical-scene-shadow-adapter');
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
	let finish;
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		initial = await page.evaluate(async () => {
			const THREE = await import('three');
			const { PLAYER_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
			const { STONE_BRIDGE_OWNER_POLICY } = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');
			const {
				CANONICAL_SCENE_SHADOW_POLICY,
				buildCanonicalSceneShadowPlan,
				createCanonicalSceneShadowWindow,
				createCanonicalSceneShadowGroundCollider,
				updateCanonicalSceneShadowWindow,
				summarizeCanonicalSceneShadowWindow,
				disposeCanonicalSceneShadowWindow,
			} = await import('/src/3d/world/worldReferenceSceneShadowAdapter.js');

			const plan = buildCanonicalSceneShadowPlan();
			if (plan.bridgePlan.bridges.length !== 7 || plan.bridgePlan.totalArchCount !== 177) throw new Error('Run191 bridge topology drifted');
			if (plan.totalWaterRoutePoints !== 399 || plan.coveredWaterRoutePoints !== 399) throw new Error(`Run192 suppression drifted ${plan.coveredWaterRoutePoints}/${plan.totalWaterRoutePoints}`);
			if (plan.approaches.length !== 14) throw new Error(`Run192 approach count drifted: ${plan.approaches.length}`);
			if (plan.safeRockCandidates.length !== 332 || plan.rockConflicts.length !== 11) throw new Error(`Run190 rock clearance drifted ${plan.safeRockCandidates.length}/${plan.rockConflicts.length}`);
			const maxGrade = Math.max(...plan.approaches.map((entry) => entry.gradeDegrees));
			const maxLength = Math.max(...plan.approaches.map((entry) => entry.lengthMeters));
			if (maxGrade > CANONICAL_SCENE_SHADOW_POLICY.maxApproachGradeDegrees + 1e-9) throw new Error(`approach grade ${maxGrade}`);
			if (maxLength > CANONICAL_SCENE_SHADOW_POLICY.maxApproachLengthMeters + 1e-9) throw new Error(`approach length ${maxLength}`);

			const playerRadiusMeters = Number(PLAYER_CONFIG.COLLIDER_RADIUS_METERS || PLAYER_CONFIG.PLAYER_RADIUS_METERS || 0.4);
			const fullColliderState = {
				plan,
				selectedBridges: plan.bridgePlan.bridges,
				selectedApproaches: plan.approaches,
			};
			const fullCollider = createCanonicalSceneShadowGroundCollider(fullColliderState, playerRadiusMeters);
			const expectedSafeHalfWidth = STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters * 0.5 - STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters - playerRadiusMeters;
			if (Math.abs(fullCollider.safeHalfWidthMeters - expectedSafeHalfWidth) > 1e-9) throw new Error('safe corridor drifted');
			let minBridgeClearance = Infinity;
			for (const bridge of plan.bridgePlan.bridges) {
				const deckTop = bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
				const resolved = fullCollider.getGroundHeight(bridge.centerX, bridge.centerZ);
				if (Math.abs(resolved - deckTop) > 1e-6) throw new Error(`${bridge.id}: center did not resolve to deck`);
				minBridgeClearance = Math.min(minBridgeClearance, resolved - plan.context.sampler(bridge.centerX, bridge.centerZ));
			}
			if (!(minBridgeClearance > 0.1)) throw new Error(`bridge clearance too small ${minBridgeClearance}`);

			const first = createCanonicalSceneShadowWindow({ profile: 'mobile' });
			const firstSummary = summarizeCanonicalSceneShadowWindow(first);
			if (firstSummary.terrainChunkCount !== 25) throw new Error(`mobile terrain window not bounded: ${firstSummary.terrainChunkCount}`);
			if (firstSummary.selectedBridgeIds.length < 1 || firstSummary.selectedBridgeIds.length >= 7) throw new Error(`bridge window not local: ${firstSummary.selectedBridgeIds.length}`);
			if (firstSummary.selectedRockInstances < 1 || firstSummary.selectedRockInstances > 96) throw new Error(`rock resident count invalid: ${firstSummary.selectedRockInstances}`);
			if (firstSummary.coveredWaterRoutePoints !== firstSummary.totalWaterRoutePoints) throw new Error('window plan lost water suppression coverage');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9aafbb);
			scene.add(first.root);
			const hemisphere = new THREE.HemisphereLight(0xeaf2ff, 0x4b513e, 1.7);
			const sun = new THREE.DirectionalLight(0xffe2b6, 2.2);
			sun.position.set(first.anchor.x + 300, 520, first.anchor.z + 240);
			scene.add(hemisphere, sun);
			const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1440, 900, false);
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.style.overflow = 'hidden';
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(58, 1440 / 900, 0.5, 2600);
			const target = first.selectedBridges.slice().sort((a, b) => {
				const da = Math.hypot(a.centerX - first.anchor.x, a.centerZ - first.anchor.z);
				const db = Math.hypot(b.centerX - first.anchor.x, b.centerZ - first.anchor.z);
				return da - db || a.id.localeCompare(b.id);
			})[0];
			const axisX = (target.endX - target.startX) / target.structuralSpanMeters;
			const axisZ = (target.endZ - target.startZ) / target.structuralSpanMeters;
			const sideX = -axisZ;
			const sideZ = axisX;
			const renderNear = () => {
				camera.position.set(target.centerX + sideX * 220 - axisX * 180, target.deckY + 105, target.centerZ + sideZ * 220 - axisZ * 180);
				camera.lookAt(target.centerX, target.deckY, target.centerZ);
				camera.updateMatrixWorld(true);
				updateCanonicalSceneShadowWindow(first, camera.position, 4.5);
				renderer.render(scene, camera);
			};
			const renderFar = () => {
				camera.position.set(target.centerX + sideX * 650 - axisX * 520, target.deckY + 300, target.centerZ + sideZ * 650 - axisZ * 520);
				camera.lookAt(target.centerX, target.deckY, target.centerZ);
				camera.updateMatrixWorld(true);
				updateCanonicalSceneShadowWindow(first, camera.position, 9.5);
				renderer.render(scene, camera);
			};
			renderNear();
			const nearRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
			if (nearRender.calls >= 500 || nearRender.triangles >= 500000) throw new Error(`mobile candidate budget exceeded ${JSON.stringify(nearRender)}`);

			const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
			const visibleBridgeIds = first.selectedBridges.filter((bridge) => frustum.intersectsSphere(new THREE.Sphere(
				new THREE.Vector3(bridge.centerX, bridge.deckY, bridge.centerZ),
				Math.max(bridge.bridgeWidthMeters, bridge.structuralSpanMeters * 0.52),
			))).map((bridge) => bridge.id);
			if (!visibleBridgeIds.includes(target.id)) throw new Error('near frustum missed target bridge');

			const deterministicCore = {
				policy: CANONICAL_SCENE_SHADOW_POLICY.key,
				bridgeCount: plan.bridgePlan.bridges.length,
				archCount: plan.bridgePlan.totalArchCount,
				water: [plan.coveredWaterRoutePoints, plan.totalWaterRoutePoints],
				approachCount: plan.approaches.length,
				maxGrade: Math.round(maxGrade * 1000000) / 1000000,
				maxLength: Math.round(maxLength * 1000) / 1000,
				safeRocks: plan.safeRockCandidates.length,
				rockConflicts: plan.rockConflicts.length,
				firstSummary,
			};

			window.__run193RenderFar = renderFar;
			window.__run193Finish = () => {
				const farRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
				const firstAnchor = { x: first.anchor.x, z: first.anchor.z };
				const alternateBridge = plan.bridgePlan.bridges.slice().sort((a, b) => {
					const da = Math.hypot(a.centerX - firstAnchor.x, a.centerZ - firstAnchor.z);
					const db = Math.hypot(b.centerX - firstAnchor.x, b.centerZ - firstAnchor.z);
					return db - da || a.id.localeCompare(b.id);
				})[0];
				scene.remove(first.root);
				disposeCanonicalSceneShadowWindow(first);
				const firstDisposed = {
					rootChildren: first.root.children.length,
					terrainChildren: first.terrainGroup.children.length,
					bridgeChildren: first.bridgeGroup.children.length,
					rockChildren: first.rockGroup.children.length,
				};
				const second = createCanonicalSceneShadowWindow({
					profile: 'mobile',
					anchor: { x: alternateBridge.centerX, z: alternateBridge.centerZ, bridgeId: alternateBridge.id },
				});
				const secondSummary = summarizeCanonicalSceneShadowWindow(second);
				if (secondSummary.terrainChunkCount !== 25) throw new Error(`second terrain window not bounded: ${secondSummary.terrainChunkCount}`);
				if (secondSummary.selectedBridgeIds.length < 1 || secondSummary.selectedRockInstances > 96) throw new Error('second resident-set bounds failed');
				if (Math.hypot(second.anchor.x - firstAnchor.x, second.anchor.z - firstAnchor.z) < 1500) throw new Error('streaming recenter did not move meaningfully');
				scene.add(second.root);
				camera.position.set(second.anchor.x + 360, plan.context.sampler(second.anchor.x, second.anchor.z) + 190, second.anchor.z + 360);
				camera.lookAt(second.anchor.x, plan.context.sampler(second.anchor.x, second.anchor.z), second.anchor.z);
				camera.updateMatrixWorld(true);
				updateCanonicalSceneShadowWindow(second, camera.position, 12.5);
				renderer.render(scene, camera);
				const secondRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
				if (secondRender.calls >= 500 || secondRender.triangles >= 500000) throw new Error(`second mobile budget exceeded ${JSON.stringify(secondRender)}`);
				scene.remove(second.root);
				disposeCanonicalSceneShadowWindow(second);
				const secondDisposed = { rootChildren: second.root.children.length, terrainChildren: second.terrainGroup.children.length };

				const repeat = createCanonicalSceneShadowWindow({ profile: 'mobile' });
				const repeatSummary = summarizeCanonicalSceneShadowWindow(repeat);
				if (JSON.stringify(repeatSummary) !== JSON.stringify(firstSummary)) throw new Error('same-input scene window summary drifted');
				disposeCanonicalSceneShadowWindow(repeat);
				renderer.dispose();
				renderer.domElement.remove();
				return {
					farRender,
					secondRender,
					firstDisposed,
					secondDisposed,
					secondSummary,
					recenterDistanceMeters: Math.hypot(alternateBridge.centerX - firstAnchor.x, alternateBridge.centerZ - firstAnchor.z),
					canvasCount: document.querySelectorAll('canvas').length,
				};
			};

			return {
				deterministicCore,
				firstSummary,
				nearRender,
				visibleBridgeIds,
				targetBridgeId: target.id,
				safeHalfWidthMeters: fullCollider.safeHalfWidthMeters,
				minBridgeClearanceMeters: Math.round(minBridgeClearance * 1000) / 1000,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'canonical-window-near.png') });
		await page.evaluate(() => window.__run193RenderFar());
		await page.screenshot({ path: path.join(OUT, 'canonical-window-far.png') });
		finish = await page.evaluate(() => window.__run193Finish());
		assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}

	assert(initial.firstSummary.terrainChunkCount === 25, 'first resident terrain bound failed');
	assert(initial.firstSummary.selectedRockInstances > 0, 'first window rendered no rocks');
	assert(initial.nearRender.calls < 500 && initial.nearRender.triangles < 500000, 'first candidate exceeds mobile budget');
	assert(finish.secondRender.calls < 500 && finish.secondRender.triangles < 500000, 'second candidate exceeds mobile budget');
	assert(Object.values(finish.firstDisposed).every((value) => value === 0), `first dispose incomplete ${JSON.stringify(finish.firstDisposed)}`);
	assert(Object.values(finish.secondDisposed).every((value) => value === 0), `second dispose incomplete ${JSON.stringify(finish.secondDisposed)}`);
	assert(finish.canvasCount === 0, `renderer canvas leaked: ${finish.canvasCount}`);
	assert(fs.statSync(path.join(OUT, 'canonical-window-near.png')).size > 0, 'near screenshot missing');
	assert(fs.statSync(path.join(OUT, 'canonical-window-far.png')).size > 0, 'far screenshot missing');

	const deterministic = {
		...initial.deterministicCore,
		secondSummary: finish.secondSummary,
		recenterDistanceMeters: Math.round(finish.recenterDistanceMeters * 1000) / 1000,
	};
	const proof = {
		version: 'run193-canonical-scene-shadow-adapter-v1',
		checksum: hash(deterministic),
		deterministic,
		nearRender: initial.nearRender,
		farRender: finish.farRender,
		secondRender: finish.secondRender,
		visibleBridgeIds: initial.visibleBridgeIds,
		targetBridgeId: initial.targetBridgeId,
		safeHalfWidthMeters: initial.safeHalfWidthMeters,
		minBridgeClearanceMeters: initial.minBridgeClearanceMeters,
		dispose: { first: finish.firstDisposed, second: finish.secondDisposed, canvasCount: finish.canvasCount },
	};
	fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
	console.log(`[checkCanonicalSceneShadowAdapter] BUDGET: ${JSON.stringify({ near: initial.nearRender, far: finish.farRender, recentered: finish.secondRender })}`);
	console.log(`[checkCanonicalSceneShadowAdapter] PASS: water ${initial.firstSummary.coveredWaterRoutePoints}/${initial.firstSummary.totalWaterRoutePoints}; approaches=${initial.firstSummary.selectedApproachCount}/${initial.deterministicCore.approachCount}; terrain=${initial.firstSummary.terrainChunkCount} chunks; rocks=${initial.firstSummary.selectedRockInstances}; bridges=${initial.firstSummary.selectedBridgeIds.length}; near=${initial.nearRender.calls} calls/${initial.nearRender.triangles} tris; recenter=${finish.recenterDistanceMeters.toFixed(1)}m; checksum=${proof.checksum}`);
}

main().catch((error) => {
	console.error('[checkCanonicalSceneShadowAdapter] FAIL:', error && error.stack ? error.stack : error);
	process.exit(1);
});
