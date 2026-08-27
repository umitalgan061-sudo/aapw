#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for the armorer-service browser acceptance');

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
		const serviceOffer = QUARTERMASTER_OFFERS[1];
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

		function serviceItem(snapshot) {
			return snapshot?.items?.find((item) => item.itemId === recipe.outputItemId) ?? null;
		}

		const first = makeRuntime();
		const seeded = structuredClone(first.controller.getRpgSnapshot());
		seeded.inventory = { items: [
			{ itemId: 'dragonstone-travel-ration-pack', quantity: 1, provenance: [{ sourceType: 'browser-fixture', sourceId: 'armorer-service' }] }, { itemId: 'dragonstone-whetstone', quantity: 1, provenance: [{ sourceType: 'browser-fixture', sourceId: 'armorer-service' }] },
		] };
		first.controller.restoreRpgSnapshot(seeded);
		first.events.inventory.length = first.events.economy.length = 0;
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const openingText = first.dialogueBox._textEl.textContent;
		const advertised = first.dialogueBox.isVisible
			&& serviceOffer.fulfillment?.kind === 'settlement-service'
			&& serviceOffer.fulfillment?.serviceId === 'dragonstone-watch-armorer-honing'
			&& serviceOffer.fulfillment?.stationId === 'dragonstone-armorer-bench'
			&& serviceOffer.fulfillment?.discipline === 'smithing'
			&& openingText.includes('Nöbetçi bileği taşı')
			&& openingText.includes('HİZMET: Zırhçı bileme hazırlığı');

		first.controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const after = first.controller.getRpgSnapshot();
		const whetstone = serviceItem(after.inventory);
		const provenance = whetstone?.provenance?.at(-1);
		const receipt = after.economy.ledger.recentTransactions.at(-1);
		const fulfilled = after.economy.copper === 28
			&& after.economy.stockByOffer[serviceOffer.id] === 1
			&& after.economy.ledger.transactionCount === 1
			&& after.economy.ledger.lifetimeSpentCopper === 12
			&& after.economy.ledger.purchasesByOffer[serviceOffer.id] === 1
			&& receipt?.offerId === serviceOffer.id
			&& receipt?.balanceCopper === 28
			&& whetstone?.quantity === 1
			&& !after.inventory.items.some((item) => recipe.inputs.some((input) => input.itemId === item.itemId))
			&& provenance?.sourceType === 'settlement-crafting'
			&& provenance?.sourceId === recipe.recipeId;
		const fulfilledUx = first.dialogueBox._textEl.textContent.includes('Son işlem: #1 Nöbetçi bileği taşı')
			&& first.dialogueBox._textEl.textContent.includes('stok 1/2')
			&& first.dialogueBox._textEl.textContent.includes('aldın 1')
			&& first.dialogueBox._textEl.textContent.includes('HİZMET: Zırhçı bileme hazırlığı');
		const callbackItem = serviceItem(first.events.inventory.at(-1));
		const callbackProvenance = callbackItem?.provenance?.at(-1);
		const callbacks = first.events.inventory.length === 1
			&& first.events.economy.length === 1
			&& callbackProvenance?.sourceType === 'settlement-crafting'
			&& callbackProvenance?.sourceId === recipe.recipeId
			&& first.events.economy.at(-1)?.stockByOffer?.[serviceOffer.id] === 1;

		const saved = structuredClone(after);
		first.dialogueBox.dispose();
		first.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const restoredItem = serviceItem(roundTrip.inventory);
		const restoredProvenance = restoredItem?.provenance?.at(-1);
		const persisted = roundTrip.economy.copper === 28
			&& roundTrip.economy.stockByOffer[serviceOffer.id] === 1
			&& roundTrip.economy.ledger.transactionCount === 1
			&& restoredProvenance?.sourceType === 'settlement-crafting'
			&& restoredProvenance?.sourceId === recipe.recipeId
			&& restored.dialogueBox._textEl.textContent.includes('Son işlem: #1 Nöbetçi bileği taşı')
			&& restored.dialogueBox._textEl.textContent.includes('HİZMET: Zırhçı bileme hazırlığı');

		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		restored.dialogueBox.dispose();
		restored.host.remove();
		return { advertised, fulfilled, fulfilledUx, callbacks, persisted, provenance, callbackProvenance };
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Armorer service emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['advertised', 'fulfilled', 'fulfilledUx', 'callbacks', 'persisted']) {
		if (!result[key]) throw new Error(`Armorer-service browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: B → Digit2 authored armorer smithing → crafting provenance → ledger → save/load → reopen');
	console.log('[RPG Chromium] armorer-service page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
