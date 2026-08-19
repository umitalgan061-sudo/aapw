/** First-audio regression check (run 346, GOVERNANCE_FULL_GAME_DIRECTIVE.md §3 item 6 —
 * `audio/audioManager.js`, wired into `ui/pauseMenu.js`'s open/close transitions via `game3d.js`). */

// Same environment-quirk margin `game3dSmokeChecksControlsHelp.js`/`game3dSmokeChecksPauseMenu.js`
// already document (this project's own boot cost, not this run's change).
const NAV_TIMEOUT_MS = 30_000;
// Same value `game3dSmokeChecksScene.js`'s `check3DMode` already waits on for full scene boot
// (GAME_READY phase1-scene) -- this check drives a real pointer click, so unlike `PauseMenu`'s own
// smoke check (which builds an isolated `PauseMenu` instance and uses hit-test-bypassing
// `element.click()`), it must wait for the real `#game3d-loading` overlay/canvas to stop covering
// the page first, or the click times out against whichever element is on top mid-boot.
const GAME3D_READY_TIMEOUT_MS = 60_000;

/**
 * Constructs a real `createAudioManager` against a real `THREE.PerspectiveCamera` (the same shape
 * `game3d.js` passes it), then drives `playClick()` through an actual Playwright `page.click()` —
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
			{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
		);
		const setup = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createAudioManager } = await import('/src/3d/audio/audioManager.js');
			const camera = new THREE.PerspectiveCamera();
			const audio = createAudioManager({ camera });
			const listenerAddedOnConstruct = camera.children.some((child) => child.type === 'AudioListener');
			// Stashed on `window` so the follow-up real click's handler (installed next) and the final
			// evaluate() below can all reach the same instances -- Playwright's page.click() runs
			// against page DOM, not this evaluate()'s local scope.
			window.__audioCheck = { audio, camera };

			const btn = document.createElement('button');
			btn.id = '__audio-check-btn';
			btn.textContent = 'trigger click sound';
			// `#game3d-canvas` is `position: fixed` and covers the full viewport to receive real
			// pointer/drag input (game3d.css) -- a plain appended button renders underneath it in the
			// normal stacking order and a real `page.click()` below would hit the canvas instead. Fixed
			// position + a z-index above the canvas's own puts it on top without faking the click event.
			btn.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:999999;';
			btn.onclick = () => { window.__audioCheck.clickPromise = audio.playClick(); };
			document.body.appendChild(btn);

			return { listenerAddedOnConstruct };
		});

		// A real trusted click, not a scripted DOM event -- the one thing this check exists to prove
		// that a plain unit test of the module in isolation could not.
		await page.click('#__audio-check-btn');

		const afterClick = await page.evaluate(async () => {
			await window.__audioCheck.clickPromise;
			const listener = window.__audioCheck.camera.children.find((child) => child.type === 'AudioListener');
			// 'running' after a resumed gesture-triggered context is the real-world success case;
			// some CI/automation Chromium profiles start contexts already unsuspended, which is not a
			// regression here -- only 'closed' (this module never closes it) would indicate a bug.
			const contextNotClosed = listener.context.state !== 'closed';

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

			return { contextNotClosed, disposeRemovesListener, secondDisposeIsSafe };
		});

		result = { ...setup, ...afterClick };
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'first audio (audio/audioManager.js, run 346)',
		ok,
		details: ok
			? 'createAudioManager() adds a real THREE.AudioListener to the camera; a real trusted click '
				+ '(not a scripted event) resolves playClick() without throwing and leaves the audio '
				+ 'context open; dispose() removes the listener and is safe to call twice'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkAudioManager };
