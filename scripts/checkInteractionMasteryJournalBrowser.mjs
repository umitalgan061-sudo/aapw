#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for mastery-journal browser acceptance');

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

		const first = createHarness();
		first.controller.update([quartermaster], { x: 1, z: 1 });
		const seed = first.controller.getRpgSnapshot();
		seed.inventory = {
			items: [
				{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
				{ itemId: 'dragonstone-travel-ration-pack', quantity: 3, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
			],
		};
		seed.worldState = {
			dragonstoneWatchPolicy: null,
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
		};
		first.controller.restoreRpgSnapshot(seed);

		first.controller.handleKeyDown({ code: 'KeyT', repeat: false });
		const beforeText = first.dialogueBox._textEl.textContent;
		first.controller.handleKeyDown({ code: 'Digit3', repeat: false });
		const masteryResultText = first.dialogueBox._textEl.textContent;
		const mastered = structuredClone(first.controller.getRpgSnapshot());

		first.controller.handleKeyDown({ code: 'KeyJ', repeat: false });
		first.controller.handleKeyDown({ code: 'KeyJ', repeat: false });
		const journalText = first.dialogueBox._textEl.textContent;
		const journalAfterMastery = journalText.includes('Görev Günlüğü')
			&& journalText.includes('Seviye: 1 · XP: 75/100')
			&& journalText.includes('Dragonstone itibarı: 5')
			&& journalText.includes('Sefer kontratları: 3/3')
			&& journalText.includes('Sefer ustalığı: TAMAMLANDI');

		const second = createHarness();
		second.controller.update([quartermaster], { x: 1, z: 1 });
		second.controller.restoreRpgSnapshot(structuredClone(mastered));
		second.controller.handleKeyDown({ code: 'KeyJ', repeat: false });
		const restoredJournal = second.dialogueBox._textEl.textContent;
		const roundTrip = second.controller.getRpgSnapshot();
		const persisted = restoredJournal.includes('Seviye: 1 · XP: 75/100')
			&& restoredJournal.includes('Dragonstone itibarı: 5')
			&& restoredJournal.includes('Sefer kontratları: 3/3')
			&& restoredJournal.includes('Sefer ustalığı: TAMAMLANDI')
			&& roundTrip.progression.totalExperience === 75
			&& roundTrip.reputation.dragonstone === 5
			&& roundTrip.worldState.dragonstoneExpeditionMasteryClaimed === true
			&& roundTrip.worldState.dragonstoneExpeditionRoutes.length === 3
			&& roundTrip.economy.copper === 70;

		const beforeShowsProgress = beforeText.includes('Sefer ustalığı: İLERLEME 2/3');
		const resultShowsMastery = masteryResultText.includes('SEFER USTALIĞI KAZANILDI: 50 XP + 3 Dragonstone itibarı + 20 bakır')
			&& masteryResultText.includes('Ustalık smithing ödülü: 1 Nöbetçi Bileği Taşı');

		second.dialogueBox.dispose();
		second.host.remove();
		first.dialogueBox.dispose();
		first.host.remove();
		return {
			beforeShowsProgress,
			resultShowsMastery,
			journalAfterMastery,
			persisted,
			totalExperience: roundTrip.progression.totalExperience,
			reputation: roundTrip.reputation.dragonstone,
			copper: roundTrip.economy.copper,
		};
	});

	if (pageErrors.length || consoleErrors.length) {
		throw new Error(`Mastery journal emitted browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	}
	for (const key of ['beforeShowsProgress', 'resultShowsMastery', 'journalAfterMastery', 'persisted']) {
		if (!result[key]) throw new Error(`Mastery journal browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log('[RPG Chromium] PASS: expedition mastery -> quest journal -> save/load continuity');
	console.log(`[RPG Chromium] journal progression XP=${result.totalExperience}, reputation=${result.reputation}, copper=${result.copper}`);
	console.log('[RPG Chromium] mastery journal page errors=0, console errors=0');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
