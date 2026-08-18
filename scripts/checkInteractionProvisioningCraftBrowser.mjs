#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for the provisioning-craft browser acceptance');

const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const { QUARTERMASTER_NPC_ID, QUARTERMASTER_OFFERS } = await import('/src/3d/gameplay/interactionEconomy.js');
		const rationOffer = QUARTERMASTER_OFFERS[0];
		const serviceOffer = QUARTERMASTER_OFFERS[2];
		const recipe = serviceOffer.fulfillment?.craftUpgrade;

		function makeRuntime() {
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
			}], { x: 0, z: 0 });
			return { host, dialogueBox, controller, events };
		}

		function item(snapshot, itemId) {
			return snapshot?.items?.find((entry) => entry.itemId === itemId) ?? null;
		}

		const first = makeRuntime();
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const advertised = first.dialogueBox._textEl.textContent.includes('DÖNÜŞÜM: 2 saha azığını 1 yol azığı paketine hazırla')
			&& first.dialogueBox._textEl.textContent.includes('HİZMET: Erzak hazırlama');

		first.controller.handleKeyDown({ code: 'Digit1', repeat: false });
		first.controller.handleKeyDown({ code: 'Digit1', repeat: false });
		const beforeCraft = first.controller.getRpgSnapshot();
		const inputsReady = beforeCraft.economy.copper === 28
			&& item(beforeCraft.inventory, rationOffer.itemId)?.quantity === 2
			&& beforeCraft.economy.stockByOffer[rationOffer.id] === 2;

		first.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const after = first.controller.getRpgSnapshot();
		const travelPack = item(after.inventory, recipe.outputItemId);
		const provenance = travelPack?.provenance?.at(-1);
		const receipt = after.economy.ledger.recentTransactions.at(-1);
		const crafted = after.economy.copper === 23
			&& after.economy.stockByOffer[serviceOffer.id] === 0
			&& after.economy.ledger.transactionCount === 3
			&& after.economy.ledger.lifetimeSpentCopper === 17
			&& item(after.inventory, rationOffer.itemId) == null
			&& travelPack?.quantity === 1
			&& provenance?.sourceType === 'settlement-crafting'
			&& provenance?.sourceId === recipe.recipeId
			&& receipt?.offerId === serviceOffer.id
			&& receipt?.balanceCopper === 23;
		const craftUx = first.dialogueBox._textEl.textContent.includes('stok 0/1')
			&& first.dialogueBox._textEl.textContent.includes('TÜKENDİ')
			&& first.dialogueBox._textEl.textContent.includes('DÖNÜŞÜM: 2 saha azığını 1 yol azığı paketine hazırla');
		const callbacks = first.events.inventory.length === 3
			&& first.events.economy.length === 3
			&& item(first.events.inventory.at(-1), recipe.outputItemId)?.quantity === 1;

		const saved = structuredClone(after);
		first.dialogueBox.dispose();
		first.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyI', repeat: false });
		const inventoryText = restored.dialogueBox._textEl.textContent;
		const persistedPack = item(roundTrip.inventory, recipe.outputItemId);
		const persistedProvenance = persistedPack?.provenance?.at(-1);
		const persisted = roundTrip.economy.copper === 23
			&& persistedPack?.quantity === 1
			&& persistedProvenance?.sourceType === 'settlement-crafting'
			&& persistedProvenance?.sourceId === recipe.recipeId
			&& inventoryText.includes('Dragonstone Yol Azığı Paketi')
			&& inventoryText.includes(`Kaynak: settlement-crafting/${recipe.recipeId}`);

		restored.controller.handleKeyDown({ code: 'KeyI', repeat: false });
		restored.dialogueBox.dispose();
		restored.host.remove();
		return {
			advertised,
			inputsReady,
			crafted,
			craftUx,
			callbacks,
			persisted,
			balance: after.economy.copper,
			transactions: after.economy.ledger.transactionCount,
			provenance,
		};
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Provisioning craft emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['advertised', 'inputsReady', 'crafted', 'craftUx', 'callbacks', 'persisted']) {
		if (!result[key]) throw new Error(`Provisioning-craft browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: B → Digit1 → Digit1 → Digit3 provisioning craft → atomic input consumption → travel pack → save/load → inventory UI');
	console.log(`[RPG Chromium] provisioning craft balance=${result.balance}, transactions=${result.transactions}, provenance=${result.provenance?.sourceType}/${result.provenance?.sourceId}`);
	console.log('[RPG Chromium] provisioning craft page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
