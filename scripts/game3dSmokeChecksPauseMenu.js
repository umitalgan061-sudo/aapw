/** Menu/pause flow regression check (run 339, GOVERNANCE_FULL_GAME_DIRECTIVE.md §3 item 7). */

// Same environment-quirk margin `game3dSmokeChecksControlsHelp.js` documents (this project's own
// boot cost, not this run's change) — see that file's own header for the full RCA.
const NAV_TIMEOUT_MS = 30_000;

async function checkPauseMenu(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { PauseMenu } = await import('/src/3d/ui/pauseMenu.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const openStates = [];
			const menu = new PauseMenu({ container, onOpenChange: (open) => openStates.push(open) });
			const button = container.querySelector('.g3d-pause-menu-button');
			const overlay = container.querySelector('.g3d-pause-menu-overlay');
			const resumeButton = container.querySelector('.g3d-pause-menu-resume');
			const quitLink = container.querySelector('.g3d-pause-menu-quit');
			const startsClosed = !menu.isOpen && overlay.hidden && button.getAttribute('aria-expanded') === 'false';
			// Real regression: a `display: flex` rule with no `:not([hidden])` guard once won the
			// cascade over the `[hidden]` UA-stylesheet rule by source order alone (equal specificity),
			// so the "hidden" overlay still rendered and intercepted real pointer clicks on the HUD
			// underneath it -- invisible to `element.click()` below, which bypasses hit-testing
			// entirely, and only caught by this run's own real-pointer-click evidence capture
			// (`captureRun339PauseMenuEvidence.js`). Asserting computed `display` here closes that gap
			// for every future change to this rule.
			const hiddenOverlayIsReallyHidden = window.getComputedStyle(overlay).display === 'none';

			button.click();
			const opensViaButton = menu.isOpen && !overlay.hidden && button.getAttribute('aria-expanded') === 'true';
			const openOverlayIsReallyVisible = window.getComputedStyle(overlay).display !== 'none';
			const buttonTargetIs44px = button.getBoundingClientRect().width >= 44
				&& button.getBoundingClientRect().height >= 44;
			const focusMovedToResume = document.activeElement === resumeButton;

			resumeButton.click();
			const resumeButtonCloses = !menu.isOpen && overlay.hidden;

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
			const escapeOpens = menu.isOpen && !overlay.hidden;
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
			const escapeCloses = !menu.isOpen && overlay.hidden;

			const callbackSequenceCorrect = JSON.stringify(openStates) === JSON.stringify([true, false, true, false]);
			const quitHrefIsMainHub = quitLink.getAttribute('href') === 'index.html';

			menu.dispose();
			const disposeRemovesDom = container.querySelector('.g3d-pause-menu') === null;
			container.remove();

			return {
				startsClosed, hiddenOverlayIsReallyHidden, opensViaButton, openOverlayIsReallyVisible,
				buttonTargetIs44px, focusMovedToResume, resumeButtonCloses,
				escapeOpens, escapeCloses, callbackSequenceCorrect, quitHrefIsMainHub, disposeRemovesDom,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'pause menu (ui/pauseMenu.js)',
		ok,
		details: ok
			? 'button/Escape both toggle a 44px-target overlay (real computed display, not just the '
				+ '`hidden` property), focus moves to Resume on open, resume button and Escape both '
				+ 'close it, quit link points at index.html, onOpenChange fires true/false in order, '
				+ 'dispose removes DOM'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

/** Settings screen regression check (run 341, ADR-0289 — the quality picker inside the pause overlay
 * this file's own header names). Covers desktop (quality radios render, current selection reflects
 * storage, applying persists + reloads) and mobile (radios absent, note shown instead), plus that
 * reopening the overlay always lands back on the main screen, not mid-settings. */
async function checkPauseMenuSettings(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { PauseMenu } = await import('/src/3d/ui/pauseMenu.js');
			const { QUALITY_LEVELS, STORAGE_KEYS } = await import('/src/3d/config.js');

			// A fake Storage so this check never touches the page's real localStorage and can assert
			// exactly what was written, same isolation shape `ui/settlementDiscovery.js`'s own smoke
			// check already gives its `storage` option.
			function makeFakeStorage(initial = {}) {
				const data = { ...initial };
				return {
					getItem: (key) => (key in data ? data[key] : null),
					setItem: (key, value) => { data[key] = String(value); },
					_data: data,
				};
			}

			const container = document.createElement('div');
			document.body.appendChild(container);
			let reloadCount = 0;
			const storage = makeFakeStorage();
			const menu = new PauseMenu({
				container,
				storage,
				reload: () => { reloadCount += 1; },
			});

			menu.setOpen(true);
			container.querySelector('.g3d-pause-menu-settings-open').click();
			const mainHiddenInSettings = container.querySelector('.g3d-pause-menu-main-panel').hidden;
			const settingsPanelVisible = !container.querySelector('.g3d-pause-menu-settings-panel').hidden;
			const radios = [...container.querySelectorAll('.g3d-pause-menu-settings-quality-option input')];
			const desktopHasFourOptions = radios.length === 4;
			const defaultCheckedIsAutomatic = radios.find((r) => r.checked)?.value === QUALITY_LEVELS.AUTOMATIC;

			const highRadio = radios.find((r) => r.value === QUALITY_LEVELS.HIGH);
			highRadio.checked = true;
			container.querySelector('.g3d-pause-menu-settings-apply').click();
			const storedHigh = storage._data[STORAGE_KEYS.QUALITY_SETTING] === QUALITY_LEVELS.HIGH;
			const reloadCalledOnce = reloadCount === 1;

			// Reopen the same live instance (overlay closing and the player pausing again later, no
			// reload involved) and confirm it lands back on the main screen, not stuck mid-settings.
			menu.setOpen(false);
			menu.setOpen(true);
			const reopensOnMainScreen = !container.querySelector('.g3d-pause-menu-main-panel').hidden
				&& container.querySelector('.g3d-pause-menu-settings-panel').hidden;

			// Back button returns to the main screen without touching storage or reloading again.
			container.querySelector('.g3d-pause-menu-settings-open').click();
			container.querySelector('.g3d-pause-menu-settings-back').click();
			const backReturnsToMain = !container.querySelector('.g3d-pause-menu-main-panel').hidden;
			const backDidNotReload = reloadCount === 1;

			menu.dispose();
			container.remove();

			// The real persistence path is a full page reload, not this live instance staying open --
			// `_buildSettingsPanel` only reads storage once, at construction. Construct a *second*,
			// independent instance against the same `storage` object (what a fresh `game3d.html` load
			// after Apply's reload actually does) and confirm its radio group starts checked on the
			// value the first instance just persisted, not on `AUTOMATIC` again.
			const reloadedContainer = document.createElement('div');
			document.body.appendChild(reloadedContainer);
			const reloadedMenu = new PauseMenu({ container: reloadedContainer, storage });
			reloadedMenu.setOpen(true);
			reloadedContainer.querySelector('.g3d-pause-menu-settings-open').click();
			const reloadedRadios = [...reloadedContainer.querySelectorAll('.g3d-pause-menu-settings-quality-option input')];
			const reflectsStoredSelection = reloadedRadios.find((r) => r.checked)?.value === QUALITY_LEVELS.HIGH;
			reloadedMenu.dispose();
			reloadedContainer.remove();

			// Mobile: the quality picker is replaced by a note, no apply button, no radios at all.
			const mobileContainer = document.createElement('div');
			document.body.appendChild(mobileContainer);
			const mobileMenu = new PauseMenu({ container: mobileContainer, isMobileClass: true, storage: makeFakeStorage() });
			mobileMenu.setOpen(true);
			mobileContainer.querySelector('.g3d-pause-menu-settings-open').click();
			const mobileHasNoRadios = mobileContainer.querySelectorAll('.g3d-pause-menu-settings-quality-option').length === 0;
			const mobileHasNoApplyButton = mobileContainer.querySelector('.g3d-pause-menu-settings-apply') === null;
			const mobileHasNote = mobileContainer.querySelector('.g3d-pause-menu-settings-note') !== null;
			mobileMenu.dispose();
			mobileContainer.remove();

			// The pure `resolveRenderQuality()` decision itself (run 341's actual runtime effect, not
			// just the UI around it): a manual level only applies on desktop, never on a coarse-pointer
			// device, and an unknown/AUTOMATIC value falls back to the existing per-device default.
			const { resolveRenderQuality } = await import('/src/3d/renderQuality.js');
			const desktopAutoIsHigh = resolveRenderQuality({ coarsePointer: false }).level === QUALITY_LEVELS.HIGH;
			const desktopManualLowApplies = resolveRenderQuality({ coarsePointer: false, manualLevel: QUALITY_LEVELS.LOW }).level === QUALITY_LEVELS.LOW;
			const mobileIgnoresManualOverride = resolveRenderQuality({ coarsePointer: true, manualLevel: QUALITY_LEVELS.ULTRA }).level === QUALITY_LEVELS.LOW;
			const mobileShadowsStayOffRegardless = resolveRenderQuality({ coarsePointer: true, manualLevel: QUALITY_LEVELS.ULTRA }).shadowsEnabled === false;
			const unknownManualLevelFallsBack = resolveRenderQuality({ coarsePointer: false, manualLevel: 'not-a-real-level' }).level === QUALITY_LEVELS.HIGH;
			const automaticMeansNoOverride = resolveRenderQuality({ coarsePointer: false, manualLevel: QUALITY_LEVELS.AUTOMATIC }).level === QUALITY_LEVELS.HIGH;

			return {
				mainHiddenInSettings, settingsPanelVisible, desktopHasFourOptions, defaultCheckedIsAutomatic,
				storedHigh, reloadCalledOnce, reopensOnMainScreen, reflectsStoredSelection,
				backReturnsToMain, backDidNotReload,
				mobileHasNoRadios, mobileHasNoApplyButton, mobileHasNote,
				desktopAutoIsHigh, desktopManualLowApplies, mobileIgnoresManualOverride,
				mobileShadowsStayOffRegardless, unknownManualLevelFallsBack, automaticMeansNoOverride,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'pause menu settings screen (ui/pauseMenu.js + renderQuality.js, run 341)',
		ok,
		details: ok
			? 'settings screen shows 4 quality radios on desktop (defaulting to Otomatik) and a note '
				+ '(no radios/apply) on mobile; applying a choice persists it and reloads exactly once; '
				+ 'reopening always lands on the main screen and reflects the persisted choice; back '
				+ 'returns without persisting/reloading; resolveRenderQuality() only honors a manual '
				+ 'override on desktop, ignores it (and keeps shadows off) on a coarse-pointer device, '
				+ 'and treats AUTOMATIC/unknown values as no override'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkPauseMenu, checkPauseMenuSettings };
