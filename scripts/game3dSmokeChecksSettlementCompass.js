/** FAZ 8 nearest-settlement compass regression check (run 106, ADR-0133). */

const NAV_TIMEOUT_MS = 10_000;

async function checkSettlementCompass(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { SettlementCompass } = await import('/src/3d/ui/settlementCompass.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const compass = new SettlementCompass({
				container,
				seats: [
					{ name: 'Kuzey Kalesi', x: 0, z: 100 },
					{ name: 'Doğu Kalesi', x: 40, z: 0 },
				],
			});
			compass.update({ x: 0, z: 0 }, 0);
			const root = container.querySelector('.g3d-settlement-compass');
			const selectsNearest = root.querySelector('strong').textContent === 'Doğu Kalesi'
				&& root.querySelector('.g3d-settlement-compass-distance').textContent === '40 m';
			const eastBearing = root.querySelector('.g3d-settlement-compass-arrow').style.transform;
			compass.update({ x: 0, z: 0 }, Math.PI / 2);
			const yawChangesArrow = root.querySelector('.g3d-settlement-compass-arrow').style.transform !== eastBearing;
			compass.update({ x: 39, z: 0 }, 0);
			const updatesDestination = root.querySelector('strong').textContent === 'Doğu Kalesi'
				&& root.querySelector('.g3d-settlement-compass-distance').textContent === '0 m';
			const fitsMobileViewport = root.getBoundingClientRect().left >= 0
				&& root.getBoundingClientRect().right <= window.innerWidth;
			compass.dispose();
			const disposeRemovesDom = container.querySelector('.g3d-settlement-compass') === null;

			const emptyCompass = new SettlementCompass({ container, seats: [] });
			emptyCompass.update({ x: 0, z: 0 }, 0);
			const noSeatsHides = emptyCompass._root.hidden === true;
			emptyCompass.dispose();
			container.remove();
			return { selectsNearest, yawChangesArrow, updatesDestination, fitsMobileViewport, disposeRemovesDom, noSeatsHides };
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'nearest-settlement compass (ui/settlementCompass.js)',
		ok,
		details: ok
			? 'nearest seat/distance resolve, player yaw rotates arrow, mobile panel fits, empty seats hide, dispose removes DOM'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkSettlementCompass };
