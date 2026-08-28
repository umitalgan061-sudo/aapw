#!/usr/bin/env node
/** Run 190: real THREE InstancedMesh/LOD proof for Run189 canonical rock sites, still shadow-only. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUN189_FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run189-rock-placement.json');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run190-rock-geometry.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run190-rock-geometry');
const ARTIFACT = path.join(ARTIFACT_DIR, 'proof.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function deepSort(value) {
	if (Array.isArray(value)) return value.map(deepSort);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepSort(value[key])]));
}

function checksum(value) {
	return crypto.createHash('sha256').update(JSON.stringify(deepSort(value))).digest('hex');
}

function round(value, digits = 3) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, ''));
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
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

async function measure() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCanonicalRockGeometryShadow] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		return await page.evaluate(async () => {
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const rock = await import('/src/3d/world/worldReferenceRockShadow.js');
			const candidatesA = rock.generateCanonicalRockShadowCandidates();
			const candidatesB = rock.generateCanonicalRockShadowCandidates();
			const roadEdges = rock.buildCanonicalRockRoadDiagnostic();
			const clearance = rock.classifyRockRoadClearance(candidatesA, roadEdges);

			function renderProfile(profile) {
				const profileConfig = rock.ROCK_SHADOW_RENDER_PROFILES[profile];
				const anchor = rock.chooseDenseRockShadowAnchor(clearance.safeCandidates, profileConfig.renderRadiusMeters);
				const group = rock.createCanonicalRockShadowGeometry({ candidates: clearance.safeCandidates, profile, anchor });
				const scene = new THREE.Scene();
				scene.add(group);
				scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
				const sun = new THREE.DirectionalLight(0xffffff, 1.4);
				sun.position.set(400, 900, 300);
				scene.add(sun);
				const camera = new THREE.PerspectiveCamera(60, 640 / 480, 0.1, 8000);
				camera.position.set(0, 1500, 2200);
				camera.lookAt(0, 40, 0);
				const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
				renderer.setPixelRatio(1);
				renderer.setSize(640, 480, false);
				renderer.render(scene, camera);
				const predicted = { ...group.userData.rockShadow };
				const actual = {
					drawCalls: renderer.info.render.calls,
					triangles: renderer.info.render.triangles,
					geometries: renderer.info.memory.geometries,
					textures: renderer.info.memory.textures,
				};
				const meshSummary = group.children.map((mesh) => ({
					name: mesh.name,
					count: mesh.count,
					trianglesPerInstance: mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.getAttribute('position').count / 3,
				}));
				rock.disposeCanonicalRockShadowGeometry(group);
				renderer.dispose();
				renderer.forceContextLoss?.();
				return { profile, anchor, predicted, actual, meshSummary, disposedChildren: group.children.length };
			}

			return {
				policy: rock.ROCK_SHADOW_SITE_POLICY,
				profiles: rock.ROCK_SHADOW_RENDER_PROFILES,
				candidatesA,
				candidateRepeatIdentical: JSON.stringify(candidatesA) === JSON.stringify(candidatesB),
				road: {
					edgeCount: roadEdges.length,
					clearanceMeters: clearance.clearanceMeters,
					safeCount: clearance.safeCandidates.length,
					conflictCount: clearance.conflicts.length,
					minDistanceMeters: clearance.minDistanceMeters,
					conflictIds: clearance.conflicts.map((item) => `${item.ix}:${item.iz}:${item.tier}`),
				},
				mobile: renderProfile('mobile'),
				desktop: renderProfile('desktop'),
			};
		});
	} finally {
		await browser.close();
		server.close();
	}
}

function compactProfile(profile) {
	return {
		anchor: { x: round(profile.anchor.x), z: round(profile.anchor.z), nearbyCount: profile.anchor.nearbyCount },
		predicted: profile.predicted,
		actual: profile.actual,
		meshSummary: profile.meshSummary,
		disposedChildren: profile.disposedChildren,
	};
}

async function main() {
	assert(fs.existsSync(RUN189_FIXTURE), 'Run189 fixture missing');
	const run189 = JSON.parse(fs.readFileSync(RUN189_FIXTURE, 'utf8'));
	const data = await measure();
	const candidateChecksum = checksum(data.candidatesA);

	assert(data.candidateRepeatIdentical, 'candidate generator changed across repeat call');
	assert(data.candidatesA.length === run189.counts.eligible, `Run189 candidate count drift: ${data.candidatesA.length} != ${run189.counts.eligible}`);
	assert(candidateChecksum === run189.candidateChecksum, `Run189 candidate checksum drift: ${candidateChecksum} != ${run189.candidateChecksum}`);
	assert(data.policy.cellMeters === run189.policy.cellMeters, 'Run189 cell size drift');
	assert(data.policy.jitterMeters === run189.policy.jitterMeters, 'Run189 jitter drift');
	assert(data.policy.maxSlopeDegrees === run189.policy.maxSlopeDegrees, 'Run189 slope guard drift');
	assert(data.policy.minGeologyScore === run189.policy.minGeologyScore, 'Run189 geology threshold drift');
	assert(data.road.edgeCount === 13, `expected 13 provisional target-road edges, got ${data.road.edgeCount}`);
	assert(data.road.safeCount + data.road.conflictCount === data.candidatesA.length, 'road-clearance partition lost candidates');
	assert(data.road.safeCount >= 50, `too few road-clear rock candidates: ${data.road.safeCount}`);
	assert(data.road.clearanceMeters >= 20, `road clearance too small: ${data.road.clearanceMeters}`);

	for (const profile of [data.mobile, data.desktop]) {
		assert(profile.predicted.selectedInstances > 0, `${profile.profile}: no selected instances`);
		assert(profile.predicted.selectedInstances <= profile.predicted.maxInstances, `${profile.profile}: instance cap exceeded`);
		assert(profile.predicted.drawCalls > 0 && profile.predicted.drawCalls <= 6, `${profile.profile}: draw calls ${profile.predicted.drawCalls} outside 1..6`);
		assert(profile.predicted.nearInstances > 0, `${profile.profile}: near LOD empty`);
		assert(profile.predicted.farInstances > 0, `${profile.profile}: far LOD empty`);
		assert(profile.actual.drawCalls === profile.predicted.drawCalls, `${profile.profile}: renderer drawCalls ${profile.actual.drawCalls} != predicted ${profile.predicted.drawCalls}`);
		assert(profile.actual.triangles === profile.predicted.triangles, `${profile.profile}: renderer triangles ${profile.actual.triangles} != predicted ${profile.predicted.triangles}`);
		assert(profile.disposedChildren === 0, `${profile.profile}: geometry group not cleared on dispose`);
		assert(profile.meshSummary.length === profile.predicted.drawCalls, `${profile.profile}: mesh/draw mismatch`);
	}
	assert(data.mobile.actual.drawCalls < 500, `mobile shadow draw calls ${data.mobile.actual.drawCalls} exceed live budget`);
	assert(data.mobile.actual.triangles < 500000, `mobile shadow triangles ${data.mobile.actual.triangles} exceed live budget`);
	assert(data.desktop.actual.drawCalls < 2500, `desktop shadow draw calls ${data.desktop.actual.drawCalls} exceed budget`);
	assert(data.desktop.actual.triangles < 5000000, `desktop shadow triangles ${data.desktop.actual.triangles} exceed budget`);
	assert(data.mobile.predicted.selectedInstances <= data.desktop.predicted.selectedInstances, 'mobile should not keep more rock instances than desktop');
	assert(data.mobile.actual.triangles <= data.desktop.actual.triangles, 'mobile LOD should not submit more rock triangles than desktop');

	const runtimeConsumers = [
		'src/3d/game3d.js',
		'src/3d/sceneManager.js',
		'src/3d/world/chunkManager.js',
		'src/3d/world/terrain.js',
		'src/3d/world/roads.js',
		'src/3d/world/vegetation.js',
	];
	for (const file of runtimeConsumers) {
		assert(!fs.readFileSync(path.join(ROOT, file), 'utf8').includes('worldReferenceRockShadow.js'), `${file}: Run190 shadow module must remain unwired`);
	}

	const summary = {
		version: 'run190-canonical-rock-geometry-shadow-v1',
		run189CandidateChecksum: candidateChecksum,
		candidateCount: data.candidatesA.length,
		road: {
			edgeCount: data.road.edgeCount,
			clearanceMeters: data.road.clearanceMeters,
			safeCount: data.road.safeCount,
			conflictCount: data.road.conflictCount,
			minDistanceMeters: round(data.road.minDistanceMeters),
			conflictChecksum: checksum(data.road.conflictIds),
		},
		mobile: compactProfile(data.mobile),
		desktop: compactProfile(data.desktop),
	};
	const final = { ...summary, checksum: checksum(summary) };
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	fs.writeFileSync(ARTIFACT, JSON.stringify(final, null, 2) + '\n');
	if (process.argv.includes('--write-fixture')) {
		fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
		fs.writeFileSync(FIXTURE, JSON.stringify(final, null, 2) + '\n');
	}
	if (process.argv.includes('--verify-fixture')) {
		assert(fs.existsSync(FIXTURE), 'Run190 fixture missing');
		const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		assert(JSON.stringify(deepSort(fixture)) === JSON.stringify(deepSort(final)), 'Run190 fixture mismatch');
	}

	console.log(`[checkCanonicalRockGeometryShadow] PASS: Run189 candidates ${final.candidateCount} checksum preserved; provisional 24m road-clear safe/conflict ${final.road.safeCount}/${final.road.conflictCount}; mobile ${final.mobile.predicted.selectedInstances} instances ${final.mobile.actual.drawCalls} calls/${final.mobile.actual.triangles} tris; desktop ${final.desktop.predicted.selectedInstances} instances ${final.desktop.actual.drawCalls} calls/${final.desktop.actual.triangles} tris; near+far LOD and dispose PASS; live runtime unwired.`);
	console.log(`[checkCanonicalRockGeometryShadow] CHECKSUM: ${final.checksum}`);
}

main().catch((error) => {
	console.error('[checkCanonicalRockGeometryShadow] FAIL:', error);
	process.exit(1);
});
