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
 * and render correctly" (2D shell load, 3D mode boot, the water shader's depth-tapered swell
 * invariant); the F4 debug camera, F2 profiling panel, and world-event system + its day/night gating
 * moved into the new `game3dSmokeChecksDebugTools.js` — all four are singleton systems exercised via
 * the same in-page dynamic-`import()` pattern, distinct from this file's page-navigation-level checks.
 * `game3dSmokeChecks.js` keeps the non-movement per-entity gameplay checks (settlement collider, jump
 * arc, interaction). `smokeTestGame3D.js` calls every check module's exports — see its own comment
 * for the current module list and the combined check list, which is the authoritative one; run 68
 * (DECISIONS.md ADR-0087) split the check modules again and this header's per-file breakdown is a
 * summary, not the registry.
 *
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name: string, ok: boolean, details: string}>`. See
 * each function's own comment for what it guards against.
 * @module scripts/game3dSmokeChecksScene
 */

/** Timeout for a page navigation (`load`/`domcontentloaded`) — asset fetches happen after this.
 * Same value/convention as `game3dSmokeChecks.js`'s own copy; duplicated rather than shared/
 * imported across the two sibling check files since it's a single primitive with no other state. */
// Run 332 RCA (game3d.js line-cap extraction, ADR-0279): this project's own boot cost has grown
// past this constant's original assumption -- run-326/330/330b/331's procedural creatures, real
// castle models, and villages pushed a real game3d.html boot to ~9-13s (observed via direct
// domcontentloaded-timing instrumentation) in this project's software-WebGL sandboxed CI/dev
// environment, which sat right at or over the old 10s/15s ceiling -- a pre-existing flake
// (already recorded as an "environment quirk" by game3dSmokeChecksScene.js's own run-68 comment)
// that reproduced on unmodified `main` in this run's own RCA, not something the run's actual code
// change caused (confirmed: that change executes strictly after the domcontentloaded event this
// timeout gates on). 30s gives real margin above the observed range, including one measured 20s+
// outlier under sandbox contention.
const NAV_TIMEOUT_MS = 30_000;
/** Timeout for the 3D mode's boot sequence (444 terrain chunks + ~76MB of character/animal
 *  models decoded under SwiftShader software rendering in a headless sandbox can be slow — see
 *  3D_GAME_PROGRESS.md's FPS caveat). Generous on purpose to avoid environment-flaky failures.
 *  Run 1039's preserved exact-head artifact showed every shipped module/gameplay assertion green
 *  while the authoritative cold GAME_READY boot alone exceeded the historical 60s ceiling. */
const GAME3D_READY_TIMEOUT_MS = 120000;

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
 * Kural 4 requires the 3D mode to run offline-PWA-capable, so a future external dependency sneaking
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
 * Regression guard for ADR-0270's depth-tapered water swell — the **successor** to the ADR-0048
 * guard this function used to be, kept at the same position in the smoke suite.
 *
 * History, because deleting it would look like a lost guard: ADR-0048 fixed a real lake-water
 * flicker (constant-amplitude Gerstner waves, ~1m, dipped the trough below shallow lake beds and
 * popped the shoreline every frame) by removing vertex displacement entirely, and this check
 * enforced that by asserting the vertex shader contained no `uTime` and no `sin(`/`cos(`. ADR-0270
 * deliberately reinstates displacement, so that source-level assertion is now provably wrong to
 * keep. What replaces it is stronger, not weaker: instead of banning the mechanism, this asserts
 * the *inequality that makes the mechanism safe* —
 *
 *     maxDisplacement(depth) = WAVE_TOTAL_AMPLITUDE_METERS * min(1, depth / FULL_WAVE_DEPTH_METERS)
 *                            < depth,   for every depth > 0
 *
 * — so the trough can never reach the bed at any depth, which is the actual property ADR-0048's
 * flicker violated. A future amplitude/full-depth tweak that breaks the inequality fails here.
 *
 * Also asserted, since the inequality alone would not catch a shader that ignored the taper: the
 * displacement is still gated on the baked depth field (`uSwellStrength` is exactly 0 on a fresh
 * mesh, so water is never displaced against unknown bathymetry — the ADR-0048-equivalent safe
 * state), attaching a field turns it on and wires the right texture/extent, and the vertex source
 * really does multiply its displacement by the sampled depth factor.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkWaterDepthTaperedSwell(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createWater, setWaterDepthField, disposeWater, WAVE_TOTAL_AMPLITUDE_METERS } = await import(
				'/src/3d/world/water.js'
			);
			const { createWaterDepthField, FULL_WAVE_DEPTH_METERS } = await import('/src/3d/world/waterDepthField.js');
			const failures = [];
			if (!(WAVE_TOTAL_AMPLITUDE_METERS < FULL_WAVE_DEPTH_METERS)) {
				failures.push(`amplitude ${WAVE_TOTAL_AMPLITUDE_METERS} >= full-wave depth ${FULL_WAVE_DEPTH_METERS}`);
			}
			let worstClearanceMeters = Infinity;
			for (let depthMeters = 0.01; depthMeters <= FULL_WAVE_DEPTH_METERS * 2; depthMeters += 0.01) {
				const taper = Math.min(1, depthMeters / FULL_WAVE_DEPTH_METERS);
				const clearance = depthMeters - WAVE_TOTAL_AMPLITUDE_METERS * taper;
				if (clearance < worstClearanceMeters) worstClearanceMeters = clearance;
				if (clearance <= 0) {
					failures.push(`trough reaches the bed at depth ${depthMeters.toFixed(2)}m`);
					break;
				}
			}
			const water = createWater(6);
			if (water.material.uniforms.uSwellStrength.value !== 0) {
				failures.push('fresh water mesh has non-zero uSwellStrength (would displace against unknown bathymetry)');
			}
			const vertexSource = water.material.vertexShader;
			if (!/worldPos\.y\s*\+=\s*swellHeight\s*\*\s*amplitudeScale/.test(vertexSource)) {
				failures.push('vertex shader no longer scales its displacement by the depth-tapered amplitude');
			}
			if (!/amplitudeScale\s*=\s*depthFactor\s*\*\s*uSwellStrength/.test(vertexSource)) {
				failures.push('vertex shader no longer derives amplitudeScale from the sampled depth factor');
			}
			const depthField = createWaterDepthField({
				sampleHeightMeters: (x) => (x < 0 ? 40 : -40),
				waterLevelMeters: 6,
				extentMeters: 1000,
				resolution: 16,
			});
			setWaterDepthField(water, depthField);
			const uniforms = water.material.uniforms;
			if (uniforms.uSwellStrength.value !== 1) failures.push('attaching a depth field did not enable swell');
			if (uniforms.uDepthMap.value !== depthField.texture) failures.push('depth texture not bound to uDepthMap');
			if (uniforms.uDepthFieldExtentMeters.value !== 1000) failures.push('depth field extent not forwarded');
			const texels = depthField.texture.image.data;
			if (texels[0] !== 0) failures.push(`dry-land texel baked ${texels[0]}, expected 0`);
			const lastTexelOffset = (16 * 16 - 1) * 4;
			if (texels[lastTexelOffset] !== 255) failures.push(`deep-water texel baked ${texels[lastTexelOffset]}, expected 255`);
			disposeWater(water);
			return {
				failures,
				amplitude: WAVE_TOTAL_AMPLITUDE_METERS,
				fullWaveDepth: FULL_WAVE_DEPTH_METERS,
				worstClearanceMeters,
				dryRatio: depthField.dryTexelRatio,
				deepRatio: depthField.deepTexelRatio,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = Boolean(result && !result.error && result.failures.length === 0);
	const details = ok
		? `swell amplitude ${result.amplitude.toFixed(2)}m < full-wave depth ${result.fullWaveDepth}m; swept 0.01-${(result.fullWaveDepth * 2).toFixed(0)}m, worst bed clearance ${result.worstClearanceMeters.toFixed(4)}m (>0 everywhere); fresh mesh undisplaced (uSwellStrength=0), field attach enables swell, synthetic bake ${(result.dryRatio * 100).toFixed(0)}% dry / ${(result.deepRatio * 100).toFixed(0)}% deep`
		: `FAILED: ${result?.error ?? JSON.stringify(result?.failures)}`;
	return { name: 'depth-tapered water swell (world/water.js + world/waterDepthField.js, ADR-0270)', ok, details };
}

/**
 * Regression guard for ADR-0118 (settlement ground-flatten pads — fixes castles visibly floating/
 * gapping over uneven terrain). Drives the *real* `createHeightSampler`/`computeSettlementFlattenPads`
 * the live game imports, in-page, against all 14 real `KINGDOM_SEATS` — not a re-derived
 * approximation. Three invariants, none of which held before ADR-0118 (there was no flattening at
 * all):
 *   1. Every seat's exact center samples to precisely its own pad's `anchorHeightMeters` (proves the
 *      pad's anchor formula matches what `createSettlements` actually places the castle at — see
 *      `world/settlements.js`'s `computeSettlementFlattenPads` doc comment for why this must be the
 *      *clamped* height, not the raw terrain sample).
 *   2. 8 points spaced around each seat's full `innerRadiusMeters` ring sample to that exact same
 *      anchor height (within float tolerance) — proves the *entire* castle footprint is flat, not
 *      just the single center point the old code sampled, which is the actual bug this fixes.
 *   3. A point just beyond each seat's `outerRadiusMeters`, chosen in a direction outside every
 *      other settlement pad too, samples identically with or without `flattenPads` — proves pad
 *      influence is bounded without misclassifying legitimate overlap from a nearby castle.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkSettlementGroundFlatten(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createHeightSampler } = await import('/src/3d/world/terrain.js');
			const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
			const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
			const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
			const flattenPads = computeSettlementFlattenPads({
				sampleHeightMeters: baseSampleHeightMeters,
				seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
				minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
				mapBounds: WORLD_SCALE.MAP_BOUNDS,
				metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
			});
			const flatSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
			const EPSILON_METERS = 1e-6;
			const failures = [];
			KINGDOM_SEATS.forEach((seat, index) => {
				const pad = flattenPads[index];
				const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
				const centerHeight = flatSampleHeightMeters(x, z);
				if (Math.abs(centerHeight - pad.anchorHeightMeters) > EPSILON_METERS) {
					failures.push(`${seat.id}: center=${centerHeight.toFixed(4)} != anchor=${pad.anchorHeightMeters.toFixed(4)}`);
				}
				if (pad.anchorHeightMeters <= WORLD_DEFAULTS.WATER_LEVEL_METERS) {
					failures.push(`${seat.id}: anchor=${pad.anchorHeightMeters.toFixed(4)} at/below water level ${WORLD_DEFAULTS.WATER_LEVEL_METERS}`);
				}
				for (let i = 0; i < 8; i++) {
					const angle = (i / 8) * Math.PI * 2;
					const ringX = x + Math.cos(angle) * pad.innerRadiusMeters;
					const ringZ = z + Math.sin(angle) * pad.innerRadiusMeters;
					const ringHeight = flatSampleHeightMeters(ringX, ringZ);
					if (Math.abs(ringHeight - pad.anchorHeightMeters) > EPSILON_METERS) {
						failures.push(`${seat.id} ring#${i}: height=${ringHeight.toFixed(4)} != anchor=${pad.anchorHeightMeters.toFixed(4)}`);
					}
				}
				let beyondPoint = null;
				const probeRadiusMeters = pad.outerRadiusMeters + 5;
				for (let i = 0; i < 32 && !beyondPoint; i++) {
					const angle = (i / 32) * Math.PI * 2;
					const candidateX = x + Math.cos(angle) * probeRadiusMeters;
					const candidateZ = z + Math.sin(angle) * probeRadiusMeters;
					const outsideAllPads = flattenPads.every((otherPad) => (
						Math.hypot(candidateX - otherPad.x, candidateZ - otherPad.z) > otherPad.outerRadiusMeters + 1
					));
					if (outsideAllPads) beyondPoint = { x: candidateX, z: candidateZ };
				}
				if (!beyondPoint) {
					failures.push(`${seat.id}: no clear just-beyond-outer probe outside all settlement pads`);
					return;
				}
				const flattenedBeyond = flatSampleHeightMeters(beyondPoint.x, beyondPoint.z);
				const baseBeyond = baseSampleHeightMeters(beyondPoint.x, beyondPoint.z);
				if (Math.abs(flattenedBeyond - baseBeyond) > EPSILON_METERS) {
					failures.push(`${seat.id} beyond-all-pads: flattened=${flattenedBeyond.toFixed(4)} != base=${baseBeyond.toFixed(4)}`);
				}
			});
			return { seatCount: KINGDOM_SEATS.length, failures };
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && !result.error && result.failures.length === 0;
	const details = ok
		? `all ${result.seatCount} kingdom seats: center + 8-point footprint ring flat at the exact clamped anchor height, zero influence just beyond each outer radius where no other pad overlaps`
		: `FAILED: ${result?.error ?? JSON.stringify(result.failures)}`;
	return { name: 'settlement ground-flatten pads (world/terrain.js + world/settlements.js, ADR-0118)', ok, details };
}

module.exports = {
	check2DShell,
	check3DMode,
	checkWaterDepthTaperedSwell,
	checkSettlementGroundFlatten,
};