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

	// This acceptance owns the shipped interaction surface, not full-world castle hydration.
	// Stop background scene bootstrap as soon as the real game3d document is live so unrelated
	// Git-LFS pointer castle loads cannot race into this feature-scoped proof.
	await page.evaluate(() => window.stop());
	if (pageErrors.length || consoleErrors.length) {
		fail('Quartermaster bootstrap emitted browser errors before interaction isolation', { pageErrors, consoleErrors });
	}

	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const { QUARTERMASTER_NPC_ID, QUARTERMASTER_OFFERS } = await import('/src/3d/gameplay/interactionEconomy.js');

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
		const openingChoices = [...first.dialogueBox._choicesEl.querySelectorAll('[data-dialogue-choice-index]')].map((node) => node.textContent);
		const shopOpened = first.dialogueBox.isVisible && openingChoices.length === QUARTERMASTER_OFFERS.length && openingText.includes('ALINABİLİR') && !openingText.includes('Son işlem:');

		const before = first.controller.getRpgSnapshot();
		first.controller.handleKeyDown({ code: 'Digit1', repeat: false });
		const after = first.controller.getRpgSnapshot();
		const purchasedOffer = QUARTERMASTER_OFFERS[0];
		const expectedBalance = before.economy.copper - purchasedOffer.priceCopper;
		const purchasedItem = after.inventory.items.find((item) => item.itemId === purchasedOffer.itemId);
		const latestReceipt = after.economy.ledger.recentTransactions.at(-1);
		const purchased = after.economy.copper === expectedBalance
			&& after.economy.ledger.transactionCount === before.economy.ledger.transactionCount + 1
			&& after.economy.ledger.lifetimeSpentCopper === before.economy.ledger.lifetimeSpentCopper + purchasedOffer.priceCopper
			&& after.economy.ledger.purchasesByOffer[purchasedOffer.id] === 1
			&& latestReceipt?.sequence === 1
			&& latestReceipt?.offerId === purchasedOffer.id
			&& latestReceipt?.itemId === purchasedOffer.itemId
			&& latestReceipt?.spentCopper === purchasedOffer.priceCopper
			&& latestReceipt?.balanceCopper === expectedBalance
			&& purchasedItem?.quantity === purchasedOffer.quantity;
		const purchaseUx = first.dialogueBox._textEl.textContent.includes('aldın 1')
			&& first.dialogueBox._textEl.textContent.includes(`Kese: ${expectedBalance} bakır`)
			&& first.dialogueBox._textEl.textContent.includes(`Son işlem: #1 ${purchasedOffer.label}`);
		const callbacks = first.events.inventory.length === 1 && first.events.economy.length === 1 && first.events.economy[0].ledger.recentTransactions.at(-1)?.offerId === purchasedOffer.id;

		const saved = structuredClone(after);
		first.dialogueBox.dispose();
		first.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const restoredText = restored.dialogueBox._textEl.textContent;
		const restoredReceipt = roundTrip.economy.ledger.recentTransactions.at(-1);
		const persisted = roundTrip.economy.copper === saved.economy.copper
			&& roundTrip.economy.ledger.transactionCount === saved.economy.ledger.transactionCount
			&& roundTrip.economy.ledger.lifetimeSpentCopper === saved.economy.ledger.lifetimeSpentCopper
			&& roundTrip.economy.ledger.purchasesByOffer[purchasedOffer.id] === 1
			&& restoredReceipt?.sequence === 1
			&& restoredReceipt?.offerId === purchasedOffer.id
			&& restoredReceipt?.balanceCopper === expectedBalance
			&& roundTrip.inventory.items.some((item) => item.itemId === purchasedOffer.itemId && item.quantity === purchasedOffer.quantity)
			&& restoredText.includes('aldın 1')
			&& restoredText.includes(`Son işlem: #1 ${purchasedOffer.label}`);

		restored.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		restored.dialogueBox.dispose();
		restored.host.remove();

		const legacy = makeRuntime();
		const legacySnapshot = structuredClone(saved);
		delete legacySnapshot.economy.ledger;
		legacy.controller.restoreRpgSnapshot(legacySnapshot);
		const inferred = legacy.controller.getRpgSnapshot();
		legacy.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const inferredText = legacy.dialogueBox._textEl.textContent;
		const inferredWithoutReceipt = inferred.economy.ledger.transactionCount === 1
			&& inferred.economy.ledger.lifetimeSpentCopper === purchasedOffer.priceCopper
			&& inferred.economy.ledger.purchasesByOffer[purchasedOffer.id] === 1
			&& inferred.economy.ledger.recentTransactions.length === 0
			&& inferredText.includes('Alışveriş defteri: 1 işlem · 6 bakır harcandı')
			&& inferredText.includes('aldın 1')
			&& !inferredText.includes('Son işlem:');
		const resumedOffer = QUARTERMASTER_OFFERS[1];
		legacy.controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const resumed = legacy.controller.getRpgSnapshot();
		const resumedReceipt = resumed.economy.ledger.recentTransactions.at(-1);
		const legacyMigration = inferredWithoutReceipt
			&& resumed.economy.ledger.transactionCount === 2
			&& resumed.economy.ledger.lifetimeSpentCopper === purchasedOffer.priceCopper + resumedOffer.priceCopper
			&& resumed.economy.ledger.purchasesByOffer[resumedOffer.id] === 1
			&& resumedReceipt?.sequence === 2
			&& resumedReceipt?.offerId === resumedOffer.id
			&& legacy.dialogueBox._textEl.textContent.includes(`Son işlem: #2 ${resumedOffer.label}`);
		legacy.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		legacy.dialogueBox.dispose();
		legacy.host.remove();

		return {
			shopOpened,
			purchased,
			purchaseUx,
			callbacks,
			persisted,
			legacyMigration,
			expectedBalance,
			transactions: roundTrip.economy.ledger.transactionCount,
			lifetimeSpentCopper: roundTrip.economy.ledger.lifetimeSpentCopper,
			purchaseCount: roundTrip.economy.ledger.purchasesByOffer[purchasedOffer.id],
			receiptSequence: restoredReceipt?.sequence,
			legacyResumedSequence: resumedReceipt?.sequence,
		};
	});

	if (pageErrors.length || consoleErrors.length) fail('Browser emitted page/console errors during quartermaster acceptance', { pageErrors, consoleErrors });
	for (const key of ['shopOpened', 'purchased', 'purchaseUx', 'callbacks', 'persisted', 'legacyMigration']) if (!result[key]) fail(`Quartermaster browser assertion failed: ${key}`, result);

	console.log('[RPG Chromium] PASS: game3d.html quartermaster B→Digit1 purchase→ledger receipt→save/load→reopen UX + stock-aware legacy inference');
	console.log(`[RPG Chromium] balance=${result.expectedBalance}, transactions=${result.transactions}, lifetimeSpent=${result.lifetimeSpentCopper}, purchaseCount=${result.purchaseCount}, receipt=#${result.receiptSequence}, legacy-resumed=#${result.legacyResumedSequence}`);
	console.log('[RPG Chromium] page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
