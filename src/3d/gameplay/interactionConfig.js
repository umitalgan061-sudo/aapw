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
});

/** Compact inventory state for interaction-owned quest rewards; deterministic provenance, no timestamps. */
export function createInteractionInventoryState() {
	const entries = new Map();

	function grant(itemId, quantity = 1, provenance = null) {
		const item = INTERACTION_ITEMS[itemId];
		const amount = Math.max(0, Math.floor(Number(quantity) || 0));
		if (!item || amount === 0) return false;
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

	return { grant, snapshot, restore };
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
 * to share). Still no branching/replies/quest hooks — one static line per NPC, not a real dialogue
 * tree (see 3D_GAME_PROGRESS.md Known Issues). */
export const INTERACTION_CONFIG = Object.freeze({
	/** Closer than `NPC_CONFIG`'s 12m keep-clearance offset — a "standing right next to them" cue,
	 * not a "somewhere in this courtyard" one. */
	PROMPT_RADIUS_METERS: 6,
	/** Fallback only, for any NPC id not present in `GREETINGS_BY_NPC_ID` below (none today — every
	 * real `NPC_CONFIG.SPAWNS` entry has its own line — but a future spawn added without a matching
	 * entry degrades gracefully instead of showing `undefined`). `{name}` is replaced with the NPC's
	 * `displayName` — see `gameplay/interaction.js`'s `openDialogue`. */
	GREETING_TEMPLATE: '{name}: Uzak yollardan mı geliyorsun, yabancı?',
	/** One hand-written, house-flavored line per `NPC_CONFIG.SPAWNS` entry, keyed by that entry's
	 * `id` (already carried onto `object3D.name` — see `gameplay/npc.js`'s `createNPC`, no new field
	 * needed to look this up). Original writing, not adapted from the show — same "Westeros theme
	 * freely, no real show media" constraint every asset in this project already follows. See
	 * DECISIONS.md ADR-0051 for why per-id (not per-house): `twin-guard-1` and `cersei-guard-1` are
	 * both House Lannister but distinct seats, and reusing one line for both read as less "real"
	 * than the per-house grouping this map still visibly shares (`berk-guard-1`/`olena-guard-1`
	 * intentionally echo `ziya-guard-1`'s Tyrell flavor, same as their shared `displayName` already
	 * does — see ADR-0036). */
	GREETINGS_BY_NPC_ID: Object.freeze({
		'stannis-guard-1': '{name}: Kral Stannis\'in adaleti bu topraklarda hüküm sürer. İşin nedir, yabancı?',
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
	/** FAZ 5's real branching pilot (started run 44, DECISIONS.md ADR-0058; grown through run 50,
	 * DECISIONS.md ADR-0060/0062/0063/0064/0067; content itself moved out to its own file run 50,
	 * DECISIONS.md ADR-0066, once this growth pattern pushed `gameplayConfig.js` to 566/600 lines).
	 * 13 of 14 NPCs get 2 numbered choices after their greeting; picking one (Digit1/Digit2 — see
	 * `gameplay/interaction.js`'s `DIALOGUE_CHOICE_KEY_CODES`) shows that choice's own response line,
	 * replacing `{name}` the same way `GREETINGS_BY_NPC_ID` does. Every other NPC has no entry here —
	 * an absent/empty array means the old greeting-then-close-on-E behavior, unchanged. See
	 * `gameplay/dialogueChoices.js` for the full per-NPC content, growth history, and the
	 * `jon-guard-1` exclusion rationale. */
	CHOICES_BY_NPC_ID,
});