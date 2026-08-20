#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for journey-planning browser acceptance');

const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
	await page.route(`http://127.0.0.1:${port}/src/3d/game3d.js`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export function initGame3D() {}\n' }));
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const { buildExpeditionJourneyOptionsText, buildExpeditionJourneyText, evaluateExpeditionJourney, rankExpeditionJourneyOptions } = await import('/src/3d/gameplay/interactionFieldReadiness.js');
		const host = document.createElement('div'); document.body.appendChild(host);
		const dialogueBox = new DialogueBox(host);
		const controller = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		const saved = controller.getRpgSnapshot();
		saved.inventory = { items: [
			{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
			{ itemId: 'dragonstone-travel-ration-pack', quantity: 2, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
		] };
		controller.restoreRpgSnapshot(saved);
		const restored = controller.getRpgSnapshot();
		const legs = [
			{ originId: 'dragonstone', destinationId: 'dragonstone-watch-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 10 },
			{ originId: 'dragonstone-watch-road', destinationId: 'dragonstone-harbor-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 25 },
			{ originId: 'dragonstone-harbor-road', destinationId: 'dragonstone', discovered: true, routeOpen: true, inCombat: false, distanceKm: 20 },
		];
		const plan = evaluateExpeditionJourney(restored.inventory, legs);
		dialogueBox.show(buildExpeditionJourneyText(plan));
		const rendered = dialogueBox._textEl.textContent;
		const ranked = rankExpeditionJourneyOptions(restored.inventory, [
			{ id: 'shore', label: 'Sahil yolu', legs: [{ originId: 'dragonstone', destinationId: 'harbor', discovered: true, routeOpen: true, distanceKm: 42 }] },
			{ id: 'ridge', label: 'Sırt yolu', legs: [{ originId: 'dragonstone', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 }] },
			{ id: 'closed-pass', label: 'Kapalı geçit', legs: [{ originId: 'dragonstone', destinationId: 'pass', discovered: true, routeOpen: false, distanceKm: 8 }] },
		]);
		dialogueBox.show(buildExpeditionJourneyOptionsText(ranked));
		const rankedRendered = dialogueBox._textEl.textContent;
		const inventoryAfterPlanning = controller.getRpgSnapshot().inventory;
		const preserved = inventoryAfterPlanning.fieldReadiness.travelCapacity.travelRationPacks === 2;
		const renderedRoute = rendered.includes('Toplam: 55 km · 2 yol azığı') && rendered.includes('Rota hazır · kalan yol azığı: 0');
		const sequential = plan.complete === true && plan.legs[0].requiredTravelPacks === 0 && plan.legs[1].requiredTravelPacks === 1 && plan.legs[2].remainingTravelPacksAfter === 0;
		const recommendation = ranked.preferredRouteId === 'ridge' && rankedRendered.includes('Sırt yolu · ÖNERİ · HAZIR · 28 km · 1 azık') && rankedRendered.includes('Önerilen rota: Sırt yolu');
		dialogueBox.dispose(); host.remove();
		return { renderedRoute, sequential, recommendation, preserved, rendered, rankedRendered };
	});
	if (pageErrors.length || consoleErrors.length) throw new Error(`Journey-planning browser proof emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['renderedRoute', 'sequential', 'recommendation', 'preserved']) if (!result[key]) throw new Error(`Journey-planning browser assertion failed: ${key} ${JSON.stringify(result)}`);
	console.log(`[RPG Chromium] PASS sequential journey planning + route recommendation ${JSON.stringify(result)}`);
} finally {
	await browser.close();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
