/** FAZ 8 nearest-settlement compass regression check (run 106, ADR-0133). */

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
			compass.setSeatFilter((seat) => seat.name !== 'Doğu Kalesi');
			compass.update({ x: 0, z: 0 }, 0);
			if (root.querySelector('strong').textContent !== 'Kuzey Kalesi') throw new Error('Seat filter did not advance the compass target');
			compass.setSeatFilter(() => false);
			compass.update({ x: 0, z: 0 }, 0);
			if (!root.hidden) throw new Error('Compass stayed visible after every seat was filtered out');
			compass.setSeatFilter(null);
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
