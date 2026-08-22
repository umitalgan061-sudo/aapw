#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for mastery-armorer browser acceptance');

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
		const { QUARTERMASTER_NPC_ID } = await import('/src/3d/gameplay/interactionEconomy.js');
		const createHarness = () => {
			const host = document.createElement('div');
			document.body.appendChild(host);
			const dialogueBox = new DialogueBox(host);
			const controller = createInteractionController({
				interactionPrompt: { setVisible() {} },
				dialogueBox,
				greetingTemplate: 'Selam, {name}!',
				radiusMeters: 6,
			});
			dialogueBox.setChoiceHandler((index) => controller.handleChoice(index));
			return { host, dialogueBox, controller };
		};
		const quartermaster = {
			object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
			displayName: 'Dragonstone Levazımcısı',
		};
		const seedInventory = {
			items: [
				{ itemId: 'dragonstone-travel-ration-pack', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
				{ itemId: 'dragonstone-whetstone', quantity: 1, provenance: [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }] },
			],
		};

		const first = createHarness();
		first.controller.update([quartermaster], { x: 1, z: 1 });
		const lockedSeed = first.controller.getRpgSnapshot();
		lockedSeed.inventory = structuredClone(seedInventory);
		lockedSeed.worldState = {
			dragonstoneWatchPolicy: null,
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run', 'dragonstone-ridge-camp'],
			dragonstoneExpeditionMasteryClaimed: false,
		};
		first.controller.restoreRpgSnapshot(lockedSeed);
		first.controller.handleKeyDown({ code: 'KeyF', repeat: false });
		const lockedText = first.dialogueBox._textEl.textContent;
		const lockedInventory = first.controller.getInventorySnapshot();
		first.controller.handleKeyDown({ code: 'Escape', repeat: false });

		const unlockedSeed = first.controller.getRpgSnapshot();
		unlockedSeed.inventory = structuredClone(seedInventory);
		unlockedSeed.worldState = {
			dragonstoneWatchPolicy: null,
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run', 'dragonstone-ridge-camp'],
			dragonstoneExpeditionMasteryClaimed: true,
		};
		first.controller.restoreRpgSnapshot(unlockedSeed);
		first.controller.handleKeyDown({ code: 'KeyB', repeat: false });
		const shopHintText = first.dialogueBox._textEl.textContent;
		first.controller.handleKeyDown({ code: 'KeyF', repeat: false });
		const craftedText = first.dialogueBox._textEl.textContent;
		const craftedSnapshot = structuredClone(first.controller.getRpgSnapshot());
		const craftedItems = craftedSnapshot.inventory.items;
		const maintenanceKit = craftedItems.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit');
		const whetstone = craftedItems.find((item) => item.itemId === 'dragonstone-whetstone');
		const rationPack = craftedItems.find((item) => item.itemId === 'dragonstone-travel-ration-pack');

		first.controller.handleKeyDown({ code: 'KeyF', repeat: false });
		const duplicateGuardText = first.dialogueBox._textEl.textContent;
		const afterDuplicate = first.controller.getRpgSnapshot();

		const second = createHarness();
		second.controller.update([quartermaster], { x: 1, z: 1 });
		second.controller.restoreRpgSnapshot(structuredClone(craftedSnapshot));
		const roundTrip = second.controller.getRpgSnapshot();
		const restoredKit = roundTrip.inventory.items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit');

		const locked = lockedText.includes('Sefer Ustalığı tamamlanmadan')
			&& lockedInventory.items.some((item) => item.itemId === 'dragonstone-whetstone' && item.quantity === 1)
			&& lockedInventory.items.some((item) => item.itemId === 'dragonstone-travel-ration-pack' && item.quantity === 1);
		const hint = shopHintText.includes('F — Ustalık zırhçı hizmeti');
		const crafted = craftedText.includes('Ustalık zırhçı hizmeti tamamlandı')
			&& maintenanceKit?.quantity === 1
			&& maintenanceKit?.provenance?.some((entry) => entry.sourceType === 'settlement-crafting' && entry.sourceId === 'dragonstone-expedition-maintenance-kit')
			&& !whetstone
			&& !rationPack
			&& craftedSnapshot.economy.copper === 40;
		const duplicateGuard = duplicateGuardText.includes('Bakım kiti zaten çantanda')
			&& afterDuplicate.inventory.items.filter((item) => item.itemId === 'dragonstone-expedition-maintenance-kit').length === 1
			&& afterDuplicate.economy.copper === 40;
		const persisted = restoredKit?.quantity === 1
			&& roundTrip.worldState.dragonstoneExpeditionMasteryClaimed === true
			&& roundTrip.economy.copper === 40;

		second.dialogueBox.dispose();
		second.host.remove();
		first.dialogueBox.dispose();
		first.host.remove();
		return { locked, hint, crafted, duplicateGuard, persisted };
	});

	if (pageErrors.length || consoleErrors.length) {
		throw new Error(`Mastery armorer emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	}
	for (const key of ['locked', 'hint', 'crafted', 'duplicateGuard', 'persisted']) {
		if (!result[key]) throw new Error(`Mastery armorer browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: mastery reward -> direct armorer service -> maintenance kit -> save/load');
	console.log('[RPG Chromium] mastery armorer page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
