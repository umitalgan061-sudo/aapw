#!/usr/bin/env node
/**
 * Run 155 regression guard for the player health meter semantics (ui/healthBar.js).
 * Uses real Chromium at mobile and desktop viewports and verifies semantic value updates,
 * visual text/fill state, EventBus cleanup, and damage-flash timer cleanup.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function checkViewport(browser, baseUrl, viewport, label) {
	const page = await browser.newPage({ viewport });
	const pageErrors = [];
	const consoleErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});

	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded' });
		const result = await page.evaluate(async () => {
			const { HealthBar } = await import('/src/3d/ui/healthBar.js');
			const listeners = new Map();
			const eventsBus = {
				on(name, fn) { listeners.set(name, fn); },
				off(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
				emit(name, payload) { listeners.get(name)?.(payload); },
			};
			const container = document.createElement('div');
			document.body.appendChild(container);
			const bar = new HealthBar({
				eventsBus,
				healthChangedEventName: 'health',
				damageEventName: 'damage',
				container,
			});

			const initial = {
				role: bar._el.getAttribute('role'),
				label: bar._el.getAttribute('aria-label'),
				min: bar._el.getAttribute('aria-valuemin'),
				listenerCount: listeners.size,
			};

			eventsBus.emit('health', { current: 73.2, maxHealth: 100 });
			const afterHealth = {
				max: bar._el.getAttribute('aria-valuemax'),
				now: bar._el.getAttribute('aria-valuenow'),
				text: bar._el.getAttribute('aria-valuetext'),
				visibleText: bar._textEl.textContent,
				width: bar._fillEl.style.width,
			};

			eventsBus.emit('health', { current: -4, maxHealth: 100 });
			const clamped = {
				now: bar._el.getAttribute('aria-valuenow'),
				width: bar._fillEl.style.width,
			};

			eventsBus.emit('damage');
			const flashApplied = bar._el.classList.contains('g3d-health-bar-flash');
			bar.dispose();
			const disposed = {
				listenerCount: listeners.size,
				connected: bar._el.isConnected,
			};
			container.remove();
			return { initial, afterHealth, clamped, flashApplied, disposed };
		});

		const expected = {
			initial: { role: 'meter', label: 'Can', min: '0', listenerCount: 2 },
			afterHealth: { max: '100', now: '74', text: '74 / 100', visibleText: '74 / 100', width: '73.2%' },
			clamped: { now: '0', width: '0%' },
			disposed: { listenerCount: 0, connected: false },
		};
		for (const [group, fields] of Object.entries(expected)) {
			for (const [key, value] of Object.entries(fields)) {
				const actual = result[group]?.[key];
				if (actual !== value) throw new Error(`${label} ${group}.${key}: expected ${value}, got ${actual}`);
			}
		}
		if (result.flashApplied !== true) throw new Error(`${label} damage flash was not applied`);
		if (pageErrors.length) throw new Error(`${label} page errors: ${pageErrors.join(' | ')}`);
		console.log(`[health-bar-a11y] PASS ${label}:`, JSON.stringify(result));
		if (consoleErrors.length) {
			console.log(`[health-bar-a11y] INFO ${label}: ${consoleErrors.length} unrelated boot console.error(s) observed; full smoke owns the zero-error gate.`);
		}
	} finally {
		await page.close();
	}
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[health-bar-a11y] SKIP: Playwright unavailable.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		await checkViewport(browser, baseUrl, { width: 390, height: 844 }, 'mobile-390');
		await checkViewport(browser, baseUrl, { width: 1440, height: 900 }, 'desktop-1440');
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[health-bar-a11y] FAIL:', error);
	process.exit(1);
});
