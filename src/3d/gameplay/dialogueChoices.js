/**
 * `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` — split out of `gameplay/gameplayConfig.js` (run 50,
 * DECISIONS.md ADR-0066) once that file reached 566/600 lines with only 34 headroom left, this
 * block's own biggest remaining growth driver (~30 lines per 2-NPC pair) and the one most likely to
 * blow the cap before FAZ 7 needs its own room in `gameplayConfig.js`. `GREETINGS_BY_NPC_ID` stays in
 * `gameplayConfig.js` (much smaller per-entry, one line each vs. ~4) — this file owns only the
 * heavier branching-choice content. Re-exported through `gameplayConfig.js`'s `INTERACTION_CONFIG.
 * CHOICES_BY_NPC_ID` so every existing caller (`game3d.js`, `gameplay/interaction.js`) is unchanged.
 * @module gameplay/dialogueChoices
 */

/** FAZ 5's real branching pilot (started run 44, DECISIONS.md ADR-0058; grown run 46 to 4,
 * DECISIONS.md ADR-0060; grown run 47 to 6, DECISIONS.md ADR-0062; grown run 48 to 8,
 * DECISIONS.md ADR-0063; grown run 49 to 10, DECISIONS.md ADR-0064; grown run 50 to 12,
 * DECISIONS.md ADR-0067). 12 of 14 NPCs
 * (`umit-guard-1`/`berkalp-guard-1` — the player's home seat and the Stark seat the wolves already
 * patrol at; `doran-guard-1`/`xaro-guard-1` — Dorne's pride and Qarth's thirteen gates;
 * `cersei-guard-1`/`stannis-guard-1` — Lannister gold and Baratheon justice, both already
 * flavor-rich in `GREETINGS_BY_NPC_ID`; `stannis-guard-2` — Baratheon's second watchman;
 * `balon-guard-1` — Greyjoy's "we do not sow" flavor, the pilot's first Iron Islands seat;
 * `robin-guard-1` — Arryn's Eyrie height, the pilot's first Vale seat; `ziya-guard-1`/`berk-guard-1`/
 * `olena-guard-1` — Tyrell's gardens/growing-power flavor, now voiced at all 3 of its Reach seats)
 * get 2
 * numbered choices after their greeting; picking
 * one (Digit1/Digit2 — see
 * `gameplay/interaction.js`'s `DIALOGUE_CHOICE_KEY_CODES`) shows that choice's own response line,
 * replacing `{name}` the same way `GREETINGS_BY_NPC_ID` does. Every other NPC has no entry here —
 * an absent/empty array means the old greeting-then-close-on-E behavior, unchanged.
 * `jon-guard-1` deliberately excluded again (see ADR-0058's "Alternatives considered": its
 * ominous one-liner reads better staying a single line); `twin-guard-1` is the one remaining
 * not-yet-covered NPC. Not a real dialogue tree/quest system
 * yet (no further branching, no state/persistence, no stat effects) — proves the mechanism on a
 * growing pilot subset first, same "pilot on 2 of N, extend later" precedent `NPC_CONFIG.SPAWNS`'
 * own patrol rollout (run 22) already established for this project. */
export const CHOICES_BY_NPC_ID = Object.freeze({
	'umit-guard-1': Object.freeze([
		Object.freeze({
			label: 'Ejderhalar hâlâ var mı?',
			response: '{name}: Yıllardır kimse görmedi, ama Targeryan kanı bu surlarda hâlâ akıyor. Umutlanmak günah değil.',
		}),
		Object.freeze({
			label: 'Ümit Targeryan nerede?',
			response: '{name}: Lordumuz surların içinde, danışmanlarıyla meşgul. Onu rahatsız etmeni tavsiye etmem.',
		}),
	]),
	'berkalp-guard-1': Object.freeze([
		Object.freeze({
			label: 'Kışın geldiğini nereden biliyorsun?',
			response: '{name}: Stark\'ın sözü boşuna değildir. Rüzgar kuzeyden esmeye başladı mı, biz hazır demektir.',
		}),
		Object.freeze({
			label: 'Kurtlar neden bu kadar yakın dolaşıyor?',
			response: '{name}: Direwolf bizim kanımızdandır. Onlar buradaysa, biz de güvende demektir.',
		}),
	]),
	'doran-guard-1': Object.freeze([
		Object.freeze({
			label: 'Diğer krallıklarla aranız neden bu kadar gergin?',
			response: '{name}: Dorne kimseye boyun eğmedi, kimseye de borçlu değil. Gerginlik değil, bağımsızlıktır bu.',
		}),
		Object.freeze({
			label: 'Dorne\'un gizli bahçeleri var mı?',
			response: '{name}: Bahçelerimizde ne yetiştiğini yalnızca Dorne halkı bilir, yabancı. Sen bilmesen daha iyi.',
		}),
	]),
	'xaro-guard-1': Object.freeze([
		Object.freeze({
			label: 'Diğer on iki kapının ardında ne var?',
			response: '{name}: Tüccarlar, sırlar, bazen de hiçbir şey. Qarth kapılarını meraklılara açık tutmaz.',
		}),
		Object.freeze({
			label: 'Qarth\'a nasıl güven kazanılır?',
			response: '{name}: Altınla, ya da sabırla. İkisi de yoksa, on üçüncü kapı seni hiç görmeyecek.',
		}),
	]),
	'cersei-guard-1': Object.freeze([
		Object.freeze({
			label: 'Lannister\'lar neden bu kadar zengin?',
			response: '{name}: Casterly Rock\'ın madenleri hiç tükenmez derler. İster inan, ister inanma, altın konuşur.',
		}),
		Object.freeze({
			label: 'Cersei Lannister nasıl bir kraliçedir?',
			response: '{name}: Sorgulanacak biri değildir. Sözü kanundur, burada da öyledir.',
		}),
	]),
	'stannis-guard-1': Object.freeze([
		Object.freeze({
			label: 'Stannis\'in adaleti tam olarak nedir?',
			response: '{name}: Kanun herkese eşit uygulanır, lorda da köylüye de. Kral Stannis kayırma tanımaz.',
		}),
		Object.freeze({
			label: 'Neden başka bir kral değil de Stannis?',
			response: '{name}: Hak onundur, yabancı. O, görevden kaçmaz — bu yeterli bir cevaptır.',
		}),
	]),
	'stannis-guard-2': Object.freeze([
		Object.freeze({
			label: 'Tepede tam olarak ne arıyorsun?',
			response: '{name}: Düşman ateşi, yabancı bayrağı, her ne gelirse. İlk gören ben olurum, ilk uyaran da.',
		}),
		Object.freeze({
			label: 'Birinci nöbetçiyle aranız nasıl?',
			response: '{name}: O kapıyı tutar, ben tepeyi. İkimiz de aynı krala hizmet ederiz, sorun çıkmaz.',
		}),
	]),
	'balon-guard-1': Object.freeze([
		Object.freeze({
			label: 'Tohum ekmemek ne demek?',
			response: '{name}: Toprağa güvenmeyiz, denize güveniriz. İhtiyacımız olanı alırız, beklemeyiz.',
		}),
		Object.freeze({
			label: 'Demir Adalar\'a nasıl saygı gösterilir?',
			response: '{name}: Güçle, yabancı. Zayıflık burada saygı görmez, ne sözle ne de altınla.',
		}),
	]),
	'robin-guard-1': Object.freeze([
		Object.freeze({
			label: 'Neden bu kadar yükseğe yerleştiniz?',
			response: '{name}: Eyrie\'ye kimse merdivensiz çıkamaz, yabancı. Yükseklik en iyi kaledir, kılıçtan önce gelir.',
		}),
		Object.freeze({
			label: 'Kartallarınız gerçekten her şeyi mi görür?',
			response: '{name}: Vadi\'nin her karışını görürler. Sana da bir göz atıyorlardır şu an, merak etme.',
		}),
	]),
	'ziya-guard-1': Object.freeze([
		Object.freeze({
			label: 'Ziya Hanım\'ın bahçeleri neyle ünlü?',
			response: '{name}: Reach\'in en bereketli toprakları burada, yabancı. Kışın bile açlık bilmeyiz.',
		}),
		Object.freeze({
			label: 'Büyüyen güç derken neyi kastediyorsun?',
			response: '{name}: Ordular kılıçla büyür, biz tahılla. Sonunda ikisi de aynı kapıya çıkar.',
		}),
	]),
	'berk-guard-1': Object.freeze([
		Object.freeze({
			label: 'Topraklarınız neden bu kadar verimli?',
			response: '{name}: Reach\'in toprağı cömerttir, yabancı. Ekersin, biçersin, hiç boş dönmezsin.',
		}),
		Object.freeze({
			label: 'Misafirperverliğinizin sınırı tam olarak ne?',
			response: '{name}: Sofra herkese açıktır, ama kapı herkese değil. Niyetini belli et, gerisi kolay.',
		}),
	]),
	'olena-guard-1': Object.freeze([
		Object.freeze({
			label: 'Olena Hanım\'ın diline neden bu kadar dikkat etmeli?',
			response: '{name}: Kılıçtan çok kelimeyle kesilen görmüştür bu saray, yabancı. Sözü boşa gitmez.',
		}),
		Object.freeze({
			label: 'Keskin sözleri kimseyi kırmıyor mu hiç?',
			response: '{name}: Kırar elbette, ama doğru söylenmiş bir söz her zaman bir yalandan iyidir.',
		}),
	]),
});
