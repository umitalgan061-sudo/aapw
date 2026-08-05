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
	{ id: 'falling_star', icon: '🌠', title: 'Düşen Yıldız', desc: 'Gökyüzünde bir yıldız kayarken görüldü — bazıları bunu bir alamet sayar.', color: '#c8b4e8' },
	{ id: 'horse_gallop', icon: '🐎', title: 'Nal Sesleri', desc: 'Uzaktan bir atın nal sesleri duyuluyor — bir haberci mi, yoksa devriye mi?', color: '#b48a5a' },
	{ id: 'trade_caravan', icon: '🛒', title: 'Tüccar Kervanı', desc: 'Kale yoluna bir tüccar kervanı yaklaşıyor, çanları uzaktan duyuluyor.', color: '#c89a30' },
	{ id: 'bell_toll', icon: '🔔', title: 'Çan Sesi', desc: 'Bir kalenin çanı çalıyor — nöbet değişimi mi, yoksa bir uyarı mı?', color: '#a0a0c8' },
	{ id: 'watch_horn', icon: '📯', title: 'Nöbet Boynuzu', desc: 'Uzaktan, kuzey yönünden tek bir boynuz sesi duyuldu. Sadece bir devriye mi dönüyor?', color: '#607890' },
	{ id: 'tourney_announce', icon: '🏆', title: 'Turnuva Duyurusu', desc: 'Bir haberci komşu bir kalede düzenlenecek mızrak turnuvasını duyuruyor.', color: '#d4a017' },
	{ id: 'ship_sighted', icon: '⛵', title: 'Yelken Göründü', desc: 'Ufukta bir yelkenli belirdi — dost mu, yoksa yabancı bir bayrak mı taşıyor?', color: '#2c5f7a' },
	{ id: 'blacksmith_hammer', icon: '🔨', title: 'Demirci Çekici', desc: 'Bir kaleden ritmik çekiç sesleri geliyor — silahlar mı dövülüyor, at nalı mı?', color: '#7a5230' },
	{ id: 'white_raven', icon: '🕊️', title: 'Beyaz Kuzgun', desc: 'Citadel\'den beyaz bir kuzgun geldi — mevsimin değiştiğinin habercisi.', color: '#e8e8e8' },
	{ id: 'iron_bank', icon: '🪙', title: 'Demir Banka Ziyareti', desc: 'Şehre yabancı bir tahsildar geldi — kimin ne borcu olduğunu fısıldıyorlar.', color: '#3a3a5a' },
	{ id: 'wildling_rumor', icon: '❄️', title: 'Vahşi Kuzeyliler Söylentisi', desc: 'Duvar\'ın ötesinden endişeli fısıltılar yayılıyor — bu kez gerçek mi?', color: '#4a6a8a' },
	{ id: 'mourning_bells', icon: '🖤', title: 'Yas Çanları', desc: 'Bir kaleden yavaş, ağır çan sesleri geliyor — biri kaybedilmiş.', color: '#4a4a4a' },
	{ id: 'red_comet', icon: '☄️', title: 'Kızıl Kuyruklu Yıldız', desc: 'Gökyüzünde günlerdir asılı duran kızıl bir kuyruklu yıldız — kimileri bunu bir hanedanın alâmeti sayıyor.', color: '#9c2a1e' },
	{ id: 'hunting_party', icon: '🦌', title: 'Av Dönüşü', desc: 'Bir av birliği kale kapısından geri döndü, atların sırtında günün avı asılı.', color: '#5a7a3a' },
	{ id: 'eclipse', icon: '🌑', title: 'Güneş Tutulması', desc: 'Öğle vakti gökyüzü kararıyor — kimileri bunu bir felaket alâmeti sayıyor, kimileri sadece doğanın bir cilvesi.', color: '#2a1f3d' },
	{ id: 'shackled_prisoner', icon: '⛓️', title: 'Zincirli Mahkûm', desc: 'Nöbetçiler zincirli bir mahkûmu kale kapısından zindana sürüklüyor — suçu neydi, kimse bilmiyor.', color: '#5c5c4a' },
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
