/**
 * game3dSmokeChecksScene.js — page-boot checks, split out of `game3dSmokeChecks.js` at run 40 (was
 * 587/600 lines; adding that run's 2 new checks in-place would have pushed it well past this
 * project's 600-line file cap). Mirrors the same "extract into a focused module, moved verbatim for
 * the pre-existing checks" pattern DECISIONS.md ADR-0028/the original `game3dSmokeChecks.js`
 * extraction already established.
 *
 * **Split again, run 88** (this file had reached 573/600, flagged approaching-the-cap since run 87's
 * Next step — `checkSmokeCheckRegistry.js`'s WARN, not yet an actual violation, but the next run
 * touching it was asked to plan a split rather than push it past 600, same precedent runs 40/64/68/82
 * already set for exactly this scenario). This file now keeps only "does the page/scene itself boot
 * and render correctly" (2D shell load, 3D mode boot, the water shader's vertex-displacement
 * invariant); the F4 debug camera, F2 profiling panel, and world-event system + its day/night gating
 * moved into the new `game3dSmokeChecksDebugTools.js` — all four are singleton systems exercised via
 * the same in-page dynamic-`import()` pattern, distinct from this file's page-navigation-level checks.
 * `game3dSmokeChecks.js` keeps the non-movement per-entity gameplay checks (settlement collider, jump
 * arc, interaction). `smokeTestGame3D.js` calls every check module's exports — see its own comment
 * for the current module list and the combined check list, which is the authoritative one; run 68
 * (DECISIONS.md ADR-0087) split the check modules again and this header's per-file breakdown is a
 * summary, not the registry.
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
 *
 * **Hermetic by design (run 76, DECISIONS.md ADR-0099).** Every request to an origin other than the
 * local static server is aborted before it leaves the browser, so this navigation never touches the
 * real network. This is a flakiness fix with a measured root cause, not a precaution: `index.html`
 * references 5 external resources (3 Firebase CDN scripts, Google Fonts, cdnjs font-awesome) that
 * this sandbox cannot reach, and they do **not** fail fast — each one hangs until the sandbox resets
 * the connection at ~12.6-13.4s. Because those are render/parser-blocking `<link>`/`<script>` tags,
 * they delayed even `domcontentloaded` to ~13s, leaving only ~1.6s of headroom under
 * `NAV_TIMEOUT_MS` — so ordinary jitter intermittently pushed `check2DShell` over the limit. That
 * exact `page.goto: Timeout 15000ms exceeded` flake was recorded as an environment quirk in run 68
 * and hit again in run 76; blocking the unreachable requests removes the wait entirely (measured on
 * this very function, 6 consecutive calls: ~13,000ms -> 104-445ms), which is what makes the timeout
 * flake structurally impossible rather than merely unlikely.
 *
 * Scope note, measured rather than assumed: this fixes the *timeout*, not the long-standing 10-11
 * fluctuation in the non-blocking console-error count — that was re-measured after this fix and
 * still varies between 10 and 11 across full-suite runs (the tail of the aborted requests' console
 * errors races `page.close()`). It stays non-blocking and unasserted for exactly that reason; do not
 * be tempted to assert an exact count here without first making that race deterministic.
 *
 * `game3d.html` references no external origins at all (verified run 76), so blocking is a no-op for
 * the 3D path in the current tree — but it is applied there too on purpose: this project's Altın
 * Kural 4 requires the 3D mode to be offline-PWA-capable, so a future external dependency sneaking
 * into the 3D path is a real regression, and `externalBlocked` surfacing a non-zero count on a
 * `game3d.html` load is exactly how it would get noticed.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {string} baseUrl Local static-server origin; every other origin is aborted.
 * @returns {Promise<{page: import('playwright').Page, errors: string[], externalBlocked: number}>}
 */
async function loadAndCollectErrors(browser, url, baseUrl) {
	const page = await browser.newPage();
	const errors = [];
	// Uncaught `pageerror`s are tracked separately from `console.error`s (run 83, ADR-0109). The two
	// are not the same severity: a `console.error` here is usually this sandbox reporting a blocked
	// external request or a `.gitignore`d media file (`/resimler/`, `/videolar/`), i.e. an artifact
	// of the hermetic environment. An uncaught `pageerror` is a real thrown exception that aborted
	// whatever script raised it — which is exactly how the 2D game's offline crash went unnoticed
	// for 83 runs, averaged into an "11 errors, non-blocking" count.
	const pageErrors = [];
	let externalBlocked = 0;
	page.on('pageerror', (err) => {
		errors.push(`pageerror: ${err.message}`);
		pageErrors.push(err.message);
	});
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
	});
	await page.route('**/*', (route, request) => {
		const requestUrl = request.url();
		const isLocal = requestUrl.startsWith(baseUrl)
			|| requestUrl.startsWith('data:')
			|| requestUrl.startsWith('blob:');
		if (isLocal) return route.continue();
		externalBlocked += 1;
		return route.abort();
	});
	await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
	return { page, errors, pageErrors, externalBlocked };
}

/**
 * Guards Altın Kural 1 ("preserve the existing 2D game") against the specific failure ADR-0109
 * fixed: with every external origin blocked (the offline/installed-PWA case, since the Firebase SDK
 * is loaded from Google's CDN), `script.js` used to throw an uncaught `ReferenceError: firebase is
 * not defined` on its second line and abort the entire 4,100-line game script.
 *
 * Two assertions, deliberately at different strictness:
 * - **Hard (fails the check):** zero uncaught `pageerror`s, and `script.js` must run to completion.
 *   Completion is proven by the file's own last statement, a `console.log` — a real end-of-file
 *   marker, not a proxy like "some global exists" that an early abort could still satisfy.
 * - **Soft (reported only):** the `console.error` count. Those are dominated by this sandbox's
 *   blocked external requests and by `/resimler/`+`/videolar/` media that `.gitignore` deliberately
 *   keeps out of the repo, so failing on them would make this check environment-dependent.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function check2DShell(browser, baseUrl) {
	const page = await browser.newPage();
	const errors = [];
	const pageErrors = [];
	let externalBlocked = 0;
	let ranToCompletion = false;
	page.on('pageerror', (err) => {
		errors.push(`pageerror: ${err.message}`);
		pageErrors.push(err.message);
	});
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
		// `script.js`'s own final statement — see its last line. Reaching it proves the whole file
		// executed, which is precisely what the pre-ADR-0109 crash prevented.
		if (msg.text().includes('Script başarıyla yüklendi')) ranToCompletion = true;
	});
	await page.route('**/*', (route, request) => {
		const requestUrl = request.url();
		const isLocal = requestUrl.startsWith(baseUrl)
			|| requestUrl.startsWith('data:')
			|| requestUrl.startsWith('blob:');
		if (isLocal) return route.continue();
		externalBlocked += 1;
		return route.abort();
	});
	await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
	const title = await page.title();
	await page.close();

	const ok = title.length > 0 && pageErrors.length === 0 && ranToCompletion;
	const consoleErrorCount = errors.length - pageErrors.length;
	const details = ok
		? `title="${title}", zero uncaught pageerrors and script.js ran to completion with all `
			+ `${externalBlocked} external request(s) blocked (ADR-0109 offline guard); `
			+ `${consoleErrorCount} console.error(s) seen — blocked CDNs + .gitignore'd media, soft-reported`
		: `title="${title}"`
			+ (pageErrors.length ? `, ${pageErrors.length} UNCAUGHT pageerror(s): ${pageErrors.join('; ')}` : '')
			+ (ranToCompletion ? '' : ', script.js did NOT run to completion (aborted early — see ADR-0109)')
			+ ` [hermetic: ${externalBlocked} external request(s) blocked]`;
	return { name: '2D shell (index.html) — offline/no-CDN resilience', ok, details };
}

/** @returns {Promise<{name: string, ok: boolean, details: string}>} */
async function check3DMode(browser, baseUrl) {
	const { page, errors, externalBlocked } = await loadAndCollectErrors(
		browser,
		`${baseUrl}/game3d.html`,
		baseUrl,
	);
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
	// `externalBlocked` must be 0 here, and that is a real assertion rather than a diagnostic: Altın
	// Kural 4 requires the 3D mode to run offline, so any request the 3D path makes to a non-local
	// origin is an offline-PWA regression — the boot only appeared to succeed because this sandbox
	// happened to have a network. See `loadAndCollectErrors`'s comment (ADR-0099).
	const ok = outcome === 'ready' && errors.length === 0 && externalBlocked === 0;
	const details = ok
		? 'loading screen hid (GAME_READY phase1-scene), zero console/page errors, zero external requests (offline-capable)'
		: `outcome=${outcome}${errors.length ? `, errors: ${errors.join('; ')}` : ''}`
			+ (externalBlocked > 0
				? `, ${externalBlocked} external request(s) attempted — violates the offline-PWA rule (Altın Kural 4)`
				: '');
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

module.exports = {
	check2DShell,
	check3DMode,
	checkWaterVertexShaderStatic,
};
