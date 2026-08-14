#!/usr/bin/env node
/**
 * checkRun338CartGradeSpeed.js — evidence for `gameplay/cartBrain.js`'s grade-aware cart speed
 * (run 338, ADR-0284), closing run 336/337's own repeatedly-named gap: "the cart moves at one
 * constant speedMps regardless of a given road segment's real grade".
 *
 * Asserted:
 *   - Flat/comfort-grade travel (<= ROAD_COMFORT_GRADE_DEGREES) is unchanged from the pre-338
 *     constant-speed behaviour — a real regression guard against the world's overwhelmingly flat-to-
 *     gentle cart-road network suddenly slowing down everywhere.
 *   - A steep uphill segment measurably slows the cart: covering the same real distance takes longer
 *     than the flat case.
 *   - A steep downhill segment measurably speeds the cart up, capped at `DOWNHILL_MAX_SPEED_FRACTION`.
 *   - The *same* edge is uphill one travel direction and downhill the other — grade is a function of
 *     direction of travel, not a per-edge constant (proven by comparing forward vs. reversed traversal
 *     of one asymmetric-slope edge).
 *   - Wheel spin rate scales with the same effective speed as translation (they never drift apart).
 *   - Determinism: identical inputs (edge, seed, elapsed simulated time) produce byte-identical output
 *     positions across two independent calls.
 *   - `game3d.html` boots with the grade-aware cart still wired in, zero uncaught page errors.
 *   - Rendered before/after proof (GPU pixel read-back): an uphill cart visibly covers less ground
 *     than a flat cart over the same real time window.
 *
 * Usage: `node scripts/checkRun338CartGradeSpeed.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun338CartGradeSpeed
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run338-cart-grade-speed');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun338CartGradeSpeed] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForTimeout(9000);

		// --- pure-logic assertions (no live scene needed) -------------------------------------------
		const logic = await page.evaluate(async () => {
			const { createCartBeing, CART_CONFIG } = await import('/src/3d/gameplay/cartBrain.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');
			const failures = [];
			const BASE_SPEED = CART_CONFIG.speedMps;

			/**
			 * Runs a cart on `edge` for `totalSeconds` and groups every moving (non-paused) frame's
			 * instantaneous speed by which way it was travelling (+x vs -x) at that frame. Deliberately
			 * does NOT try to pin the cart's seeded start position/direction — a straight two-point edge
			 * has exactly one grade in each direction regardless of *where* along it the cart starts, and
			 * ping-ponging naturally visits both directions within one run, so there is nothing to control
			 * for. Returns the median observed speed for each direction (median, not mean/first-sample, so
			 * the handful of transitional frames right at a reversal/pause boundary can't skew the result).
			 */
			function sampleDirectionalSpeeds(edge, cartId, totalSeconds) {
				const being = createCartBeing({ cartId, edge, mulberry32 });
				const delta = 0.1;
				const plusSpeeds = [];
				const minusSpeeds = [];
				let prevX = being.object3D.position.x;
				for (let t = 0; t < totalSeconds; t += delta) {
					being.update(delta);
					const x = being.object3D.position.x;
					const dx = x - prevX;
					prevX = x;
					if (Math.abs(dx) < 1e-6) continue; // paused frame — excluded, not a speed sample
					(dx > 0 ? plusSpeeds : minusSpeeds).push(Math.abs(dx) / delta);
				}
				being.dispose();
				function median(arr) {
					if (arr.length === 0) return null;
					const sorted = [...arr].sort((a, b) => a - b);
					return sorted[Math.floor(sorted.length / 2)];
				}
				return { plusSpeed: median(plusSpeeds), minusSpeed: median(minusSpeeds) };
			}

			// 1) Flat 100m edge (0° grade in both directions) — baseline, unchanged from pre-338
			// constant-speed math: both directions should measure the base 2.0 m/s.
			const flatEdge = { fromId: 'f1', toId: 'f2', points: [{ x: 0, y: 10, z: 0 }, { x: 100, y: 10, z: 0 }], lengthMeters: 100 };
			const flat = sampleDirectionalSpeeds(flatEdge, 'cart-flat', 220);
			for (const [dirLabel, speed] of [['+x', flat.plusSpeed], ['-x', flat.minusSpeed]]) {
				if (speed === null) failures.push(`flat edge: no ${dirLabel} moving frames observed in the sample window`);
				else if (Math.abs(speed - BASE_SPEED) > 0.05) failures.push(`flat edge ${dirLabel} median speed ${speed.toFixed(3)}m/s, expected ~${BASE_SPEED}m/s (unchanged base speed)`);
			}

			// 2) Gentle 8° edge (under ROAD_COMFORT_GRADE_DEGREES=10) — both directions must still read
			// ~base speed (the "still comfortable, don't slow it" regression guard).
			const gentleRise = 100 * Math.tan((8 * Math.PI) / 180);
			const gentleEdge = { fromId: 'g1', toId: 'g2', points: [{ x: 0, y: 10, z: 0 }, { x: 100, y: 10 + gentleRise, z: 0 }], lengthMeters: 100 };
			const gentle = sampleDirectionalSpeeds(gentleEdge, 'cart-gentle', 220);
			for (const [dirLabel, speed] of [['+x', gentle.plusSpeed], ['-x', gentle.minusSpeed]]) {
				if (speed === null) failures.push(`gentle 8° edge: no ${dirLabel} moving frames observed in the sample window`);
				else if (Math.abs(speed - BASE_SPEED) > 0.05) failures.push(`gentle 8° edge ${dirLabel} median speed ${speed.toFixed(3)}m/s, expected ~${BASE_SPEED}m/s (at/under the comfort-grade threshold, no slowdown expected)`);
			}

			// 3) Steep 35° edge — climbing (+x, since y rises with x) must be slower than base, descending
			// (-x) must be faster than base and capped at DOWNHILL_MAX_SPEED_FRACTION.
			const steepRise = 100 * Math.tan((35 * Math.PI) / 180);
			const steepEdge = { fromId: 's1', toId: 's2', points: [{ x: 0, y: 10, z: 0 }, { x: 100, y: 10 + steepRise, z: 0 }], lengthMeters: 100 };
			const steep = sampleDirectionalSpeeds(steepEdge, 'cart-steep', 700); // longer window — the uphill leg alone can take ~140s
			const expectedUpSpeed = BASE_SPEED * 0.35; // UPHILL_MIN_SPEED_FRACTION, grade well past STEEP_GRADE_DEGREES
			const expectedDownSpeed = BASE_SPEED * 1.3; // DOWNHILL_MAX_SPEED_FRACTION, same clamp
			if (steep.plusSpeed === null) failures.push('steep edge: no uphill (+x) moving frames observed in the sample window');
			else if (Math.abs(steep.plusSpeed - expectedUpSpeed) > 0.1) failures.push(`steep uphill median speed ${steep.plusSpeed.toFixed(3)}m/s, expected ~${expectedUpSpeed.toFixed(3)}m/s (base x UPHILL_MIN_SPEED_FRACTION)`);
			if (steep.minusSpeed === null) failures.push('steep edge: no downhill (-x) moving frames observed in the sample window');
			else if (Math.abs(steep.minusSpeed - expectedDownSpeed) > 0.1) failures.push(`steep downhill median speed ${steep.minusSpeed.toFixed(3)}m/s, expected ~${expectedDownSpeed.toFixed(3)}m/s (base x DOWNHILL_MAX_SPEED_FRACTION cap)`);
			if (steep.plusSpeed !== null && steep.minusSpeed !== null && !(steep.minusSpeed > steep.plusSpeed * 2)) {
				failures.push(`steep edge: downhill (${steep.minusSpeed.toFixed(3)}m/s) should be markedly faster than uphill (${steep.plusSpeed.toFixed(3)}m/s) on the identical edge`);
			}

			// 4) Wheel spin stays proportional to translation under a grade (never drifts apart from the
			// grade-eased speed): sample one clean moving frame on the steep edge and confirm
			// |Δx| / |Δwheelangle| still equals wheelRadiusMeters, same relationship the flat case has.
			const wheelBeing = createCartBeing({ cartId: 'cart-wheel-grade', edge: steepEdge, mulberry32 });
			const wheelPivot = wheelBeing.object3D.children.find((c) => c.isGroup && c.children[0]?.isMesh && c.children.length === 1);
			let wheelRatioChecked = false;
			for (let i = 0; i < 40 && !wheelRatioChecked; i++) {
				const xBefore = wheelBeing.object3D.position.x;
				const angleBefore = wheelPivot.rotation.x;
				wheelBeing.update(0.1);
				const dx = wheelBeing.object3D.position.x - xBefore;
				const dAngle = wheelPivot.rotation.x - angleBefore;
				if (Math.abs(dx) < 1e-6) continue; // skip paused/reversal frames
				const impliedRadius = Math.abs(dx) / Math.abs(dAngle);
				if (Math.abs(impliedRadius - CART_CONFIG.wheelRadiusMeters) > 0.01) {
					failures.push(`under a grade, distance/rotation implied wheel radius ${impliedRadius.toFixed(3)}m, expected ${CART_CONFIG.wheelRadiusMeters}m — wheel spin drifted from translation speed`);
				}
				wheelRatioChecked = true;
			}
			if (!wheelRatioChecked) failures.push('wheel-radius check: never observed a clean moving frame to sample');
			wheelBeing.dispose();

			// 5) Determinism: two independently-built carts with the same id/seed take the identical
			// position at every sampled frame over a real run (not just at t=0).
			const detA = createCartBeing({ cartId: 'cart-det', edge: steepEdge, mulberry32 });
			const detB = createCartBeing({ cartId: 'cart-det', edge: steepEdge, mulberry32 });
			let determinismOk = true;
			for (let i = 0; i < 50; i++) {
				detA.update(0.1);
				detB.update(0.1);
				if (Math.abs(detA.object3D.position.x - detB.object3D.position.x) > 1e-9) determinismOk = false;
			}
			if (!determinismOk) failures.push('same cartId/edge/seed gave diverging positions over a run — not deterministic');
			detA.dispose();
			detB.dispose();

			return { failures, flat, gentle, steep };
		});

		if (logic.failures.length > 0) {
			console.error(`[checkRun338CartGradeSpeed] FAIL:\n  ${logic.failures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		if (pageErrors.length > 0) {
			console.error(`[checkRun338CartGradeSpeed] FAIL: game3d.html threw with grade-aware cart logic wired in: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}

		// --- rendered before/after proof: an uphill cart covers visibly less ground than a flat cart,
		// both carts in the same shot (offset in Z) so one screenshot pair shows the contrast directly --
		const pixelProof = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createCartBeing } = await import('/src/3d/gameplay/cartBrain.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0xa9c4d8);
			scene.add(new THREE.HemisphereLight(0xf3f7ff, 0x556b3c, 2.4));
			const sun = new THREE.DirectionalLight(0xffffff, 2.6);
			sun.position.set(3, 6, 5);
			scene.add(sun);
			const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x9c7b4a }));
			ground.rotation.x = -Math.PI / 2;
			scene.add(ground);

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1280, 720, false);
			const camera = new THREE.PerspectiveCamera(35, 1280 / 720, 0.1, 400);
			camera.position.set(15, 22, 30);
			camera.lookAt(15, 0, -8);

			function makeCartOnEdge(edge, cartId) {
				const being = createCartBeing({ cartId, edge, mulberry32 });
				being.object3D.position.set(edge.points[0].x, edge.points[0].y, edge.points[0].z);
				scene.add(being.object3D);
				return being;
			}

			// Two lanes (offset in Z) so both carts are visible in one frame: a flat lane and, right
			// next to it, a steep-uphill lane of the identical horizontal length.
			const flatEdge = { fromId: 'pf1', toId: 'pf2', points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], lengthMeters: 100 };
			const steepRise = 100 * Math.tan((35 * Math.PI) / 180);
			const steepEdge = { fromId: 'ps1', toId: 'ps2', points: [{ x: 0, y: 0, z: -16 }, { x: 100, y: steepRise, z: -16 }], lengthMeters: 100 };

			const flatCart = makeCartOnEdge(flatEdge, 'proof-flat');
			const steepCart = makeCartOnEdge(steepEdge, 'proof-steep');

			function shot() {
				renderer.render(scene, camera);
				return renderer.domElement.toDataURL('image/png');
			}

			const before = shot();
			for (let i = 0; i < 150; i++) {
				flatCart.update(0.1);
				steepCart.update(0.1);
			} // 15s of travel each
			const after = shot();
			const flatX = flatCart.object3D.position.x;
			const steepX = steepCart.object3D.position.x;
			flatCart.dispose();
			steepCart.dispose();
			renderer.dispose();
			return { before, after, flatX, steepX };
		});

		fs.writeFileSync(path.join(ARTIFACT_DIR, 'cart-grade-1-before.png'), Buffer.from(pixelProof.before.split(',')[1], 'base64'));
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'cart-grade-2-after.png'), Buffer.from(pixelProof.after.split(',')[1], 'base64'));

		if (!(pixelProof.flatX > pixelProof.steepX + 3)) {
			console.error(
				`[checkRun338CartGradeSpeed] FAIL: after 15s, flat-edge cart (x=${pixelProof.flatX.toFixed(2)}) should have ` +
					`travelled meaningfully further than the steep-uphill cart (x=${pixelProof.steepX.toFixed(2)})`,
			);
			process.exitCode = 1;
			return;
		}

		console.log(
			`[checkRun338CartGradeSpeed] PASS: flat edge both directions ~${logic.flat.plusSpeed.toFixed(2)}/` +
				`${logic.flat.minusSpeed.toFixed(2)}m/s (unchanged base speed), gentle-8° edge both directions ~` +
				`${logic.gentle.plusSpeed.toFixed(2)}/${logic.gentle.minusSpeed.toFixed(2)}m/s (at/under the comfort-grade ` +
				`threshold, no slowdown), steep-35° edge uphill ${logic.steep.plusSpeed.toFixed(2)}m/s vs downhill ` +
				`${logic.steep.minusSpeed.toFixed(2)}m/s on the identical edge (correctly clamped at the ` +
				`UPHILL_MIN_SPEED_FRACTION/DOWNHILL_MAX_SPEED_FRACTION caps), wheel spin stays proportional to ` +
				`translation under a grade, deterministic across two independent same-seed runs, game3d.html booted ` +
				`with 0 page errors. Rendered proof: after 15s a flat-edge cart reached x=${pixelProof.flatX.toFixed(1)} ` +
				`vs a steep-uphill cart's x=${pixelProof.steepX.toFixed(1)} on an identical edge length. 2 screenshots ` +
				`in artifacts/run338-cart-grade-speed/.`,
		);
	} catch (error) {
		console.error(`[checkRun338CartGradeSpeed] FAIL: ${error.message}\n${error.stack}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
