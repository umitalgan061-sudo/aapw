#!/usr/bin/env node
/**
 * Run 154 regression guard for the NPC dialogue box's accessibility semantics (ui/dialogueBox.js).
 * Same pattern/shape as run 150's checkWorldEventToastAccessibility.js and run 153's
 * checkSettlementDiscoveryAccessibility.js: real Chromium, real module, no production dependency
 * added by the test itself.
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
			const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const box = new DialogueBox(container);

			const beforeShow = {
				role: box._el.getAttribute('role'),
				live: box._el.getAttribute('aria-live'),
				atomicBeforeShow: box._el.getAttribute('aria-atomic'),
			};

			box.show('Kışyarı Lordu: Kuzey unutmaz.');
			const afterGreeting = {
				atomic: box._el.getAttribute('aria-atomic'),
				text: box._textEl.textContent,
				hidden: box._el.hidden,
			};

			box.show('Kim gelirse gelsin?', ['Bir soru sor', 'Ayrıl']);
			const afterChoices = {
				atomic: box._el.getAttribute('aria-atomic'),
				text: box._textEl.textContent,
				choiceCount: box._choicesEl.childElementCount,
			};

			box.dispose();
			container.remove();
			return { beforeShow, afterGreeting, afterChoices };
		});

		const expected = {
			beforeShow: { role: 'status', live: 'polite', atomicBeforeShow: null },
			afterGreeting: { atomic: 'true', text: 'Kışyarı Lordu: Kuzey unutmaz.', hidden: false },
			afterChoices: { atomic: 'true', text: 'Kim gelirse gelsin?', choiceCount: 2 },
		};
		for (const [group, fields] of Object.entries(expected)) {
			for (const [key, value] of Object.entries(fields)) {
				const actual = result[group]?.[key];
				if (actual !== value) throw new Error(`${label} ${group}.${key}: expected ${value}, got ${actual}`);
			}
		}
		if (pageErrors.length) throw new Error(`${label} page errors: ${pageErrors.join(' | ')}`);
		console.log(`[dialogue-box-a11y] PASS ${label}:`, JSON.stringify(result));
		if (consoleErrors.length) {
			console.log(`[dialogue-box-a11y] INFO ${label}: ${consoleErrors.length} unrelated boot console.error(s) observed; full smoke owns the zero-error gate.`);
		}
		return result;
	} finally {
		await page.close();
	}
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[dialogue-box-a11y] SKIP: Playwright unavailable.');
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
	console.error('[dialogue-box-a11y] FAIL:', error);
	process.exit(1);
});
