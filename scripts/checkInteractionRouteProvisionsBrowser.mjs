#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for route-provision browser acceptance');

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
		const {
			FAST_TRAVEL_BLOCK_REASON,
			buildFastTravelRequestText,
			evaluateFastTravelRequest,
		} = await import('/src/3d/gameplay/interactionFieldReadiness.js');

		const host = document.createElement('div');
		document.body.appendChild(host);
		const dialogueBox = new DialogueBox(host);
		const controller = createInteractionController({
			interactionPrompt: { setVisible() {} },
			dialogueBox,
			greetingTemplate: 'Selam, {name}!',
			radiusMeters: 6,
		});

		const saved = controller.getRpgSnapshot();
		saved.inventory = {
			items: [
				{
					itemId: 'dragonstone-expedition-maintenance-kit',
					quantity: 1,
					provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }],
				},
				{
					itemId: 'dragonstone-travel-ration-pack',
					quantity: 1,
					provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }],
				},
			],
		};
		controller.restoreRpgSnapshot(saved);
		const restored = controller.getRpgSnapshot();
		controller.handleKeyDown({ code: 'KeyI', repeat: false });
		const inventoryText = dialogueBox._textEl.textContent;

		const capacity = restored.inventory.fieldReadiness.travelCapacity;
		const uxRange = inventoryText.includes('Hızlı seyahat menzili: 30 km · Yol azığı: 1');
		const exactCapacity = capacity.baseRangeKm === 12
			&& capacity.rationRangeKm === 18
			&& capacity.maxDistanceKm === 30
			&& capacity.travelRationPacks === 1;

		const allowed = evaluateFastTravelRequest(restored.inventory, {
			destinationId: 'dragonstone-watch-road',
			discovered: true,
			routeOpen: true,
			inCombat: false,
			distanceKm: 28,
		});
		const blocked = evaluateFastTravelRequest(restored.inventory, {
			destinationId: 'dragonstone-watch-road',
			discovered: true,
			routeOpen: true,
			inCombat: false,
			distanceKm: 31,
		});
		const allowedText = buildFastTravelRequestText(allowed);
		const blockedText = buildFastTravelRequestText(blocked);
		const authorization = allowed.allowed === true
			&& allowed.routePlan.requiredTravelPacks === 1
			&& allowedText.includes('28 km · 1 yol azığı')
			&& blocked.allowed === false
			&& blocked.reasons.includes(FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS)
			&& blocked.routePlan.provisionShortfall === 1
			&& blockedText.includes('yol azığı menzili yetersiz');

		const forged = structuredClone(restored);
		forged.inventory.fieldReadiness.travelCapacity = {
			travelRationPacks: 99,
			baseRangeKm: 999,
			rationRangeKm: 999,
			maxDistanceKm: 999,
		};
		controller.restoreRpgSnapshot(forged);
		const canonical = controller.getRpgSnapshot();
		const forgedRejected = canonical.inventory.fieldReadiness.travelCapacity.maxDistanceKm === 30
			&& canonical.inventory.fieldReadiness.travelCapacity.travelRationPacks === 1;

		dialogueBox.dispose();
		host.remove();
		return {
			uxRange,
			exactCapacity,
			authorization,
			forgedRejected,
			capacity,
			allowedText,
			blockedText,
		};
	});

	if (pageErrors.length || consoleErrors.length) {
		throw new Error(`Route-provision browser proof emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
	}
	for (const key of ['uxRange', 'exactCapacity', 'authorization', 'forgedRejected']) {
		if (!result[key]) throw new Error(`Route-provision browser assertion failed: ${key} ${JSON.stringify(result)}`);
	}
	console.log(`[RPG Chromium] PASS route provisions + fast-travel range UX ${JSON.stringify(result)}`);
} finally {
	await browser.close();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
