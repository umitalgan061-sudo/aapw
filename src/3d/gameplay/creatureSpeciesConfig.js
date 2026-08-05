/**
 * `CREATURE_SPECIES` — a data-only registry of every planned living-being archetype's
 * *characteristic movement/behavior* spec (FAZ 11, run 72, DECISIONS.md ADR-0095). Written ahead of
 * any real model: the project owner will upload each species' model later, so this file exists to
 * capture the *design decision* (how each creature should move/behave, distinct from every other
 * one) now, while it's fresh, without waiting on the asset.
 *
 * **What this file deliberately is NOT (yet):** a runtime behavior engine. No `create<Species>()`
 * factory function lives here, and nothing in `game3d.js` imports this file. GOVERNANCE.md's
 * "Bilmeme kuralı" (don't guess an API you're not sure of) and this project's own established
 * per-species precedent (`gameplay/animals.js`'s wolf patrol is a *copy* of `npc.js`'s, not a shared
 * function — see DECISIONS.md ADR-0026's "why duplicate" reasoning) both argue against building a
 * generic, speculative "creature engine" before a single one of these models exists to test it
 * against. Every species below gets its own real `create<Species>()` (in `gameplay/animals.js` for
 * animals, `gameplay/npc.js`-style for human archetypes, or a new file if a category doesn't fit
 * either) as its OWN future sub-task, once its model is uploaded — with its own ADR, its own smoke
 * check driving the real model, and its own headless-boot visual proof, exactly like every other
 * FAZ 6/7 addition this project has already shipped. This file is the shared spec those future
 * sub-tasks implement against, so two different runs don't invent two different answers to "how
 * does a cat move" independently.
 *
 * **Values below are first-pass design judgment** (this run's own engineering reasoning, same
 * category as `ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS`'s own "no existing project value to reuse"
 * precedent) — speeds/radii are starting points to implement against, not final tuning; each
 * species' own future sub-task re-confirms or adjusts them once a real model/animation set exists to
 * feel them out against, and records that in its own ADR.
 *
 * @module gameplay/creatureSpeciesConfig
 */

/**
 * @typedef {object} CreatureSpeciesSpec
 * @property {string} id Slug, matches this object's own key in `CREATURE_SPECIES`.
 * @property {string} displayNameTr Turkish display name (GOVERNANCE.md §15 — in-game text is
 *   Turkish-only; this registry's own prose/comments stay English like the rest of this codebase).
 * @property {'insan'|'evcil-hayvan'|'yaban-hayvan'|'kus'|'mitolojik'} category
 * @property {'biped'|'quadruped'|'flying'} locomotion
 * @property {'yalniz'|'suru'|'cift'|'eskortlu'} social Solitary / herd-or-flock / pair / escorted
 *   (always accompanied by other NPCs, e.g. a king with guards).
 * @property {string} characteristicMovement One-paragraph description of the gait/behavior that
 *   should make this species read as visually distinct from every other one in the registry — the
 *   actual design decision this file exists to capture.
 * @property {{idleOrPatrolMps: number, alertOrFleeMps: number}} speedProfile First-pass m/s values
 *   (see file header — starting points, not final tuning). `alertOrFleeMps` means "flee speed" for
 *   prey, "pursuit/reactive speed" for anything else that has one, and equals `idleOrPatrolMps` for
 *   species with no distinct alert gait at all (e.g. a slow-moving flock that doesn't startle).
 * @property {string[]} behaviorTags Composable behavior primitives this species' own future
 *   `create<Species>()` should draw from — most already exist in this codebase (reuse, don't
 *   reinvent): `patrol` (`npc.js`/`animals.js`'s waypoint pattern), `flee-on-approach` /
 *   `pack-alert` (`animals.js`'s wolf reaction), `flying-circle` / `reactive-flight` / `dive` /
 *   `pursuit` (`dragons.js`'s tiers), plus new primitives this registry is the first to name:
 *   `flock` (birds — tighter, synchronized group movement than a `pack-alert` herd), `herd-bound`
 *   (gazelle/deer — bounding flee gait, distinct from a wolf's flat sprint), `pounce` (cat — a short
 *   lunge trigger, distinct from `dive`'s altitude-loss framing), `approach-friendly` (dog — the
 *   *inverse* of `flee-on-approach`, moves toward the player instead of away), `escort-formation`
 *   (king — 1+ guard NPCs hold relative position around this one), `regal-idle` (king — slow,
 *   unhurried gait even where a generic NPC would use `PATROL_SPEED_MPS`), `combat-stance` (soldier
 *   — alert posture on player proximity; no attack, no health system yet, see
 *   `QUESTIONS_FOR_OWNER.md`'s open health/damage question).
 * @property {'awaiting-model'|'partial-existing'} status
 * @property {string} [existingOverlapNote] Only set when `status` is `'partial-existing'` — points at
 *   what already exists in the codebase today and what a future sub-task would add on top of it.
 */

/** @type {Record<string, CreatureSpeciesSpec>} */
export const CREATURE_SPECIES = Object.freeze({
	kedi: Object.freeze({
		id: 'kedi',
		displayNameTr: 'Kedi',
		category: 'evcil-hayvan',
		locomotion: 'quadruped',
		social: 'yalniz',
		characteristicMovement:
			'Sinsi, alçak ve sessiz bir sürünme temposunda dolaşır (mevcut hayvanların en yavaş ' +
			'patrol hızı) — bir şeyi (kuş, oyuncu) fark ettiğinde birden çömelip kısa, hızlı bir ' +
			'sıçrama (pounce) yapar, sonra tekrar sakin sinsi yürüyüşe döner. Sürü davranışı yok, ' +
			'her zaman tek başına.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 0.9, alertOrFleeMps: 3.5 }),
		behaviorTags: Object.freeze(['patrol', 'pounce']),
		status: 'awaiting-model',
	}),
	kopek: Object.freeze({
		id: 'kopek',
		displayNameTr: 'Köpek',
		category: 'evcil-hayvan',
		locomotion: 'quadruped',
		social: 'yalniz',
		characteristicMovement:
			'Canlı, zıplayan bir yürüyüş temposu — her adımda hafif bir sekme var, mevcut hiçbir ' +
			'canlıda olmayan bir enerji. Oyuncu yaklaştığında `animals.js`\'nin kurt/geyik/ceylan\'ının ' +
			'tam tersini yapar: kaçmak yerine oyuncuya doğru yaklaşır (dost canlısı) — bu proje için ' +
			'ilk "approach-friendly" davranış, `flee-on-approach`\'ın ayna görüntüsü.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.8, alertOrFleeMps: 4.0 }),
		behaviorTags: Object.freeze(['patrol', 'approach-friendly']),
		status: 'awaiting-model',
	}),
	kral: Object.freeze({
		id: 'kral',
		displayNameTr: 'Kral',
		category: 'insan',
		locomotion: 'biped',
		social: 'eskortlu',
		characteristicMovement:
			'Yavaş, ağırbaşlı (regal) bir yürüyüş — `NPC_CONFIG.PATROL_SPEED_MPS` (1.4) bile bir kral ' +
			'için fazla telaşlı; daha da yavaş, duraksamalı bir tempo hedeflenir. Genelde dar bir alanda ' +
			'(taht odası/avlu) kısa bir rota izler, uzun devriyeler yapmaz. 1-2 muhafız NPC\'siyle ' +
			'göreli konumunu koruyarak (escort-formation) hareket eder — bu proje için ilk çok-NPC ' +
			'koordineli hareket örneği.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 0.8, alertOrFleeMps: 0.8 }),
		behaviorTags: Object.freeze(['regal-idle', 'escort-formation']),
		status: 'awaiting-model',
	}),
	ejderha: Object.freeze({
		id: 'ejderha',
		displayNameTr: 'Ejderha',
		category: 'mitolojik',
		locomotion: 'flying',
		social: 'yalniz',
		characteristicMovement:
			'Zaten tam kapsamlı: `gameplay/dragons.js` — sabit yükseklikte daire çizen devriye uçuşu, ' +
			'oyuncu yaklaşınca reaktif hızlanma/bank açısı, dalış (dive), sürekli kovalama (pursuit), ' +
			'vazgeçme (give-up) ve dalış öncesi kanat-çırpma uyarısı (telegraph). Bkz. ADR-0071/0072/' +
			'0077/0082/0085/0089/0091/0093.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 12, alertOrFleeMps: 10 }),
		behaviorTags: Object.freeze(['flying-circle', 'reactive-flight', 'dive', 'pursuit']),
		status: 'partial-existing',
		existingOverlapNote: 'Tamamen mevcut, bu registry sadece referans için listeliyor.',
	}),
	asker: Object.freeze({
		id: 'asker',
		displayNameTr: 'Asker',
		category: 'insan',
		locomotion: 'biped',
		social: 'yalniz',
		characteristicMovement:
			'Disiplinli, düzenli bir adım temposu (marching cadence) — bugünkü "Muhafız" NPC\'lerinin ' +
			'devriye hızıyla aynı olabilir, ama duruşu farklı: oyuncu yaklaştığında (henüz saldırı/hasar ' +
			'sistemi yokken bile) belirgin bir "combat-stance" — dik, teyakkuz duruşuna geçer, mevcut ' +
			'Muhafız NPC\'lerinin şu anki tepkisiz idle\'ından ayrışır.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.4, alertOrFleeMps: 1.4 }),
		behaviorTags: Object.freeze(['patrol', 'combat-stance']),
		status: 'partial-existing',
		existingOverlapNote:
			'`NPC_CONFIG.SPAWNS`\'daki tüm "Muhafız" NPC\'leri davranışsal olarak zaten bu arketipin ' +
			'devriye kısmını karşılıyor; eksik olan tek şey `combat-stance` tepkisi.',
	}),
	kus: Object.freeze({
		id: 'kus',
		displayNameTr: 'Kuş',
		category: 'kus',
		locomotion: 'flying',
		social: 'suru',
		characteristicMovement:
			'Küçük bir sürü halinde, birbirine yakın ve senkronize (`flock`) kısa mesafeli, rastgele ' +
			'olmayan (seeded) uçuşlar — bir ağaçtan diğerine, kısaca yere konup tekrar havalanma. ' +
			'`ejderha`\'nın büyük, yavaş devriye dairesinden tamamen farklı bir ölçek/tempoda: küçük, ' +
			'hızlı, düzensiz sıçramalı hareket.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 2.5, alertOrFleeMps: 8 }),
		behaviorTags: Object.freeze(['flock']),
		status: 'awaiting-model',
	}),
	ceylan: Object.freeze({
		id: 'ceylan',
		displayNameTr: 'Ceylan',
		category: 'yaban-hayvan',
		locomotion: 'quadruped',
		social: 'suru',
		characteristicMovement:
			'Çok ürkek — `ANIMAL_CONFIG.FLEE_TRIGGER_RADIUS_METERS` (15) kurttan daha geniş bir alarm ' +
			'yarıçapı hedeflenir. Kaçarken düz bir sprint değil, sıçrayarak (bounding) koşar — kurdun ' +
			'`flee-on-approach`\'ından görsel olarak ayrışan yeni bir `herd-bound` birincili. Sürü ' +
			'halinde otlar, `pack-alert`\'e benzer ama sürü daha sıkı/senkronize.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.6, alertOrFleeMps: 7.5 }),
		behaviorTags: Object.freeze(['herd-bound', 'pack-alert']),
		status: 'awaiting-model',
	}),
	geyik: Object.freeze({
		id: 'geyik',
		displayNameTr: 'Geyik',
		category: 'yaban-hayvan',
		locomotion: 'quadruped',
		social: 'suru',
		characteristicMovement:
			'`ceylan`\'a çok benzer (`herd-bound` kaçış) ama daha büyük/ağır bir gövde hissi için biraz ' +
			'daha düşük kaçış hızı ve daha geniş sıçrama adımı hedeflenir; tercihen ormanlık alanlarda ' +
			'(çim değil, ağaç yoğunluğu yüksek bölgeler) yerleştirilir, tek başına veya küçük (2-3) ' +
			'gruplar halinde — ceylanın büyük sürüsünden daha küçük ölçekli.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.5, alertOrFleeMps: 6.5 }),
		behaviorTags: Object.freeze(['herd-bound', 'pack-alert']),
		status: 'awaiting-model',
	}),
	'erkek-insan': Object.freeze({
		id: 'erkek-insan',
		displayNameTr: 'Erkek İnsan',
		category: 'insan',
		locomotion: 'biped',
		social: 'yalniz',
		characteristicMovement:
			'Mevcut `gameplay/npc.js`/`gameplay/player.js` yürüme/koşma/idle klipleri zaten cinsiyet ' +
			'ayrımı gözetmeden tüm karakterlere uygulanıyor (`peasant_girl`\'ün retarget edilmiş ' +
			'klipleri). Bu girdi, ileride cinsiyete özgü bir yürüyüş/duruş farkı (adım genişliği, kol ' +
			'sallama genliği) eklenmek istenirse diye ayrı bir arketip olarak burada tutuluyor — bugün ' +
			'için ek bir kod değişikliği gerektirmiyor.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.4, alertOrFleeMps: 6.5 }),
		behaviorTags: Object.freeze(['patrol']),
		status: 'partial-existing',
		existingOverlapNote:
			'Mevcut NPC/oyuncu animasyon boru hattı zaten bunu karşılıyor; farklılaştırma isteğe bağlı.',
	}),
	'kadin-insan': Object.freeze({
		id: 'kadin-insan',
		displayNameTr: 'Kadın İnsan',
		category: 'insan',
		locomotion: 'biped',
		social: 'yalniz',
		characteristicMovement: 'Bkz. `erkek-insan` — aynı not, simetrik olarak geçerli.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.4, alertOrFleeMps: 6.5 }),
		behaviorTags: Object.freeze(['patrol']),
		status: 'partial-existing',
		existingOverlapNote:
			'Mevcut NPC/oyuncu animasyon boru hattı zaten bunu karşılıyor (oyuncu modeli ' +
			'`peasant_girl` zaten kadın); farklılaştırma isteğe bağlı.',
	}),
	koylu: Object.freeze({
		id: 'koylu',
		displayNameTr: 'Köylü',
		category: 'insan',
		locomotion: 'biped',
		social: 'yalniz',
		characteristicMovement:
			'Zaten `NPC_CONFIG.SPAWNS`\'daki devriye eden "Muhafız" NPC\'leri bu arketipin temel ' +
			'hareketini (patrol) karşılıyor. İleride köylüye özgü "iş" davranışları (su taşıma, ' +
			'çiftçilik gibi kısa flavor animasyonlar) eklenmek istenirse, ayrı bir `behaviorTags` ' +
			'girdisi (`chore-loop` gibi) bu registry\'ye eklenir.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.4, alertOrFleeMps: 1.4 }),
		behaviorTags: Object.freeze(['patrol']),
		status: 'partial-existing',
		existingOverlapNote:
			'Devriye davranışı zaten NPC sisteminde var (guard olarak); "köylü"ye özgü iş/flavor ' +
			'davranışı henüz yok.',
	}),
	// --- Bu proje için önerilen ek türler (kullanıcı listesine eklenebilir/çıkarılabilir) ---
	at: Object.freeze({
		id: 'at',
		displayNameTr: 'At',
		category: 'evcil-hayvan',
		locomotion: 'quadruped',
		social: 'suru',
		characteristicMovement:
			'Zaten `ANIMAL_CONFIG.SPAWNS`\'da bir örneği var (`umit-horse-1`, run 39/ADR-0047) ama ' +
			'model rigsiz olduğu için sadece statik/idle — yürüyüş/kaçış animasyonu yok. Karakteristik ' +
			'hedef: dörtnala (gallop) koşma, sürü halinde otlama; rigli bir model yüklenirse gerçek ' +
			'`patrol`/`flee-on-approach` davranışı eklenebilir.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 2.0, alertOrFleeMps: 9 }),
		behaviorTags: Object.freeze(['patrol', 'flee-on-approach']),
		status: 'partial-existing',
		existingOverlapNote:
			'`ANIMAL_CONFIG.SPAWNS`\'da statik/idle olarak var (rigsiz model); rigli bir at modeli ' +
			'yüklenirse gerçek hareket eklenebilir.',
	}),
	kuzgun: Object.freeze({
		id: 'kuzgun',
		displayNameTr: 'Kuzgun',
		category: 'kus',
		locomotion: 'flying',
		social: 'yalniz',
		characteristicMovement:
			'Westeros temasına özellikle uygun (Gece Nöbeti\'nin mesaj kuzgunları, üç-gözlü kuzgun ' +
			'motifi). `kus`\'un aksine tek başına ve kale kulelerinde tünüyor; oyuncu yaklaşınca kısa ' +
			'bir "mesaj taşımaya gidiyor" uçuşuyla uzaklaşabilir — `kus`\'un sürü/flock davranışından ' +
			'kasıtlı olarak ayrışan, yalnız bir karakter.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 0, alertOrFleeMps: 9 }),
		behaviorTags: Object.freeze(['flee-on-approach']),
		status: 'awaiting-model',
	}),
	koyun: Object.freeze({
		id: 'koyun',
		displayNameTr: 'Koyun',
		category: 'evcil-hayvan',
		locomotion: 'quadruped',
		social: 'suru',
		characteristicMovement:
			'Köy/çiftlik hayvanı — çok yavaş, ürkek değil (küçük ya da yok denecek alarm yarıçapı), ' +
			'sıkı bir sürü halinde birlikte otlar. `ceylan`/`geyik`\'in tersine kaçış davranışı yok ' +
			'veya çok zayıf — sakin bir sahne canlısı.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 0.7, alertOrFleeMps: 1.5 }),
		behaviorTags: Object.freeze(['patrol']),
		status: 'awaiting-model',
	}),
	'yaban-domuzu': Object.freeze({
		id: 'yaban-domuzu',
		displayNameTr: 'Yaban Domuzu',
		category: 'yaban-hayvan',
		locomotion: 'quadruped',
		social: 'yalniz',
		characteristicMovement:
			'Vahşi/tehlikeli hissi hedefleniyor — oyuncu çok yaklaşırsa kaçmak yerine oyuncuya doğru ' +
			'kısa bir hücum (charge) yapabilir; bu proje için ilk "saldırgan" hayvan davranışı, ama ' +
			'gerçek hasar/saldırı mekaniği yok (bkz. `QUESTIONS_FOR_OWNER.md`\'nin sağlık/hasar ' +
			'sorusu — o karar netleşmeden bu tür sadece görsel bir "charge" jesti yapar, temas ' +
			'sonucu hiçbir şey olmaz). Ormanın derinliklerinde, kale/yerleşim yakınında değil.',
		speedProfile: Object.freeze({ idleOrPatrolMps: 1.0, alertOrFleeMps: 6 }),
		behaviorTags: Object.freeze(['patrol', 'combat-stance']),
		status: 'awaiting-model',
	}),
});
