#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const NAV_TIMEOUT_MS = 30_000;

function fail(message, details = null) {
	const suffix = details == null ? '' : `\n${JSON.stringify(details, null, 2)}`;
	throw new Error(`${message}${suffix}`);
}

const playwright = loadPlaywright();
if (!playwright) fail('Playwright is required for the RPG browser acceptance');

const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
page.on('console', (message) => {
	if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
		waitUntil: 'domcontentloaded',
		timeout: NAV_TIMEOUT_MS,
	});

	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const {
			QUARTERMASTER_NPC_ID,
			QUARTERMASTER_OFFERS,
		} = await import('/src/3d/gameplay/interactionEconomy.js');

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
				onInventoryChanged: (snapshot) => events.inventory.push(snapshot),
				onEconomyChanged: (snapshot) => events.economy.push(snapshot),
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

		const first = makeRuntime();
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const openingText = first.dialogueBox._textEl.textContent;
		const openingChoices = [...first.dialogueBox._choicesEl.querySelectorAll('[data-dialogue-choice-index]')]
			.map((node) => node.textContent);
		const shopOpened = first.dialogueBox.isVisible
			&& openingChoices.length === QUARTERMASTER_OFFERS.length
			&& openingText.includes('ALINABİLİR');

		const before = first.controller.getRpgSnapshot();
		first.controller.handleKeyDown({ code: 'Digit1', repeat: false });
		const after = first.controller.getRpgSnapshot();
		const purchasedOffer = QUARTERMASTER_OFFERS[0];
		const expectedBalance = before.economy.copper - purchasedOffer.priceCopper;
		const purchasedItem = after.inventory.items.find((item) => item.id === purchasedOffer.item.id);
		const purchased = after.economy.copper === expectedBalance
			&& after.economy.transactions === before.economy.transactions + 1
			&& after.economy.lifetimeCopperSpent === before.economy.lifetimeCopperSpent + purchasedOffer.priceCopper
			&& after.economy.purchaseCounts[purchasedOffer.id] === 1
			&& purchasedItem?.quantity === purchasedOffer.item.quantity;
		const purchaseUx = first.dialogueBox._textEl.textContent.includes('aldın 1')
			&& first.dialogueBox._textEl.textContent.includes(String(expectedBalance));
		const callbacks = first.events.inventory.length === 1 && first.events.economy.length === 1;

		const saved = structuredClone(after);
		first.dialogueBox.dispose();
		first.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const restoredText = restored.dialogueBox._textEl.textContent;
		const persisted = roundTrip.economy.copper === saved.economy.copper
			&& roundTrip.economy.transactions === saved.economy.transactions
			&& roundTrip.economy.lifetimeCopperSpent === saved.economy.lifetimeCopperSpent
			&& roundTrip.economy.purchaseCounts[purchasedOffer.id] === 1
			&& roundTrip.inventory.items.some((item) => item.id === purchasedOffer.item.id && item.quantity === purchasedOffer.item.quantity)
			&& restoredText.includes('aldın 1');

		const priceBeforeQuote = roundTrip.economy.copper;
		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		restored.dialogueBox.dispose();
		restored.host.remove();

		return {
			shopOpened,
			purchased,
			purchaseUx,
			callbacks,
			persisted,
			priceBeforeQuote,
			expectedBalance,
			transactions: roundTrip.economy.transactions,
			lifetimeCopperSpent: roundTrip.economy.lifetimeCopperSpent,
			purchaseCount: roundTrip.economy.purchaseCounts[purchasedOffer.id],
		};
	});

	if (pageErrors.length || consoleErrors.length) {
		fail('Browser emitted page/console errors during quartermaster acceptance', { pageErrors, consoleErrors });
	}
	for (const key of ['shopOpened', 'purchased', 'purchaseUx', 'callbacks', 'persisted']) {
		if (!result[key]) fail(`Quartermaster browser assertion failed: ${key}`, result);
	}

	console.log('[RPG Chromium] PASS: game3d.html quartermaster B→Digit1 purchase→ledger→save/load→reopen UX');
	console.log(`[RPG Chromium] balance=${result.expectedBalance}, transactions=${result.transactions}, lifetimeSpent=${result.lifetimeCopperSpent}, purchaseCount=${result.purchaseCount}`);
	console.log('[RPG Chromium] page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	server.close();
}
