#!/usr/bin/env node
/**
 * Mobile spawn-anchored vegetation regression check (run 135, ADR-0159).
 *
 * Two parts:
 * 1. A coordinate-shift correctness proof, run directly against the real `world/vegetation.js` and
 *    `world/terrain.js` modules (no `game3d.js` involved) — confirms the shifted-sampler technique
 *    `game3d.js` uses (query the real height sampler at `x + spawnWorld.x, z + spawnWorld.z`, then
 *    translate the returned group by the same offset) produces instances whose *final, translated*
 *    world position always samples the exact same height a direct, unshifted call to the real
 *    sampler would give at that same absolute point — the property that keeps trees from floating or
 *    sinking relative to the real terrain once translated.
 * 2. A real mobile-context `game3d.html` boot proving the feature actually wires up end-to-end: the
 *    `[game3d] Mobile spawn-anchored vegetation:` console line appears with a non-zero placed count,
 *    and a same-context desktop-class boot (no touch emulation) never logs it at all — desktop stays
 *    on its own unchanged, already-wide-enough origin disc.
 */
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
void ROOT;

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[mobile-spawn-vegetation] FAIL: Playwright is unavailable.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		// Part 1 — coordinate-shift correctness, via a throwaway page (module import only, no game3d.js).
		const correctnessPage = await browser.newPage();
		let correctness;
		try {
			await correctnessPage.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
			correctness = await correctnessPage.evaluate(async () => {
				const { createHeightSampler } = await import('/src/3d/world/terrain.js');
				const { createVegetation } = await import('/src/3d/world/vegetation.js');
				const THREE = await import('/src/3d/vendor/three/three.module.js');

				const realSampleHeightMeters = createHeightSampler(1337);
				const spawnX = 577.5;
				const spawnZ = 4058.25;
				const shiftedSampleHeightMeters = (x, z) => realSampleHeightMeters(x + spawnX, z + spawnZ);

				const result = createVegetation({
					sampleHeightMeters: shiftedSampleHeightMeters,
					seaLevelMeters: 6,
					seed: 1337 ^ 0x5350574e,
					seats: [],
					roadEdges: [],
					radiusMeters: 1000,
				});
				result.group.position.set(spawnX, 0, spawnZ);

				const m = new THREE.Matrix4();
				const p = new THREE.Vector3();
				const q = new THREE.Quaternion();
				const s = new THREE.Vector3();
				let checked = 0;
				let allHeightsMatchRealTerrain = true;
				let allWithinRadiusOfSpawn = true;
				for (const mesh of result.group.children) {
					for (let i = 0; i < mesh.count; i++) {
						mesh.getMatrixAt(i, m);
						m.decompose(p, q, s);
						// p is LOCAL to the group (pre-translate); the group's own position.set() above
						// is what makes the final world position = p + (spawnX, 0, spawnZ).
						const worldX = p.x + spawnX;
						const worldZ = p.z + spawnZ;
						const expectedHeight = realSampleHeightMeters(worldX, worldZ);
						// Float32Array-backed instance matrices round-trip position through float32
						// precision (`mesh.getMatrixAt` reads a Float32Array), so a tiny (~1e-4m) position
						// rounding error can shift the *input* to a second `realSampleHeightMeters` call
						// enough to move its FBM-noise output slightly — a real float32 storage artifact,
						// not a placement-logic bug. 1cm is generous against any plausible local terrain
						// slope at that scale while still catching a genuine wrong-sampler-input regression
						// (which would be off by meters, not millimeters).
						if (Math.abs(expectedHeight - p.y) > 0.01) allHeightsMatchRealTerrain = false;
						const distanceFromSpawn = Math.hypot(worldX - spawnX, worldZ - spawnZ);
						if (distanceFromSpawn > 1000 + 1e-6) allWithinRadiusOfSpawn = false;
						checked++;
					}
				}
				return { placedCount: result.placedCount, checked, allHeightsMatchRealTerrain, allWithinRadiusOfSpawn };
			});
		} finally {
			await correctnessPage.close();
		}
		// `checked` counts every individual mesh instance across BOTH the trunk and foliage
		// InstancedMesh of every species — each placed tree contributes one instance to each of
		// exactly 2 meshes (trunk + foliage), so the expected total is always `placedCount * 2`.
		const correctnessOk = correctness.placedCount > 0 && correctness.checked === correctness.placedCount * 2 &&
			correctness.allHeightsMatchRealTerrain && correctness.allWithinRadiusOfSpawn;
		if (!correctnessOk) {
			console.error('[mobile-spawn-vegetation] FAIL (correctness)', JSON.stringify(correctness));
			process.exit(1);
		}
		console.log(
			`[mobile-spawn-vegetation] PASS (correctness): ${correctness.placedCount} instance(s), every one's ` +
				`translated world height matches the real terrain sampler exactly and stays within the disc radius of spawn.`,
		);

		// Part 2a — real mobile-context boot logs the new spawn-anchored disc.
		const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const mobilePage = await mobileContext.newPage();
		const mobileLogs = [];
		mobilePage.on('console', (message) => mobileLogs.push(message.text()));
		await mobilePage.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await mobilePage.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			undefined,
			{ timeout: 60000, polling: 250 },
		);
		await mobileContext.close();
		const spawnVegLine = mobileLogs.find((line) => line.includes('[game3d] Mobile spawn-anchored vegetation:'));
		const mobilePlacedMatch = spawnVegLine?.match(/vegetation: (\d+)\//);
		const mobileOk = Boolean(spawnVegLine) && Number(mobilePlacedMatch?.[1]) > 0;

		// Part 2b — real desktop-context boot never logs it (unchanged desktop behavior).
		const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const desktopPage = await desktopContext.newPage();
		const desktopLogs = [];
		desktopPage.on('console', (message) => desktopLogs.push(message.text()));
		await desktopPage.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await desktopPage.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			undefined,
			{ timeout: 60000, polling: 250 },
		);
		await desktopContext.close();
		const desktopNeverLogsIt = !desktopLogs.some((line) => line.includes('[game3d] Mobile spawn-anchored vegetation:'));

		if (!mobileOk || !desktopNeverLogsIt) {
			console.error('[mobile-spawn-vegetation] FAIL (integration)', JSON.stringify({ spawnVegLine, desktopNeverLogsIt }));
			process.exit(1);
		}
		console.log(
			`[mobile-spawn-vegetation] PASS (integration): mobile boot places ${mobilePlacedMatch[1]} spawn-anchored tree(s); ` +
				`desktop boot never triggers the mobile-only path.`,
		);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[mobile-spawn-vegetation] FAIL:', error);
	process.exit(1);
});
