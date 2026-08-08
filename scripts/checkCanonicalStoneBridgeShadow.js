#!/usr/bin/env node
/** Run 191: owner-approved canonical medieval stone-arch bridge shadow qualification. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run191-stone-bridges.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run191-stone-bridges');
const ARTIFACT = path.join(ARTIFACT_DIR, 'proof.json');
const HARNESS_URL = '/scripts/fixtures/run191-bridge-harness.html';
const RUN188_FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run188-road-water-policy.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const EXPECTED_RUN188_CHECKSUM = 'c47d6ecbacff41a6ffc4e18623642905c1865c46f37f3f82fbd69a9eecd57214';
const EXPECTED_AFFECTED = ['cersei->stannis', 'jon->Night King', 'robin->berkalp', 'twin->balon', 'umit->Xaro', 'umit->doran'];

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function round(value, digits = 3) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function checksum(value) {
	return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
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

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

async function buildProof(page) {
	return page.evaluate(async () => {
		const THREE = await import('three');
		const bridgeModule = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');
		const {
			STONE_BRIDGE_OWNER_POLICY,
			buildCanonicalStoneBridgePlan,
			createCanonicalStoneBridgeGeometry,
			disposeCanonicalStoneBridgeGeometry,
		} = bridgeModule;
		const plan = buildCanonicalStoneBridgePlan();
		const group = createCanonicalStoneBridgeGeometry({ bridges: plan.bridges });
		const canvas = document.getElementById('run191-canvas');
		canvas.width = 960;
		canvas.height = 540;
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setPixelRatio(1);
		renderer.setSize(960, 540, false);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x17130f);
		const camera = new THREE.PerspectiveCamera(50, 960 / 540, 0.1, 30000);
		camera.position.set(0, 9000, 9000);
		camera.lookAt(0, 0, 0);
		const hemi = new THREE.HemisphereLight(0xffe4ba, 0x223344, 2.2);
		const sun = new THREE.DirectionalLight(0xffd6a1, 3.5);
		sun.position.set(4500, 7000, 3200);
		scene.add(hemi, sun, group);
		for (const child of group.children) child.frustumCulled = false;
		renderer.render(scene, camera);
		const actual = {
			drawCalls: renderer.info.render.calls,
			triangles: renderer.info.render.triangles,
			geometries: renderer.info.memory.geometries,
			textures: renderer.info.memory.textures,
		};
		const predicted = { drawCalls: 0, triangles: 0, instances: 0 };
		const parts = [];
		for (const child of group.children) {
			if (!child.isInstancedMesh || child.count <= 0) continue;
			const trianglesPerInstance = child.geometry.index
				? child.geometry.index.count / 3
				: child.geometry.getAttribute('position').count / 3;
			predicted.drawCalls += 1;
			predicted.triangles += trianglesPerInstance * child.count;
			predicted.instances += child.count;
			parts.push({ name: child.name, count: child.count, trianglesPerInstance });
		}
		const geometrySet = new Set(group.children.map((child) => child.geometry).filter(Boolean));
		const materialSet = new Set(group.children.map((child) => child.material).filter(Boolean));
		const textureSet = new Set([...materialSet].map((material) => material.map).filter(Boolean));
		let geometryDisposals = 0;
		let materialDisposals = 0;
		let textureDisposals = 0;
		for (const geometry of geometrySet) geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
		for (const material of materialSet) material.addEventListener('dispose', () => { materialDisposals += 1; });
		for (const texture of textureSet) texture.addEventListener('dispose', () => { textureDisposals += 1; });
		const texture = [...textureSet][0];
		const textureEvidence = texture ? {
			name: texture.name,
			width: texture.image?.width || 0,
			height: texture.image?.height || 0,
			repeatX: texture.repeat.x,
			repeatY: texture.repeat.y,
			isCanvasTexture: Boolean(texture.isCanvasTexture),
		} : null;
		disposeCanonicalStoneBridgeGeometry(group);
		const disposed = {
			childrenAfterDispose: group.children.length,
			geometryDisposals,
			materialDisposals,
			textureDisposals,
			expectedGeometries: geometrySet.size,
			expectedMaterials: materialSet.size,
			expectedTextures: textureSet.size,
		};
		renderer.dispose();
		return {
			ownerPolicy: STONE_BRIDGE_OWNER_POLICY,
			plan: {
				policyKey: plan.policyKey,
				policy: plan.policy,
				affectedEdges: [...plan.affectedEdges],
				routeSummaries: plan.routeSummaries.map((entry) => ({ ...entry })),
				bridges: plan.bridges.map((bridge) => ({ ...bridge })),
				waterChordTotalMeters: plan.waterChordTotalMeters,
				structuralSpanTotalMeters: plan.structuralSpanTotalMeters,
				maxStructuralSpanMeters: plan.maxStructuralSpanMeters,
				totalArchCount: plan.totalArchCount,
			},
			predicted,
			actual,
			parts,
			texture: textureEvidence,
			disposed,
		};
	});
}

async function renderBridgeEvidence(page, bridge, filename, mode) {
	await page.evaluate(async ({ bridge, mode }) => {
		const THREE = await import('three');
		const {
			createCanonicalStoneBridgeGeometry,
			disposeCanonicalStoneBridgeGeometry,
		} = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');
		const canvas = document.getElementById('run191-canvas');
		const old = window.__run191Visual;
		if (old) {
			disposeCanonicalStoneBridgeGeometry(old.group);
			old.renderer.dispose();
		}
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setPixelRatio(1);
		renderer.setSize(960, 540, false);
		renderer.shadowMap.enabled = true;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x9aa5a8);
		scene.fog = new THREE.Fog(0x9aa5a8, 500, Math.max(1800, bridge.structuralSpanMeters * 1.8));
		const group = createCanonicalStoneBridgeGeometry({ bridges: [bridge] });
		scene.add(group);
		const waterWidth = Math.max(180, bridge.bridgeWidthMeters * 16);
		const waterLength = Math.max(220, bridge.structuralSpanMeters + 180);
		const waterGeometry = new THREE.PlaneGeometry(waterLength, waterWidth);
		const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x456a78, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.9 });
		const water = new THREE.Mesh(waterGeometry, waterMaterial);
		water.rotation.x = -Math.PI / 2;
		water.rotation.z = -bridge.yawRadians;
		water.position.set(bridge.centerX, Math.min(bridge.startGroundY, bridge.endGroundY, bridge.deckY - bridge.archRiseMeters) - 0.3, bridge.centerZ);
		scene.add(water);
		const groundGeometry = new THREE.PlaneGeometry(waterLength + 260, waterWidth + 260);
		const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x6d7652, roughness: 1, metalness: 0 });
		const ground = new THREE.Mesh(groundGeometry, groundMaterial);
		ground.rotation.x = -Math.PI / 2;
		ground.rotation.z = -bridge.yawRadians;
		ground.position.set(bridge.centerX, water.position.y - 0.5, bridge.centerZ);
		scene.add(ground);
		const hemi = new THREE.HemisphereLight(0xffe5bd, 0x334052, 2.4);
		const sun = new THREE.DirectionalLight(0xffd39b, 4.2);
		sun.position.set(bridge.centerX + 400, bridge.deckY + 700, bridge.centerZ + 350);
		scene.add(hemi, sun);
		const camera = new THREE.PerspectiveCamera(48, 960 / 540, 0.1, 30000);
		const dx = bridge.endX - bridge.startX;
		const dz = bridge.endZ - bridge.startZ;
		const length = Math.hypot(dx, dz) || 1;
		const sideX = -dz / length;
		const sideZ = dx / length;
		const alongX = dx / length;
		const alongZ = dz / length;
		if (mode === 'near') {
			const distance = Math.max(42, Math.min(120, bridge.structuralSpanMeters * 0.7));
			camera.position.set(
				bridge.centerX + sideX * distance - alongX * distance * 0.25,
				bridge.deckY + Math.max(18, bridge.archRiseMeters * 1.6),
				bridge.centerZ + sideZ * distance - alongZ * distance * 0.25,
			);
		} else {
			const distance = Math.max(550, bridge.structuralSpanMeters * 0.58);
			camera.position.set(
				bridge.centerX + sideX * distance,
				bridge.deckY + Math.max(180, bridge.structuralSpanMeters * 0.12),
				bridge.centerZ + sideZ * distance,
			);
		}
		camera.lookAt(bridge.centerX, bridge.deckY - bridge.archRiseMeters * 0.25, bridge.centerZ);
		renderer.render(scene, camera);
		window.__run191Visual = { renderer, group, waterGeometry, waterMaterial, groundGeometry, groundMaterial };
	}, { bridge, mode });
	await page.screenshot({ path: filename });
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalStoneBridgeShadow] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	const run188 = JSON.parse(fs.readFileSync(RUN188_FIXTURE, 'utf8'));
	assert(run188.checksum === EXPECTED_RUN188_CHECKSUM, 'Run188 road/water comparison checksum drifted');
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startServer();
	const port = server.address().port;
	const browser = await playwright.chromium.launch({ headless: true });
	const consoleErrors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		await page.goto(`http://127.0.0.1:${port}${HARNESS_URL}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const proof = await buildProof(page);
		assert(proof.plan.policy === 'stone-arch-bridge', 'owner bridge policy not active');
		assert(proof.plan.routeSummaries.length === 13, `expected 13 MST road edges, got ${proof.plan.routeSummaries.length}`);
		const affectedSorted = [...proof.plan.affectedEdges].sort();
		assert(JSON.stringify(affectedSorted) === JSON.stringify(EXPECTED_AFFECTED), `affected edge set drifted: ${JSON.stringify(affectedSorted)}`);
		assert(proof.plan.bridges.length === 7, `expected 7 distinct water crossings/bridges, got ${proof.plan.bridges.length}`);
		assert(proof.plan.waterChordTotalMeters > 6000 && proof.plan.waterChordTotalMeters < 6300, `Run188 bridge chord aggregate drifted: ${proof.plan.waterChordTotalMeters}`);
		assert(proof.plan.maxStructuralSpanMeters > 3000 && proof.plan.maxStructuralSpanMeters < 3200, `unexpected longest structural span: ${proof.plan.maxStructuralSpanMeters}`);
		assert(proof.plan.totalArchCount > 150 && proof.plan.totalArchCount < 220, `unexpected total arch count: ${proof.plan.totalArchCount}`);
		for (const bridge of proof.plan.bridges) {
			assert(bridge.archCount >= 1, `${bridge.id} has no arches`);
			assert(bridge.archSpanMeters <= proof.ownerPolicy.maxArchSpanMeters + 0.001, `${bridge.id} arch span exceeds policy: ${bridge.archSpanMeters}`);
			assert(bridge.bridgeWidthMeters === 8, `${bridge.id} road/bridge width mismatch`);
		}
		assert(proof.texture?.isCanvasTexture, 'medieval masonry material is not backed by a CanvasTexture');
		assert(proof.texture.width === 256 && proof.texture.height === 256, `unexpected masonry texture size: ${JSON.stringify(proof.texture)}`);
		assert(proof.predicted.drawCalls === 4, `expected four batched bridge draw calls, got ${proof.predicted.drawCalls}`);
		assert(proof.actual.drawCalls === proof.predicted.drawCalls, `renderer draw-call mismatch: predicted ${proof.predicted.drawCalls}, actual ${proof.actual.drawCalls}`);
		assert(proof.actual.triangles === proof.predicted.triangles, `renderer triangle mismatch: predicted ${proof.predicted.triangles}, actual ${proof.actual.triangles}`);
		assert(proof.actual.triangles < 100000, `bridge proof triangle budget too high: ${proof.actual.triangles}`);
		assert(proof.disposed.childrenAfterDispose === 0, 'bridge group children remain after dispose');
		assert(proof.disposed.geometryDisposals === proof.disposed.expectedGeometries, 'not every bridge geometry disposed');
		assert(proof.disposed.materialDisposals === proof.disposed.expectedMaterials, 'bridge material dispose mismatch');
		assert(proof.disposed.textureDisposals === proof.disposed.expectedTextures, 'bridge masonry texture dispose mismatch');
		const shortest = [...proof.plan.bridges].sort((a, b) => a.structuralSpanMeters - b.structuralSpanMeters)[0];
		const longest = [...proof.plan.bridges].sort((a, b) => b.structuralSpanMeters - a.structuralSpanMeters)[0];
		await renderBridgeEvidence(page, shortest, path.join(ARTIFACT_DIR, 'bridge-near.png'), 'near');
		await renderBridgeEvidence(page, longest, path.join(ARTIFACT_DIR, 'bridge-long.png'), 'long');
		assert(consoleErrors.length === 0, `bridge harness console/page errors: ${consoleErrors.join(' | ')}`);
		const deterministicCore = {
			version: 'run191-canonical-stone-bridge-shadow-v1',
			run188Checksum: run188.checksum,
			policy: proof.plan.policy,
			affectedEdges: affectedSorted,
			bridges: proof.plan.bridges,
			waterChordTotalMeters: proof.plan.waterChordTotalMeters,
			structuralSpanTotalMeters: proof.plan.structuralSpanTotalMeters,
			maxStructuralSpanMeters: proof.plan.maxStructuralSpanMeters,
			totalArchCount: proof.plan.totalArchCount,
			predicted: {
				drawCalls: proof.predicted.drawCalls,
				triangles: proof.predicted.triangles,
				instances: proof.predicted.instances,
			},
			texture: proof.texture,
		};
		const deterministicChecksum = checksum(deterministicCore);
		const report = {
			...deterministicCore,
			actual: proof.actual,
			parts: proof.parts,
			disposed: proof.disposed,
			visualEvidence: ['bridge-near.png', 'bridge-long.png'],
			checksum: deterministicChecksum,
		};
		fs.writeFileSync(ARTIFACT, JSON.stringify(report, null, 2) + '\n');
		const args = new Set(process.argv.slice(2));
		if (args.has('--write-fixture')) fs.writeFileSync(FIXTURE, JSON.stringify(report, null, 2) + '\n');
		if (args.has('--verify-fixture')) {
			assert(fs.existsSync(FIXTURE), 'Run191 bridge fixture missing');
			const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
			assert(fixture.checksum === deterministicChecksum, `Run191 bridge checksum drift: expected ${fixture.checksum}, got ${deterministicChecksum}`);
			assert(fixture.policy === 'stone-arch-bridge', 'Run191 fixture owner policy drifted');
			assert(fixture.bridges.length === proof.plan.bridges.length, 'Run191 fixture bridge count drifted');
		}
		const summary = `${proof.plan.affectedEdges.length}/13 affected road edges -> ${proof.plan.bridges.length} medieval stone bridge structures, ${proof.plan.totalArchCount} arches; water chord ${round(proof.plan.waterChordTotalMeters / 1000, 2)} km; batched ${proof.actual.drawCalls} calls/${proof.actual.triangles} tris; masonry texture + two visual angles + dispose PASS`;
		console.log(`[checkCanonicalStoneBridgeShadow] PASS: ${summary}`);
		console.log(`[checkCanonicalStoneBridgeShadow] CHECKSUM: ${deterministicChecksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error('[checkCanonicalStoneBridgeShadow] FAIL:', error?.stack || error);
	process.exit(1);
});
