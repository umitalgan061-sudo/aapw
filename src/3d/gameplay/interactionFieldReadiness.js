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

export const EXPEDITION_ROUTE_POLICY = Object.freeze({
	FIELD_KIT_BASE_RANGE_KM: 12,
	TRAVEL_PACK_RANGE_KM: 18,
	MAX_FAST_TRAVEL_RANGE_KM: 84,
});

export const FAST_TRAVEL_BLOCK_REASON = Object.freeze({
	NO_DESTINATION: 'no-destination',
	UNDISCOVERED_DESTINATION: 'undiscovered-destination',
	FIELD_KIT_REQUIRED: 'field-kit-required',
	COMBAT_ACTIVE: 'combat-active',
	ROUTE_BLOCKED: 'route-blocked',
	INSUFFICIENT_PROVISIONS: 'insufficient-provisions',
});

const FAST_TRAVEL_REASON_LABEL = Object.freeze({
	[FAST_TRAVEL_BLOCK_REASON.NO_DESTINATION]: 'hedef seçilmedi',
	[FAST_TRAVEL_BLOCK_REASON.UNDISCOVERED_DESTINATION]: 'hedef henüz keşfedilmedi',
	[FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED]: 'Sefer Bakım Kiti gerekli',
	[FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE]: 'çatışma sürüyor',
	[FAST_TRAVEL_BLOCK_REASON.ROUTE_BLOCKED]: 'rota şu anda kapalı',
	[FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]: 'yol azığı menzili yetersiz',
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
		quantities.set(itemId, (quantities.get(itemId) ?? 0) + normalizedQuantity(item?.quantity));
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

function buildTravelCapacity({ maintenanceKits = 0, travelPacks = 0 } = {}) {
	const hasFieldKit = maintenanceKits > 0;
	const baseRangeKm = hasFieldKit ? EXPEDITION_ROUTE_POLICY.FIELD_KIT_BASE_RANGE_KM : 0;
	const rationRangeKm = hasFieldKit
		? travelPacks * EXPEDITION_ROUTE_POLICY.TRAVEL_PACK_RANGE_KM
		: 0;
	const maxDistanceKm = Math.min(
		EXPEDITION_ROUTE_POLICY.MAX_FAST_TRAVEL_RANGE_KM,
		baseRangeKm + rationRangeKm,
	);
	return Object.freeze({
		travelRationPacks: travelPacks,
		baseRangeKm,
		rationRangeKm,
		maxDistanceKm,
	});
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
	const travelCapacity = buildTravelCapacity({ maintenanceKits, travelPacks });

	return Object.freeze({
		tier,
		label: FIELD_READINESS_LABEL[tier],
		score: Math.min(100, score),
		equipped,
		capabilities,
		capabilityLabels: Object.freeze(capabilitySummary(capabilities)),
		missingForExpedition: Object.freeze(missingForExpedition),
		travelCapacity,
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

/**
 * Estimate expedition provisions without mutating inventory or owning route state.
 * A maintenance kit unlocks a 12 km emergency range; each retained travel-ration pack extends the
 * route by 18 km, capped at 84 km so authored world routes remain bounded.
 */
export function evaluateExpeditionRoutePlan(snapshotOrReadiness = {}, context = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined
		? snapshotOrReadiness
		: evaluateFieldReadiness(snapshotOrReadiness);
	const distance = Number(context?.distanceKm);
	const distanceKm = Number.isFinite(distance) && distance >= 0 ? Number(distance.toFixed(2)) : null;
	const capacity = readiness?.travelCapacity ?? Object.freeze({
		travelRationPacks: 0,
		baseRangeKm: readiness?.capabilities?.fastTravelEligible ? EXPEDITION_ROUTE_POLICY.FIELD_KIT_BASE_RANGE_KM : 0,
		rationRangeKm: 0,
		maxDistanceKm: readiness?.capabilities?.fastTravelEligible ? EXPEDITION_ROUTE_POLICY.FIELD_KIT_BASE_RANGE_KM : 0,
	});
	const beyondBaseKm = distanceKm == null
		? 0
		: Math.max(0, distanceKm - capacity.baseRangeKm);
	const requiredTravelPacks = distanceKm == null
		? 0
		: Math.ceil(beyondBaseKm / EXPEDITION_ROUTE_POLICY.TRAVEL_PACK_RANGE_KM);
	const provisionShortfall = Math.max(0, requiredTravelPacks - capacity.travelRationPacks);
	const withinRange = distanceKm == null || distanceKm <= capacity.maxDistanceKm;
	return Object.freeze({
		distanceKm,
		withinRange,
		maxDistanceKm: capacity.maxDistanceKm,
		availableTravelPacks: capacity.travelRationPacks,
		requiredTravelPacks,
		provisionShortfall,
		policy: EXPEDITION_ROUTE_POLICY,
	});
}

/**
 * Bridge the derived field-kit capability into the travel/map layer without owning travel state.
 * The caller supplies live discovery/combat/route context; this function only produces a stable,
 * side-effect-free authorization decision that a POI or fast-travel UI can consume.
 */
export function evaluateFastTravelRequest(snapshotOrReadiness = {}, context = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined
		? snapshotOrReadiness
		: evaluateFieldReadiness(snapshotOrReadiness);
	const destinationId = String(context?.destinationId ?? '').trim();
	const discovered = context?.discovered === true;
	const inCombat = context?.inCombat === true;
	const routeOpen = context?.routeOpen !== false;
	const routePlan = evaluateExpeditionRoutePlan(readiness, context);
	const reasons = [];
	if (!destinationId) reasons.push(FAST_TRAVEL_BLOCK_REASON.NO_DESTINATION);
	if (destinationId && !discovered) reasons.push(FAST_TRAVEL_BLOCK_REASON.UNDISCOVERED_DESTINATION);
	if (!readiness?.capabilities?.fastTravelEligible) reasons.push(FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED);
	if (inCombat) reasons.push(FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE);
	if (!routeOpen) reasons.push(FAST_TRAVEL_BLOCK_REASON.ROUTE_BLOCKED);
	if (readiness?.capabilities?.fastTravelEligible && !routePlan.withinRange) {
		reasons.push(FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS);
	}
	const allowed = reasons.length === 0;
	return Object.freeze({
		allowed,
		status: allowed ? 'ready' : 'blocked',
		destinationId: destinationId || null,
		distanceKm: routePlan.distanceKm,
		readinessTier: readiness?.tier ?? FIELD_READINESS_TIER.UNPREPARED,
		requiredCapability: 'fastTravelEligible',
		reasons: Object.freeze(reasons),
		routePlan,
	});
}

export function buildFastTravelRequestText(decision = evaluateFastTravelRequest()) {
	if (decision.allowed) {
		const distance = decision.distanceKm == null ? '' : ` · ${decision.distanceKm} km`;
		const provisions = decision.routePlan?.requiredTravelPacks > 0
			? ` · ${decision.routePlan.requiredTravelPacks} yol azığı`
			: '';
		return `Hızlı seyahat: HAZIR · ${decision.destinationId}${distance}${provisions}`;
	}
	const reasonText = (decision.reasons ?? []).map((reason) => FAST_TRAVEL_REASON_LABEL[reason] ?? reason).join(', ');
	return `Hızlı seyahat: KİLİTLİ${reasonText ? ` · ${reasonText}` : ''}`;
}

export function buildFieldReadinessText(readiness = evaluateFieldReadiness()) {
	const lines = [`Sefer hazırlığı: ${readiness.label} · ${readiness.score}/100`];
	if (readiness.equipped) lines.push('Saha ekipmanı: Dragonstone Sefer Bakım Kiti · field-kit');
	if (readiness.capabilityLabels?.length) lines.push(`Hazır kabiliyetler: ${readiness.capabilityLabels.join(', ')}`);
	if (readiness.capabilities?.fastTravelEligible && readiness.travelCapacity) {
		lines.push(`Hızlı seyahat menzili: ${readiness.travelCapacity.maxDistanceKm} km · Yol azığı: ${readiness.travelCapacity.travelRationPacks}`);
	}
	if (!readiness.equipped && readiness.missingForExpedition?.length) {
		lines.push(`Sefer için eksik: ${readiness.missingForExpedition.join(' + ')}`);
	}
	return lines.join('\n');
}
