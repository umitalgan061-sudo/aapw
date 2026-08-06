/**
 * game3dSmokeChecksDebugTools.js — debug-tool (F4/F2) and world-event singleton-system checks, split
 * out of `game3dSmokeChecksScene.js` this run (that file had reached 573/600, flagged
 * approaching-the-cap since run 87's Next step). Same "extract into a focused module, moved verbatim"
 * pattern DECISIONS.md ADR-0028/runs 40/64/68/82 already established for exactly this scenario.
 *
 * Split by theme: `game3dSmokeChecksScene.js` kept the page-navigation-level checks (2D shell load,
 * 3D mode boot, water shader invariant); this file holds the four checks that instead build a real
 * *singleton* object in-page and drive it directly via synthetic key events/method calls — the F4
 * free-fly camera (ADR-0049), the F2 profiling panel (ADR-0053/ADR-0084), and the world-event system
 * plus its day/night gating (ADR-0056/ADR-0111). `smokeTestGame3D.js` calls every check module's
 * exports — see its own comment for the current module list and the combined check list, which is
 * the authoritative one; this header's per-file breakdown is a summary, not the registry.
 *
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name, ok, details}>`. See
 * each function's own comment for what it guards against.
 * @module scripts/game3dSmokeChecksDebugTools
 */

/** Timeout for a page navigation (`domcontentloaded`) — asset fetches happen after this. Same
 * value/convention as `game3dSmokeChecksScene.js`'s own copy; duplicated rather than shared/imported
 * across the two sibling check files since it's a single primitive with no other state. */
const NAV_TIMEOUT_MS = 15000;

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
		await page.setViewportSize({ width: 390, height: 844 });
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

/**
 * Guards ADR-0053's F2 debug/profiling panel (`debug/perfPanel.js`): builds a real
 * `createPerfPanel` against a synthetic fake `renderer` (only `.info` is read, so a plain object
 * stands in for a real `WebGLRenderer` — same isolation pattern `checkFreeCamera` above already
 * uses). Asserts the full lifecycle: inactive by default and a true no-op (no DOM write) until F2,
 * the refresh throttle (no write below `REFRESH_INTERVAL_SECONDS`, a real write once past it),
 * live re-reads of `renderer.info` (not a value captured once at creation), the over-budget " !"
 * flag, F2 deactivation, `dispose()` actually removing the DOM node, and — separately — that
 * `isMobileClass: true` really switches to `MOBILE_BUDGET`, not just accepting the option and
 * ignoring it (620 draw calls flags over-budget on mobile's 500 cap but would not on desktop's
 * 2500 one, so this also proves the budget object itself is being read, not hardcoded).
 *
 * Run 66 (ADR-0084) also guards the storage-quota line: an immediate "measuring…" placeholder on
 * the first active `update()` (before `navigator.storage.estimate()`'s promise has had a chance to
 * resolve — proven by reading the DOM synchronously right after the call, no `await` in between),
 * the real resolved `usage / quota MB (%)` line once it does resolve, and the feature-detected
 * "unsupported" fallback on a separate instance with `navigator.storage` stubbed away (real
 * headless Chromium does support the API, so the fallback path needs this explicit stub to exercise
 * at all).
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkPerfPanel(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createPerfPanel } = await import('/src/3d/debug/perfPanel.js');
			const fakeRenderer = { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } };
			const panel = createPerfPanel({ renderer: fakeRenderer, isMobileClass: false });
			const el = document.querySelector('.g3d-perf-panel');

			const inactiveInitially = panel.active === false;
			const hiddenInitially = el.hidden === true;
			fakeRenderer.info.render.calls = 999; // must not leak into the DOM while inactive.
			panel.update(1);
			const noWriteWhileInactive = el.textContent === '';

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			const activatedOnF2 = panel.active === true;
			const domVisibleOnActivate = el.hidden === false;

			fakeRenderer.info.render.calls = 100;
			fakeRenderer.info.render.triangles = 200000;
			fakeRenderer.info.memory.geometries = 5;
			fakeRenderer.info.memory.textures = 3;
			panel.update(0.1); // below the refresh throttle — must not write yet.
			const throttledNoWriteBelowInterval = el.textContent === '';
			panel.update(0.2); // cumulative 0.3s, past the 0.25s throttle — must write now.
			const text1 = el.textContent;
			const writesAfterThrottleInterval = text1.includes('Draw calls: 100 / 2500 (Desktop)')
				&& text1.includes('Triangles: 200,000 / 5,000,000 (Desktop)')
				&& text1.includes('Geometries: 5') && text1.includes('Textures: 3');
			// Run 66 (ADR-0084): the first active update() already kicked off
			// navigator.storage.estimate() (its own timer starts at Infinity), but no `await` has
			// happened since — the promise cannot have resolved yet, so the DOM must still show the
			// synchronous "measuring…" placeholder, not a stale-empty or already-resolved value.
			const storageShowsMeasuringBeforeResolve = text1.includes('Storage: measuring…');

			fakeRenderer.info.render.calls = 3000; // over DESKTOP_BUDGET.maxDrawCalls (2500).
			panel.update(0.3); // past the throttle again (reset after the last write).
			const overBudgetFlagged = el.textContent.includes('/ 2500 (Desktop) !');

			// Give navigator.storage.estimate()'s real promise a turn to resolve, then force one more
			// DOM write (past the render-stat throttle again) to pick up the now-resolved storageLine
			// — the storage timer itself won't refire for STORAGE_REFRESH_INTERVAL_SECONDS, so this
			// is reading the *first* resolved estimate, not triggering a second request.
			await new Promise((resolve) => setTimeout(resolve, 150));
			panel.update(0.3);
			const text2 = el.textContent;
			const storageResolvedWithRealNumbers = /Storage: \d+\.\d \/ \d+ MB \(\d+%\)( !)?$/.test(text2);

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			const deactivatedOnSecondF2 = panel.active === false;
			const hiddenAfterSecondF2 = el.hidden === true;

			panel.dispose();
			const disposedRemovesDom = document.querySelector('.g3d-perf-panel') === null;

			// Separate instance: confirms isMobileClass really swaps in MOBILE_BUDGET (620 draw
			// calls only flags over-budget under the 500 mobile cap, not the 2500 desktop one).
			const fakeMobileRenderer = { info: { render: { calls: 620, triangles: 0 }, memory: { geometries: 0, textures: 0 } } };
			const mobilePanel = createPerfPanel({ renderer: fakeMobileRenderer, isMobileClass: true });
			const mobileEl = document.querySelector('.g3d-perf-panel');
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			mobilePanel.update(0.3);
			const mobileBudgetUsed = mobileEl.textContent.includes('/ 500 (Mobile) !');
			mobilePanel.dispose();

			// Run 66 (ADR-0084): feature-detection fallback. Real headless Chromium does support
			// navigator.storage.estimate(), so the "unsupported" branch needs an explicit stub to
			// exercise at all — a third instance, created while the stub is in place, restored
			// immediately after so it can't affect any other check.
			const originalStorage = navigator.storage;
			Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
			const noStoragePanel = createPerfPanel({ renderer: fakeRenderer, isMobileClass: false });
			const noStorageEl = document.querySelector('.g3d-perf-panel');
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' }));
			noStoragePanel.update(0.3);
			const unsupportedFallbackShown = noStorageEl.textContent.includes('Storage: unsupported (no navigator.storage.estimate)');
			noStoragePanel.dispose();
			Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });

			return {
				inactiveInitially, hiddenInitially, noWriteWhileInactive, activatedOnF2, domVisibleOnActivate,
				throttledNoWriteBelowInterval, writesAfterThrottleInterval, overBudgetFlagged,
				storageShowsMeasuringBeforeResolve, storageResolvedWithRealNumbers, unsupportedFallbackShown,
				deactivatedOnSecondF2, hiddenAfterSecondF2, disposedRemovesDom, mobileBudgetUsed,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? 'inactive by default, no-ops while inactive, F2 activates/deactivates, refresh-throttled writes, over-budget flag, dispose removes DOM, isMobileClass swaps in the mobile budget, storage-quota line measures-then-resolves with real numbers, unsupported fallback shown when navigator.storage is stubbed away'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'F2 debug/profiling panel (debug/perfPanel.js, ADR-0053/ADR-0084)', ok, details };
}

/**
 * Guards ADR-0056's world-event system (`gameplay/worldEvents.js` + `ui/worldEventToast.js`).
 * `createWorldEventSystem` only checks its countdown once per `update()` call (never loops to catch
 * multiple crossings within one big delta), so a single call with a delta far past the max interval
 * is expected to fire *exactly once* — this asserts that, plus determinism (two independently
 * created systems with the same seed emit the same first event), the below-threshold no-op case,
 * and the toast's show/dispose lifecycle (real `EventBus`, not a synthetic stand-in, since the whole
 * point of this system is routing through it).
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkWorldEvents(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		await page.setViewportSize({ width: 390, height: 844 });
		result = await page.evaluate(async () => {
			const { createWorldEventSystem } = await import('/src/3d/gameplay/worldEvents.js');
			const { WorldEventToast } = await import('/src/3d/ui/worldEventToast.js');
			const { EventBus } = await import('/src/3d/eventBus.js');

			const bus = new EventBus();
			const eventName = 'test:worldEvent';
			const received = [];
			bus.on(eventName, (payload) => received.push(payload));

			const system = createWorldEventSystem({ eventsBus: bus, seed: 42, eventName });
			system.update(1); // 1s, far below the 45s minimum interval — must not fire.
			const noFireBelowThreshold = received.length === 0;

			system.update(1000); // far past the max interval — must fire exactly once, not loop.
			const firedExactlyOnce = received.length === 1;
			const firstEventId = received[0] && received[0].id;
			const payloadShapeOk = received[0]
				&& typeof received[0].icon === 'string' && typeof received[0].title === 'string'
				&& typeof received[0].desc === 'string' && typeof received[0].color === 'string';

			system.update(1000); // resets its own countdown after firing — a 2nd huge delta fires again.
			const firesAgainAfterReset = received.length === 2;

			system.dispose();
			received.length = 0;
			system.update(1000);
			const noFireAfterDispose = received.length === 0;

			// Determinism: a fresh system with the same seed picks the exact same first event id.
			const receivedB = [];
			bus.on(`${eventName}B`, (payload) => receivedB.push(payload));
			const systemB = createWorldEventSystem({ eventsBus: bus, seed: 42, eventName: `${eventName}B` });
			systemB.update(1000);
			const deterministic = receivedB[0] && receivedB[0].id === firstEventId;
			systemB.dispose();

			// Toast lifecycle needs its own fresh system/bus channel (received[0] above was consumed
			// by the determinism check's comparison, not re-fired).
			const toastEvents = [];
			bus.on(`${eventName}C`, (payload) => toastEvents.push(payload));
			const systemC = createWorldEventSystem({ eventsBus: bus, seed: 7, eventName: `${eventName}C` });
			const toast = new WorldEventToast({ eventsBus: bus, eventName: `${eventName}C` });
			const el = document.querySelector('.g3d-event-toast');
			const hiddenInitially = el.hidden === true;
			systemC.update(1000);
			const shownOnEvent = el.hidden === false
				&& el.querySelector('.g3d-event-toast-title').textContent === toastEvents[0].title
				&& el.querySelector('.g3d-event-toast-desc').textContent === toastEvents[0].desc;
			const backLinkRect = document.querySelector('.g3d-back-link').getBoundingClientRect();
			const toastRect = el.getBoundingClientRect();
			const mobileToastClearsBackLink = toastRect.top >= backLinkRect.bottom + 12;

			toast.dispose();
			systemC.dispose();
			const disposedRemovesDom = document.querySelector('.g3d-event-toast') === null;

			return {
				noFireBelowThreshold, firedExactlyOnce, payloadShapeOk, firesAgainAfterReset,
				noFireAfterDispose, deterministic, hiddenInitially, shownOnEvent, disposedRemovesDom,
				mobileToastClearsBackLink,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? 'no-op below the min interval, fires exactly once per update() call past it (never loops), resets its own countdown, dispose() stops further emits, same seed picks the same first event, toast shows real emitted payload text and dispose() removes its DOM'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'world-event system (gameplay/worldEvents.js + ui/worldEventToast.js, ADR-0056)', ok, details };
}

/**
 * Guards ADR-0111's day/night `timeOfDay` gating on top of ADR-0056/ADR-0110's world-event picker.
 * Real statistical proof, not an assumption the filter logic is right: forces `nightFactor` to solid
 * noon (`0`) and solid midnight (`1`) across many real `update()` firings and asserts the
 * night-restricted entries (`wolf_howl`, `falling_star`, `northern_lights`) never once appear at
 * noon, the day-restricted entries (`eclipse`, `harvest_wagons`, `market_day`, ADR-0130) never once
 * appear at midnight, and — the positive half, not just the negative — that `eclipse` *does* appear
 * at noon and at least one of the three night-restricted entries *does* appear at midnight (proves
 * the gate lets its own tier through, not just that it blocks everything). Also asserts the
 * pre-ADR-0111 call shape (`update(delta)` with no `nightFactor`) still fires without throwing —
 * gating is additive, never a required argument.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkWorldEventsTimeGating(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createWorldEventSystem } = await import('/src/3d/gameplay/worldEvents.js');
			const { EventBus } = await import('/src/3d/eventBus.js');
			const NIGHT_ONLY_IDS = ['wolf_howl', 'falling_star', 'northern_lights'];
			const DRAW_COUNT = 1000;

			const bus = new EventBus();
			const noonIds = new Set();
			const noonSystem = createWorldEventSystem({ eventsBus: bus, seed: 1, eventName: 'noon' });
			bus.on('noon', (payload) => noonIds.add(payload.id));
			for (let i = 0; i < DRAW_COUNT; i += 1) noonSystem.update(1000, 0); // nightFactor=0: solid noon.
			noonSystem.dispose();
			const noonNeverGatesInNightOnly = NIGHT_ONLY_IDS.every((id) => !noonIds.has(id));
			const noonFiresEclipse = noonIds.has('eclipse');
			const noonFiresHarvestWagons = noonIds.has('harvest_wagons');
			const noonFiresMarketDay = noonIds.has('market_day');

			const midnightIds = new Set();
			const midnightSystem = createWorldEventSystem({ eventsBus: bus, seed: 2, eventName: 'midnight' });
			bus.on('midnight', (payload) => midnightIds.add(payload.id));
			for (let i = 0; i < DRAW_COUNT; i += 1) midnightSystem.update(1000, 1); // nightFactor=1: solid midnight.
			midnightSystem.dispose();
			const midnightNeverFiresEclipse = !midnightIds.has('eclipse');
			const midnightNeverFiresHarvestWagons = !midnightIds.has('harvest_wagons');
			const midnightNeverFiresMarketDay = !midnightIds.has('market_day');
			const midnightFiresSomeNightOnly = NIGHT_ONLY_IDS.some((id) => midnightIds.has(id));

			// Pre-ADR-0111 call shape: no nightFactor argument at all must still fire without throwing.
			const legacyIds = [];
			const legacySystem = createWorldEventSystem({ eventsBus: bus, seed: 3, eventName: 'legacy' });
			bus.on('legacy', (payload) => legacyIds.push(payload.id));
			legacySystem.update(1000); // eslint-disable-line -- deliberately 1-arg, proving the old call shape.
			legacySystem.dispose();
			const legacyCallStillFires = legacyIds.length === 1;

			return {
				noonNeverGatesInNightOnly, noonFiresEclipse,
				noonFiresHarvestWagons, midnightNeverFiresHarvestWagons,
				noonFiresMarketDay, midnightNeverFiresMarketDay,
				midnightNeverFiresEclipse, midnightFiresSomeNightOnly,
				legacyCallStillFires,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? 'forced noon (nightFactor=0) across 1000 draws never emitted a night-restricted id and did emit eclipse/harvest_wagons/market_day; forced midnight (nightFactor=1) across 1000 draws never emitted eclipse/harvest_wagons/market_day and did emit a night-restricted id; the pre-gating 1-argument update(delta) call shape still fires without throwing'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'world-event day/night gating (gameplay/worldEvents.js, ADR-0111)', ok, details };
}

module.exports = {
	checkFreeCamera,
	checkPerfPanel,
	checkWorldEvents,
	checkWorldEventsTimeGating,
};
