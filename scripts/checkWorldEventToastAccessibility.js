#!/usr/bin/env node
/**
 * Run 150 regression guard for world-event toast accessibility semantics.
 * Uses the real browser module and EventBus; no production dependency is added.
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
			const [{ EventBus }, { WorldEventToast }] = await Promise.all([
				import('/src/3d/eventBus.js'),
				import('/src/3d/ui/worldEventToast.js'),
			]);
			const bus = new EventBus();
			const container = document.createElement('div');
			document.body.appendChild(container);
			const toast = new WorldEventToast({ eventsBus: bus, eventName: 'run150-test', container });
			const payload = {
				icon: '🔥',
				title: 'Gece İşaret Ateşi',
				desc: 'Uzakta bir işaret ateşi yanıyor.',
				color: '#d05a32',
			};
			bus.emit('run150-test', payload);
			const el = container.querySelector('.g3d-event-toast');
			const icon = container.querySelector('.g3d-event-toast-icon');
			const rect = el?.getBoundingClientRect();
			const snapshot = {
				role: el?.getAttribute('role'),
				live: el?.getAttribute('aria-live'),
				atomic: el?.getAttribute('aria-atomic'),
				iconHidden: icon?.getAttribute('aria-hidden'),
				hidden: el?.hidden,
				title: container.querySelector('.g3d-event-toast-title')?.textContent,
				desc: container.querySelector('.g3d-event-toast-desc')?.textContent,
				width: rect?.width ?? 0,
				height: rect?.height ?? 0,
			};
			toast.dispose();
			bus.emit('run150-test', payload);
			snapshot.disposed = !container.querySelector('.g3d-event-toast');
			container.remove();
			return snapshot;
		});

		const expected = {
			role: 'status',
			live: 'polite',
			atomic: 'true',
			iconHidden: 'true',
			hidden: false,
			title: 'Gece İşaret Ateşi',
			desc: 'Uzakta bir işaret ateşi yanıyor.',
			disposed: true,
		};
		for (const [key, value] of Object.entries(expected)) {
			if (result[key] !== value) throw new Error(`${label} ${key}: expected ${value}, got ${result[key]}`);
		}
		if (!(result.width > 0 && result.height > 0)) throw new Error(`${label}: toast has no visible layout box`);
		if (pageErrors.length) throw new Error(`${label} page errors: ${pageErrors.join(' | ')}`);
		console.log(`[world-event-toast-a11y] PASS ${label}:`, JSON.stringify(result));
		if (consoleErrors.length) {
			console.log(`[world-event-toast-a11y] INFO ${label}: ${consoleErrors.length} unrelated boot console.error(s) observed; full smoke owns the zero-error gate.`);
		}
		return result;
	} finally {
		await page.close();
	}
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[world-event-toast-a11y] SKIP: Playwright unavailable.');
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
	console.error('[world-event-toast-a11y] FAIL:', error);
	process.exit(1);
});
