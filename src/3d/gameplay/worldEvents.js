/**
 * Periodic world-flavor events (FAZ 8's early piece, priority 9.5 — "OLAY SİSTEMİNİ 3D MODA TAŞI").
 * `script.js`'s 2D `triggerRandomEvents()` picks a random `RANDOM_EVENTS` entry every turn and
 * applies a stat change (gold/army/morale/...) to a kingdom, shown as a card popup. The 3D world has
 * no per-kingdom economy/stats yet (no turns either — it's real-time), so a direct port would have
 * nothing to apply its effect to. This module ports the *pattern* instead: a small curated list of
 * icon/title/description flavor events, fired periodically through the shared `EventBus`
 * (`EVENTS.WORLD_EVENT_TRIGGERED`) rather than called directly — the explicit ask was to extend the
 * EventBus to real gameplay events, not just add another direct function call. `ui/worldEventToast.js`
 * is the (only, for now) listener, rendering the same icon/title/description shape as a toast card.
 * @module gameplay/worldEvents
 */

/** Deterministic 32-bit PRNG (mulberry32) — never `Math.random()` for world/gameplay behavior, per
 * this project's determinism rule. Duplicated from `world/terrain.js` rather than imported: this
 * folder's own README documents a "blast radius" rule (`gameplay/` only touches itself,
 * `eventBus.js`, `physics.js`, `input.js`) and `animals.js`/`npc.js` already establish the
 * precedent of a small duplicated helper over a cross-folder import for exactly this reason.
 * @param {number} seed
 * @returns {() => number} Returns a new float in `[0, 1)` each call.
 */
function mulberry32(seed) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Curated flavor events — pure lore/ambiance, no stat effects (see module doc for why). Kept local
 * to this file rather than in `config.js`, which is already at its 600-line cap — same
 * "tool/system-specific constants stay local" precedent `debug/perfPanel.js`'s own budgets set. */
const WORLD_EVENTS = Object.freeze([
	{ id: 'raven', icon: '🐦', title: 'Kuzgun Ulaştı', desc: 'Uzak bir kaleden kuzgun mesajı geldi.', color: '#8faabb' },
	{ id: 'distant_storm', icon: '🌩️', title: 'Uzak Fırtına', desc: 'Ufukta fırtına bulutları toplanıyor.', color: '#4a88c8' },
	{ id: 'wolf_howl', icon: '🐺', title: 'Kurt Uluması', desc: 'Gecenin sessizliğinde bir kurt uluması yankılandı.', color: '#8faabb' },
	{ id: 'feast_fires', icon: '🔥', title: 'Şölen Ateşleri', desc: 'Bir kalede şölen ateşleri yakıldı, kutlama sesleri rüzgarda taşınıyor.', color: '#e8784a' },
	{ id: 'dragon_shadow', icon: '🐉', title: 'Ejderha Gölgesi', desc: 'Gökyüzünde bir gölge geçti — yoksa hayal mi gördün?', color: '#c8430a' },
	{ id: 'guard_change', icon: '⚔️', title: 'Nöbetçi Değişimi', desc: 'Kale kapılarında nöbetçiler el değiştiriyor.', color: '#c8960a' },
	{ id: 'sept_prayer', icon: '🕯️', title: 'Yedi Tanrı\'ya Dua', desc: 'Bir Sept\'ten mumların titreyen ışığı görünüyor.', color: '#e8b420' },
	{ id: 'maester_raven', icon: '📜', title: 'Maester\'ın Kaydı', desc: 'Bir maester yeni bilgi kayıtlarını tamamladı.', color: '#20c8a0' },
]);

/** Real-time seconds between events — randomized per-firing within this range so it never reads as
 * a metronome. Deliberately real-time, not turn-based: FAZ 8 has no turn system yet. */
const MIN_INTERVAL_SECONDS = 45;
const MAX_INTERVAL_SECONDS = 90;

/**
 * @param {object} options
 * @param {import('../eventBus.js').EventBus} options.eventsBus Emits `EVENTS.WORLD_EVENT_TRIGGERED`
 *   with the picked event object (`{id, icon, title, desc, color}`) as payload.
 * @param {number} options.seed Deterministic seed — same seed always produces the same sequence of
 *   events and intervals (this project's determinism rule).
 * @param {string} options.eventName The `EVENTS.WORLD_EVENT_TRIGGERED` string (passed in, not
 *   imported from `config.js`, matching this folder's existing `npc.js`/`animals.js` precedent of
 *   taking config values as constructor options rather than importing `config.js` directly).
 * @returns {{update: (deltaSeconds: number) => void, dispose: () => void}}
 */
export function createWorldEventSystem({ eventsBus, seed, eventName }) {
	const random = mulberry32(seed);
	let secondsUntilNext = MIN_INTERVAL_SECONDS + random() * (MAX_INTERVAL_SECONDS - MIN_INTERVAL_SECONDS);
	let disposed = false;

	const system = {};

	/**
	 * Call once per frame with the real elapsed seconds since the last call. No-op after `dispose()`.
	 * @param {number} deltaSeconds
	 */
	system.update = (deltaSeconds) => {
		if (disposed) return;
		secondsUntilNext -= deltaSeconds;
		if (secondsUntilNext > 0) return;
		secondsUntilNext += MIN_INTERVAL_SECONDS + random() * (MAX_INTERVAL_SECONDS - MIN_INTERVAL_SECONDS);
		const picked = WORLD_EVENTS[Math.floor(random() * WORLD_EVENTS.length)];
		eventsBus.emit(eventName, picked);
	};

	/** No listeners/DOM owned by this module (it only emits) — kept for API symmetry with every
	 * other disposable system `game3d.js` wires up, and to make a future accidental post-teardown
	 * `update()` call a guaranteed no-op instead of emitting into a torn-down scene. */
	system.dispose = () => {
		disposed = true;
	};

	return system;
}
