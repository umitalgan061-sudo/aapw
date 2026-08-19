/**
 * Derived expedition-readiness semantics for the interaction-owned RPG inventory.
 *
 * This module is intentionally pure: it does not own inventory, travel, survival, or equipment
 * state. It derives a compact field-readiness view from the existing interaction inventory
 * snapshot so save/load stays authoritative in one place and other systems can consume a stable
 * contract without creating a second framework.
 * @module gameplay/interactionFieldReadiness
 */

export const FIELD_READINESS_TIER = Object.freeze({
	UNPREPARED: 'unprepared',
	PROVISIONED: 'provisioned',
	MAINTAINED: 'maintained',
	EXPEDITION_READY: 'expedition-ready',
});

export const FIELD_READINESS_LABEL = Object.freeze({
	[FIELD_READINESS_TIER.UNPREPARED]: 'HAZIR DEĞİL',
	[FIELD_READINESS_TIER.PROVISIONED]: 'ERZAKLI',
	[FIELD_READINESS_TIER.MAINTAINED]: 'BAKIMLI',
	[FIELD_READINESS_TIER.EXPEDITION_READY]: 'SEFERE HAZIR',
});

export const FIELD_READINESS_ITEMS = Object.freeze({
	FIELD_RATION: 'dragonstone-field-ration',
	TRAVEL_RATION_PACK: 'dragonstone-travel-ration-pack',
	WHETSTONE: 'dragonstone-whetstone',
	EXPEDITION_MAINTENANCE_KIT: 'dragonstone-expedition-maintenance-kit',
});

function normalizedQuantity(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function quantitiesFromSnapshot(snapshot = {}) {
	const quantities = new Map();
	for (const item of Array.isArray(snapshot?.items) ? snapshot.items : []) {
		const itemId = String(item?.itemId ?? '');
		if (!itemId) continue;
		quantities.set(itemId, normalizedQuantity(item?.quantity));
	}
	return quantities;
}

function capabilitySummary(capabilities) {
	const labels = [];
	if (capabilities.campProvisioning) labels.push('kamp erzağı');
	if (capabilities.equipmentMaintenance) labels.push('teçhizat bakımı');
	if (capabilities.fastTravelEligible) labels.push('hızlı seyahat hazırlığı');
	if (capabilities.survivalBuffer) labels.push('sefer dayanıklılığı');
	return labels;
}

/**
 * Derive field readiness from the canonical interaction inventory snapshot.
 *
 * The maintenance kit is treated as the single utility-slot expedition item. It is not persisted
 * as a second equipment record: having the canonical item means the utility slot is equipped.
 * This avoids stale equipment references when inventory restore clamps or rejects forged items.
 */
export function evaluateFieldReadiness(snapshot = {}) {
	const quantities = quantitiesFromSnapshot(snapshot);
	const fieldRations = quantities.get(FIELD_READINESS_ITEMS.FIELD_RATION) ?? 0;
	const travelPacks = quantities.get(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK) ?? 0;
	const whetstones = quantities.get(FIELD_READINESS_ITEMS.WHETSTONE) ?? 0;
	const maintenanceKits = quantities.get(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT) ?? 0;

	let tier = FIELD_READINESS_TIER.UNPREPARED;
	let score = 0;
	if (fieldRations > 0) score += 15;
	if (travelPacks > 0) {
		tier = FIELD_READINESS_TIER.PROVISIONED;
		score += 35;
	}
	if (whetstones > 0) {
		if (tier === FIELD_READINESS_TIER.PROVISIONED) tier = FIELD_READINESS_TIER.MAINTAINED;
		score += 25;
	}
	if (maintenanceKits > 0) {
		tier = FIELD_READINESS_TIER.EXPEDITION_READY;
		score = 100;
	}

	const capabilities = Object.freeze({
		campProvisioning: travelPacks > 0 || maintenanceKits > 0,
		equipmentMaintenance: whetstones > 0 || maintenanceKits > 0,
		fastTravelEligible: maintenanceKits > 0,
		survivalBuffer: maintenanceKits > 0,
	});
	const equipped = maintenanceKits > 0
		? Object.freeze({ slot: 'field-kit', itemId: FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT })
		: null;
	const missingForExpedition = [];
	if (maintenanceKits <= 0) {
		if (travelPacks <= 0) missingForExpedition.push(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK);
		if (whetstones <= 0) missingForExpedition.push(FIELD_READINESS_ITEMS.WHETSTONE);
	}

	return Object.freeze({
		tier,
		label: FIELD_READINESS_LABEL[tier],
		score: Math.min(100, score),
		equipped,
		capabilities,
		capabilityLabels: Object.freeze(capabilitySummary(capabilities)),
		missingForExpedition: Object.freeze(missingForExpedition),
	});
}

/** Canonicalize authored recipe inputs exactly like inventory crafting does, for UX inspection. */
export function evaluateCraftAvailability(upgrade, snapshot = {}, itemDefinitions = {}) {
	if (!upgrade || typeof upgrade !== 'object') return Object.freeze({ status: 'invalid-recipe', ready: false, inputs: [] });
	const authoredInputs = Array.isArray(upgrade.inputs) && upgrade.inputs.length > 0
		? upgrade.inputs
		: [{ itemId: upgrade.inputItemId, quantity: upgrade.inputQuantity }];
	const required = new Map();
	for (const input of authoredInputs) {
		const itemId = String(input?.itemId ?? '');
		const quantity = Math.max(1, Math.floor(Number(input?.quantity) || 1));
		if (!itemId || !itemDefinitions[itemId]) return Object.freeze({ status: 'invalid-recipe', ready: false, inputs: [] });
		required.set(itemId, (required.get(itemId) ?? 0) + quantity);
	}

	const quantities = quantitiesFromSnapshot(snapshot);
	const inputs = [...required.entries()].map(([itemId, requiredQuantity]) => Object.freeze({
		itemId,
		requiredQuantity,
		availableQuantity: quantities.get(itemId) ?? 0,
		missingQuantity: Math.max(0, requiredQuantity - (quantities.get(itemId) ?? 0)),
	}));
	const outputItemId = String(upgrade.outputItemId ?? '');
	const outputQuantity = Math.max(1, Math.floor(Number(upgrade.outputQuantity) || 1));
	const outputDefinition = itemDefinitions[outputItemId];
	if (!outputDefinition) return Object.freeze({ status: 'invalid-recipe', ready: false, inputs: Object.freeze(inputs) });
	const outputCurrent = quantities.get(outputItemId) ?? 0;
	const outputCapacity = Math.max(0, Math.floor(Number(outputDefinition.stackLimit) || 0) - outputCurrent);
	const missingInputs = inputs.filter((input) => input.missingQuantity > 0);
	const outputFull = outputCapacity < outputQuantity;
	const status = missingInputs.length > 0 ? 'missing-inputs' : outputFull ? 'output-full' : 'ready';
	return Object.freeze({
		status,
		ready: status === 'ready',
		inputs: Object.freeze(inputs),
		missingInputs: Object.freeze(missingInputs),
		outputItemId,
		outputQuantity,
		outputCapacity,
	});
}

export function buildFieldReadinessText(readiness = evaluateFieldReadiness()) {
	const lines = [`Sefer hazırlığı: ${readiness.label} · ${readiness.score}/100`];
	if (readiness.equipped) lines.push('Saha ekipmanı: Dragonstone Sefer Bakım Kiti · field-kit');
	if (readiness.capabilityLabels?.length) lines.push(`Hazır kabiliyetler: ${readiness.capabilityLabels.join(', ')}`);
	if (!readiness.equipped && readiness.missingForExpedition?.length) {
		lines.push(`Sefer için eksik: ${readiness.missingForExpedition.join(' + ')}`);
	}
	return lines.join('\n');
}
