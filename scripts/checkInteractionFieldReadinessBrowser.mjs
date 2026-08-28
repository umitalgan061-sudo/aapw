#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for the field-readiness browser acceptance');

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
		dialogueBox.setCloseHandler(() => controller.handleKeyDown({ code: 'KeyB', repeat: false }));
		controller.update([{
			object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
			displayName: 'Dragonstone Levazımcısı',
		}], { x: 0, z: 0 });

		const armorer = QUARTERMASTER_OFFERS[1];
		const boosted = controller.getRpgSnapshot();
		boosted.economy.copper = 60;
		controller.restoreRpgSnapshot(boosted);

		controller.handleKeyDown({ code: 'KeyI', repeat: false });
		const initialText = dialogueBox._textEl.textContent;
		const initial = controller.getRpgSnapshot();
		const startsUnprepared = initial.inventory.fieldReadiness.tier === FIELD_READINESS_TIER.UNPREPARED
			&& initialText.includes('Sefer hazırlığı: HAZIR DEĞİL · 0/100')
			&& initialText.includes('Sefer için eksik: dragonstone-travel-ration-pack + dragonstone-whetstone');
		controller.handleKeyDown({ code: 'KeyI', repeat: false });

		// Existing shipped interaction loop: armorer fallback grants whetstone; two rations + ration
		// preparation produce the travel pack; the second armorer call atomically upgrades both.
		controller.handleKeyDown({ code: 'KeyB', repeat: false });
		controller.handleKeyDown({ code: 'Digit2', repeat: false });
		controller.handleKeyDown({ code: 'Digit1', repeat: false });
		controller.handleKeyDown({ code: 'Digit1', repeat: false });
		controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const beforeCraft = controller.getRpgSnapshot();
		const maintained = beforeCraft.inventory.fieldReadiness.tier === FIELD_READINESS_TIER.MAINTAINED
			&& beforeCraft.inventory.fieldReadiness.capabilities.campProvisioning === true
			&& beforeCraft.inventory.fieldReadiness.capabilities.equipmentMaintenance === true
			&& beforeCraft.inventory.fieldReadiness.capabilities.fastTravelEligible === false;

		controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const crafted = controller.getRpgSnapshot();
		// Digit2 leaves the quartermaster shop open by design. Mirror the shipped player flow instead
		// of asking KeyI to replace an active shop: B closes the vendor, then I opens inventory UX.
		controller.handleKeyDown({ code: 'KeyB', repeat: false });
		controller.handleKeyDown({ code: 'KeyI', repeat: false });
		const readyText = dialogueBox._textEl.textContent;
		const ready = crafted.inventory.fieldReadiness.tier === FIELD_READINESS_TIER.EXPEDITION_READY
			&& crafted.inventory.fieldReadiness.score === 100
			&& crafted.inventory.fieldReadiness.equipped?.slot === 'field-kit'
			&& crafted.inventory.fieldReadiness.equipped?.itemId === armorer.fulfillment.craftUpgrade.outputItemId
			&& crafted.inventory.fieldReadiness.capabilities.fastTravelEligible === true
			&& crafted.inventory.fieldReadiness.capabilities.survivalBuffer === true
			&& readyText.includes('Sefer hazırlığı: SEFERE HAZIR · 100/100')
			&& readyText.includes('Saha ekipmanı: Dragonstone Sefer Bakım Kiti · field-kit')
			&& readyText.includes('hızlı seyahat hazırlığı')
			&& readyText.includes('sefer dayanıklılığı');

		const saved = structuredClone(crafted);
		saved.inventory.fieldReadiness = { tier: 'forged', label: 'SAHTE', score: 999 };
		controller.restoreRpgSnapshot(saved);
		const restored = controller.getRpgSnapshot();
		controller.handleKeyDown({ code: 'KeyI', repeat: false });
		controller.handleKeyDown({ code: 'KeyI', repeat: false });
		const persisted = restored.inventory.fieldReadiness.tier === FIELD_READINESS_TIER.EXPEDITION_READY
			&& restored.inventory.fieldReadiness.score === 100
			&& restored.inventory.fieldReadiness.equipped?.slot === 'field-kit';

		dialogueBox.dispose();
		host.remove();
		return { startsUnprepared, maintained, ready, persisted, copper: restored.economy.copper, fieldReadiness: restored.inventory.fieldReadiness };
	});

	if (pageErrors.length || consoleErrors.length) throw new Error(`Field-readiness browser proof emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	for (const key of ['startsUnprepared', 'maintained', 'ready', 'persisted']) {
		if (!result[key]) throw new Error(`Field-readiness browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log(`[RPG Chromium] PASS field readiness + inventory equipment UX ${JSON.stringify(result)}`);
} finally {
	await browser.close();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
