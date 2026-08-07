/** FAZ 8 persistent settlement-discovery regression check. */

const NAV_TIMEOUT_MS = 10_000;

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
			const discovery = new SettlementDiscovery({ seats, container, storage, radiusMeters: 20, visibleMilliseconds: 20 });
			discovery.update({ x: 0, z: 0 });
			const root = container.querySelector('.g3d-settlement-discovery');
			const staysHiddenWhenFar = root.hidden;
			discovery.update({ x: 90, z: 100 });
			const announcesOnArrival = !root.hidden && root.textContent.includes('Kışyarı')
				&& root.getAttribute('role') === 'status' && root.getAttribute('aria-live') === 'polite';
			const persistsDiscovery = [...storageValues.values()].some((value) => value.includes('winterfell'));
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
			return { staysHiddenWhenFar, announcesOnArrival, persistsDiscovery, fitsMobileViewport, autoHides, disposeRemovesDom, doesNotRepeat, storageFailureFallsBack };
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'persistent settlement discovery (ui/settlementDiscovery.js)',
		ok,
		details: ok ? 'range, announcement, persistence, mobile fit, timeout and disposal pass' : `FAILED: ${JSON.stringify(result)}`,
	};
}

module.exports = { checkSettlementDiscovery };
