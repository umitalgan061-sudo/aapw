/**
 * `INTERACTION_CONFIG` (FAZ 5 dialogue) — proximity affordance + dialogue content, see
 * `gameplay/interaction.js`. Split out of `gameplay/gameplayConfig.js` (run 77, DECISIONS.md
 * ADR-0100) once that file reached 597/600 lines — see `playerConfig.js`'s header for the full
 * split rationale/precedent. `gameplayConfig.js` re-exports this unchanged, so no importer of
 * `INTERACTION_CONFIG` needed to change.
 * @module gameplay/interactionConfig
 */

import { CHOICES_BY_NPC_ID } from './dialogueChoices.js';
import {
	FAST_TRAVEL_BLOCK_REASON,
	buildFieldReadinessText,
	evaluateExpeditionRoutePlan,
	evaluateFieldReadiness,
	evaluateJourneyEndurance,
	evaluateJourneyWithRestStops,
} from './interactionFieldReadiness.js';

/** Dragonstone watch outcome values shared by quest definitions and the interaction adapter. */
export const WATCH_POLICY = Object.freeze({
	DISCIPLINE: 'discipline',
	MERCY: 'mercy',
});

export const INTERACTION_JOURNEY_POLICY = Object.freeze({ MAX_FATIGUE_KM: 52, MAX_COMMIT_COUNT: 1_000_000, MAX_RECENT_RECEIPTS: 5 });

/** Compact travel-survival state kept inside the existing interaction RPG owner. */
export function createInteractionJourneyState() {
	let fatigueKm = 0;
	let commitCount = 0;
	let lastDestinationId = null;
	let recentReceipts = [];
	function normalizeFatigue(value) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? Math.min(INTERACTION_JOURNEY_POLICY.MAX_FATIGUE_KM, Number(parsed.toFixed(2))) : 0;
	}
	function normalizeDistance(value) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
	}
	function normalizeCount(value, max = INTERACTION_JOURNEY_POLICY.MAX_COMMIT_COUNT) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? Math.min(max, Math.floor(parsed)) : 0;
	}
	function sanitizeReceipt(receipt) {
		if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
		const sequence = normalizeCount(receipt.sequence);
		if (sequence <= 0) return null;
		return {
			sequence,
			totalDistanceKm: normalizeDistance(receipt.totalDistanceKm),
			consumedTravelPacks: normalizeCount(receipt.consumedTravelPacks, 100),
			finalFatigueKm: normalizeFatigue(receipt.finalFatigueKm),
			destinationId: String(receipt.destinationId ?? '').trim() || null,
			restStopCount: normalizeCount(receipt.restStopCount, 100),
		};
	}
	function snapshot() { return { fatigueKm, commitCount, lastDestinationId, recentReceipts: recentReceipts.map((receipt) => ({ ...receipt })) }; }
	function restore(saved) {
		fatigueKm = normalizeFatigue(saved?.fatigueKm);
		commitCount = normalizeCount(saved?.commitCount);
		lastDestinationId = String(saved?.lastDestinationId ?? '').trim() || null;
		recentReceipts = (Array.isArray(saved?.recentReceipts) ? saved.recentReceipts : [])
			.map(sanitizeReceipt)
			.filter((receipt) => receipt && receipt.sequence <= commitCount)
			.slice(-INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS);
	}
	function applyCommit(result) {
		if (result?.ok !== true || result?.plan?.complete !== true) return false;
		fatigueKm = normalizeFatigue(result.plan.finalFatigueKm);
		commitCount = Math.min(INTERACTION_JOURNEY_POLICY.MAX_COMMIT_COUNT, commitCount + 1);
		const travelSteps = result.plan.steps?.filter((step) => step.type === 'travel' && step.allowed) ?? [];
		const restSteps = result.plan.steps?.filter((step) => step.type === 'rest' && step.allowed) ?? [];
		lastDestinationId = travelSteps.at(-1)?.destinationId ?? lastDestinationId;
		recentReceipts.push({ sequence: commitCount, totalDistanceKm: normalizeDistance(result.plan.totalDistanceKm), consumedTravelPacks: normalizeCount(result.consumedQuantity, 100), finalFatigueKm: fatigueKm, destinationId: lastDestinationId, restStopCount: restSteps.length });
		recentReceipts = recentReceipts.slice(-INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS);
		return true;
	}
	function applyRecovery(result) {
		if (result?.ok !== true || result?.plan?.complete !== true) return false;
		const plannedSteps = Array.isArray(result.plan.steps) ? result.plan.steps : [];
		const startingFatigueKm = normalizeFatigue(result.plan.startingFatigueKm);
		const nextFatigueKm = normalizeFatigue(result.plan.finalFatigueKm);
		if (plannedSteps.length === 0 || plannedSteps.some((step) => step.type !== 'rest' || step.allowed !== true)) return false;
		if (normalizeDistance(result.plan.totalDistanceKm) !== 0 || startingFatigueKm !== fatigueKm || nextFatigueKm >= fatigueKm) return false;
		fatigueKm = nextFatigueKm;
		return true;
	}
	return { snapshot, restore, applyCommit, applyRecovery };
}

export function buildJourneyStateText(journey = {}, readiness = {}) {
	const fatigueKm = Math.max(0, Math.min(INTERACTION_JOURNEY_POLICY.MAX_FATIGUE_KM, Number(journey?.fatigueKm) || 0));
	const enduranceLimitKm = evaluateJourneyEndurance(readiness).continuousDistanceKm;
	const remainingEnduranceKm = Number(Math.max(0, enduranceLimitKm - fatigueKm).toFixed(2));
	const lines = [`Sefer yorgunluğu: ${Number(fatigueKm.toFixed(2))}/${enduranceLimitKm} km`, `Kesintisiz kalan dayanıklılık: ${remainingEnduranceKm} km`];
	if (journey?.lastDestinationId) lines.push(`Son sefer hedefi: ${journey.lastDestinationId}`);
	const lastReceipt = Array.isArray(journey?.recentReceipts) ? journey.recentReceipts.at(-1) : null;
	if (lastReceipt) lines.push(`Son sefer: ${lastReceipt.totalDistanceKm} km · ${lastReceipt.consumedTravelPacks} yol azığı · ${lastReceipt.restStopCount} dinlenme`);
	return lines.join('\n');
}

export const INTERACTION_ITEMS = Object.freeze({
	'dragonstone-watch-seal': Object.freeze({
		id: 'dragonstone-watch-seal',
		name: 'Dragonstone Nöbet Mührü',
		rarity: 'uncommon',
		weightKg: 0.15,
		stackLimit: 1,
	}),
	'watch-captains-writ': Object.freeze({
		id: 'watch-captains-writ',
		name: 'Nöbet Kaptanının Buyruğu',
		rarity: 'rare',
		weightKg: 0.05,
		stackLimit: 1,
	}),
	'dragonstone-field-ration': Object.freeze({
		id: 'dragonstone-field-ration',
		name: 'Dragonstone Saha Azığı',
		rarity: 'common',
		weightKg: 0.35,
		stackLimit: 5,
	}),
	'dragonstone-travel-ration-pack': Object.freeze({
		id: 'dragonstone-travel-ration-pack',
		name: 'Dragonstone Yol Azığı Paketi',
		rarity: 'uncommon',
		weightKg: 0.6,
		stackLimit: 2,
	}),
	'dragonstone-whetstone': Object.freeze({
		id: 'dragonstone-whetstone',
		name: 'Nöbetçi Bileği Taşı',
		rarity: 'common',
		weightKg: 0.4,
		stackLimit: 3,
	}),
	'dragonstone-expedition-maintenance-kit': Object.freeze({
		id: 'dragonstone-expedition-maintenance-kit',
		name: 'Dragonstone Sefer Bakım Kiti',
		rarity: 'rare',
		weightKg: 0.85,
		stackLimit: 1,
	}),
});

/** Compact inventory state for interaction-owned quest rewards and settlement purchases/crafting. */
export function createInteractionInventoryState() {
	const entries = new Map();

	function quantityOf(itemId) {
		return entries.get(itemId)?.quantity ?? 0;
	}

	function canGrant(itemId, quantity = 1) {
		const item = INTERACTION_ITEMS[itemId];
		const amount = Math.max(0, Math.floor(Number(quantity) || 0));
		return Boolean(item && amount > 0 && quantityOf(itemId) + amount <= item.stackLimit);
	}

	function consume(itemId, quantity = 1) {
		const amount = Math.max(0, Math.floor(Number(quantity) || 0));
		const current = entries.get(itemId);
		if (!current || amount === 0 || current.quantity < amount) return false;
		const nextQuantity = current.quantity - amount;
		if (nextQuantity === 0) entries.delete(itemId);
		else entries.set(itemId, { quantity: nextQuantity, provenance: [...current.provenance] });
		return true;
	}

	function normalizeCraftInputs(upgrade) {
		const authoredInputs = Array.isArray(upgrade?.inputs) && upgrade.inputs.length > 0
			? upgrade.inputs
			: [{ itemId: upgrade?.inputItemId, quantity: upgrade?.inputQuantity }];
		const requiredByItem = new Map();
		for (const input of authoredInputs) {
			const itemId = String(input?.itemId ?? '');
			const quantity = Math.max(1, Math.floor(Number(input?.quantity) || 1));
			if (!INTERACTION_ITEMS[itemId]) return null;
			requiredByItem.set(itemId, (requiredByItem.get(itemId) ?? 0) + quantity);
		}
		return [...requiredByItem.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
	}

	function tryCraftUpgrade(upgrade, provenance) {
		if (!upgrade || typeof upgrade !== 'object') return null;
		const outputItemId = String(upgrade.outputItemId ?? '');
		const outputQuantity = Math.max(1, Math.floor(Number(upgrade.outputQuantity) || 1));
		const inputs = normalizeCraftInputs(upgrade);
		if (!inputs || !INTERACTION_ITEMS[outputItemId]) return { ok: false, reason: 'invalid-craft-recipe' };
		if (inputs.some((input) => quantityOf(input.itemId) < input.quantity)) return { ok: false, reason: 'craft-input-missing' };
		if (!canGrant(outputItemId, outputQuantity)) return { ok: false, reason: 'craft-output-full' };
		const before = snapshot();
		for (const input of inputs) {
			if (consume(input.itemId, input.quantity)) continue;
			restore(before);
			return { ok: false, reason: 'craft-input-race' };
		}
		const crafted = grant(outputItemId, outputQuantity, {
			sourceType: 'settlement-crafting',
			sourceId: String(upgrade.recipeId ?? provenance?.sourceId ?? 'interaction-crafting'),
		});
		if (!crafted) {
			restore(before);
			throw new Error('Atomic crafting invariant violated after validated output capacity');
		}
		const result = {
			ok: true,
			crafted: true,
			outputItemId,
			outputQuantity,
			consumedItems: inputs.map((input) => ({ ...input })),
		};
		if (inputs.length === 1) {
			result.consumedItemId = inputs[0].itemId;
			result.consumedQuantity = inputs[0].quantity;
		}
		return result;
	}

	function grant(itemId, quantity = 1, provenance = null) {
		const item = INTERACTION_ITEMS[itemId];
		const amount = Math.max(0, Math.floor(Number(quantity) || 0));
		if (!item || amount === 0) return false;
		const craftResult = tryCraftUpgrade(provenance?.craftUpgrade, provenance);
		if (craftResult) return craftResult;
		const current = entries.get(itemId) ?? { quantity: 0, provenance: [] };
		const nextQuantity = Math.min(item.stackLimit, current.quantity + amount);
		if (nextQuantity === current.quantity) return false;
		const next = { quantity: nextQuantity, provenance: [...current.provenance] };
		if (provenance?.sourceType && provenance?.sourceId) {
			next.provenance.push({ sourceType: String(provenance.sourceType), sourceId: String(provenance.sourceId) });
		}
		entries.set(itemId, next);
		return true;
	}

	function snapshot() {
		const items = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([itemId, state]) => {
			const item = INTERACTION_ITEMS[itemId];
			return {
				itemId,
				name: item.name,
				rarity: item.rarity,
				weightKg: item.weightKg,
				quantity: state.quantity,
				provenance: state.provenance.map((entry) => ({ ...entry })),
			};
		});
		const totalWeightKg = items.reduce((sum, item) => sum + item.weightKg * item.quantity, 0);
		const base = { totalWeightKg: Number(totalWeightKg.toFixed(2)), items };
		return { ...base, fieldReadiness: evaluateFieldReadiness(base) };
	}

	function consumeFastTravelProvisions(context = {}) {
		const before = snapshot();
		const readiness = before.fieldReadiness ?? evaluateFieldReadiness(before);
		if (!readiness.capabilities.fastTravelEligible) {
			return { ok: false, reason: FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED, routePlan: evaluateExpeditionRoutePlan(readiness, context) };
		}
		const routePlan = evaluateExpeditionRoutePlan(readiness, context);
		if (!routePlan.withinRange) {
			return { ok: false, reason: FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS, routePlan };
		}
		const quantity = routePlan.requiredTravelPacks;
		if (quantity <= 0) return { ok: true, consumedItemId: null, consumedQuantity: 0, routePlan, inventory: before };
		if (!consume('dragonstone-travel-ration-pack', quantity)) {
			restore(before);
			return { ok: false, reason: 'provision-consume-race', routePlan };
		}
		return {
			ok: true,
			consumedItemId: 'dragonstone-travel-ration-pack',
			consumedQuantity: quantity,
			routePlan,
			inventory: snapshot(),
		};
	}

	function commitJourneyWithRestStops(steps = [], context = {}) {
		const authoredSteps = Array.isArray(steps) ? steps : [];
		const before = snapshot();
		const plan = evaluateJourneyWithRestStops(before.fieldReadiness ?? before, authoredSteps, context);
		if (!plan.complete) {
			const blocked = plan.steps?.find((step) => step.index === plan.blockedAtStepIndex) ?? null;
			const reasons = blocked?.type === 'rest' ? blocked?.decision?.reasons : blocked?.reasons;
			return { ok: false, reason: reasons?.[0] ?? 'journey-blocked', blockedAtStepIndex: plan.blockedAtStepIndex, consumedItemId: null, consumedQuantity: 0, plan, inventory: before };
		}
		let consumedQuantity = 0;
		for (const plannedStep of plan.steps) {
			if (plannedStep.type !== 'travel') continue;
			const result = consumeFastTravelProvisions(authoredSteps[plannedStep.index] ?? {});
			if (!result.ok) {
				restore(before);
				return { ok: false, reason: result.reason ?? 'journey-commit-race', blockedAtStepIndex: plannedStep.index, consumedItemId: null, consumedQuantity: 0, plan, inventory: snapshot() };
			}
			consumedQuantity += Math.max(0, Math.floor(Number(result.consumedQuantity) || 0));
		}
		const expectedConsumption = Math.max(0, plan.startingTravelPacks - plan.remainingTravelPacks);
		if (consumedQuantity !== expectedConsumption) {
			restore(before);
			return { ok: false, reason: 'journey-consumption-invariant', blockedAtStepIndex: null, consumedItemId: null, consumedQuantity: 0, plan, inventory: snapshot() };
		}
		return { ok: true, reason: 'committed', blockedAtStepIndex: null, consumedItemId: consumedQuantity > 0 ? 'dragonstone-travel-ration-pack' : null, consumedQuantity, plan, inventory: snapshot() };
	}

	function restore(saved) {
		entries.clear();
		for (const savedItem of Array.isArray(saved?.items) ? saved.items : []) {
			const item = INTERACTION_ITEMS[savedItem?.itemId];
			if (!item) continue;
			const quantity = Math.min(item.stackLimit, Math.max(0, Math.floor(Number(savedItem.quantity) || 0)));
			if (quantity === 0) continue;
			const provenance = (Array.isArray(savedItem.provenance) ? savedItem.provenance : [])
				.filter((entry) => entry?.sourceType && entry?.sourceId)
				.map((entry) => ({ sourceType: String(entry.sourceType), sourceId: String(entry.sourceId) }));
			entries.set(item.id, { quantity, provenance });
		}
	}

	return { grant, quantityOf, consume, consumeFastTravelProvisions, commitJourneyWithRestStops, snapshot, restore };
}

export function buildInventoryText(snapshot = {}, journey = null) {
	const items = Array.isArray(snapshot.items) ? snapshot.items : [];
	const readiness = snapshot?.fieldReadiness?.tier ? snapshot.fieldReadiness : evaluateFieldReadiness(snapshot);
	const lines = ['Envanter', `Toplam ağırlık: ${Number(snapshot.totalWeightKg) || 0} kg`, ...buildFieldReadinessText(readiness).split('\n')];
	if (journey) lines.push(...buildJourneyStateText(journey, readiness).split('\n'));
	if (items.length === 0) return [...lines, 'Henüz eşya yok.'].join('\n');
	for (const item of items) {
		const origin = item.provenance?.at(-1);
		const source = origin ? ` · Kaynak: ${origin.sourceType}/${origin.sourceId}` : '';
		lines.push(`${item.name} ×${item.quantity} · ${item.rarity} · ${item.weightKg} kg${source}`);
	}
	return lines.join('\n');
}

/** FAZ 5 (run 32-33, per-NPC content run 40): `ui/interactionPrompt.js` shows a proximity
 * *affordance* ("E - Selamla") when the player is near any NPC; pressing E while it's showing opens
 * `ui/dialogueBox.js` with that NPC's own greeting — see DECISIONS.md ADR-0033 (the open/close
 * mechanism) and ADR-0051 (real per-NPC content, replacing the single generic line every NPC used
 * to share). */
export const INTERACTION_CONFIG = Object.freeze({
	PROMPT_RADIUS_METERS: 6,
	GREETING_TEMPLATE: '{name}: Uzak yollardan mı geliyorsun, yabancı?',
	GREETINGS_BY_NPC_ID: Object.freeze({
		'stannis-guard-1': '{name}: Kral Stannis\'in adaleti bu topraklarda hüküm sürer. İşin nedir, yabancı? Levazım için yakındayken B tuşuna bas.',
		'stannis-guard-2': '{name}: İkinci nöbetçi benim, gözüm hep tepede. Sakin dur, seni izliyorum.',
		'umit-guard-1': '{name}: Ümit Targeryan\'ın kalesine hoş geldin! Ejderha kanı bu surlarda hâlâ akar derler.',
		'cersei-guard-1': '{name}: Bir Lannister borcunu öder. Sen de saygını göster, yeter.',
		'berkalp-guard-1': '{name}: Kışın geldiğini unutma, yolcu. Kuzeyde sözler boşa verilmez.',
		'doran-guard-1': '{name}: Dorne asla dize gelmedi. Burada da eğilmeyeceğiz.',
		'ziya-guard-1': '{name}: Büyüyen güç bizimdir. Ziya Hanım\'ın bahçeleri seni bekliyor olabilir.',
		'balon-guard-1': '{name}: Biz tohum ekmeyiz, biçeriz. Demir Adalar\'da hoş karşılanmak kolay değildir.',
		'robin-guard-1': '{name}: Yükseklik güçtür, yabancı. Arryn\'in kartalları her şeyi görür.',
		'jon-guard-1': '{name}: Gece Nöbeti sınırdadır. Duvar\'ın ötesinde ne olduğunu bilmek istemezsin.',
		'xaro-guard-1': '{name}: Qarth\'ın on üç kapısı vardır, ama sana yalnızca biri açık, yabancı.',
		'berk-guard-1': '{name}: Berk Bey\'in toprakları verimlidir, ama misafirperverliğimiz sınırsız değildir.',
		'olena-guard-1': '{name}: Olena Hanım keskin dilinden ödün vermez. Sözlerine dikkat et.',
		'twin-guard-1': '{name}: İkiz Kuleler\'in gölgesinde yürüyorsun. Burada her adım izlenir.',
	}),
	CHOICES_BY_NPC_ID,
});