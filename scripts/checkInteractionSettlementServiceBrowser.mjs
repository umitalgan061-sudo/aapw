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
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const { QUARTERMASTER_NPC_ID, QUARTERMASTER_OFFERS } = await import('/src/3d/gameplay/interactionEconomy.js');
		const serviceOffer = QUARTERMASTER_OFFERS[2];

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
			const npc = {
				object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
				displayName: 'Dragonstone Levazımcısı',
			};
			controller.update([npc], { x: 0, z: 0 });
			return { host, dialogueBox, controller, events };
		}

		const first = makeRuntime();
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const openingText = first.dialogueBox._textEl.textContent;
		const serviceAdvertised = serviceOffer.fulfillment?.kind === 'settlement-service'
			&& serviceOffer.fulfillment?.serviceId === 'dragonstone-watch-ration-prep'
			&& openingText.includes('Nöbetçi erzak payı')
			&& openingText.includes('HİZMET: Erzak hazırlama');

		first.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const after = first.controller.getRpgSnapshot();
		const ration = after.inventory.items.find((item) => item.itemId === serviceOffer.itemId);
		const provenance = ration?.provenance?.at(-1);
		const receipt = after.economy.ledger.recentTransactions.at(-1);
		const fulfilled = after.economy.copper === 35
			&& after.economy.stockByOffer[serviceOffer.id] === 0
			&& after.economy.ledger.transactionCount === 1
			&& after.economy.ledger.lifetimeSpentCopper === serviceOffer.priceCopper
			&& after.economy.ledger.purchasesByOffer[serviceOffer.id] === 1
			&& receipt?.offerId === serviceOffer.id
			&& receipt?.balanceCopper === 35
			&& ration?.quantity === 1
			&& provenance?.sourceType === 'settlement-service'
			&& provenance?.sourceId === 'dragonstone-watch-ration-prep';
		const fulfilledUx = first.dialogueBox._textEl.textContent.includes('Son işlem: #1 Nöbetçi erzak payı')
			&& first.dialogueBox._textEl.textContent.includes('stok 0/1')
			&& first.dialogueBox._textEl.textContent.includes('TÜKENDİ')
			&& first.dialogueBox._textEl.textContent.includes('HİZMET: Erzak hazırlama');
		const callbacks = first.events.inventory.length === 1
			&& first.events.economy.length === 1
			&& first.events.inventory[0].items[0]?.provenance?.at(-1)?.sourceType === 'settlement-service';

		const saved = structuredClone(after);
		first.dialogueBox.dispose();
		first.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const restoredRation = roundTrip.inventory.items.find((item) => item.itemId === serviceOffer.itemId);
		const restoredProvenance = restoredRation?.provenance?.at(-1);
		const persisted = roundTrip.economy.copper === 35
			&& roundTrip.economy.stockByOffer[serviceOffer.id] === 0
			&& roundTrip.economy.ledger.transactionCount === 1
			&& restoredProvenance?.sourceType === 'settlement-service'
			&& restoredProvenance?.sourceId === 'dragonstone-watch-ration-prep'
			&& restored.dialogueBox._textEl.textContent.includes('Son işlem: #1 Nöbetçi erzak payı')
			&& restored.dialogueBox._textEl.textContent.includes('HİZMET: Erzak hazırlama');

		restored.dialogueBox.dispose();
		restored.host.remove();
		return { serviceAdvertised, fulfilled, fulfilledUx, callbacks, persisted };
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Settlement service emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['serviceAdvertised', 'fulfilled', 'fulfilledUx', 'callbacks', 'persisted']) {
		if (!result[key]) throw new Error(`Settlement-service browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: B → Digit3 settlement service → service provenance → ledger → save/load → reopen');
	console.log('[RPG Chromium] settlement-service page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	server.close();
}
