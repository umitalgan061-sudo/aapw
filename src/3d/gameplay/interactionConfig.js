/**
 * `INTERACTION_CONFIG` (FAZ 5 dialogue) — proximity affordance + dialogue content, see
 * `gameplay/interaction.js`. Split out of `gameplay/gameplayConfig.js` (run 77, DECISIONS.md
 * ADR-0100) once that file reached 597/600 lines — see `playerConfig.js`'s header for the full
 * split rationale/precedent. `gameplayConfig.js` re-exports this unchanged, so no importer of
 * `INTERACTION_CONFIG` needed to change.
 * @module gameplay/interactionConfig
 */

import { CHOICES_BY_NPC_ID } from './dialogueChoices.js';

/** Dragonstone watch outcome values shared by quest definitions and the interaction adapter. */
export const WATCH_POLICY = Object.freeze({
	DISCIPLINE: 'discipline',
	MERCY: 'mercy',
});

/** Small serializable world-state owner for the shipped Dragonstone watch consequence. */
export function createWatchWorldState() {
	const values = { dragonstoneWatchPolicy: null };

	function set(key, value) {
		if (key !== 'dragonstoneWatchPolicy') return false;
		if (![null, WATCH_POLICY.DISCIPLINE, WATCH_POLICY.MERCY].includes(value)) return false;
		values[key] = value;
		return true;
	}

	function get(key) {
		return values[key] ?? null;
	}

	function snapshot() {
		return { ...values };
	}

	function restore(saved) {
		values.dragonstoneWatchPolicy = null;
		if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
		set('dragonstoneWatchPolicy', saved.dragonstoneWatchPolicy ?? null);
	}

	return { get, set, snapshot, restore };
}

export function watchPolicyLabel(policy) {
	if (policy === WATCH_POLICY.MERCY) return 'İkinci şans';
	if (policy === WATCH_POLICY.DISCIPLINE) return 'Sıkı disiplin';
	return null;
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
		if (!inputs || !INTERACTION_ITEMS[outputItemId]) return null;
		if (inputs.some((input) => quantityOf(input.itemId) < input.quantity)) return null;
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
		return { totalWeightKg: Number(totalWeightKg.toFixed(2)), items };
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

	return { grant, quantityOf, consume, snapshot, restore };
}

export function buildInventoryText(snapshot = {}) {
	const items = Array.isArray(snapshot.items) ? snapshot.items : [];
	const lines = ['Envanter', `Toplam ağırlık: ${Number(snapshot.totalWeightKg) || 0} kg`];
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