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
	return Object.freeze({ travelRationPacks: travelPacks, baseRangeKm, rationRangeKm, maxDistanceKm });
}

export function evaluateFieldReadiness(snapshot = {}) {
	const quantities = quantitiesFromSnapshot(snapshot);
	const fieldRations = quantities.get(FIELD_READINESS_ITEMS.FIELD_RATION) ?? 0;
	const travelPacks = quantities.get(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK) ?? 0;
	const whetstones = quantities.get(FIELD_READINESS_ITEMS.WHETSTONE) ?? 0;
	const maintenanceKits = quantities.get(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT) ?? 0;
	let tier = FIELD_READINESS_TIER.UNPREPARED;
	let score = 0;
	if (fieldRations > 0) score += 15;
	if (travelPacks > 0) { tier = FIELD_READINESS_TIER.PROVISIONED; score += 35; }
	if (whetstones > 0) { if (tier === FIELD_READINESS_TIER.PROVISIONED) tier = FIELD_READINESS_TIER.MAINTAINED; score += 25; }
	if (maintenanceKits > 0) { tier = FIELD_READINESS_TIER.EXPEDITION_READY; score = 100; }
	const capabilities = Object.freeze({
		campProvisioning: travelPacks > 0 || maintenanceKits > 0,
		equipmentMaintenance: whetstones > 0 || maintenanceKits > 0,
		fastTravelEligible: maintenanceKits > 0,
		survivalBuffer: maintenanceKits > 0,
	});
	const equipped = maintenanceKits > 0 ? Object.freeze({ slot: 'field-kit', itemId: FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT }) : null;
	const missingForExpedition = [];
	if (maintenanceKits <= 0) {
		if (travelPacks <= 0) missingForExpedition.push(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK);
		if (whetstones <= 0) missingForExpedition.push(FIELD_READINESS_ITEMS.WHETSTONE);
	}
	const travelCapacity = buildTravelCapacity({ maintenanceKits, travelPacks });
	return Object.freeze({ tier, label: FIELD_READINESS_LABEL[tier], score: Math.min(100, score), equipped, capabilities, capabilityLabels: Object.freeze(capabilitySummary(capabilities)), missingForExpedition: Object.freeze(missingForExpedition), travelCapacity });
}

export function evaluateCraftAvailability(upgrade, snapshot = {}, itemDefinitions = {}) {
	if (!upgrade || typeof upgrade !== 'object') return Object.freeze({ status: 'invalid-recipe', ready: false, inputs: [] });
	const authoredInputs = Array.isArray(upgrade.inputs) && upgrade.inputs.length > 0 ? upgrade.inputs : [{ itemId: upgrade.inputItemId, quantity: upgrade.inputQuantity }];
	const required = new Map();
	for (const input of authoredInputs) {
		const itemId = String(input?.itemId ?? '');
		const quantity = Math.max(1, Math.floor(Number(input?.quantity) || 1));
		if (!itemId || !itemDefinitions[itemId]) return Object.freeze({ status: 'invalid-recipe', ready: false, inputs: [] });
		required.set(itemId, (required.get(itemId) ?? 0) + quantity);
	}
	const quantities = quantitiesFromSnapshot(snapshot);
	const inputs = [...required.entries()].map(([itemId, requiredQuantity]) => Object.freeze({ itemId, requiredQuantity, availableQuantity: quantities.get(itemId) ?? 0, missingQuantity: Math.max(0, requiredQuantity - (quantities.get(itemId) ?? 0)) }));
	const outputItemId = String(upgrade.outputItemId ?? '');
	const outputQuantity = Math.max(1, Math.floor(Number(upgrade.outputQuantity) || 1));
	const outputDefinition = itemDefinitions[outputItemId];
	if (!outputDefinition) return Object.freeze({ status: 'invalid-recipe', ready: false, inputs: Object.freeze(inputs) });
	const outputCurrent = quantities.get(outputItemId) ?? 0;
	const outputCapacity = Math.max(0, Math.floor(Number(outputDefinition.stackLimit) || 0) - outputCurrent);
	const missingInputs = inputs.filter((input) => input.missingQuantity > 0);
	const outputFull = outputCapacity < outputQuantity;
	const status = missingInputs.length > 0 ? 'missing-inputs' : outputFull ? 'output-full' : 'ready';
	return Object.freeze({ status, ready: status === 'ready', inputs: Object.freeze(inputs), missingInputs: Object.freeze(missingInputs), outputItemId, outputQuantity, outputCapacity });
}

export function evaluateExpeditionRoutePlan(snapshotOrReadiness = {}, context = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined ? snapshotOrReadiness : evaluateFieldReadiness(snapshotOrReadiness);
	const distance = Number(context?.distanceKm);
	const distanceKm = Number.isFinite(distance) && distance >= 0 ? Number(distance.toFixed(2)) : null;
	const capacity = readiness?.travelCapacity ?? Object.freeze({ travelRationPacks: 0, baseRangeKm: readiness?.capabilities?.fastTravelEligible ? 12 : 0, rationRangeKm: 0, maxDistanceKm: readiness?.capabilities?.fastTravelEligible ? 12 : 0 });
	const beyondBaseKm = distanceKm == null ? 0 : Math.max(0, distanceKm - capacity.baseRangeKm);
	const requiredTravelPacks = distanceKm == null ? 0 : Math.ceil(beyondBaseKm / 18);
	return Object.freeze({ distanceKm, withinRange: distanceKm == null || distanceKm <= capacity.maxDistanceKm, maxDistanceKm: capacity.maxDistanceKm, availableTravelPacks: capacity.travelRationPacks, requiredTravelPacks, provisionShortfall: Math.max(0, requiredTravelPacks - capacity.travelRationPacks), policy: EXPEDITION_ROUTE_POLICY });
}

export function evaluateFastTravelRequest(snapshotOrReadiness = {}, context = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined ? snapshotOrReadiness : evaluateFieldReadiness(snapshotOrReadiness);
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
	if (readiness?.capabilities?.fastTravelEligible && !routePlan.withinRange) reasons.push(FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS);
	const allowed = reasons.length === 0;
	return Object.freeze({ allowed, status: allowed ? 'ready' : 'blocked', destinationId: destinationId || null, distanceKm: routePlan.distanceKm, readinessTier: readiness?.tier ?? FIELD_READINESS_TIER.UNPREPARED, requiredCapability: 'fastTravelEligible', reasons: Object.freeze(reasons), routePlan });
}

export function buildFastTravelRequestText(decision = evaluateFastTravelRequest()) {
	if (decision.allowed) {
		const distance = decision.distanceKm == null ? '' : ` · ${decision.distanceKm} km`;
		const provisions = decision.routePlan?.requiredTravelPacks > 0 ? ` · ${decision.routePlan.requiredTravelPacks} yol azığı` : '';
		return `Hızlı seyahat: HAZIR · ${decision.destinationId}${distance}${provisions}`;
	}
	const reasonText = (decision.reasons ?? []).map((reason) => FAST_TRAVEL_REASON_LABEL[reason] ?? reason).join(', ');
	return `Hızlı seyahat: KİLİTLİ${reasonText ? ` · ${reasonText}` : ''}`;
}

export function buildFieldReadinessText(readiness = evaluateFieldReadiness()) {
	const lines = [`Sefer hazırlığı: ${readiness.label} · ${readiness.score}/100`];
	if (readiness.equipped) lines.push('Saha ekipmanı: Dragonstone Sefer Bakım Kiti · field-kit');
	if (readiness.capabilityLabels?.length) lines.push(`Hazır kabiliyetler: ${readiness.capabilityLabels.join(', ')}`);
	if (readiness.capabilities?.fastTravelEligible && readiness.travelCapacity) lines.push(`Hızlı seyahat menzili: ${readiness.travelCapacity.maxDistanceKm} km · Yol azığı: ${readiness.travelCapacity.travelRationPacks}`);
	if (!readiness.equipped && readiness.missingForExpedition?.length) lines.push(`Sefer için eksik: ${readiness.missingForExpedition.join(' + ')}`);
	return lines.join('\n');
}

function readinessWithTravelPackCount(readiness, travelRationPacks) {
	const safeCount = Math.max(0, Math.floor(Number(travelRationPacks) || 0));
	const hasFieldKit = readiness?.capabilities?.fastTravelEligible === true;
	return Object.freeze({ ...readiness, travelCapacity: buildTravelCapacity({ maintenanceKits: hasFieldKit ? 1 : 0, travelPacks: safeCount }) });
}

export function evaluateExpeditionJourney(snapshotOrReadiness = {}, legs = []) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined ? snapshotOrReadiness : evaluateFieldReadiness(snapshotOrReadiness);
	const authoredLegs = Array.isArray(legs) ? legs : [];
	let remainingTravelPacks = Math.max(0, Math.floor(Number(readiness?.travelCapacity?.travelRationPacks) || 0));
	let totalRequiredTravelPacks = 0;
	let totalDistanceKm = 0;
	let blockedAtLegIndex = null;
	const plannedLegs = [];
	for (let index = 0; index < authoredLegs.length; index += 1) {
		const leg = authoredLegs[index] ?? {};
		const decision = evaluateFastTravelRequest(readinessWithTravelPackCount(readiness, remainingTravelPacks), leg);
		const requiredTravelPacks = decision.routePlan?.requiredTravelPacks ?? 0;
		const canConsume = decision.allowed && requiredTravelPacks <= remainingTravelPacks;
		const remainingAfterLeg = canConsume ? remainingTravelPacks - requiredTravelPacks : remainingTravelPacks;
		if (decision.distanceKm != null) totalDistanceKm += decision.distanceKm;
		if (canConsume) totalRequiredTravelPacks += requiredTravelPacks;
		if (!canConsume && blockedAtLegIndex === null) blockedAtLegIndex = index;
		plannedLegs.push(Object.freeze({ index, originId: String(leg?.originId ?? '').trim() || null, destinationId: decision.destinationId, distanceKm: decision.distanceKm, allowed: canConsume, reasons: decision.reasons, requiredTravelPacks, remainingTravelPacksBefore: remainingTravelPacks, remainingTravelPacksAfter: remainingAfterLeg }));
		if (!canConsume) break;
		remainingTravelPacks = remainingAfterLeg;
	}
	const complete = blockedAtLegIndex === null && plannedLegs.length === authoredLegs.length && authoredLegs.length > 0;
	return Object.freeze({ status: complete ? 'ready' : 'blocked', complete, plannedLegCount: plannedLegs.length, authoredLegCount: authoredLegs.length, blockedAtLegIndex, totalDistanceKm: Number(totalDistanceKm.toFixed(2)), totalRequiredTravelPacks, startingTravelPacks: Math.max(0, Math.floor(Number(readiness?.travelCapacity?.travelRationPacks) || 0)), remainingTravelPacks, legs: Object.freeze(plannedLegs) });
}

export function buildExpeditionJourneyText(plan = evaluateExpeditionJourney()) {
	const lines = ['Sefer Rotası'];
	if (!Array.isArray(plan.legs) || plan.legs.length === 0) return [...lines, 'Henüz rota planlanmadı.'].join('\n');
	lines.push(`Toplam: ${plan.totalDistanceKm} km · ${plan.totalRequiredTravelPacks} yol azığı`);
	for (const leg of plan.legs) {
		const origin = leg.originId ? `${leg.originId} → ` : '';
		const status = leg.allowed ? 'HAZIR' : 'KİLİTLİ';
		const packText = leg.requiredTravelPacks > 0 ? ` · ${leg.requiredTravelPacks} azık` : ' · acil menzil';
		lines.push(`${leg.index + 1}. ${origin}${leg.destinationId ?? 'hedefsiz'} · ${leg.distanceKm ?? '?'} km · ${status}${packText}`);
		if (!leg.allowed && leg.reasons?.length) lines.push(`   Engel: ${leg.reasons.map((reason) => FAST_TRAVEL_REASON_LABEL[reason] ?? reason).join(', ')}`);
	}
	lines.push(plan.complete ? `Rota hazır · kalan yol azığı: ${plan.remainingTravelPacks}` : `Rota tamamlanamadı · ${Number(plan.blockedAtLegIndex) + 1}. etapta durdu`);
	return lines.join('\n');
}

export function rankExpeditionJourneyOptions(snapshotOrReadiness = {}, options = []) {
	const ranked = (Array.isArray(options) ? options : []).map((option, index) => {
		const id = String(option?.id ?? `route-${index + 1}`).trim() || `route-${index + 1}`;
		const label = String(option?.label ?? id).trim() || id;
		const plan = evaluateExpeditionJourney(snapshotOrReadiness, option?.legs);
		return Object.freeze({ id, label, index, plan, complete: plan.complete, totalRequiredTravelPacks: plan.totalRequiredTravelPacks, totalDistanceKm: plan.totalDistanceKm, legCount: plan.authoredLegCount });
	});
	ranked.sort((a, b) => Number(b.complete) - Number(a.complete) || a.totalRequiredTravelPacks - b.totalRequiredTravelPacks || a.totalDistanceKm - b.totalDistanceKm || a.legCount - b.legCount || a.id.localeCompare(b.id));
	return Object.freeze({ preferredRouteId: ranked[0]?.complete ? ranked[0].id : null, preferred: ranked[0]?.complete ? ranked[0] : null, options: Object.freeze(ranked) });
}

export function buildExpeditionJourneyOptionsText(result = rankExpeditionJourneyOptions()) {
	const lines = ['Rota Seçimi'];
	if (!result.options?.length) return [...lines, 'Karşılaştırılacak rota yok.'].join('\n');
	for (const [index, entry] of result.options.entries()) {
		const marker = entry.id === result.preferredRouteId ? 'ÖNERİ' : 'ADAY';
		const status = entry.complete ? 'HAZIR' : 'KİLİTLİ';
		lines.push(`${index + 1}. ${entry.label} · ${marker} · ${status} · ${entry.totalDistanceKm} km · ${entry.totalRequiredTravelPacks} azık`);
	}
	if (result.preferred) lines.push(`Önerilen rota: ${result.preferred.label}`);
	else lines.push('Uygun rota bulunamadı.');
	return lines.join('\n');
}

export const JOURNEY_REST_POLICY = Object.freeze({ BASE_FATIGUE_CAPACITY_KM: 24, FIELD_KIT_BONUS_KM: 12, TRAVEL_PACK_BUFFER_KM: 4, MAX_CONTINUOUS_DISTANCE_KM: 52, TAVERN_RECOVERY_RATIO: 1, CAMP_RECOVERY_RATIO: 0.55 });
export const REST_KIND = Object.freeze({ TAVERN: 'tavern', CAMP: 'camp' });
export const JOURNEY_REST_BLOCK_REASON = Object.freeze({ NO_REST_SITE: 'no-rest-site', REST_SITE_CLOSED: 'rest-site-closed', TAVERN_NOT_DISCOVERED: 'tavern-not-discovered', CAMP_CAPABILITY_REQUIRED: 'camp-capability-required', COMBAT_ACTIVE: 'combat-active', NO_FATIGUE_TO_RECOVER: 'no-fatigue-to-recover', CONTINUOUS_TRAVEL_EXHAUSTED: 'continuous-travel-exhausted' });
const JOURNEY_REST_REASON_LABEL = Object.freeze({
	[JOURNEY_REST_BLOCK_REASON.NO_REST_SITE]: 'dinlenme noktası seçilmedi',
	[JOURNEY_REST_BLOCK_REASON.REST_SITE_CLOSED]: 'dinlenme noktası kapalı',
	[JOURNEY_REST_BLOCK_REASON.TAVERN_NOT_DISCOVERED]: 'taverna henüz keşfedilmedi',
	[JOURNEY_REST_BLOCK_REASON.CAMP_CAPABILITY_REQUIRED]: 'kamp erzağı hazırlığı gerekli',
	[JOURNEY_REST_BLOCK_REASON.COMBAT_ACTIVE]: 'çatışma sürüyor',
	[JOURNEY_REST_BLOCK_REASON.NO_FATIGUE_TO_RECOVER]: 'dinlenme gerektirecek yorgunluk yok',
	[JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED]: 'kesintisiz seyahat dayanıklılığı aşıldı',
});
function normalizeJourneyDistance(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0; }
export function evaluateJourneyEndurance(snapshotOrReadiness = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined ? snapshotOrReadiness : evaluateFieldReadiness(snapshotOrReadiness);
	const travelPacks = Math.max(0, Math.floor(Number(readiness?.travelCapacity?.travelRationPacks) || 0));
	const fieldKitBonusKm = readiness?.capabilities?.survivalBuffer === true ? JOURNEY_REST_POLICY.FIELD_KIT_BONUS_KM : 0;
	const rationBufferKm = Math.min(16, travelPacks * JOURNEY_REST_POLICY.TRAVEL_PACK_BUFFER_KM);
	return Object.freeze({ continuousDistanceKm: Math.min(JOURNEY_REST_POLICY.MAX_CONTINUOUS_DISTANCE_KM, JOURNEY_REST_POLICY.BASE_FATIGUE_CAPACITY_KM + fieldKitBonusKm + rationBufferKm), baseDistanceKm: JOURNEY_REST_POLICY.BASE_FATIGUE_CAPACITY_KM, fieldKitBonusKm, rationBufferKm, travelRationPacks: travelPacks, readinessTier: readiness?.tier ?? FIELD_READINESS_TIER.UNPREPARED });
}
export function evaluateRestRequest(snapshotOrReadiness = {}, context = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined ? snapshotOrReadiness : evaluateFieldReadiness(snapshotOrReadiness);
	const kind = context?.kind === REST_KIND.CAMP ? REST_KIND.CAMP : REST_KIND.TAVERN;
	const siteId = String(context?.siteId ?? '').trim();
	const fatigueKm = normalizeJourneyDistance(context?.fatigueKm);
	const reasons = [];
	if (!siteId) reasons.push(JOURNEY_REST_BLOCK_REASON.NO_REST_SITE);
	if (context?.open === false) reasons.push(JOURNEY_REST_BLOCK_REASON.REST_SITE_CLOSED);
	if (kind === REST_KIND.TAVERN && siteId && context?.discovered !== true) reasons.push(JOURNEY_REST_BLOCK_REASON.TAVERN_NOT_DISCOVERED);
	if (kind === REST_KIND.CAMP && readiness?.capabilities?.campProvisioning !== true) reasons.push(JOURNEY_REST_BLOCK_REASON.CAMP_CAPABILITY_REQUIRED);
	if (context?.inCombat === true) reasons.push(JOURNEY_REST_BLOCK_REASON.COMBAT_ACTIVE);
	if (fatigueKm <= 0) reasons.push(JOURNEY_REST_BLOCK_REASON.NO_FATIGUE_TO_RECOVER);
	const recoveryRatio = kind === REST_KIND.TAVERN ? JOURNEY_REST_POLICY.TAVERN_RECOVERY_RATIO : JOURNEY_REST_POLICY.CAMP_RECOVERY_RATIO;
	const recoveredFatigueKm = reasons.length === 0 ? Number((fatigueKm * recoveryRatio).toFixed(2)) : 0;
	return Object.freeze({ allowed: reasons.length === 0, status: reasons.length === 0 ? 'ready' : 'blocked', kind, siteId: siteId || null, fatigueKm, recoveredFatigueKm, remainingFatigueKm: Number(Math.max(0, fatigueKm - recoveredFatigueKm).toFixed(2)), recoveryRatio, reasons: Object.freeze(reasons) });
}
export function evaluateJourneyWithRestStops(snapshotOrReadiness = {}, steps = []) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined ? snapshotOrReadiness : evaluateFieldReadiness(snapshotOrReadiness);
	const endurance = evaluateJourneyEndurance(readiness);
	const authoredSteps = Array.isArray(steps) ? steps : [];
	let fatigueKm = 0;
	let totalDistanceKm = 0;
	let blockedAtStepIndex = null;
	const plannedSteps = [];
	for (let index = 0; index < authoredSteps.length; index += 1) {
		const step = authoredSteps[index] ?? {};
		if (step.type === 'rest') {
			const decision = evaluateRestRequest(readiness, { ...step, fatigueKm });
			plannedSteps.push(Object.freeze({ index, type: 'rest', allowed: decision.allowed, decision, fatigueBeforeKm: fatigueKm, fatigueAfterKm: decision.allowed ? decision.remainingFatigueKm : fatigueKm }));
			if (!decision.allowed) { blockedAtStepIndex = index; break; }
			fatigueKm = decision.remainingFatigueKm;
			continue;
		}
		const travel = evaluateFastTravelRequest(readiness, step);
		const distanceKm = normalizeJourneyDistance(travel.distanceKm);
		const projectedFatigueKm = Number((fatigueKm + distanceKm).toFixed(2));
		const reasons = [...travel.reasons];
		if (travel.allowed && projectedFatigueKm > endurance.continuousDistanceKm) reasons.push(JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED);
		const allowed = reasons.length === 0;
		plannedSteps.push(Object.freeze({ index, type: 'travel', allowed, destinationId: travel.destinationId, distanceKm, fatigueBeforeKm: fatigueKm, fatigueAfterKm: allowed ? projectedFatigueKm : fatigueKm, enduranceLimitKm: endurance.continuousDistanceKm, reasons: Object.freeze(reasons) }));
		if (!allowed) { blockedAtStepIndex = index; break; }
		fatigueKm = projectedFatigueKm;
		totalDistanceKm += distanceKm;
	}
	const complete = blockedAtStepIndex === null && plannedSteps.length === authoredSteps.length && authoredSteps.length > 0;
	return Object.freeze({ status: complete ? 'ready' : 'blocked', complete, blockedAtStepIndex, authoredStepCount: authoredSteps.length, plannedStepCount: plannedSteps.length, totalDistanceKm: Number(totalDistanceKm.toFixed(2)), finalFatigueKm: Number(fatigueKm.toFixed(2)), endurance, steps: Object.freeze(plannedSteps) });
}
export function buildJourneyRestText(plan = evaluateJourneyWithRestStops()) {
	const lines = ['Sefer Dinlenme Planı'];
	if (!plan.steps?.length) return [...lines, 'Henüz seyahat veya dinlenme adımı yok.'].join('\n');
	lines.push(`Kesintisiz dayanıklılık: ${plan.endurance.continuousDistanceKm} km`);
	for (const step of plan.steps) {
		if (step.type === 'rest') {
			lines.push(`${step.index + 1}. ${step.decision.kind === REST_KIND.TAVERN ? 'Taverna' : 'Kamp'} · ${step.decision.siteId ?? 'hedefsiz'} · ${step.allowed ? 'DİNLENDİ' : 'KİLİTLİ'} · yorgunluk ${step.fatigueBeforeKm}→${step.fatigueAfterKm} km`);
			if (!step.allowed) lines.push(`   Engel: ${step.decision.reasons.map((reason) => JOURNEY_REST_REASON_LABEL[reason] ?? reason).join(', ')}`);
		} else {
			lines.push(`${step.index + 1}. Seyahat · ${step.destinationId ?? 'hedefsiz'} · ${step.distanceKm} km · ${step.allowed ? 'HAZIR' : 'KİLİTLİ'} · yorgunluk ${step.fatigueBeforeKm}→${step.fatigueAfterKm} km`);
			if (!step.allowed && step.reasons?.length) lines.push(`   Engel: ${step.reasons.map((reason) => JOURNEY_REST_REASON_LABEL[reason] ?? FAST_TRAVEL_REASON_LABEL[reason] ?? reason).join(', ')}`);
		}
	}
	lines.push(plan.complete ? `Plan hazır · son yorgunluk: ${plan.finalFatigueKm} km` : `Plan tamamlanamadı · ${Number(plan.blockedAtStepIndex) + 1}. adımda durdu`);
	return lines.join('\n');
}
