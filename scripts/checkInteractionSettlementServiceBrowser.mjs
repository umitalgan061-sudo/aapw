#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for the settlement-service browser acceptance');

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
			const npc = {
				object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
				displayName: 'Dragonstone Levazımcısı',
			};
			controller.update([npc], { x: 0, z: 0 });
			return { host, dialogueBox, controller, events };
		}

		function serviceItem(snapshot) {
			return snapshot?.items?.find((item) => item.itemId === serviceOffer.itemId) ?? null;
		}

		const first = makeRuntime();
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const openingText = first.dialogueBox._textEl.textContent;
		const openingChoices = [...first.dialogueBox._choicesEl.querySelectorAll('[data-dialogue-choice-index]')].map((node) => node.textContent);
		const serviceAdvertised = first.dialogueBox.isVisible
			&& openingChoices.length === QUARTERMASTER_OFFERS.length
			&& serviceOffer.itemId === 'dragonstone-travel-ration-pack'
			&& serviceOffer.fulfillment?.kind === 'settlement-service'
			&& serviceOffer.fulfillment?.serviceId === 'dragonstone-watch-ration-prep'
			&& recipe?.inputItemId === 'dragonstone-field-ration'
			&& recipe?.inputQuantity === 2
			&& openingText.includes('Nöbetçi yol azığı hazırlama hizmeti')
			&& openingText.includes('HİZMET: Erzak hazırlama');

		const beforeBlocked = structuredClone(first.controller.getRpgSnapshot());
		first.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const blocked = structuredClone(first.controller.getRpgSnapshot());
		const blockedAtomically = first.dialogueBox._textEl.textContent.includes('Satın alma başarısız.')
			&& blocked.economy.copper === beforeBlocked.economy.copper
			&& blocked.economy.stockByOffer[serviceOffer.id] === beforeBlocked.economy.stockByOffer[serviceOffer.id]
			&& blocked.economy.ledger.transactionCount === beforeBlocked.economy.ledger.transactionCount
			&& !serviceItem(blocked.inventory)
			&& !blocked.inventory.items.some((item) => item.itemId === 'dragonstone-field-ration')
			&& first.events.inventory.length === 0
			&& first.events.economy.length === 0;

		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const seeded = structuredClone(first.controller.getRpgSnapshot());
		seeded.inventory = {
			items: [{
				itemId: 'dragonstone-field-ration',
				quantity: 2,
				provenance: [{ sourceType: 'vendor', sourceId: QUARTERMASTER_NPC_ID }],
			}],
		};
		first.controller.restoreRpgSnapshot(seeded);
		first.events.inventory.length = 0;
		first.events.economy.length = 0;
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		first.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const after = first.controller.getRpgSnapshot();
		const provision = serviceItem(after.inventory);
		const provenance = provision?.provenance?.at(-1);
		const receipt = after.economy.ledger.recentTransactions.at(-1);
		const fulfilled = after.economy.copper === 35
			&& after.economy.stockByOffer[serviceOffer.id] === 0
			&& after.economy.ledger.transactionCount === 1
			&& after.economy.ledger.lifetimeSpentCopper === serviceOffer.priceCopper
			&& after.economy.ledger.purchasesByOffer[serviceOffer.id] === 1
			&& receipt?.offerId === serviceOffer.id
			&& receipt?.itemId === 'dragonstone-travel-ration-pack'
			&& receipt?.balanceCopper === 35
			&& provision?.quantity === 1
			&& !after.inventory.items.some((item) => item.itemId === 'dragonstone-field-ration')
			&& provenance?.sourceType === 'settlement-crafting'
			&& provenance?.sourceId === recipe.recipeId;
		const fulfilledUx = first.dialogueBox._textEl.textContent.includes('Son işlem: #1 Nöbetçi yol azığı hazırlama hizmeti')
			&& first.dialogueBox._textEl.textContent.includes('stok 0/1')
			&& first.dialogueBox._textEl.textContent.includes('TÜKENDİ')
			&& first.dialogueBox._textEl.textContent.includes('HİZMET: Erzak hazırlama');
		const callbackItem = serviceItem(first.events.inventory.at(-1));
		const callbackProvenance = callbackItem?.provenance?.at(-1);
		const callbacks = first.events.inventory.length === 1
			&& first.events.economy.length === 1
			&& callbackItem?.quantity === 1
			&& callbackProvenance?.sourceType === 'settlement-crafting'
			&& callbackProvenance?.sourceId === recipe.recipeId
			&& first.events.economy.at(-1)?.stockByOffer?.[serviceOffer.id] === 0;

		const saved = structuredClone(after);
		first.dialogueBox.dispose();
		first.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const restoredProvision = serviceItem(roundTrip.inventory);
		const restoredProvenance = restoredProvision?.provenance?.at(-1);
		const persisted = roundTrip.economy.copper === 35
			&& roundTrip.economy.stockByOffer[serviceOffer.id] === 0
			&& roundTrip.economy.ledger.transactionCount === 1
			&& restoredProvision?.quantity === 1
			&& restoredProvenance?.sourceType === 'settlement-crafting'
			&& restoredProvenance?.sourceId === recipe.recipeId
			&& !roundTrip.inventory.items.some((item) => item.itemId === 'dragonstone-field-ration')
			&& restored.dialogueBox._textEl.textContent.includes('Son işlem: #1 Nöbetçi yol azığı hazırlama hizmeti')
			&& restored.dialogueBox._textEl.textContent.includes('HİZMET: Erzak hazırlama');

		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		restored.dialogueBox.dispose();
		restored.host.remove();
		return {
			serviceAdvertised,
			blockedAtomically,
			fulfilled,
			fulfilledUx,
			callbacks,
			persisted,
			openingChoices: openingChoices.length,
			balance: after.economy.copper,
			stock: after.economy.stockByOffer[serviceOffer.id],
			transactions: after.economy.ledger.transactionCount,
			provenance,
			callbackProvenance,
		};
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Settlement service emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['serviceAdvertised', 'blockedAtomically', 'fulfilled', 'fulfilledUx', 'callbacks', 'persisted']) {
		if (!result[key]) throw new Error(`Settlement-service browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: B → Digit3 fail-closed without inputs → seed two rations → atomic ration-prep service → crafting provenance → ledger → save/load → reopen');
	console.log(`[RPG Chromium] settlement-service choices=${result.openingChoices}, balance=${result.balance}, stock=${result.stock}, transactions=${result.transactions}`);
	console.log('[RPG Chromium] settlement-service page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
