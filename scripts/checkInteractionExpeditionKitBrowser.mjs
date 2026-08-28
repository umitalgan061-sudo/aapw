#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for the expedition-kit browser acceptance');

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
		const { FIELD_READINESS_TIER } = await import('/src/3d/gameplay/interactionFieldReadiness.js');
		const armorer = QUARTERMASTER_OFFERS[1];
		const ration = QUARTERMASTER_OFFERS[0];
		const prep = QUARTERMASTER_OFFERS[2];
		const recipe = armorer.fulfillment?.craftUpgrade;

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

		const runtime = makeRuntime();
		const boosted = runtime.controller.getRpgSnapshot();
		boosted.economy.copper = 48;
		boosted.economy.stockByOffer[armorer.id] = 1;
		boosted.inventory = { items: [{ itemId: 'dragonstone-whetstone', quantity: 1, provenance: [{ sourceType: 'browser-fixture', sourceId: 'expedition-kit' }] }] };
		runtime.controller.restoreRpgSnapshot(boosted);
		runtime.events.inventory.length = 0;
		runtime.events.economy.length = 0;

		runtime.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const advertised = runtime.dialogueBox._textEl.textContent.includes('HİZMET: Zırhçı bileme hazırlığı')
			&& runtime.dialogueBox._textEl.textContent.includes('DÖNÜŞÜM: 1 yol azığı paketi + 1 bileği taşını 1 sefer bakım kitine hazırla');

		runtime.controller.handleKeyDown({ code: 'Digit2', repeat: false });
		runtime.controller.handleKeyDown({ code: 'Digit1', repeat: false });
		runtime.controller.handleKeyDown({ code: 'Digit1', repeat: false });
		runtime.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const beforeFinal = runtime.controller.getRpgSnapshot();
		const ingredientsReady = beforeFinal.economy.copper === 31
			&& beforeFinal.economy.stockByOffer[armorer.id] === 1
			&& beforeFinal.economy.stockByOffer[ration.id] === 2
			&& beforeFinal.economy.stockByOffer[prep.id] === 0
			&& item(beforeFinal.inventory, 'dragonstone-whetstone')?.quantity === 1
			&& item(beforeFinal.inventory, 'dragonstone-travel-ration-pack')?.quantity === 1;

		runtime.controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const after = runtime.controller.getRpgSnapshot();
		const kit = item(after.inventory, recipe.outputItemId);
		const provenance = kit?.provenance?.at(-1);
		const receipt = after.economy.ledger.recentTransactions.at(-1);
		const crafted = after.economy.copper === 19
			&& after.economy.stockByOffer[armorer.id] === 0
			&& after.economy.ledger.transactionCount === 5
			&& after.economy.ledger.lifetimeSpentCopper === 41
			&& item(after.inventory, 'dragonstone-whetstone') == null
			&& item(after.inventory, 'dragonstone-travel-ration-pack') == null
			&& kit?.quantity === 1
			&& after.inventory.fieldReadiness.tier === FIELD_READINESS_TIER.EXPEDITION_READY
			&& after.inventory.fieldReadiness.score === 100
			&& after.inventory.fieldReadiness.equipped?.itemId === recipe.outputItemId
			&& after.inventory.fieldReadiness.capabilities.fastTravelEligible === true
			&& after.inventory.fieldReadiness.capabilities.survivalBuffer === true
			&& provenance?.sourceType === 'settlement-crafting'
			&& provenance?.sourceId === recipe.recipeId
			&& receipt?.offerId === armorer.id
			&& receipt?.balanceCopper === 19;
		const callbacks = runtime.events.inventory.length === 4
			&& runtime.events.economy.length === 4
			&& item(runtime.events.inventory.at(-1), recipe.outputItemId)?.quantity === 1;

		const saved = structuredClone(after);
		runtime.dialogueBox.dispose();
		runtime.host.remove();

		const restored = makeRuntime();
		restored.controller.restoreRpgSnapshot(saved);
		const roundTrip = restored.controller.getRpgSnapshot();
		restored.controller.handleKeyDown({ code: 'KeyI', repeat: false });
		const inventoryText = restored.dialogueBox._textEl.textContent;
		const restoredKit = item(roundTrip.inventory, recipe.outputItemId);
		const persisted = roundTrip.economy.copper === 19
			&& restoredKit?.quantity === 1
			&& restoredKit?.provenance?.at(-1)?.sourceId === recipe.recipeId
			&& roundTrip.inventory.fieldReadiness.tier === FIELD_READINESS_TIER.EXPEDITION_READY
			&& roundTrip.inventory.fieldReadiness.equipped?.itemId === recipe.outputItemId
			&& inventoryText.includes('Sefer hazırlığı: SEFERE HAZIR · 100/100')
			&& inventoryText.includes('Dragonstone Sefer Bakım Kiti')
			&& inventoryText.includes(`Kaynak: settlement-crafting/${recipe.recipeId}`);

		restored.controller.handleKeyDown({ code: 'KeyI', repeat: false });
		restored.dialogueBox.dispose();
		restored.host.remove();
		return { advertised, ingredientsReady, crafted, callbacks, persisted, balance: after.economy.copper, transactions: after.economy.ledger.transactionCount, provenance };
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Expedition-kit craft emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['advertised', 'ingredientsReady', 'crafted', 'callbacks', 'persisted']) {
		if (!result[key]) throw new Error(`Expedition-kit browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: game3d.html armorer → ration provisioning → two-input expedition maintenance craft → save/load → inventory UI');
	console.log(`[RPG Chromium] expedition kit balance=${result.balance}, transactions=${result.transactions}, provenance=${result.provenance?.sourceType}/${result.provenance?.sourceId}`);
	console.log('[RPG Chromium] expedition kit page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}