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

		const save = controller.getRpgSnapshot();
		save.inventory = {
			items: [
				{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
				{ itemId: 'dragonstone-travel-ration-pack', quantity: 3, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
			],
		};
		save.worldState = {
			dragonstoneWatchPolicy: null,
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
		};
		controller.restoreRpgSnapshot(save);
		events.inventory.length = 0;
		events.economy.length = 0;

		controller.handleKeyDown({ code: 'KeyT', repeat: false });
		const boardAdvertisesProgress = dialogueBox._textEl.textContent.includes('Sefer ustalığı: İLERLEME 2/3');
		controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const masteryText = dialogueBox._textEl.textContent;
		const afterMastery = controller.getRpgSnapshot();
		const whetstone = afterMastery.inventory.items.find((item) => item.itemId === 'dragonstone-whetstone');
		const pack = afterMastery.inventory.items.find((item) => item.itemId === 'dragonstone-travel-ration-pack');
		const masteryTextOk = masteryText.includes('SEFER USTALIĞI KAZANILDI: 50 XP + 3 Dragonstone itibarı + 20 bakır')
			&& masteryText.includes('Ustalık smithing ödülü: 1 Nöbetçi Bileği Taşı');
		const masteryRewardOk = whetstone?.quantity === 1
			&& whetstone?.provenance?.at(-1)?.sourceType === 'expedition-mastery'
			&& whetstone?.provenance?.at(-1)?.sourceId === 'dragonstone-expedition-mastery';
		const masteryGranted = masteryTextOk
			&& masteryRewardOk
			&& pack?.quantity === 1
			&& afterMastery.economy.copper === 70;

		controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const serviceAdvertised = dialogueBox._textEl.textContent.includes('HİZMET: Zırhçı bileme hazırlığı')
			&& dialogueBox._textEl.textContent.includes('1 yol azığı paketi + 1 bileği taşını 1 sefer bakım kitine hazırla');
		controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const afterCraft = controller.getRpgSnapshot();
		const craftedKit = afterCraft.inventory.items.find((item) => item.itemId === recipe.outputItemId);
		const crafted = afterCraft.inventory.items.every((item) => item.itemId !== 'dragonstone-whetstone')
			&& craftedKit?.quantity === 1
			&& craftedKit?.provenance?.at(-1)?.sourceType === 'settlement-crafting'
			&& craftedKit?.provenance?.at(-1)?.sourceId === recipe.recipeId
			&& afterCraft.economy.copper === 58
			&& afterCraft.economy.stockByOffer[armorer.id] === 1;

		const persistedSave = structuredClone(afterCraft);
		const secondHost = document.createElement('div');
		document.body.appendChild(secondHost);
		const secondDialogue = new DialogueBox(secondHost);
		const restored = createInteractionController({
			interactionPrompt: { setVisible() {} },
			dialogueBox: secondDialogue,
			greetingTemplate: 'Selam, {name}!',
			radiusMeters: 6,
		});
		restored.restoreRpgSnapshot(persistedSave);
		const roundTrip = restored.getRpgSnapshot();
		const restoredKit = roundTrip.inventory.items.find((item) => item.itemId === recipe.outputItemId);
		const persisted = roundTrip.worldState.dragonstoneExpeditionMasteryClaimed === true
			&& roundTrip.economy.copper === 58
			&& restoredKit?.quantity === 1
			&& restoredKit?.provenance?.at(-1)?.sourceId === recipe.recipeId
			&& roundTrip.inventory.items.every((item) => item.itemId !== 'dragonstone-whetstone');

		secondDialogue.dispose();
		secondHost.remove();
		dialogueBox.dispose();
		host.remove();
		return {
			boardAdvertisesProgress,
			masteryGranted,
			masteryTextOk,
			masteryRewardOk,
			remainingPacks: pack?.quantity ?? 0,
			masteryBalance: afterMastery.economy.copper,
			serviceAdvertised,
			crafted,
			persisted,
			inventoryEvents: events.inventory.length,
			economyEvents: events.economy.length,
			balance: afterCraft.economy.copper,
			kitQuantity: craftedKit?.quantity ?? 0,
		};
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Mastery-to-smithing emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['boardAdvertisesProgress', 'masteryGranted', 'serviceAdvertised', 'crafted', 'persisted']) {
		if (!result[key]) throw new Error(`Mastery-to-smithing browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: expedition mastery → canonical whetstone reward → armorer maintenance-kit craft → save/load');
	console.log(`[RPG Chromium] mastery-to-smithing balance=${result.balance}, maintenance kits=${result.kitQuantity}, inventory events=${result.inventoryEvents}, economy events=${result.economyEvents}`);
	console.log('[RPG Chromium] mastery-to-smithing page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
