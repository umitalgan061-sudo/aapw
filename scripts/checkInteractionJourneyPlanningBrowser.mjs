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
		const { buildInventoryText } = await import('/src/3d/gameplay/interactionConfig.js');
		const { JOURNEY_REST_BLOCK_REASON, REST_KIND, buildExpeditionJourneyOptionsText, buildExpeditionJourneyText, buildJourneyRestText, evaluateExpeditionJourney, evaluateJourneyWithRestStops, rankExpeditionJourneyOptions } = await import('/src/3d/gameplay/interactionFieldReadiness.js');
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
		const restSteps = [
			{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
			{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'watch-road-tavern', discovered: true, open: true },
			{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 30 },
		];
		const restPlan = evaluateJourneyWithRestStops(restored.inventory, restSteps);
		dialogueBox.show(buildJourneyRestText(restPlan));
		const restRendered = dialogueBox._textEl.textContent;
		const inventoryAfterPlanning = controller.getRpgSnapshot().inventory;
		const preserved = inventoryAfterPlanning.fieldReadiness.travelCapacity.travelRationPacks === 2;
		const renderedRoute = rendered.includes('Toplam: 55 km · 2 yol azığı') && rendered.includes('Rota hazır · kalan yol azığı: 0');
		const sequential = plan.complete === true && plan.legs[0].requiredTravelPacks === 0 && plan.legs[1].requiredTravelPacks === 1 && plan.legs[2].remainingTravelPacksAfter === 0;
		const recommendation = ranked.preferredRouteId === 'ridge' && rankedRendered.includes('Sırt yolu · ÖNERİ · HAZIR · 28 km · 1 azık') && rankedRendered.includes('Önerilen rota: Sırt yolu');
		const tavernRecovery = restPlan.complete === true && restPlan.totalDistanceKm === 58 && restPlan.steps[1].fatigueAfterKm === 0 && restRendered.includes('Taverna · watch-road-tavern · DİNLENDİ') && restRendered.includes('Plan hazır · son yorgunluk: 30 km');

		const committed = controller.commitJourneyWithRestStops(restSteps);
		const committedRpg = controller.getRpgSnapshot();
		const committedSnapshot = committedRpg.inventory;
		dialogueBox.show(buildInventoryText(committedSnapshot, committedRpg.journey));
		const committedRendered = dialogueBox._textEl.textContent;
		const remainingPacks = committedSnapshot.items.find((item) => item.itemId === 'dragonstone-travel-ration-pack')?.quantity ?? 0;
		const maintenanceKits = committedSnapshot.items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit')?.quantity ?? 0;
		const committedTravel = committed.ok === true
			&& committed.consumedQuantity === 2
			&& remainingPacks === 0
			&& maintenanceKits === 1
			&& committedSnapshot.totalWeightKg === 0.85
			&& committedSnapshot.fieldReadiness.tier === 'expedition-ready'
			&& committedRendered.includes('Hızlı seyahat menzili: 12 km · Yol azığı: 0')
			&& committedRendered.includes('Dragonstone Sefer Bakım Kiti ×1');
		const firstReceipt = committedRpg.journey?.recentReceipts?.[0];
		const journeySaved = committedRpg.schemaVersion === 6
			&& committedRpg.journey?.fatigueKm === 30
			&& committedRpg.journey?.commitCount === 1
			&& committedRpg.journey?.lastDestinationId === 'harbor-road'
			&& committedRpg.journey?.recentReceipts?.length === 1
			&& firstReceipt?.sequence === 1
			&& firstReceipt?.totalDistanceKm === 58
			&& firstReceipt?.consumedTravelPacks === 2
			&& firstReceipt?.finalFatigueKm === 30
			&& firstReceipt?.destinationId === 'harbor-road'
			&& firstReceipt?.restStopCount === 1
			&& committedRendered.includes('Sefer yorgunluğu: 30/36 km')
			&& committedRendered.includes('Kesintisiz kalan dayanıklılık: 6 km')
			&& committedRendered.includes('Son sefer hedefi: harbor-road')
			&& committedRendered.includes('Son sefer: 58 km · 2 yol azığı · 1 dinlenme');

		const restoredController = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		restoredController.restoreRpgSnapshot(committedRpg);
		const restoredJourney = restoredController.getJourneySnapshot();
		const receiptRestored = restoredJourney.recentReceipts?.length === 1
			&& restoredJourney.recentReceipts[0].sequence === 1
			&& restoredJourney.recentReceipts[0].destinationId === 'harbor-road';
		const fatigueBlocked = restoredController.commitJourneyWithRestStops([
			{ type: 'travel', destinationId: 'nearby-camp', discovered: true, routeOpen: true, distanceKm: 10 },
		]);
		const carriedFatigueBlocks = restoredJourney.fatigueKm === 30
			&& fatigueBlocked.ok === false
			&& fatigueBlocked.reason === JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED
			&& restoredController.getJourneySnapshot().fatigueKm === 30
			&& restoredController.getJourneySnapshot().recentReceipts.length === 1;
		const recoveredCommit = restoredController.commitJourneyWithRestStops([
			{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'harbor-road-tavern', discovered: true, open: true },
			{ type: 'travel', destinationId: 'nearby-camp', discovered: true, routeOpen: true, distanceKm: 10 },
		]);
		const recoveredRpg = restoredController.getRpgSnapshot();
		const secondReceipt = recoveredRpg.journey?.recentReceipts?.at(-1);
		const persistedRecovery = recoveredCommit.ok === true
			&& recoveredCommit.consumedQuantity === 0
			&& recoveredRpg.schemaVersion === 6
			&& recoveredRpg.journey?.fatigueKm === 10
			&& recoveredRpg.journey?.commitCount === 2
			&& recoveredRpg.journey?.lastDestinationId === 'nearby-camp'
			&& recoveredRpg.journey?.recentReceipts?.length === 2
			&& secondReceipt?.sequence === 2
			&& secondReceipt?.totalDistanceKm === 10
			&& secondReceipt?.consumedTravelPacks === 0
			&& secondReceipt?.finalFatigueKm === 10
			&& secondReceipt?.destinationId === 'nearby-camp'
			&& secondReceipt?.restStopCount === 1;

		dialogueBox.dispose(); host.remove();
		return { renderedRoute, sequential, recommendation, tavernRecovery, preserved, committedTravel, journeySaved, receiptRestored, carriedFatigueBlocks, persistedRecovery, rendered, rankedRendered, restRendered, committedRendered, committedPacks: committed.consumedQuantity, savedJourney: committedRpg.journey, recoveredJourney: recoveredRpg.journey };
	});
	if (pageErrors.length || consoleErrors.length) throw new Error(`Journey-planning browser proof emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['renderedRoute', 'sequential', 'recommendation', 'tavernRecovery', 'preserved', 'committedTravel', 'journeySaved', 'receiptRestored', 'carriedFatigueBlocks', 'persistedRecovery']) if (!result[key]) throw new Error(`Journey-planning browser assertion failed: ${key} ${JSON.stringify(result)}`);
	console.log(`[RPG Chromium] PASS journey planning + atomic commit + persisted fatigue/receipts ${JSON.stringify(result)}`);
} finally {
	await browser.close();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
