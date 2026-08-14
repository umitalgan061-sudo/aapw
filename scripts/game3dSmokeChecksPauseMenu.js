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

module.exports = { checkPauseMenu };
