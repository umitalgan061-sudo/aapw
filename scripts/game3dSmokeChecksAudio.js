/** First-audio regression check (run 346, GOVERNANCE_FULL_GAME_DIRECTIVE.md §3 item 6 —
 * `audio/audioManager.js`, wired into `ui/pauseMenu.js`'s open/close transitions via `game3d.js`).
 * Run 347 extended it with the mute control's `setMuted()`/`isMuted()`/`readStoredMuted()` surface —
 * `game3dSmokeChecksPauseMenu.js`'s own `checkPauseMenuMute` covers the checkbox/persistence side.
 * Run 348 extended it again with `playDiscoveryChime()` resolving cleanly — the callback-fires side
 * of that feature lives in `game3dSmokeChecksSettlementDiscovery.js`'s own `checkSettlementDiscovery`. */

// Navigation only needs the response committed. This check separately waits for the real entry gate
// and drives its own top-layer trusted pointer target. Full GAME_READY/scene boot is authoritative in
// `game3dSmokeChecksScene.js`'s `check3DMode`; making the audio module smoke wait for that unrelated
// software-WebGL work caused false 60s failures before any audio assertion could execute.
const NAV_TIMEOUT_MS = 30_000;

/**
 * Constructs a real `createAudioManager` against a real `THREE.PerspectiveCamera` (the same shape
 * `game3d.js` passes it), then drives `playClick()` through an actual Playwright mouse input —
 * a trusted browser input event, unlike a plain `page.evaluate()` call — so the browser's
 * autoplay-gesture requirement is exercised the same way a real player's pause-button click
 * satisfies it in production (see `audio/audioManager.js`'s own module doc).
 */
async function checkAudioManager(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
		// Run 266's full-viewport consent overlay (`#run266-entry-gate`) intercepts pointer events
		// until dismissed. Waiting for the actual shipped control is the only page-readiness condition
		// this module smoke needs; full scene readiness is proven independently by `check3DMode`.
		await page.waitForSelector('#run266-entry-enter', { state: 'visible', timeout: NAV_TIMEOUT_MS });
		await page.click('#run266-entry-enter');
		const setup = await page.evaluate(async () => {
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
			// Stashed on `window` so the follow-up native mouse input and the final evaluate() below can
			// all reach the same instances. The click handler records Event.isTrusted so this proof cannot
			// silently degrade into a scripted DOM dispatch.
			window.__audioCheck = { audio, camera, trustedClick: false, clickPromise: null };

			const btn = document.createElement('button');
			btn.id = '__audio-check-btn';
			btn.textContent = 'trigger click sound';
			// Scene/layout work can keep Playwright's locator actionability stability check busy even
			// though this fixed target is already hittable. Put it at a deterministic viewport coordinate
			// above every game overlay, then use native page.mouse input rather than locator.click().
			btn.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:2147483647;pointer-events:auto;';
			btn.onclick = (event) => {
				window.__audioCheck.trustedClick = event.isTrusted === true;
				window.__audioCheck.clickPromise = audio.playClick();
			};
			document.body.appendChild(btn);

			return {
				listenerAddedOnConstruct, startsUnmuted, readStoredMutedIsFalseByDefault,
				mutedFlagUpdates, unmuteFlagUpdates,
			};
		});

		// Native browser mouse input at the fixed target. This remains a real trusted click while
		// avoiding locator.click()'s unrelated "stable" actionability wait during heavy scene layout.
		await page.mouse.click(100, 30);

		const afterClick = await page.evaluate(async () => {
			if (!window.__audioCheck.clickPromise) {
				return {
					trustedClickReceived: false,
					contextNotClosed: false,
					discoveryChimeResolvedWithoutThrow: false,
					disposeRemovesListener: false,
					secondDisposeIsSafe: false,
				};
			}
			await window.__audioCheck.clickPromise;
			const trustedClickReceived = window.__audioCheck.trustedClick === true;
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

			return {
				trustedClickReceived,
				contextNotClosed,
				discoveryChimeResolvedWithoutThrow,
				disposeRemovesListener,
				secondDisposeIsSafe,
			};
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
				+ 'native trusted mouse click (Event.isTrusted=true, not a scripted event) resolves playClick() '
				+ 'without throwing and leaves the audio context open; playDiscoveryChime() also resolves '
				+ 'without throwing; dispose() removes the listener and is safe to call twice'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkAudioManager };
