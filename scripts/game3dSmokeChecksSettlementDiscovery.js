/** FAZ 8 persistent settlement-discovery regression check. Run 348 extended it with the new
 * `onDiscover` callback option (`game3d.js` wires it to `audio/audioManager.js`'s
 * `playDiscoveryChime()`). */

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

async function checkSettlementDiscovery(browser, baseUrl) {
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { SettlementDiscovery } = await import('/src/3d/ui/settlementDiscovery.js');
			const storageValues = new Map();
			const storage = {
				getItem: (key) => storageValues.get(key) ?? null,
				setItem: (key, value) => storageValues.set(key, value),
			};
			const container = document.createElement('div');
			document.body.appendChild(container);
			const seats = [{ id: 'winterfell', name: 'Kışyarı', x: 100, z: 100 }];
			// Run 348: onDiscover — game3d.js wires this to audioManager.js's playDiscoveryChime();
			// a plain array here, same isolation shape every other callback option in this codebase's
			// own smoke checks already uses (see e.g. checkPauseMenuSettings' storage/reload fakes).
			const discoverEvents = [];
			const discovery = new SettlementDiscovery({
				seats, container, storage, radiusMeters: 20, visibleMilliseconds: 20,
				onDiscover: (seat) => discoverEvents.push(seat.id),
			});
			discovery.update({ x: 0, z: 0 });
			const root = container.querySelector('.g3d-settlement-discovery');
			const staysHiddenWhenFar = root.hidden;
			const outOfRangeDidNotFireCallback = discoverEvents.length === 0;
			discovery.update({ x: 90, z: 100 });
			const announcesOnArrival = !root.hidden && root.textContent.includes('Kışyarı')
				&& root.getAttribute('role') === 'status' && root.getAttribute('aria-live') === 'polite';
			const onDiscoverFiredOnceWithSeatId = JSON.stringify(discoverEvents) === JSON.stringify(['winterfell']);
			discovery.update({ x: 90, z: 100 });
			const onDiscoverDidNotRefireOnRevisit = discoverEvents.length === 1;
			const persistsDiscovery = [...storageValues.values()].some((value) => value.includes('winterfell'));
			const reportsDiscoveryProgress = root.textContent.includes('1 / 1 yerleşim keşfedildi')
				&& root.querySelector('.g3d-settlement-discovery-progress')?.getAttribute('aria-label') === 'Keşif ilerlemesi';
			if (!reportsDiscoveryProgress) throw new Error('Settlement discovery progress is missing or inaccessible');
			const celebratesCompletion = root.classList.contains('is-complete')
				&& root.textContent.includes('Tüm yerleşimler keşfedildi');
			if (!celebratesCompletion) throw new Error('Final settlement discovery is not celebrated');
			const fitsMobileViewport = root.getBoundingClientRect().left >= 0
				&& root.getBoundingClientRect().right <= window.innerWidth;
			await new Promise((resolve) => setTimeout(resolve, 30));
			const autoHides = root.hidden;
			discovery.dispose();
			const disposeRemovesDom = !container.querySelector('.g3d-settlement-discovery');

			const remembered = new SettlementDiscovery({ seats, container, storage, radiusMeters: 20 });
			remembered.update({ x: 100, z: 100 });
			const doesNotRepeat = remembered._root.hidden;
			remembered.dispose();
			const blockedStorage = {
				getItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
				setItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
			};
			const restricted = new SettlementDiscovery({ seats, container, storage: blockedStorage, radiusMeters: 20 });
			restricted.update({ x: 100, z: 100 });
			const storageFailureFallsBack = !restricted._root.hidden
				&& restricted._root.textContent.includes('Kışyarı');
			restricted.dispose();
			container.remove();
			return {
				staysHiddenWhenFar, outOfRangeDidNotFireCallback, announcesOnArrival, onDiscoverFiredOnceWithSeatId,
				onDiscoverDidNotRefireOnRevisit, persistsDiscovery, fitsMobileViewport, autoHides, disposeRemovesDom,
				doesNotRepeat, storageFailureFallsBack,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'persistent settlement discovery (ui/settlementDiscovery.js, run 348 onDiscover)',
		ok,
		details: ok
			? 'range, announcement, persistence, mobile fit, timeout and disposal pass; onDiscover fires '
				+ 'exactly once per newly-discovered seat (never out-of-range, never on a revisit)'
			: `FAILED: ${JSON.stringify(result)}`,
	};
}

module.exports = { checkSettlementDiscovery };
