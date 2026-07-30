/**
 * game3dSmokeChecksScene.js — page-boot and whole-scene checks, split out of `game3dSmokeChecks.js`
 * this run (was 587/600 lines; adding this run's 2 new checks in-place would have pushed it well
 * past this project's 600-line file cap). Mirrors the same "extract into a focused module, moved
 * verbatim for the pre-existing checks" pattern DECISIONS.md ADR-0028/the original
 * `game3dSmokeChecks.js` extraction already established. Split by theme, not arbitrarily: this file
 * covers "does the page/scene itself boot and render correctly" (2D shell load, 3D mode boot, the
 * water shader's vertex-displacement invariant, the F4 debug camera); `game3dSmokeChecks.js` keeps
 * the per-entity gameplay
 * checks (settlement collider, jump arc, interaction, wolf/NPC patrol). `smokeTestGame3D.js` calls
 * both files' exports — see its own comment for the combined check list.
 *
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name, ok, details}>`. See
 * each function's own comment for what it guards against.
 * @module scripts/game3dSmokeChecksScene
 */

/** Timeout for a page navigation (`load`/`domcontentloaded`) — asset fetches happen after this.
 * Same value/convention as `game3dSmokeChecks.js`'s own copy; duplicated rather than shared/
 * imported across the two sibling check files since it's a single primitive with no other state. */
const NAV_TIMEOUT_MS = 15000;
/** Timeout for the 3D mode's boot sequence (444 terrain chunks + ~76MB of character/animal
 *  models decoded under SwiftShader software rendering in a headless sandbox can be slow — see
 *  3D_GAME_PROGRESS.md's FPS caveat). Generous on purpose to avoid environment-flaky failures. */
const GAME3D_READY_TIMEOUT_MS = 60000;

/**
 * Navigates to `url` and collects uncaught exceptions / console errors seen during the load.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @returns {Promise<{page: import('playwright').Page, errors: string[]}>}
 */
async function loadAndCollectErrors(browser, url) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
	});
	await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
	return { page, errors };
}

/**
 * Non-blocking: only a failed navigation (empty title) counts against `ok`. Console/page errors
 * are reported for visibility but never fail this check — they trace to this sandbox's
 * external-network restrictions and a pre-existing, unrelated 2D media-asset gap, not to anything
 * a 3D-mode regression could cause.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function check2DShell(browser, baseUrl) {
	const { page, errors } = await loadAndCollectErrors(browser, `${baseUrl}/index.html`);
	const title = await page.title();
	await page.close();
	const ok = title.length > 0;
	const errorNote = errors.length > 0
		? ` (${errors.length} console/page error(s) seen, non-blocking — see file header comment)`
		: '';
	return { name: '2D shell (index.html)', ok, details: `title="${title}"${errorNote}` };
}

/** @returns {Promise<{name: string, ok: boolean, details: string}>} */
async function check3DMode(browser, baseUrl) {
	const { page, errors } = await loadAndCollectErrors(browser, `${baseUrl}/game3d.html`);
	let outcome = 'timeout';
	try {
		const handle = await page.waitForFunction(
			() => {
				const el = document.getElementById('game3d-loading');
				if (!el) return 'missing-element';
				if (el.classList.contains('g3d-loading-hidden')) return 'ready';
				if (el.classList.contains('g3d-loading-error')) return 'error';
				return false;
			},
			{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
		);
		outcome = await handle.jsonValue();
	} catch (error) {
		outcome = 'timeout';
	}
	await page.close();
	const ok = outcome === 'ready' && errors.length === 0;
	const details = ok
		? 'loading screen hid (GAME_READY phase1-scene), zero console/page errors'
		: `outcome=${outcome}${errors.length ? `, errors: ${errors.join('; ')}` : ''}`;
	return { name: '3D mode (game3d.html)', ok, details };
}

/**
 * Regression guard for ADR-0048 (lake-water flicker fix): `world/water.js`'s vertex shader must
 * never compute a time-varying (or otherwise animated) vertical displacement — that displacement
 * (previously real Gerstner waves, up to ~1m) is exactly what geometrically popped the water plane
 * through shallow lake beds (some sit centimeters below `WORLD_DEFAULTS.WATER_LEVEL_METERS` — see
 * ADR-0048's `jon` example).
 *
 * **Deliberately a shader-source check, not a `geometry.attributes.position` comparison** — an
 * earlier draft of this check sampled the live mesh's CPU-side position buffer before/after
 * `updateWater()` and asserted it never changed. That was meaningless: a vertex shader's
 * displacement math runs entirely on the GPU inside `gl_Position`'s computation and is never read
 * back into the CPU-side `BufferAttribute` — the old, buggy Gerstner-wave shader would have passed
 * that exact same check too (confirmed by literally re-running it against the pre-ADR-0048 shader
 * before replacing it with this one). Instead, this asserts the real invariant that actually rules
 * the bug out: the compiled vertex shader source contains no `uTime` (the only per-frame-varying
 * uniform available to it) and no `sin(`/`cos(` calls (wave trigonometry) — if a future change
 * reintroduces either, this fails immediately, whereas the buffer-comparison approach never could.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkWaterVertexShaderStatic(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createWater } = await import('/src/3d/world/water.js');
			const water = createWater(6);
			const source = water.material.vertexShader;
			return {
				hasUTime: source.includes('uTime'),
				hasTrig: /\b(sin|cos)\s*\(/.test(source),
				sourceLength: source.length,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && result.hasUTime === false && result.hasTrig === false;
	const details = ok
		? `vertex shader (${result.sourceLength} chars) has no uTime/sin()/cos() — no vertex-stage animation possible`
		: `FAILED: ${JSON.stringify(result)}`;
	return { name: 'water vertex shader has no time-varying displacement (world/water.js, ADR-0048)', ok, details };
}

/**
 * Regression guard for ADR-0049 (F4 debug free-fly camera): confirms activation copies the source
 * camera's pose, WASD movement actually moves the free camera once active (and does nothing while
 * inactive), and a second F4 press deactivates it again — all in isolation (a real
 * `createFreeCameraController` instance against a synthetic source camera/canvas), same in-page
 * dynamic-`import()` pattern as `checkWaterVertexShaderStatic` above. Runs on the live `game3d.html`
 * page (like every other isolated check here) — the real, already-running free camera also reacts
 * to the synthetic key events dispatched below, same as `checkWolfPackAlert`'s isolated wolves
 * coexist harmlessly with the live game's own wolves; this check only asserts against its own
 * synthetic controller instance, never the live one.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkFreeCamera(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createFreeCameraController } = await import('/src/3d/debug/freeCamera.js');
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const sourceCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
			sourceCamera.position.set(10, 20, 30);
			sourceCamera.lookAt(0, 20, 0);
			const domElement = document.createElement('canvas');
			const controller = createFreeCameraController({ sourceCamera, domElement });

			const inactiveInitially = controller.active === false;
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
			controller.update(1); // must no-op while inactive, even with a key already held.
			const staysPutWhileInactive = controller.camera.position.length() === 0;

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
			const activatedOnF4 = controller.active === true;
			const poseCopiedOnActivate = controller.camera.position.distanceTo(sourceCamera.position) < 1e-6
				&& controller.camera.quaternion.angleTo(sourceCamera.quaternion) < 1e-6;

			const positionBeforeMove = controller.camera.position.clone();
			controller.update(0.5); // KeyW still held from above.
			const movedForward = controller.camera.position.distanceTo(positionBeforeMove) > 0;

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
			const deactivatedOnSecondF4 = controller.active === false;

			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
			controller.dispose();

			return {
				inactiveInitially, staysPutWhileInactive, activatedOnF4, poseCopiedOnActivate,
				movedForward, deactivatedOnSecondF4,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? 'inactive by default, no-ops while inactive, F4 activates (copies source pose)/deactivates, WASD moves it once active'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'F4 debug free-fly camera (debug/freeCamera.js, ADR-0049)', ok, details };
}

module.exports = {
	check2DShell,
	check3DMode,
	checkWaterVertexShaderStatic,
	checkFreeCamera,
};
