#!/usr/bin/env node
/**
 * Real mobile-class render-budget gate for the 3D mode.
 *
 * Boots game3d.html in Chromium with a touch/mobile context so the same `(pointer: coarse)` branch
 * used by sceneManager.js and the run-130 bounded-streaming policy is exercised. It then reads the
 * live F2 renderer.info counters and rejects a run that exceeds GOVERNANCE.md's measurable mobile
 * budgets: DrawCalls < 500 and Triangles < 500,000. Texture *memory* is not exposed by
 * renderer.info, so this tool reports the live texture-object count but deliberately does not
 * invent a MB estimate; the existing <512 MB texture-memory rule remains a real-device/profile
 * requirement rather than a fabricated CI number.
 *
 * Headless/software-render FPS is printed for run-over-run trend only, never treated as the real
 * 30-60 FPS phone target. The structural GPU-submission counters are deterministic enough for CI.
 */

const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(__dirname, '..');
void ROOT;

const MOBILE_BUDGET = Object.freeze({
	drawCallsExclusiveMax: 500,
	trianglesExclusiveMax: 500000,
});

const SAMPLE_WAIT_MS = 3500;

function parsePanel(text) {
	const num = (re) => Number((text.match(re) ?? [])[1]?.replace(/,/g, '') ?? NaN);
	return {
		fps: num(/FPS:\s*(\d+)/),
		drawCalls: num(/Draw calls:\s*(\d+)/),
		triangles: num(/Triangles:\s*([\d,]+)/),
		geometries: num(/Geometries:\s*(\d+)/),
		textures: num(/Textures:\s*(\d+)/),
	};
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkMobilePerfBudget] FAIL: Playwright is unavailable.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const baseUrl = `http://127.0.0.1:${port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 430, height: 932 },
		screen: { width: 430, height: 932 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		userAgent: 'WesterosPWA-MobileBudgetGate/1.0',
	});
	const page = await context.newPage();

	const consoleErrors = [];
	const pageErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => pageErrors.push(String(error)));

	try {
		// Use the shipped entry-gate readiness contract rather than a short locator-specific wait.
		// Run266's authoritative browser gate allows 120s for DOMContentLoaded on cold CI runners.
		// Resolve the static consent control directly from the parsed DOM instead of handing it to a
		// Locator, whose default 30s resolution timeout can mask a missing/already-dismissed gate and
		// prevent this test from ever reaching the independent GAME_READY/render-budget assertion.
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		const entryState = await page.evaluate(() => {
			const button = document.getElementById('run266-entry-enter');
			if (!button) {
				return {
					clicked: false,
					gatePresent: Boolean(document.getElementById('run266-entry-gate')),
				};
			}
			button.click();
			return { clicked: true, gatePresent: true };
		});
		if (!entryState.clicked && entryState.gatePresent) {
			throw new Error('run266 entry gate is present but its enter control is missing');
		}
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			null,
			{ timeout: 60000, polling: 250 },
		);

		const pointerProfile = await page.evaluate(() => ({
			coarse: window.matchMedia('(pointer: coarse)').matches,
			fine: window.matchMedia('(pointer: fine)').matches,
			touchPoints: navigator.maxTouchPoints,
		}));
		if (!pointerProfile.coarse || pointerProfile.touchPoints < 1) {
			throw new Error(`mobile emulation did not activate coarse/touch input: ${JSON.stringify(pointerProfile)}`);
		}

		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' })));
		await page.waitForTimeout(SAMPLE_WAIT_MS);
		const panelText = await page.locator('.g3d-perf-panel').textContent();
		const result = parsePanel(panelText ?? '');

		if (Object.values(result).some(Number.isNaN)) {
			throw new Error(`could not parse F2 panel: ${JSON.stringify(panelText)}`);
		}
		if (consoleErrors.length || pageErrors.length) {
			throw new Error(`console/page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
		}

		const payload = {
			profile: pointerProfile,
			...result,
			budgets: MOBILE_BUDGET,
			textureMemoryMB: null,
			textureMemoryReason: 'renderer.info exposes texture count, not resident texture-memory bytes',
		};
		console.log(`[checkMobilePerfBudget] sample ${JSON.stringify(payload)}`);

		if (result.drawCalls >= MOBILE_BUDGET.drawCallsExclusiveMax) {
			throw new Error(`draw-call budget exceeded: ${result.drawCalls} >= ${MOBILE_BUDGET.drawCallsExclusiveMax}`);
		}
		if (result.triangles >= MOBILE_BUDGET.trianglesExclusiveMax) {
			throw new Error(`triangle budget exceeded: ${result.triangles} >= ${MOBILE_BUDGET.trianglesExclusiveMax}`);
		}
		console.log('[checkMobilePerfBudget] PASS: measurable mobile render budgets are respected.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkMobilePerfBudget] FAIL:', error.message || error);
	process.exit(1);
});