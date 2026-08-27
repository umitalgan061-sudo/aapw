/** First-audio regression check (run 346, GOVERNANCE_FULL_GAME_DIRECTIVE.md §3 item 6 —
 * `audio/audioManager.js`, wired into `ui/pauseMenu.js`'s open/close transitions via `game3d.js`).
 * Run 347 extended it with the mute control's `setMuted()`/`isMuted()`/`readStoredMuted()` surface —
 * `game3dSmokeChecksPauseMenu.js`'s own `checkPauseMenuMute` covers the checkbox/persistence side.
 * Run 348 extended it again with `playDiscoveryChime()` resolving cleanly — the callback-fires side
 * of that feature lives in `game3dSmokeChecksSettlementDiscovery.js`'s own `checkSettlementDiscovery`. */

// Same environment-quirk margin `game3dSmokeChecksControlsHelp.js`/`game3dSmokeChecksPauseMenu.js`
// already document (this project's own boot cost, not this run's change).
const NAV_TIMEOUT_MS = 90_000;
// Same value `game3dSmokeChecksScene.js`'s `check3DMode` already waits on for full scene boot
// (GAME_READY phase1-scene) -- this check drives a real pointer click, so unlike `PauseMenu`'s own
// smoke check (which builds an isolated `PauseMenu` instance and uses hit-test-bypassing
// `element.click()`), it must wait for the real `#game3d-loading` overlay/canvas to stop covering
// the page first, or the click times out against whichever element is on top mid-boot.
/**
 * How long a check may wait for `#game3d-loading` to clear.
 *
 * **This is a threshold change and I am not dressing it up as anything else** (run 404). It was 60s;
 * the desktop boot in this environment measures **~133s**. Six explanations were eliminated first,
 * each by measurement, before touching the number:
 *
 * 1. Downloading more on desktop — 118 assets / 249 MB vs mobile's 126 / 286 MB. It is not that.
 * 2. Our own JavaScript — all project code is **6%** of a CPU profile of the boot.
 * 3. Too many shader programs — `renderer.info.programs.length` is **48**, not hundreds.
 * 4. Duplicated chunk textures — 550 chunk meshes but **3** distinct chunk textures, already shared.
 * 5. Shadows — real, and large (160,135ms -> 62,550ms with them off), but turning them off is a
 *    visible downgrade against the owner's stated priority *and still leaves 62.5s*, over the old 60s.
 * 6. State piling up in the shared browser — three consecutive desktop boots in one browser measured
 *    137,923 / 131,091 / 133,293 ms. **Flat.** Nothing accumulates.
 *
 * What is left is the environment: over 80% of the boot is the GPU driver compiling shaders
 * (`getProgramInfoLog` 14.3%) and uploading textures (`texSubImage2D` 12.2%) under **headless
 * software rendering**, where 48 programs at roughly 400ms each is most of the time. A real desktop
 * GPU compiles the same programs far faster, so the ~133s is a property of the CI renderer rather
 * than anything a player experiences — it must not be read as a user-facing regression.
 *
 * 240s is the measured boot plus margin, not a number picked to make a red check go away. The honest
 * cost of this change: checks that wait on it now take minutes rather than failing fast, so the gate
 * job gets slower.
 */
const GAME3D_READY_TIMEOUT_MS = 240_000;
/**
 * Where the trusted click lands, inside the button this check appends at `0,0 200x60`.
 *
 * **Why a coordinate and not a selector** (run 405). Run 404's raise got this check past the ready
 * overlay for the first time, and it then failed at `page.click('#__audio-check-btn')` — 30s exceeded
 * with the call log stuck on `waiting for locator(...)`. The button was not missing. Measured here,
 * against the same hydrated assets CI checks out, immediately after the overlay hid:
 *
 * - `document.getElementById('__audio-check-btn')` → present, in `document.body`, rect `0,0,200,60`,
 *   and `document.elementFromPoint(100, 30)` returns **the button itself**. Nothing overlays it.
 * - A bare `waitForSelector(state: 'attached')` on it took **113,766ms**.
 * - `page.click()` still timed out at **120,000ms**, its call log stopped at `scrolling into view`.
 *
 * Every one of those steps runs *in the page's main thread*, and after boot that thread is saturated
 * by the same headless-software-rendering shader compilation documented above — the `page.evaluate()`
 * below measures **97,120ms** for what is a few dozen lines of setup. So `page.click`'s selector
 * resolution, actionability polling and scroll-into-view each cost a minute or more, and no single
 * timeout value makes that reliable. `page.mouse.click()` is dispatched over CDP instead
 * (`Input.dispatchMouseEvent`) and needs none of them, while still being the real trusted input event
 * that is the entire point of this check.
 *
 * The safety the selector used to provide is not dropped, it is asserted directly: the setup below
 * returns `buttonIsTopmostAtClickPoint` from `elementFromPoint`, so a button that is missing or
 * covered fails the check rather than being clicked past — which the old code only claimed in a
 * comment. `clickFired` then proves the handler actually ran, so a dispatch that never reached the
 * page cannot pass vacuously.
 */
const CLICK_POINT = { x: 100, y: 30 };

/**
 * Constructs a real `createAudioManager` against a real `THREE.PerspectiveCamera` (the same shape
 * `game3d.js` passes it), then drives `playClick()` through an actual Playwright mouse click —
 * a trusted synthetic input event, unlike a plain `page.evaluate()` call — so the browser's
 * autoplay-gesture requirement is exercised the same way a real player's pause-button click
 * satisfies it in production (see `audio/audioManager.js`'s own module doc).
 */
async function checkAudioManager(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		// Run 266's full-viewport consent overlay (`#run266-entry-gate`) intercepts pointer events
		// until dismissed -- a real `page.click()` below (unlike `PauseMenu`'s own smoke check, which
		// bypasses hit-testing entirely via `element.click()`) would otherwise time out clicking a
		// button appended underneath it. Same dismissal `captureRun339PauseMenuEvidence.js` already
		// uses.
		await page.click('#run266-entry-enter');
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			undefined,
			{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
		);
		const setup = await page.evaluate(async (clickPoint) => {
			const THREE = await import('three');
			const { createAudioManager, readStoredMuted } = await import('/src/3d/audio/audioManager.js');
			const camera = new THREE.PerspectiveCamera();
			const audio = createAudioManager({ camera });
			const listenerAddedOnConstruct = camera.children.some((child) => child.type === 'AudioListener');
			// Run 347: mute wiring, against the real THREE.AudioListener this module adds (not a mock).
			// `setMasterVolume()` schedules an exponential ramp (`AudioParam.setTargetAtTime`), so this
			// only asserts this module's own `isMuted()` bookkeeping, not a same-tick exact gain value —
			// the ramp itself is three.js's own primitive, not this module's logic to re-verify.
			const startsUnmuted = audio.isMuted() === false;
			const readStoredMutedIsFalseByDefault = readStoredMuted() === false;
			audio.setMuted(true);
			const mutedFlagUpdates = audio.isMuted() === true;
			audio.setMuted(false);
			const unmuteFlagUpdates = audio.isMuted() === false;
			// Stashed on `window` so the follow-up real click's handler (installed next) and the final
			// evaluate() below can all reach the same instances -- Playwright's page.click() runs
			// against page DOM, not this evaluate()'s local scope.
			window.__audioCheck = { audio, camera, clickFired: false };

			const btn = document.createElement('button');
			btn.id = '__audio-check-btn';
			btn.textContent = 'trigger click sound';
			// `#game3d-canvas` is `position: fixed` and covers the full viewport to receive real
			// pointer/drag input (game3d.css) -- a plain appended button renders underneath it in the
			// normal stacking order and a real click below would hit the canvas instead. Fixed
			// position + a z-index above the canvas's own puts it on top without faking the click event.
			btn.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:999999;';
			btn.onclick = () => {
				window.__audioCheck.clickFired = true;
				window.__audioCheck.clickPromise = audio.playClick();
			};
			document.body.appendChild(btn);
			// Asserted, not assumed: whatever the browser would hand the click at `CLICK_POINT` has to
			// be this button, so a covered or missing button fails instead of being silently clicked past.
			const buttonIsTopmostAtClickPoint = document.elementFromPoint(clickPoint.x, clickPoint.y) === btn;

			return {
				listenerAddedOnConstruct, startsUnmuted, readStoredMutedIsFalseByDefault,
				mutedFlagUpdates, unmuteFlagUpdates, buttonIsTopmostAtClickPoint,
			};
		}, CLICK_POINT);

		// A real trusted click, not a scripted DOM event -- the one thing this check exists to prove
		// that a plain unit test of the module in isolation could not. Dispatched at the button's own
		// coordinates rather than through a selector, for the measured reason `CLICK_POINT` documents.
		await page.mouse.click(CLICK_POINT.x, CLICK_POINT.y);
		// The handler runs on the same saturated main thread, so the dispatch returning is not proof it
		// ran. Without this the `clickPromise` awaited below could still be `undefined` and `await
		// undefined` would resolve, passing the check on a click that never happened.
		await page.waitForFunction(
			() => window.__audioCheck?.clickFired === true,
			undefined,
			{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
		);

		const afterClick = await page.evaluate(async () => {
			await window.__audioCheck.clickPromise;
			const listener = window.__audioCheck.camera.children.find((child) => child.type === 'AudioListener');
			// 'running' after a resumed gesture-triggered context is the real-world success case;
			// some CI/automation Chromium profiles start contexts already unsuspended, which is not a
			// regression here -- only 'closed' (this module never closes it) would indicate a bug.
			const contextNotClosed = listener.context.state !== 'closed';

			// Run 348: the settlement-discovery chime shares playClick()'s already-resumed context (a
			// real trusted click just ran above), so this doesn't need its own separate gesture -- same
			// autoplay-policy reasoning `playClick()` itself documents.
			let discoveryChimeResolvedWithoutThrow = true;
			try {
				await window.__audioCheck.audio.playDiscoveryChime();
			} catch {
				discoveryChimeResolvedWithoutThrow = false;
			}

			window.__audioCheck.audio.dispose();
			const disposeRemovesListener = window.__audioCheck.camera.children.length === 0;
			// Idempotent by construction (`listener = null` after the first call) -- calling twice must
			// not throw, matching every other `dispose()` in this codebase's own convention.
			let secondDisposeIsSafe = true;
			try {
				window.__audioCheck.audio.dispose();
			} catch {
				secondDisposeIsSafe = false;
			}

			return { contextNotClosed, discoveryChimeResolvedWithoutThrow, disposeRemovesListener, secondDisposeIsSafe };
		});

		result = { ...setup, ...afterClick };
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'first audio + mute + discovery chime (audio/audioManager.js, runs 346/347/348)',
		ok,
		details: ok
			? 'createAudioManager() adds a real THREE.AudioListener to the camera, starts unmuted '
				+ '(readStoredMuted() defaults false), and setMuted()/isMuted() track state correctly; a '
				+ 'real trusted click (not a scripted event) on a button proven topmost at the click point '
				+ 'runs its handler and resolves playClick() without throwing and '
				+ 'leaves the audio context open; playDiscoveryChime() also resolves without throwing; '
				+ 'dispose() removes the listener and is safe to call twice'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkAudioManager };
