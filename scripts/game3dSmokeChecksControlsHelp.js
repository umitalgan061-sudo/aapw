/** FAZ 8 responsive controls-reference regression check (run 104, ADR-0131). */

const NAV_TIMEOUT_MS = 10_000;

async function checkControlsHelp(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { ControlsHelp } = await import('/src/3d/ui/controlsHelp.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const help = new ControlsHelp({ container, isMobileClass: true });
			const button = container.querySelector('.g3d-controls-help-button');
			const panel = container.querySelector('.g3d-controls-help-panel');
			const startsClosed = !help.isOpen && panel.hidden && button.getAttribute('aria-expanded') === 'false';

			button.click();
			const touchLabels = [...panel.querySelectorAll('dt')].map((el) => el.textContent);
			const opensWithTouchContent = help.isOpen && !panel.hidden
				&& button.getAttribute('aria-expanded') === 'true'
				&& touchLabels.includes('Sol çubuk') && touchLabels.includes('Diyalog');
			const buttonTargetIs44px = button.getBoundingClientRect().width >= 44
				&& button.getBoundingClientRect().height >= 44;
			const panelFitsViewport = panel.getBoundingClientRect().left >= 0
				&& panel.getBoundingClientRect().right <= window.innerWidth;

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
			const escapeCloses = !help.isOpen && panel.hidden;
			help.dispose();
			const disposeRemovesDom = container.querySelector('.g3d-controls-help') === null;

			const desktopHelp = new ControlsHelp({ container, isMobileClass: false });
			desktopHelp.setOpen(true);
			const desktopLabels = [...container.querySelectorAll('dt')].map((el) => el.textContent);
			const desktopContent = desktopLabels.includes('WASD / Oklar')
				&& desktopLabels.includes('Space') && desktopLabels.includes('Fare');
			desktopHelp.dispose();
			container.remove();
			return {
				startsClosed, opensWithTouchContent, buttonTargetIs44px, panelFitsViewport,
				escapeCloses, disposeRemovesDom, desktopContent,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'responsive controls help (ui/controlsHelp.js)',
		ok,
		details: ok
			? '44px help button toggles mobile-specific content, panel fits 390px viewport, Escape closes, desktop content differs, dispose removes DOM'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkControlsHelp };
