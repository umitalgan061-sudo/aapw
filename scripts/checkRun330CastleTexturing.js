#!/usr/bin/env node
/**
 * checkRun330CastleTexturing.js — ADR-0275 evidence, and a standing guard against the class of bug
 * run 330 found: a texture that is *applied* in code but cannot possibly be *seen* on screen.
 *
 * The real castle models carried a procedural stone material from ADR-0074 (run 54) until run 330
 * without ever showing it. The `.glb` exports have no `uv` attribute — several have no `normal`
 * either — so every fragment sampled texel (0,0) of the stone map and lit it with no surface normal.
 * Reviewing the code could not reveal this; only rendering it could. Separately, `paintStoneColor`
 * wrote `THREE.Color`'s **linear** components into a canvas tagged **sRGB**, darkening every castle
 * in the game (procedural ones included) to roughly rgb(47,45,40) mud.
 *
 * Asserted:
 *   - every one of the 14 kingdom seats gets a real castle pivot (no seat left on the procedural
 *     placeholder), each sitting exactly on its seat's ground height and centred on its seat;
 *   - every castle mesh has BOTH `uv` and `normal` attributes after `spawnRealCastleModels` — the
 *     direct regression guard for the invisible-texture bug;
 *   - generated UVs actually span more than one texture tile (a `uv` attribute that is all zeros
 *     would satisfy "has uv" while reproducing the original bug exactly);
 *   - the stone colour map is a plausible mid-tone stone, not near-black — the guard for the colour
 *     space bug, asserted on the decoded pixels of the real generated canvas;
 *   - seats sharing one castle file share its geometry (the clone path must not duplicate buffers);
 *   - a rendered GPU pixel read-back proves a castle is neither a black silhouette nor a flat
 *     untextured blob: it must show real luminance variation across its own surface.
 *
 * Usage: `node scripts/checkRun330CastleTexturing.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun330CastleTexturing
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run330-castles');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun330CastleTexturing] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForTimeout(9000);

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { spawnRealCastleModels, CASTLE_MODEL_ASSIGNMENTS, KINGDOM_SEATS, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { gameEvents } = await import('/src/3d/eventBus.js');
			const { WORLD_SCALE } = await import('/src/3d/config.js');

			const failures = [];
			const SEAT_GROUND_Y = 60;
			const loader = new AssetLoader(gameEvents);
			const seats = KINGDOM_SEATS.map((seat) => {
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, name: seat.name, x, z, groundY: SEAT_GROUND_Y };
			});
			const group = await spawnRealCastleModels({ assetLoader: loader, seats, seed: 1337 });

			// --- every seat covered, placed and grounded ------------------------------------------
			if (CASTLE_MODEL_ASSIGNMENTS.length !== KINGDOM_SEATS.length) {
				failures.push(`${CASTLE_MODEL_ASSIGNMENTS.length} castle assignments for ${KINGDOM_SEATS.length} seats — a seat is still on the procedural placeholder`);
			}
			const placedSeatIds = new Set(group.children.map((pivot) => pivot.userData.kingdomSeatId));
			for (const seat of KINGDOM_SEATS) {
				if (!placedSeatIds.has(seat.id)) failures.push(`seat "${seat.id}" has no real castle placed`);
			}

			const box = new THREE.Box3();
			const size = new THREE.Vector3();
			const center = new THREE.Vector3();
			const geometryUseCount = new Map();

			for (const pivot of group.children) {
				const seatId = pivot.userData.kingdomSeatId;
				box.setFromObject(pivot);
				box.getSize(size);
				box.getCenter(center);

				if (Math.abs(box.min.y - SEAT_GROUND_Y) > 0.5) {
					failures.push(`${seatId}: castle base at y=${box.min.y.toFixed(2)}, expected to rest on seat ground y=${SEAT_GROUND_Y} (floating or sunk)`);
				}
				if (Math.hypot(center.x - pivot.position.x, center.z - pivot.position.z) > 1.5) {
					failures.push(`${seatId}: castle centre is ${Math.hypot(center.x - pivot.position.x, center.z - pivot.position.z).toFixed(2)}m off its own seat (yaw applied about the wrong pivot?)`);
				}
				// A castle that came out at a couple of metres means a compounded scale — the exact
				// failure mode of measuring an already-transformed model before cloning it.
				const footprint = Math.max(size.x, size.z);
				if (footprint < 25 || footprint > 90) {
					failures.push(`${seatId}: castle footprint ${footprint.toFixed(1)}m is outside the sane 25-90m band (scale compounded or lost)`);
				}

				pivot.traverse((node) => {
					if (!node.isMesh) return;
					geometryUseCount.set(node.geometry, (geometryUseCount.get(node.geometry) ?? 0) + 1);

					if (!node.geometry.attributes.normal) failures.push(`${seatId}: mesh has no "normal" attribute — MeshStandardMaterial cannot light it`);
					const uv = node.geometry.attributes.uv;
					if (!uv) {
						failures.push(`${seatId}: mesh has no "uv" attribute — the stone map can only ever sample texel (0,0)`);
						return;
					}
					// "Has a uv attribute" is not enough: an all-zero uv reproduces the original bug.
					// What actually matters is the *effective* tiling — uv span multiplied by the
					// material's own repeat — because the two UV conventions in play here are scaled
					// oppositely: a generated UV is already in real-world tiles and pairs with
					// `repeat: 1`, while an authored UV spans the normalised 0..1 and relies on a
					// repeat above 1 to tile at all. Asserting the product covers both without
					// hard-coding which model uses which.
					let minU = Infinity;
					let maxU = -Infinity;
					for (let i = 0; i < uv.count; i++) {
						const u = uv.getX(i);
						if (u < minU) minU = u;
						if (u > maxU) maxU = u;
					}
					const uvSpan = maxU - minU;
					const repeatX = node.material?.map?.repeat?.x ?? 1;
					const effectiveTiles = uvSpan * repeatX;
					if (!(uvSpan > 0.05)) {
						failures.push(`${seatId}: uv span is ${uvSpan.toFixed(4)} — effectively a single texel, the original invisible-texture bug`);
					} else if (!(effectiveTiles > 1.5)) {
						failures.push(`${seatId}: effective tiling is ${effectiveTiles.toFixed(2)} (uv span ${uvSpan.toFixed(2)} x repeat ${repeatX}) — one stone tile stretched over the whole castle`);
					}
				});
			}

			// --- shared geometry across seats that share a file ------------------------------------
			const fileUse = new Map();
			for (const assignment of CASTLE_MODEL_ASSIGNMENTS) {
				fileUse.set(assignment.file, (fileUse.get(assignment.file) ?? 0) + 1);
			}
			const sharedFiles = [...fileUse.values()].filter((count) => count > 1).length;
			const sharedGeometries = [...geometryUseCount.values()].filter((count) => count > 1).length;
			if (sharedFiles > 0 && sharedGeometries === 0) {
				failures.push(`${sharedFiles} castle file(s) are used by more than one seat, but no geometry is shared — each clone duplicated its buffers`);
			}

			// --- stone colour map must be a real mid-tone, not the near-black mud -----------------
			const { createStoneMaterial } = await import('/src/3d/world/materials.js');
			const probe = createStoneMaterial({ seed: 7, baseColor: new THREE.Color(0x8a8578), repeat: 1 });
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 32;
			const ctx = canvas.getContext('2d');
			ctx.drawImage(probe.map.image, 0, 0, 32, 32);
			const pixels = ctx.getImageData(0, 0, 32, 32).data;
			let sum = 0;
			for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
			const meanLuma = sum / (pixels.length / 4);
			// 0x8a8578 is ~133 mean in sRGB; the shade ramp darkens it to roughly 0.72-1.0 of that, so
			// anything under ~80 means the linear/sRGB double-darkening is back.
			if (meanLuma < 80) {
				failures.push(`stone colour map mean luminance is ${meanLuma.toFixed(1)}/255 — too dark for a 0x8a8578 base (linear components written into an sRGB canvas again?)`);
			}
			probe.map.dispose();
			probe.dispose();

			return {
				failures,
				seats: KINGDOM_SEATS.length,
				placed: group.children.length,
				sharedFiles,
				sharedGeometries,
				meanLuma: Number(meanLuma.toFixed(1)),
			};
		});

		if (result.failures.length > 0) {
			console.error(`[checkRun330CastleTexturing] FAIL:\n  ${result.failures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		// --- rendered proof: a castle must show real surface variation, not one flat tone ----------
		const pixelProof = await page.evaluate(async () => {
			const THREE = await import('three');
			const { spawnRealCastleModels, KINGDOM_SEATS, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { gameEvents } = await import('/src/3d/eventBus.js');
			const { WORLD_SCALE } = await import('/src/3d/config.js');

			const loader = new AssetLoader(gameEvents);
			const seats = KINGDOM_SEATS.map((seat) => {
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				return { id: seat.id, name: seat.name, x, z, groundY: 0 };
			});
			const group = await spawnRealCastleModels({ assetLoader: loader, seats, seed: 1337 });

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x9fb8cc);
			scene.add(new THREE.HemisphereLight(0xf0f6ff, 0x55603c, 2.0));
			const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
			sun.position.set(40, 70, 30);
			scene.add(sun);

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1200, 700, false);
			const camera = new THREE.PerspectiveCamera(42, 1200 / 700, 0.5, 3000);
			const gl = renderer.getContext();

			const pivot = group.children.find((child) => child.userData.kingdomSeatId === 'stannis') ?? group.children[0];
			const clone = pivot.clone(true);
			clone.position.set(0, 0, 0);
			scene.add(clone);
			const bounds = new THREE.Box3().setFromObject(clone);
			const extent = new THREE.Vector3();
			bounds.getSize(extent);
			const reach = Math.max(extent.x, extent.z);
			camera.position.set(reach * 1.25, extent.y * 0.55 + 8, reach * 1.25);
			camera.lookAt(0, extent.y * 0.4, 0);
			renderer.render(scene, camera);
			const shot = renderer.domElement.toDataURL('image/png');

			const buffer = new Uint8Array(1200 * 700 * 4);
			gl.readPixels(0, 0, 1200, 700, gl.RGBA, gl.UNSIGNED_BYTE, buffer);

			// Sample only pixels that are neither sky nor ground: whatever is left is castle.
			const lumas = [];
			for (let i = 0; i < buffer.length; i += 4) {
				const r = buffer[i];
				const g = buffer[i + 1];
				const b = buffer[i + 2];
				const isSky = b > r + 20 && b > 120;
				const isGround = g > r + 20 && g > 80;
				if (isSky || isGround) continue;
				lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
			}
			renderer.dispose();

			if (lumas.length < 500) return { shot, castlePixels: lumas.length, meanLuma: 0, stdDev: 0 };
			const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
			const variance = lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length;
			return { shot, castlePixels: lumas.length, meanLuma: mean, stdDev: Math.sqrt(variance) };
		});

		fs.writeFileSync(path.join(ARTIFACT_DIR, 'regression-stannis.png'), Buffer.from(pixelProof.shot.split(',')[1], 'base64'));

		const renderFailures = [];
		if (pixelProof.castlePixels < 500) renderFailures.push(`only ${pixelProof.castlePixels} castle pixels found — the castle did not render`);
		if (pixelProof.meanLuma < 45) renderFailures.push(`castle mean luminance ${pixelProof.meanLuma.toFixed(1)}/255 — rendering as a near-black silhouette again`);
		if (pixelProof.stdDev < 8) renderFailures.push(`castle luminance std-dev ${pixelProof.stdDev.toFixed(1)} — a flat untextured blob, no masonry detail is reaching the screen`);
		if (renderFailures.length > 0) {
			console.error(`[checkRun330CastleTexturing] FAIL:\n  ${renderFailures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		if (pageErrors.length > 0) {
			console.error(`[checkRun330CastleTexturing] FAIL: uncaught page errors: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}

		console.log(
			`[checkRun330CastleTexturing] PASS: ${result.placed}/${result.seats} seats carry a real castle, every mesh has uv+normal ` +
				`with real tile span, ${result.sharedGeometries} geometry set(s) shared across the ${result.sharedFiles} reused file(s), ` +
				`stone colour map mean ${result.meanLuma}/255 (not the pre-fix ~47 mud). Rendered proof: ${pixelProof.castlePixels} castle ` +
				`pixels, mean luma ${pixelProof.meanLuma.toFixed(1)}, std-dev ${pixelProof.stdDev.toFixed(1)} (real masonry variation). ` +
				`Screenshot in artifacts/run330-castles/.`,
		);
	} catch (error) {
		console.error(`[checkRun330CastleTexturing] FAIL: ${error.message}\n${error.stack}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
