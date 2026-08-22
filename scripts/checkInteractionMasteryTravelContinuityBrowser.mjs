#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for mastery-travel browser acceptance');

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
		const { QUARTERMASTER_NPC_ID } = await import('/src/3d/gameplay/interactionEconomy.js');
		const host = document.createElement('div');
		document.body.appendChild(host);
		const dialogueBox = new DialogueBox(host);
		const controller = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		dialogueBox.setChoiceHandler((index) => controller.handleChoice(index));
		const quartermaster = { object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } }, displayName: 'Dragonstone Levazımcısı' };
		controller.update([quartermaster], { x: 1, z: 1 });
		const seed = controller.getRpgSnapshot();
		seed.inventory = { items: [
			{ itemId: 'dragonstone-travel-ration-pack', quantity: 2, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
			{ itemId: 'dragonstone-whetstone', quantity: 1, provenance: [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }] },
		] };
		seed.worldState = { dragonstoneWatchPolicy: null, dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run', 'dragonstone-ridge-camp'], dragonstoneExpeditionMasteryClaimed: true };
		controller.restoreRpgSnapshot(seed);

		controller.handleKeyDown({ code: 'KeyB', repeat: false });
		controller.handleKeyDown({ code: 'KeyF', repeat: false });
		const crafted = structuredClone(controller.getRpgSnapshot());
		const kit = crafted.inventory.items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit');
		const remainingPack = crafted.inventory.items.find((item) => item.itemId === 'dragonstone-travel-ration-pack');
		const craftReady = kit?.quantity === 1 && remainingPack?.quantity === 1 && crafted.inventory.fieldReadiness?.capabilities?.fastTravelEligible === true;

		const journey = controller.commitJourneyWithRestStops([{ type: 'travel', originId: 'dragonstone', destinationId: 'dragonstone-ridge', discovered: true, routeOpen: true, inCombat: false, distanceKm: 30 }]);
		const afterJourney = structuredClone(controller.getRpgSnapshot());
		const afterKit = afterJourney.inventory.items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit');
		const afterPack = afterJourney.inventory.items.find((item) => item.itemId === 'dragonstone-travel-ration-pack');
		controller.showInventory();
		const inventoryText = dialogueBox._textEl.textContent;
		const journeyReady = journey.ok === true && journey.consumedQuantity === 1 && afterKit?.quantity === 1 && !afterPack
			&& afterJourney.journey?.commitCount === 1 && afterJourney.journey?.fatigueKm === 30 && afterJourney.journey?.lastDestinationId === 'dragonstone-ridge'
			&& inventoryText.includes('Sefer yorgunluğu: 30/') && inventoryText.includes('Sefer hazırlığı: SEFERE HAZIR');

		const secondHost = document.createElement('div'); document.body.appendChild(secondHost);
		const secondDialogue = new DialogueBox(secondHost);
		const second = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox: secondDialogue, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		second.restoreRpgSnapshot(structuredClone(afterJourney));
		const roundTrip = second.getRpgSnapshot();
		const persisted = roundTrip.journey?.commitCount === 1 && roundTrip.journey?.fatigueKm === 30 && roundTrip.journey?.lastDestinationId === 'dragonstone-ridge'
			&& roundTrip.inventory.items.some((item) => item.itemId === 'dragonstone-expedition-maintenance-kit' && item.quantity === 1)
			&& !roundTrip.inventory.items.some((item) => item.itemId === 'dragonstone-travel-ration-pack');
		secondDialogue.dispose(); secondHost.remove(); dialogueBox.dispose(); host.remove();
		return { craftReady, journeyReady, persisted };
	});
	if (pageErrors.length || consoleErrors.length) throw new Error(`Mastery travel emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['craftReady', 'journeyReady', 'persisted']) if (!result[key]) throw new Error(`Mastery travel browser assertion failed: ${key} ${JSON.stringify(result)}`);
	console.log('[RPG Chromium] PASS: mastery armorer craft -> field readiness -> 30 km journey -> save/load continuity');
	console.log('[RPG Chromium] mastery travel page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
