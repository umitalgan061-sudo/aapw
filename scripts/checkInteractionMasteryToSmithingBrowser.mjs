#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for mastery-to-smithing browser acceptance');

const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
	await page.route(`http://127.0.0.1:${port}/src/3d/game3d.js`, (route) => route.fulfill({
		status: 200,
		contentType: 'text/javascript',
		body: 'export function initGame3D() {}\n',
	}));
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const { QUARTERMASTER_NPC_ID, QUARTERMASTER_OFFERS } = await import('/src/3d/gameplay/interactionEconomy.js');
		const armorer = QUARTERMASTER_OFFERS.find((offer) => offer.id === 'dragonstone-whetstone');
		const recipe = armorer?.fulfillment?.craftUpgrade;
		const item = (snapshot, itemId) => snapshot.inventory.items.find((entry) => entry.itemId === itemId) ?? null;
		const quantity = (snapshot, itemId) => item(snapshot, itemId)?.quantity ?? 0;
		const hasProvenance = (entry, sourceType, sourceId) => entry?.provenance?.some((source) => source.sourceType === sourceType && source.sourceId === sourceId) === true;
		const makeDialogueController = () => {
			const host = document.createElement('div');
			document.body.appendChild(host);
			const dialogueBox = new DialogueBox(host);
			const events = { inventory: [], economy: [] };
			const controller = createInteractionController({
				interactionPrompt: { setVisible() {} },
				dialogueBox,
				greetingTemplate: 'Selam, {name}!',
				radiusMeters: 6,
				onInventoryChanged: (snapshot) => events.inventory.push(structuredClone(snapshot)),
				onEconomyChanged: (snapshot) => events.economy.push(structuredClone(snapshot)),
			});
			dialogueBox.setChoiceHandler((index) => controller.handleChoice(index));
			dialogueBox.setCloseHandler(() => controller.handleKeyDown({ code: 'KeyB', repeat: false }));
			controller.update([{
				object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
				displayName: 'Dragonstone Levazımcısı',
			}], { x: 1, z: 1 });
			return { host, dialogueBox, controller, events };
		};

		const mastery = makeDialogueController();
		const masterySave = mastery.controller.getRpgSnapshot();
		masterySave.inventory = {
			items: [
				{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
				{ itemId: 'dragonstone-travel-ration-pack', quantity: 4, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
			],
		};
		masterySave.worldState = {
			dragonstoneWatchPolicy: null,
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
		};
		mastery.controller.restoreRpgSnapshot(masterySave);
		mastery.events.inventory.length = 0;
		mastery.events.economy.length = 0;

		mastery.controller.handleKeyDown({ code: 'KeyT', repeat: false });
		const boardAdvertisesProgress = mastery.dialogueBox._textEl.textContent.includes('Sefer ustalığı: İLERLEME 2/3');
		mastery.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const masteryText = mastery.dialogueBox._textEl.textContent;
		const afterMastery = structuredClone(mastery.controller.getRpgSnapshot());
		const masteryWhetstone = item(afterMastery, 'dragonstone-whetstone');
		const masteryKit = item(afterMastery, recipe.outputItemId);
		const masteryTextOk = masteryText.includes('SEFER USTALIĞI KAZANILDI: 50 XP + 3 Dragonstone itibarı + 20 bakır')
			&& masteryText.includes('Ustalık smithing ödülü: 1 Nöbetçi Bileği Taşı');
		const masteryRewardOk = masteryWhetstone?.quantity === 1
			&& hasProvenance(masteryWhetstone, 'expedition-mastery', 'dragonstone-expedition-mastery');
		const masteryGranted = masteryTextOk
			&& masteryRewardOk
			&& afterMastery.economy.copper === 70
			&& afterMastery.worldState.dragonstoneExpeditionMasteryClaimed === true
			&& masteryKit?.quantity === 1;

		mastery.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const serviceAdvertised = mastery.dialogueBox._textEl.textContent.includes('HİZMET: Zırhçı bileme hazırlığı')
			&& mastery.dialogueBox._textEl.textContent.includes('1 yol azığı paketi + 1 bileği taşını 1 sefer bakım kitine hazırla');
		const beforeBlocked = structuredClone(mastery.controller.getRpgSnapshot());
		mastery.controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const blocked = structuredClone(mastery.controller.getRpgSnapshot());
		const blockedAtomically = mastery.dialogueBox._textEl.textContent.includes('Satın alma başarısız.')
			&& blocked.economy.copper === beforeBlocked.economy.copper
			&& blocked.economy.stockByOffer[armorer.id] === beforeBlocked.economy.stockByOffer[armorer.id]
			&& blocked.economy.ledger.transactionCount === beforeBlocked.economy.ledger.transactionCount
			&& quantity(blocked, 'dragonstone-whetstone') === quantity(beforeBlocked, 'dragonstone-whetstone')
			&& quantity(blocked, 'dragonstone-travel-ration-pack') === quantity(beforeBlocked, 'dragonstone-travel-ration-pack')
			&& quantity(blocked, recipe.outputItemId) === 1;

		const service = makeDialogueController();
		const serviceSave = service.controller.getRpgSnapshot();
		serviceSave.inventory = {
			items: [
				{ itemId: 'dragonstone-travel-ration-pack', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
				{ itemId: 'dragonstone-whetstone', quantity: 1, provenance: [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }] },
			],
		};
		serviceSave.worldState = {
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run', 'dragonstone-ridge-camp'],
			dragonstoneExpeditionMasteryClaimed: true,
		};
		service.controller.restoreRpgSnapshot(serviceSave);
		service.events.inventory.length = 0;
		service.events.economy.length = 0;
		service.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const cleanServiceAdvertised = service.dialogueBox._textEl.textContent.includes('HİZMET: Zırhçı bileme hazırlığı');
		service.controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const afterService = structuredClone(service.controller.getRpgSnapshot());
		const whetstonesAfterService = item(afterService, 'dragonstone-whetstone');
		const kitAfterService = item(afterService, recipe.outputItemId);
		const receipt = afterService.economy.ledger.recentTransactions.at(-1);
		const craftCompleted = cleanServiceAdvertised
			&& quantity(afterService, 'dragonstone-travel-ration-pack') === 0
			&& !whetstonesAfterService
			&& kitAfterService?.quantity === 1
			&& kitAfterService?.provenance?.at(-1)?.sourceType === 'settlement-crafting'
			&& kitAfterService?.provenance?.at(-1)?.sourceId === recipe.recipeId
			&& afterService.inventory.fieldReadiness.capabilities.fastTravelEligible === true
			&& afterService.inventory.fieldReadiness.equipped?.itemId === recipe.outputItemId
			&& afterService.economy.copper === 28
			&& afterService.economy.stockByOffer[armorer.id] === 1
			&& receipt?.offerId === armorer.id
			&& receipt?.balanceCopper === 28;

		const persistedSave = structuredClone(afterService);
		const restored = makeDialogueController();
		restored.controller.restoreRpgSnapshot(persistedSave);
		const roundTrip = restored.controller.getRpgSnapshot();
		const restoredWhetstones = item(roundTrip, 'dragonstone-whetstone');
		const restoredKit = item(roundTrip, recipe.outputItemId);
		const persisted = roundTrip.economy.copper === 28
			&& !restoredWhetstones
			&& restoredKit?.quantity === 1
			&& restoredKit?.provenance?.at(-1)?.sourceId === recipe.recipeId
			&& roundTrip.inventory.fieldReadiness.capabilities.fastTravelEligible === true
			&& roundTrip.inventory.fieldReadiness.equipped?.itemId === recipe.outputItemId
			&& quantity(roundTrip, 'dragonstone-travel-ration-pack') === 0;

		for (const harness of [restored, service, mastery]) {
			harness.dialogueBox.dispose();
			harness.host.remove();
		}
		return {
			boardAdvertisesProgress,
			masteryGranted,
			masteryTextOk,
			masteryRewardOk,
			serviceAdvertised,
			blockedAtomically,
			craftCompleted,
			persisted,
			masteryBalance: afterMastery.economy.copper,
			masteryKitQuantity: masteryKit?.quantity ?? 0,
			blockedBalance: blocked.economy.copper,
			serviceBalance: afterService.economy.copper,
			kitQuantity: kitAfterService?.quantity ?? 0,
			whetstonesAfterService: whetstonesAfterService?.quantity ?? 0,
			serviceInventoryEvents: service.events.inventory.length,
			serviceEconomyEvents: service.events.economy.length,
		};
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Mastery-to-smithing emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['boardAdvertisesProgress', 'masteryGranted', 'serviceAdvertised', 'blockedAtomically', 'craftCompleted', 'persisted']) {
		if (!result[key]) throw new Error(`Mastery-to-smithing browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: expedition mastery -> occupied-output atomic rejection + clean armorer craft -> field readiness -> save/load');
	console.log(`[RPG Chromium] mastery balance=${result.masteryBalance}, blocked balance=${result.blockedBalance}, service balance=${result.serviceBalance}, maintenance kits=${result.kitQuantity}`);
	console.log('[RPG Chromium] mastery-to-smithing page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
