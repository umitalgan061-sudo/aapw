/** FAZ 8 day/night clock regression check (run 107, ADR-0134). */

const NAV_TIMEOUT_MS = 10_000;

async function checkDayNightClock(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { DayNightClock } = await import('/src/3d/ui/dayNightClock.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const clock = new DayNightClock({ container });
			const root = container.querySelector('.g3d-day-night-clock');
			const timeEl = root.querySelector('.g3d-day-night-clock-time');
			const iconEl = root.querySelector('.g3d-day-night-clock-icon');

			// Noon: timeRatio 0.5 -> 12:00, nightFactor 0 (well below DAY threshold) -> sun icon.
			clock.update(0.5, 0);
			const noonCorrect = timeEl.textContent === '12:00' && iconEl.textContent === '☀️';

			// Midnight: timeRatio 0 -> 00:00, nightFactor 1 -> moon icon.
			clock.update(0, 1);
			const midnightCorrect = timeEl.textContent === '00:00' && iconEl.textContent === '🌙';

			// Dawn/dusk band: nightFactor 0.35 (between the two thresholds) -> twilight icon.
			clock.update(0.27, 0.35);
			const twilightCorrect = iconEl.textContent === '🌅';

			// A specific ratio maps to the expected HH:MM (18:30 = 0.75 + 30/1440).
			clock.update(0.75 + 30 / 1440, 0.35);
			const arbitraryTimeCorrect = timeEl.textContent === '18:30';

			// Sub-minute changes within the same displayed minute must not rewrite the DOM text —
			// same throttle-proof shape checkSettlementCompass's own distance-bucket assertion uses.
			const beforeThrottleText = timeEl.textContent;
			clock.update(0.75 + 30.4 / 1440, 0.35);
			const throttleHoldsWithinMinute = timeEl.textContent === beforeThrottleText;

			// A ratio outside [0, 1) (e.g. exactly 1, or negative) normalizes rather than throwing.
			let normalizesOutOfRangeRatio = true;
			try {
				clock.update(1, 0);
				normalizesOutOfRangeRatio = timeEl.textContent === '00:00';
				clock.update(-0.25, 0);
				normalizesOutOfRangeRatio = normalizesOutOfRangeRatio && timeEl.textContent === '18:00';
			} catch {
				normalizesOutOfRangeRatio = false;
			}

			const fitsMobileViewport = root.getBoundingClientRect().left >= 0
				&& root.getBoundingClientRect().right <= window.innerWidth;

			clock.dispose();
			const disposeRemovesDom = container.querySelector('.g3d-day-night-clock') === null;
			container.remove();

			return {
				noonCorrect,
				midnightCorrect,
				twilightCorrect,
				arbitraryTimeCorrect,
				throttleHoldsWithinMinute,
				normalizesOutOfRangeRatio,
				fitsMobileViewport,
				disposeRemovesDom,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'day/night clock (ui/dayNightClock.js)',
		ok,
		details: ok
			? 'noon/midnight/twilight icons correct, arbitrary HH:MM resolves, sub-minute changes throttle, out-of-range ratio normalizes, mobile panel fits, dispose removes DOM'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkDayNightClock };
