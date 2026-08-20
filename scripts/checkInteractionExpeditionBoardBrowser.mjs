#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for expedition-board browser acceptance');

const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
	await page.route(`http://127.0.0.1:${port}/src/3d/game3d.js`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export function initGame3D() {}\n' }));
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
	const result = await page.evaluate(async () => {
		const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
		const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
		const host = document.createElement('div');
		document.body.appendChild(host);
		const dialogueBox = new DialogueBox(host);
		const controller = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		const saved = controller.getRpgSnapshot();
		saved.inventory = { items: [
			{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
			{ itemId: 'dragonstone-travel-ration-pack', quantity: 2, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
		] };
		controller.restoreRpgSnapshot(saved);
		const quartermaster = { displayName: 'Dragonstone Levazımcısı', object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } } };
		controller.update([quartermaster], { x: 1, z: 1 });
		controller.handleKeyDown({ code: 'KeyT', repeat: false });
		const boardText = dialogueBox._textEl.textContent;
		controller.handleKeyDown({ code: 'Digit2', repeat: false });
		const resultText = dialogueBox._textEl.textContent;
		controller.showQuestJournal();
		const journalText = dialogueBox._textEl.textContent;
		controller.showInventory();
		const inventoryText = dialogueBox._textEl.textContent;
		const rpg = controller.getRpgSnapshot();
		dialogueBox.dispose(); host.remove();
		return {
			boardText,
			resultText,
			journalText,
			inventoryText,
			fatigueKm: rpg.journey?.fatigueKm,
			packs: rpg.inventory.fieldReadiness.travelCapacity.travelRationPacks,
			xp: rpg.progression.totalExperience,
			reputation: rpg.reputation.dragonstone,
			completedRoutes: rpg.worldState.dragonstoneExpeditionRoutes,
		};
	});
	if (pageErrors.length || consoleErrors.length) throw new Error(`Expedition-board browser proof emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	if (!result.boardText.includes('Dragonstone Sefer Panosu') || !result.boardText.includes('Tamamlanan kontrat: 0/3')) throw new Error(`Board did not render contract state: ${JSON.stringify(result)}`);
	if (!result.boardText.includes('1. Nöbet Yolu Devriyesi') || !result.boardText.includes('2. Liman Taverna Seferi') || !result.boardText.includes('3. Sırt Kampı Seferi')) throw new Error(`Route choices missing from shipped board text: ${JSON.stringify(result)}`);
	if (!result.boardText.includes('İLK ÖDÜL: 30 XP + 2 itibar')) throw new Error(`First completion reward missing from shipped board text: ${JSON.stringify(result)}`);
	if (!result.resultText.includes('SEFER TAMAMLANDI') || !result.resultText.includes('dragonstone-harbor-tavern') || !result.resultText.includes('Kontrat ödülü: 30 XP + 2 Dragonstone itibarı')) throw new Error(`Committed route reward/result missing: ${JSON.stringify(result)}`);
	if (!result.journalText.includes('Seviye: 1 · XP: 30/100') || !result.journalText.includes('Dragonstone itibarı: 2') || !result.journalText.includes('Sefer kontratları: 1/3')) throw new Error(`Post-contract journal UX mismatch: ${JSON.stringify(result)}`);
	if (!result.inventoryText.includes('Sefer yorgunluğu: 30/36 km') || !result.inventoryText.includes('Yol azığı: 0')) throw new Error(`Post-expedition inventory UX mismatch: ${JSON.stringify(result)}`);
	if (result.fatigueKm !== 30 || result.packs !== 0 || result.xp !== 30 || result.reputation !== 2 || result.completedRoutes?.[0] !== 'dragonstone-harbor-tavern-run') throw new Error(`Canonical contract state mismatch: ${JSON.stringify(result)}`);
	console.log(`[RPG Chromium] PASS expedition contract keyboard loop ${JSON.stringify({ fatigueKm: result.fatigueKm, packs: result.packs, xp: result.xp, reputation: result.reputation, completedRoutes: result.completedRoutes })}`);
} finally {
	await browser.close();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
