/**
 * Tavern/rest recovery policy for the interaction-owned expedition planner.
 *
 * The planner owns no clock, settlement, health, inventory or save store. It consumes the existing
 * expedition readiness snapshot plus authored route/rest contexts and returns deterministic decisions
 * that settlement/tavern UI can commit through their existing owners.
 */
import { evaluateFieldReadiness, evaluateFastTravelRequest } from './interactionFieldReadiness.js';

export const JOURNEY_REST_POLICY = Object.freeze({
	BASE_FATIGUE_CAPACITY_KM: 24,
	FIELD_KIT_BONUS_KM: 12,
	TRAVEL_PACK_BUFFER_KM: 4,
	MAX_CONTINUOUS_DISTANCE_KM: 52,
	TAVERN_RECOVERY_RATIO: 1,
	CAMP_RECOVERY_RATIO: 0.55,
});

export const REST_KIND = Object.freeze({
	TAVERN: 'tavern',
	CAMP: 'camp',
});

export const JOURNEY_REST_BLOCK_REASON = Object.freeze({
	NO_REST_SITE: 'no-rest-site',
	REST_SITE_CLOSED: 'rest-site-closed',
	TAVERN_NOT_DISCOVERED: 'tavern-not-discovered',
	CAMP_CAPABILITY_REQUIRED: 'camp-capability-required',
	COMBAT_ACTIVE: 'combat-active',
	NO_FATIGUE_TO_RECOVER: 'no-fatigue-to-recover',
	CONTINUOUS_TRAVEL_EXHAUSTED: 'continuous-travel-exhausted',
});

const REASON_LABELS = Object.freeze({
	[JOURNEY_REST_BLOCK_REASON.NO_REST_SITE]: 'dinlenme noktası seçilmedi',
	[JOURNEY_REST_BLOCK_REASON.REST_SITE_CLOSED]: 'dinlenme noktası kapalı',
	[JOURNEY_REST_BLOCK_REASON.TAVERN_NOT_DISCOVERED]: 'taverna henüz keşfedilmedi',
	[JOURNEY_REST_BLOCK_REASON.CAMP_CAPABILITY_REQUIRED]: 'kamp erzağı hazırlığı gerekli',
	[JOURNEY_REST_BLOCK_REASON.COMBAT_ACTIVE]: 'çatışma sürüyor',
	[JOURNEY_REST_BLOCK_REASON.NO_FATIGUE_TO_RECOVER]: 'dinlenme gerektirecek yorgunluk yok',
	[JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED]: 'kesintisiz seyahat dayanıklılığı aşıldı',
});

function normalizeDistance(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
}

function normalizeFatigue(value) {
	return Math.max(0, normalizeDistance(value));
}

export function evaluateJourneyEndurance(snapshotOrReadiness = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined
		? snapshotOrReadiness
		: evaluateFieldReadiness(snapshotOrReadiness);
	const travelPacks = Math.max(0, Math.floor(Number(readiness?.travelCapacity?.travelRationPacks) || 0));
	const fieldKitBonus = readiness?.capabilities?.survivalBuffer === true ? JOURNEY_REST_POLICY.FIELD_KIT_BONUS_KM : 0;
	const rationBuffer = Math.min(16, travelPacks * JOURNEY_REST_POLICY.TRAVEL_PACK_BUFFER_KM);
	const continuousDistanceKm = Math.min(
		JOURNEY_REST_POLICY.MAX_CONTINUOUS_DISTANCE_KM,
		JOURNEY_REST_POLICY.BASE_FATIGUE_CAPACITY_KM + fieldKitBonus + rationBuffer,
	);
	return Object.freeze({
		continuousDistanceKm,
		baseDistanceKm: JOURNEY_REST_POLICY.BASE_FATIGUE_CAPACITY_KM,
		fieldKitBonusKm: fieldKitBonus,
		rationBufferKm: rationBuffer,
		travelRationPacks: travelPacks,
		readinessTier: readiness?.tier ?? 'unprepared',
	});
}

export function evaluateRestRequest(snapshotOrReadiness = {}, context = {}) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined
		? snapshotOrReadiness
		: evaluateFieldReadiness(snapshotOrReadiness);
	const kind = context?.kind === REST_KIND.CAMP ? REST_KIND.CAMP : REST_KIND.TAVERN;
	const siteId = String(context?.siteId ?? '').trim();
	const discovered = context?.discovered === true;
	const open = context?.open !== false;
	const inCombat = context?.inCombat === true;
	const fatigueKm = normalizeFatigue(context?.fatigueKm);
	const reasons = [];
	if (!siteId) reasons.push(JOURNEY_REST_BLOCK_REASON.NO_REST_SITE);
	if (!open) reasons.push(JOURNEY_REST_BLOCK_REASON.REST_SITE_CLOSED);
	if (kind === REST_KIND.TAVERN && siteId && !discovered) reasons.push(JOURNEY_REST_BLOCK_REASON.TAVERN_NOT_DISCOVERED);
	if (kind === REST_KIND.CAMP && readiness?.capabilities?.campProvisioning !== true) reasons.push(JOURNEY_REST_BLOCK_REASON.CAMP_CAPABILITY_REQUIRED);
	if (inCombat) reasons.push(JOURNEY_REST_BLOCK_REASON.COMBAT_ACTIVE);
	if (fatigueKm <= 0) reasons.push(JOURNEY_REST_BLOCK_REASON.NO_FATIGUE_TO_RECOVER);
	const recoveryRatio = kind === REST_KIND.TAVERN ? JOURNEY_REST_POLICY.TAVERN_RECOVERY_RATIO : JOURNEY_REST_POLICY.CAMP_RECOVERY_RATIO;
	const recoveredFatigueKm = reasons.length === 0 ? Number((fatigueKm * recoveryRatio).toFixed(2)) : 0;
	const remainingFatigueKm = Number(Math.max(0, fatigueKm - recoveredFatigueKm).toFixed(2));
	return Object.freeze({
		allowed: reasons.length === 0,
		status: reasons.length === 0 ? 'ready' : 'blocked',
		kind,
		siteId: siteId || null,
		fatigueKm,
		recoveredFatigueKm,
		remainingFatigueKm,
		recoveryRatio,
		reasons: Object.freeze(reasons),
	});
}

export function evaluateJourneyWithRestStops(snapshotOrReadiness = {}, steps = []) {
	const readiness = snapshotOrReadiness?.capabilities?.fastTravelEligible !== undefined
		? snapshotOrReadiness
		: evaluateFieldReadiness(snapshotOrReadiness);
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
			if (!decision.allowed) {
				blockedAtStepIndex = index;
				break;
			}
			fatigueKm = decision.remainingFatigueKm;
			continue;
		}
		const travel = evaluateFastTravelRequest(readiness, step);
		const distanceKm = normalizeDistance(travel.distanceKm);
		const projectedFatigueKm = Number((fatigueKm + distanceKm).toFixed(2));
		const enduranceExceeded = projectedFatigueKm > endurance.continuousDistanceKm;
		const reasons = [...travel.reasons];
		if (travel.allowed && enduranceExceeded) reasons.push(JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED);
		const allowed = travel.allowed && !enduranceExceeded;
		plannedSteps.push(Object.freeze({ index, type: 'travel', allowed, destinationId: travel.destinationId, distanceKm, fatigueBeforeKm: fatigueKm, fatigueAfterKm: allowed ? projectedFatigueKm : fatigueKm, enduranceLimitKm: endurance.continuousDistanceKm, reasons: Object.freeze(reasons) }));
		if (!allowed) {
			blockedAtStepIndex = index;
			break;
		}
		fatigueKm = projectedFatigueKm;
		totalDistanceKm += distanceKm;
	}
	const complete = blockedAtStepIndex === null && plannedSteps.length === authoredSteps.length && authoredSteps.length > 0;
	return Object.freeze({
		status: complete ? 'ready' : 'blocked',
		complete,
		blockedAtStepIndex,
		authoredStepCount: authoredSteps.length,
		plannedStepCount: plannedSteps.length,
		totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
		finalFatigueKm: Number(fatigueKm.toFixed(2)),
		endurance,
		steps: Object.freeze(plannedSteps),
	});
}

export function buildJourneyRestText(plan = evaluateJourneyWithRestStops()) {
	const lines = ['Sefer Dinlenme Planı'];
	if (!plan.steps?.length) return [...lines, 'Henüz seyahat veya dinlenme adımı yok.'].join('\n');
	lines.push(`Kesintisiz dayanıklılık: ${plan.endurance.continuousDistanceKm} km`);
	for (const step of plan.steps) {
		if (step.type === 'rest') {
			const status = step.allowed ? 'DİNLENDİ' : 'KİLİTLİ';
			lines.push(`${step.index + 1}. ${step.decision.kind === REST_KIND.TAVERN ? 'Taverna' : 'Kamp'} · ${step.decision.siteId ?? 'hedefsiz'} · ${status} · yorgunluk ${step.fatigueBeforeKm}→${step.fatigueAfterKm} km`);
			if (!step.allowed) lines.push(`   Engel: ${step.decision.reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(', ')}`);
			continue;
		}
		const status = step.allowed ? 'HAZIR' : 'KİLİTLİ';
		lines.push(`${step.index + 1}. Seyahat · ${step.destinationId ?? 'hedefsiz'} · ${step.distanceKm} km · ${status} · yorgunluk ${step.fatigueBeforeKm}→${step.fatigueAfterKm} km`);
		if (!step.allowed && step.reasons?.length) lines.push(`   Engel: ${step.reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(', ')}`);
	}
	lines.push(plan.complete ? `Plan hazır · son yorgunluk: ${plan.finalFatigueKm} km` : `Plan tamamlanamadı · ${Number(plan.blockedAtStepIndex) + 1}. adımda durdu`);
	return lines.join('\n');
}
