#!/usr/bin/env node
/**
 * Behavioural proof for the unified HD pindex detail layer (Run297), in a real browser.
 *
 * Proves, on an actual Three.js mesh built from the canonical mask cell centres:
 *   - every one of the ten pindexes is covered (the legacy stack only ever reached nine)
 *   - the layer is idempotent: applying it twice is byte-identical to applying it once, and
 *     applying it after the nine legacy layers gives the same result as applying it alone
 *     (so it supersedes rather than compounds)
 *   - amplitude is continuous across all nine pindex boundaries, where the legacy per-strip
 *     tables stepped discontinuously
 *   - strip centres still resolve to their approved per-pindex amplitudes exactly
 *   - shoreline vertices gain sub-cell colour gradient while cell centres keep the exact
 *     canonical palette colour
 *   - zero console/page errors (GOVERNANCE.md console-cleanliness gate)
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run297-pindex-detail-hd');
const assert = (value, message) => { if (!value) throw new Error(message); };

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch {}
	}
	return null;
}

function contentType(file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === '.html') return 'text/html; charset=utf-8';
	if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
	if (ext === '.json') return 'application/json; charset=utf-8';
	if (ext === '.css') return 'text/css; charset=utf-8';
	if (ext === '.png') return 'image/png';
	if (ext === '.glb') return 'model/gltf-binary';
	return 'application/octet-stream';
}

function startServer() {
	const server = http.createServer((req, res) => {
		const clean = decodeURIComponent(req.url.split('?')[0]);
		const file = path.join(ROOT, clean === '/' ? 'canonical-dev.html' : clean.replace(/^\//, ''));
		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		res.writeHead(200, { 'content-type': contentType(file) });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function proveInPage(page) {
	return page.evaluate(async () => {
		const THREE = await import('three');
		const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
		const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
		const { WORLD_REFERENCE_BASE_SURFACE_MASK: MASK } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
		const { applyReferenceSurfaceToTerrainMesh, WORLD_REFERENCE_SURFACE_VISUAL_POLICY } =
			await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
		const {
			PINDEX_HD_AMPLITUDES,
			PINDEX_DETAIL_HD_POLICY,
			amplitudeAt,
			applyPindexDetailHDToTerrainMesh,
			resolveDetailColor,
		} = await import('/src/3d/world/worldReferencePindexDetailHD.js');

		// --- build a mesh whose vertices sit exactly on canonical mask cell centres
		function buildMesh() {
			const positions = new Float32Array(MASK.width * MASK.height * 3);
			let cursor = 0;
			for (let y = 0; y < MASK.height; y += 1) {
				for (let x = 0; x < MASK.width; x += 1) {
					const canvas = normalizedReferenceToMapCanvas((x + 0.5) / MASK.width, (y + 0.5) / MASK.height);
					const world = mapCanvasToPlannedWorldXZ(canvas.x, canvas.y);
					positions[cursor++] = world.x;
					positions[cursor++] = 0;
					positions[cursor++] = world.z;
				}
			}
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			const material = new THREE.MeshStandardMaterial({ color: 0x516a49, roughness: 1, metalness: 0 });
			return new THREE.Mesh(geometry, material);
		}

		// --- 1. coverage: all ten pindexes touched
		const meshA = buildMesh();
		applyReferenceSurfaceToTerrainMesh(meshA);
		const summary = applyPindexDetailHDToTerrainMesh(meshA);
		const colorsOnce = Array.from(meshA.geometry.getAttribute('color').array);

		// --- 2. idempotency: apply twice
		applyPindexDetailHDToTerrainMesh(meshA);
		const colorsTwice = Array.from(meshA.geometry.getAttribute('color').array);
		let idempotencyDrift = 0;
		for (let i = 0; i < colorsOnce.length; i += 1) if (colorsOnce[i] !== colorsTwice[i]) idempotencyDrift += 1;

		// --- 3. supersede: legacy stack first, then HD -> must equal HD alone
		const meshB = buildMesh();
		applyReferenceSurfaceToTerrainMesh(meshB);
		const legacyModules = [
			'worldReferencePindex01Detail.js', 'worldReferencePindex02Detail.js', 'worldReferencePindex03Detail.js',
			'worldReferencePindex04Detail.js', 'worldReferencePindex05Detail.js', 'worldReferencePindex06Detail.js',
			'worldReferencePindex07Detail.js', 'worldReferencePindex08Detail.js', 'worldReferencePindex09Detail.js',
		];
		for (let i = 0; i < legacyModules.length; i += 1) {
			const mod = await import(`/src/3d/world/${legacyModules[i]}`);
			mod[`applyPindex0${i + 1}DetailToTerrainMesh`](meshB);
		}
		const colorsLegacyOnly = Array.from(meshB.geometry.getAttribute('color').array);
		applyPindexDetailHDToTerrainMesh(meshB);
		const colorsAfterLegacy = Array.from(meshB.geometry.getAttribute('color').array);
		let supersedeDrift = 0;
		for (let i = 0; i < colorsOnce.length; i += 1) if (colorsOnce[i] !== colorsAfterLegacy[i]) supersedeDrift += 1;
		let legacyDiffered = 0;
		for (let i = 0; i < colorsOnce.length; i += 1) if (colorsLegacyOnly[i] !== colorsOnce[i]) legacyDiffered += 1;

		// --- 4. seam continuity across the nine internal boundaries
		function legacyAmplitude(normalizedX, surface) {
			const strip = Math.min(10, Math.floor(normalizedX * 10) + 1);
			return PINDEX_HD_AMPLITUDES[strip - 1][surface];
		}
		const seams = [];
		const step = 0.0002;
		for (let boundary = 1; boundary <= 9; boundary += 1) {
			const at = boundary / 10;
			let hdMaxStep = 0;
			let legacyMaxStep = 0;
			let previousHd = amplitudeAt(at - 0.02, 'soil');
			let previousLegacy = legacyAmplitude(at - 0.02, 'soil');
			for (let x = at - 0.02 + step; x <= at + 0.02; x += step) {
				const hd = amplitudeAt(x, 'soil');
				const legacy = legacyAmplitude(x, 'soil');
				hdMaxStep = Math.max(hdMaxStep, Math.abs(hd - previousHd));
				legacyMaxStep = Math.max(legacyMaxStep, Math.abs(legacy - previousLegacy));
				previousHd = hd;
				previousLegacy = legacy;
			}
			seams.push({ boundary: at, hdMaxStep, legacyMaxStep });
		}

		// --- 5. strip centres keep their approved amplitudes exactly
		let centreAmplitudeViolations = 0;
		for (const entry of PINDEX_HD_AMPLITUDES) {
			const centre = (entry.pindex - 1) / 10 + 0.05;
			for (const surface of ['sea', 'lake', 'soil', 'rock', 'snow']) {
				if (amplitudeAt(centre, surface) !== entry[surface]) centreAmplitudeViolations += 1;
			}
		}

		// --- 6. cell centres keep the exact canonical palette hue (no shoreline bleed at centres)
		const palette = WORLD_REFERENCE_SURFACE_VISUAL_POLICY.colors;
		let centreHueViolations = 0;
		let centreShadeViolations = 0;
		let minCentreShade = Infinity;
		let maxCentreShade = -Infinity;
		let shorelineGradientVertices = 0;
		for (let y = 0; y < MASK.height; y += 1) {
			for (let x = 0; x < MASK.width; x += 1) {
				const nx = (x + 0.5) / MASK.width;
				const ny = (y + 0.5) / MASK.height;
				const resolved = resolveDetailColor(nx, ny);
				const expected = new THREE.Color(palette[resolved.surface]);
				// colour = palette * shade, so the ratio to the palette must be one shared scalar
				const ratios = [resolved.r / expected.r, resolved.g / expected.g, resolved.b / expected.b]
					.filter((value) => Number.isFinite(value) && value > 0);
				const spread = Math.max(...ratios) - Math.min(...ratios);
				if (spread > 1e-6) centreHueViolations += 1;
				// the shared scalar must be a legal shade, i.e. inside the same clamp the legacy
				// layers used — this is what stops a cell centre from being blown out or crushed
				const shade = ratios[0];
				if (shade < PINDEX_DETAIL_HD_POLICY.shadeMin - 1e-9
					|| shade > PINDEX_DETAIL_HD_POLICY.shadeMax + 1e-9) centreShadeViolations += 1;
				minCentreShade = Math.min(minCentreShade, shade);
				maxCentreShade = Math.max(maxCentreShade, shade);
				if (resolved.occupancy > 0 && resolved.occupancy < 1) shorelineGradientVertices += 1;
			}
		}
		// off-centre shoreline probe: midway between a land and a sea centre must be a real blend
		let offCentreBlends = 0;
		for (let y = 0; y < MASK.height; y += 1) {
			for (let x = 0; x < MASK.width - 1; x += 1) {
				const nx = (x + 1) / MASK.width;
				const ny = (y + 0.5) / MASK.height;
				const resolved = resolveDetailColor(nx, ny);
				if (resolved.occupancy > 0.01 && resolved.occupancy < 0.99) offCentreBlends += 1;
			}
		}

		meshA.geometry.dispose();
		meshA.material.dispose();
		meshB.geometry.dispose();
		meshB.material.dispose();

		return {
			policyId: PINDEX_DETAIL_HD_POLICY.id,
			summary,
			idempotencyDrift,
			supersedeDrift,
			legacyDiffered,
			seams,
			centreAmplitudeViolations,
			centreHueViolations,
			centreShadeViolations,
			minCentreShade,
			maxCentreShade,
			shorelineGradientVertices,
			offCentreBlends,
			totalVertices: MASK.width * MASK.height,
		};
	});
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
		const page = await context.newPage();
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/canonical-dev.html?worldSource=canonical-dev`,
			{ waitUntil: 'domcontentloaded', timeout: 30000 });

		const proof = await proveInPage(page);

		const coveredPindexes = proof.summary.pindexCounts.filter((count) => count > 0).length;
		assert(coveredPindexes === 10,
			`HD layer must cover all ten pindexes, covered ${coveredPindexes}: ${JSON.stringify(proof.summary.pindexCounts)}`);
		assert(proof.summary.touchedVertices === proof.totalVertices,
			`HD layer must touch every vertex, touched ${proof.summary.touchedVertices}/${proof.totalVertices}`);
		assert(proof.idempotencyDrift === 0, `HD layer is not idempotent: ${proof.idempotencyDrift} channels drifted`);
		assert(proof.supersedeDrift === 0,
			`HD layer must supersede the legacy stack, not compound: ${proof.supersedeDrift} channels differed`);
		assert(proof.legacyDiffered > 0, 'HD output is indistinguishable from the legacy stack — no improvement applied');
		assert(proof.centreAmplitudeViolations === 0,
			`approved per-strip amplitudes changed at ${proof.centreAmplitudeViolations} strip-centre/surface pairs`);
		assert(proof.centreHueViolations === 0,
			`cell centres must keep the exact canonical palette hue, ${proof.centreHueViolations} violated`);
		assert(proof.centreShadeViolations === 0,
			`cell-centre shade left the legacy [0.85,1.15] clamp at ${proof.centreShadeViolations} centres `
			+ `(range ${proof.minCentreShade}..${proof.maxCentreShade})`);
		assert(proof.offCentreBlends > 0, 'no sub-cell shoreline blending produced — staircase not addressed');
		for (const seam of proof.seams) {
			assert(seam.legacyMaxStep > 0, `boundary ${seam.boundary}: legacy baseline should step, measured 0`);
			assert(seam.hdMaxStep < seam.legacyMaxStep / 10,
				`boundary ${seam.boundary}: HD step ${seam.hdMaxStep} not materially below legacy ${seam.legacyMaxStep}`);
		}
		assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);

		await page.screenshot({ path: path.join(OUT, 'hd-detail-near.png'), fullPage: true });
		await page.setViewportSize({ width: 1024, height: 768 });
		await page.screenshot({ path: path.join(OUT, 'hd-detail-far.png'), fullPage: true });
		fs.writeFileSync(path.join(OUT, 'proof.json'),
			`${JSON.stringify({ ...proof, consoleErrors: errors.length }, null, 2)}\n`);

		const worstSeam = proof.seams.reduce((a, b) => (a.hdMaxStep > b.hdMaxStep ? a : b));
		console.log('[Run297] HD pindex detail browser PASS');
		console.log(`  pindex coverage      : 10/10 ${JSON.stringify(proof.summary.pindexCounts)}`);
		console.log(`  vertices touched     : ${proof.summary.touchedVertices}/${proof.totalVertices}`);
		console.log(`  idempotency drift    : ${proof.idempotencyDrift} channels`);
		console.log(`  supersede drift      : ${proof.supersedeDrift} channels (vs legacy stack)`);
		console.log(`  changed vs legacy    : ${proof.legacyDiffered} channels`);
		console.log(`  worst seam step      : HD ${worstSeam.hdMaxStep.toExponential(2)} vs legacy ${worstSeam.legacyMaxStep.toExponential(2)}`);
		console.log(`  shoreline blends     : ${proof.offCentreBlends} off-centre vertices`);
		console.log(`  cell-centre shade    : ${proof.minCentreShade.toFixed(4)}..${proof.maxCentreShade.toFixed(4)} (clamp 0.85..1.15)`);
		await context.close();
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[Run297] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
