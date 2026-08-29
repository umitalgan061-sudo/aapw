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
		const expeditionInventory = () => ({ items: [
			{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
			{ itemId: 'dragonstone-travel-ration-pack', quantity: 2, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] },
		] });
		const quartermaster = { displayName: 'Dragonstone Levazımcısı', object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } } };

		const host = document.createElement('div');
		document.body.appendChild(host);
		const dialogueBox = new DialogueBox(host);
		const controller = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		const saved = controller.getRpgSnapshot();
		saved.inventory = expeditionInventory();
		controller.restoreRpgSnapshot(saved);
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

		const restoredHost = document.createElement('div');
		document.body.appendChild(restoredHost);
		const restoredBox = new DialogueBox(restoredHost);
		const restoredController = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox: restoredBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		restoredController.restoreRpgSnapshot(rpg);
		restoredController.update([quartermaster], { x: 1, z: 1 });
		restoredController.handleKeyDown({ code: 'KeyB', repeat: false });
		const restoredQuartermasterText = restoredBox._textEl.textContent;
		const restoredRpg = restoredController.getRpgSnapshot();
		restoredBox.dispose(); restoredHost.remove();

		const replayHost = document.createElement('div');
		document.body.appendChild(replayHost);
		const replayBox = new DialogueBox(replayHost);
		const replayController = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox: replayBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		const replaySave = structuredClone(rpg);
		replaySave.inventory = expeditionInventory();
		replaySave.journey = { ...(replaySave.journey ?? {}), fatigueKm: 0 };
		replayController.restoreRpgSnapshot(replaySave);
		replayController.update([quartermaster], { x: 1, z: 1 });
		replayController.handleKeyDown({ code: 'KeyT', repeat: false });
		const replayBoardText = replayBox._textEl.textContent;
		replayController.handleKeyDown({ code: 'Digit2', repeat: false });
		const replayResultText = replayBox._textEl.textContent;
		const replayRpg = replayController.getRpgSnapshot();
		replayBox.dispose(); replayHost.remove();

		const masteryHost = document.createElement('div');
		document.body.appendChild(masteryHost);
		const masteryBox = new DialogueBox(masteryHost);
		const masteryController = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox: masteryBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		const masterySave = masteryController.getRpgSnapshot();
		masterySave.inventory = expeditionInventory();
		masterySave.worldState = {
			dragonstoneWatchPolicy: null,
			dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
		};
		masteryController.restoreRpgSnapshot(masterySave);
		masteryController.update([quartermaster], { x: 1, z: 1 });
		masteryController.handleKeyDown({ code: 'KeyT', repeat: false });
		const masteryBeforeText = masteryBox._textEl.textContent;
		masteryController.handleKeyDown({ code: 'Digit3', repeat: false });
		const masteryResultText = masteryBox._textEl.textContent;
		masteryController.handleKeyDown({ code: 'KeyT', repeat: false });
		const masteryBoardText = masteryBox._textEl.textContent;
		masteryController.showQuestJournal();
		const masteryJournalText = masteryBox._textEl.textContent;
		const masteryRpg = masteryController.getRpgSnapshot();
		masteryBox.dispose(); masteryHost.remove();

		const masteryReplayHost = document.createElement('div');
		document.body.appendChild(masteryReplayHost);
		const masteryReplayBox = new DialogueBox(masteryReplayHost);
		const masteryReplayController = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox: masteryReplayBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
		const masteryReplaySave = structuredClone(masteryRpg);
		masteryReplaySave.inventory = expeditionInventory();
		masteryReplaySave.journey = { ...(masteryReplaySave.journey ?? {}), fatigueKm: 0 };
		masteryReplayController.restoreRpgSnapshot(masteryReplaySave);
		masteryReplayController.update([quartermaster], { x: 1, z: 1 });
		masteryReplayController.handleKeyDown({ code: 'KeyT', repeat: false });
		const masteryReplayBoardText = masteryReplayBox._textEl.textContent;
		masteryReplayController.handleKeyDown({ code: 'Digit3', repeat: false });
		const masteryReplayResultText = masteryReplayBox._textEl.textContent;
		const masteryReplayRpg = masteryReplayController.getRpgSnapshot();
		masteryReplayBox.dispose(); masteryReplayHost.remove();

		return {
			boardText,
			resultText,
			journalText,
			inventoryText,
			fatigueKm: rpg.journey?.fatigueKm,
			packs: rpg.inventory.fieldReadiness.travelCapacity.travelRationPacks,
			xp: rpg.progression.totalExperience,
			reputation: rpg.reputation.dragonstone,
			copper: rpg.economy.copper,
			credits: rpg.economy.ledger.recentCredits,
			completedRoutes: rpg.worldState.dragonstoneExpeditionRoutes,
			restoredQuartermasterText,
			restoredCopper: restoredRpg.economy.copper,
			restoredCredits: restoredRpg.economy.ledger.recentCredits,
			restoredRoutes: restoredRpg.worldState.dragonstoneExpeditionRoutes,
			replayBoardText,
			replayResultText,
			replayXp: replayRpg.progression.totalExperience,
			replayReputation: replayRpg.reputation.dragonstone,
			replayCopper: replayRpg.economy.copper,
			replayCredits: replayRpg.economy.ledger.recentCredits,
			replayRoutes: replayRpg.worldState.dragonstoneExpeditionRoutes,
			masteryBeforeText,
			masteryResultText,
			masteryBoardText,
			masteryJournalText,
			masteryXp: masteryRpg.progression.totalExperience,
			masteryReputation: masteryRpg.reputation.dragonstone,
			masteryCopper: masteryRpg.economy.copper,
			masteryClaimed: masteryRpg.worldState.dragonstoneExpeditionMasteryClaimed,
			masteryCredits: masteryRpg.economy.ledger.recentCredits,
			masteryReplayBoardText,
			masteryReplayResultText,
			masteryReplayXp: masteryReplayRpg.progression.totalExperience,
			masteryReplayReputation: masteryReplayRpg.reputation.dragonstone,
			masteryReplayCopper: masteryReplayRpg.economy.copper,
			masteryReplayClaimed: masteryReplayRpg.worldState.dragonstoneExpeditionMasteryClaimed,
			masteryReplayCredits: masteryReplayRpg.economy.ledger.recentCredits,
		};
	});
	if (pageErrors.length || consoleErrors.length) throw new Error(`Expedition-board browser proof emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	if (!result.boardText.includes('Dragonstone Sefer Panosu') || !result.boardText.includes('Tamamlanan kontrat: 0/3') || !result.boardText.includes('Sefer ustalığı: İLERLEME 0/3')) throw new Error(`Board did not render contract state: ${JSON.stringify(result)}`);
	if (!result.boardText.includes('1. Nöbet Yolu Devriyesi') || !result.boardText.includes('2. Liman Taverna Seferi') || !result.boardText.includes('3. Sırt Kampı Seferi')) throw new Error(`Route choices missing from shipped board text: ${JSON.stringify(result)}`);
	if (!result.boardText.includes('İLK ÖDÜL: 30 XP + 2 itibar + 12 bakır')) throw new Error(`First completion economy reward missing from shipped board text: ${JSON.stringify(result)}`);
	if (!result.resultText.includes('SEFER TAMAMLANDI') || !result.resultText.includes('dragonstone-harbor-tavern') || !result.resultText.includes('Kontrat ödülü: 30 XP + 2 Dragonstone itibarı + 12 bakır · kese 52')) throw new Error(`Committed route reward/result missing: ${JSON.stringify(result)}`);
	if (!result.journalText.includes('Seviye: 1 · XP: 30/100') || !result.journalText.includes('Dragonstone itibarı: 2') || !result.journalText.includes('Sefer kontratları: 1/3')) throw new Error(`Post-contract journal UX mismatch: ${JSON.stringify(result)}`);
	if (!result.inventoryText.includes('Sefer yorgunluğu: 30/36 km') || !result.inventoryText.includes('Yol azığı: 0')) throw new Error(`Post-expedition inventory UX mismatch: ${JSON.stringify(result)}`);
	if (result.fatigueKm !== 30 || result.packs !== 0 || result.xp !== 30 || result.reputation !== 2 || result.copper !== 52 || result.completedRoutes?.[0] !== 'dragonstone-harbor-tavern-run') throw new Error(`Canonical contract state mismatch: ${JSON.stringify(result)}`);
	if (result.credits?.length !== 1 || result.credits[0]?.sourceId !== 'expedition-contract:dragonstone-harbor-tavern-run' || result.credits[0]?.label !== 'Liman Taverna Seferi' || result.credits[0]?.creditedCopper !== 12 || result.credits[0]?.balanceCopper !== 52) throw new Error(`Route-specific expedition receipt provenance mismatch: ${JSON.stringify(result)}`);
	if (!result.restoredQuartermasterText.includes('Son gelir: Liman Taverna Seferi · +12 bakır · bakiye 52')) throw new Error(`Restored quartermaster provenance UX mismatch: ${JSON.stringify(result)}`);
	if (result.restoredCopper !== result.copper || JSON.stringify(result.restoredCredits) !== JSON.stringify(result.credits) || JSON.stringify(result.restoredRoutes) !== JSON.stringify(result.completedRoutes)) throw new Error(`Expedition receipt/save-load browser parity mismatch: ${JSON.stringify(result)}`);
	if (!result.replayBoardText.includes('Liman Taverna Seferi') || !result.replayBoardText.includes('ÖDÜL ALINDI')) throw new Error(`Completed contract did not advertise claimed reward before replay: ${JSON.stringify(result)}`);
	if (!result.replayResultText.includes('SEFER TAMAMLANDI') || !result.replayResultText.includes('Kontrat daha önce tamamlandı · tekrar ödülü yok')) throw new Error(`Completed contract replay did not report reward idempotency: ${JSON.stringify(result)}`);
	if (result.replayXp !== result.xp || result.replayReputation !== result.reputation || result.replayCopper !== result.copper || JSON.stringify(result.replayCredits) !== JSON.stringify(result.credits) || JSON.stringify(result.replayRoutes) !== JSON.stringify(result.completedRoutes)) throw new Error(`Completed contract replay duplicated progression/reputation/economy/world rewards: ${JSON.stringify(result)}`);
	if (!result.masteryBeforeText.includes('Tamamlanan kontrat: 2/3') || !result.masteryBeforeText.includes('Sefer ustalığı: İLERLEME 2/3')) throw new Error(`Mastery precondition UX mismatch: ${JSON.stringify(result)}`);
	if (!result.masteryResultText.includes('SEFER USTALIĞI KAZANILDI: 50 XP + 3 Dragonstone itibarı + 20 bakır · kese 70')) throw new Error(`Mastery completion result missing: ${JSON.stringify(result)}`);
	if (!result.masteryBoardText.includes('Tamamlanan kontrat: 3/3') || !result.masteryBoardText.includes('Sefer ustalığı: TAMAMLANDI')) throw new Error(`Mastery board persistence UX mismatch: ${JSON.stringify(result)}`);
	if (!result.masteryJournalText.includes('Sefer kontratları: 3/3') || !result.masteryJournalText.includes('Sefer ustalığı: TAMAMLANDI')) throw new Error(`Mastery journal persistence UX mismatch: ${JSON.stringify(result)}`);
	if (result.masteryXp !== 75 || result.masteryReputation !== 5 || result.masteryCopper !== 70 || result.masteryClaimed !== true) throw new Error(`Canonical mastery state mismatch: ${JSON.stringify(result)}`);
	if (result.masteryCredits?.length !== 2 || result.masteryCredits[0]?.sourceId !== 'expedition-contract:dragonstone-ridge-camp' || result.masteryCredits[0]?.label !== 'Sırt Kampı Seferi' || result.masteryCredits[0]?.creditedCopper !== 10 || result.masteryCredits[0]?.balanceCopper !== 50 || result.masteryCredits.at(-1)?.sourceId !== 'expedition-mastery' || result.masteryCredits.at(-1)?.creditedCopper !== 20) throw new Error(`Mastery economy receipt provenance mismatch: ${JSON.stringify(result)}`);
	if (!result.masteryReplayBoardText.includes('Sefer ustalığı: TAMAMLANDI') || !result.masteryReplayBoardText.includes('Sırt Kampı Seferi') || !result.masteryReplayBoardText.includes('ÖDÜL ALINDI')) throw new Error(`Mastery replay board did not preserve claimed state: ${JSON.stringify(result)}`);
	if (!result.masteryReplayResultText.includes('SEFER TAMAMLANDI') || !result.masteryReplayResultText.includes('Kontrat daha önce tamamlandı · tekrar ödülü yok')) throw new Error(`Mastery-route replay did not report reward idempotency: ${JSON.stringify(result)}`);
	if (result.masteryReplayXp !== result.masteryXp || result.masteryReplayReputation !== result.masteryReputation || result.masteryReplayCopper !== result.masteryCopper || result.masteryReplayClaimed !== true || JSON.stringify(result.masteryReplayCredits) !== JSON.stringify(result.masteryCredits)) throw new Error(`Mastery-route replay duplicated mastery/progression/reputation/economy rewards: ${JSON.stringify(result)}`);
	console.log(`[RPG Chromium] PASS expedition contract + replay idempotency + mastery replay idempotency keyboard loop ${JSON.stringify({ fatigueKm: result.fatigueKm, packs: result.packs, xp: result.xp, reputation: result.reputation, copper: result.copper, routeReceipt: result.credits?.[0], restoredQuartermaster: result.restoredQuartermasterText, replayResult: result.replayResultText, replayXp: result.replayXp, replayReputation: result.replayReputation, replayCopper: result.replayCopper, restoredRouteReceipt: result.restoredCredits?.[0], masteryXp: result.masteryXp, masteryReputation: result.masteryReputation, masteryCopper: result.masteryCopper, masteryClaimed: result.masteryClaimed, masteryReplayResult: result.masteryReplayResultText, masteryReplayCopper: result.masteryReplayCopper })}`);
} finally {
	await browser.close();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
