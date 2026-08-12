/**
 * Figure -> palette matching by kind and by Turkish/English name.
 *
 * This is what the editor's "Otomatik Doku Giydir" button runs on: given whatever the user has
 * selected — an asset id like `black-dragon`, a Turkish display name like "Siyah Ejderha", a raw FBX
 * filename like `peasant_girl.fbx`, or an English category like "Bina" — it decides which palette
 * from `palettes.js` should dress it.
 *
 * Matching is deliberately keyword-based rather than an exact lookup table, because the asset
 * library mixes languages and naming conventions (`marker-castle`, "Kale İşaretçisi",
 * `walled_city_fortress_decimated.glb`) and new assets arrive without anyone updating a mapping.
 * Scoring, not first-match, decides the winner so that a longer, more specific keyword ("ejderha
 * kanat") beats a shorter generic one ("ejderha").
 * @module materials/textureMatcher
 */

import { PALETTES, PALETTE_IDS } from './palettes.js';

/**
 * Turkish-aware lowercasing. `String.toLowerCase()` maps 'I' to 'i' but Turkish needs 'I'->'ı' and
 * 'İ'->'i'; without this, "İNSAN" and "insan" would not match, and neither would "KILIÇ"/"kılıç".
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
	return String(value ?? '')
		.replace(/İ/g, 'i')
		.replace(/I/g, 'ı')
		.toLowerCase()
		.replace(/[_\-.]+/g, ' ')
		.replace(/\.(fbx|glb|gltf|obj)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Keyword table. Each entry lists the palette it selects and the Turkish + English words that should
 * pick it. Order does not matter — scoring handles precedence — but keeping families together keeps
 * this readable as the catalogue grows.
 *
 * A word only needs to appear once; both the bare word and its common suffixed forms are matched by
 * substring, so "kaleler", "kalesi", "castles" all hit "kale"/"castle".
 * `priority` (default 0) breaks ties where a more specific rule uses a shorter keyword.
 * @type {ReadonlyArray<{palette: string, words: string[], priority?: number}>}
 */
const KEYWORD_RULES = Object.freeze([
	// --- Ejderha: most specific first so wing membrane never loses to the generic dragon rule. ---
	{ palette: 'dragon-wing', priority: 1, words: ['kanat', 'kanad', 'zar', 'wing', 'membrane'] },
	{ palette: 'dragon-black', words: ['siyah ejderha', 'kara ejderha', 'black dragon'] },
	{ palette: 'dragon-red', words: ['kizil ejderha', 'kızıl ejderha', 'kırmızı ejderha', 'red dragon', 'ates ejderha'] },
	{ palette: 'dragon-green', words: ['yesil ejderha', 'yeşil ejderha', 'green dragon'] },
	{ palette: 'dragon-ice', words: ['buz ejderha', 'ice dragon', 'frost dragon', 'beyaz ejderha'] },
	{ palette: 'dragon-gold', words: ['altin ejderha', 'altın ejderha', 'gold dragon'] },
	{ palette: 'dragon-bronze', words: ['tunc ejderha', 'tunç ejderha', 'bronze dragon'] },
	{ palette: 'dragon-shadow', words: ['golge ejderha', 'gölge ejderha', 'shadow dragon'] },
	{ palette: 'dragon-black', words: ['ejderha', 'ejder', 'dragon', 'drake', 'wyvern'] },

	// --- İnsan ---
	{ palette: 'knight', words: ['sovalye', 'şövalye', 'knight', 'paladin'] },
	{ palette: 'soldier', words: ['asker', 'soldier', 'guard', 'muhafiz', 'muhafız', 'nobetci', 'nöbetçi', 'warrior', 'savasci'] },
	{ palette: 'noble', words: ['soylu', 'lord', 'lady', 'noble', 'kral', 'kralice', 'kraliçe', 'king', 'queen', 'prens'] },
	{ palette: 'monk', words: ['rahip', 'monk', 'priest', 'maester', 'septon'] },
	{ palette: 'peasant', words: ['koylu', 'köylü', 'peasant', 'farmer', 'ciftci', 'çiftçi', 'villager'] },
	{ palette: 'woman', words: ['kadin', 'kadın', 'woman', 'female', 'girl', 'kiz', 'kız', 'anne'] },
	{ palette: 'man', words: ['erkek', 'adam', 'man', 'male', 'boy', 'oglan', 'oğlan', 'baba'] },
	{ palette: 'child', words: ['cocuk', 'çocuk', 'child', 'kid'] },
	{ palette: 'skin-fair', words: ['ten', 'skin', 'cilt', 'flesh'] },
	{ palette: 'hair-black', words: ['sac', 'saç', 'hair'] },

	// --- Hayvan ---
	{ palette: 'horse-bay', words: ['at', 'atlar', 'atı', 'ata', 'horse', 'beygir', 'aygir', 'aygır', 'kisrak', 'kısrak', 'pony'] },
	{ palette: 'giraffe', words: ['zurafa', 'zürafa', 'giraffe'] },
	{ palette: 'elephant', words: ['fil', 'elephant', 'mammoth', 'mamut'] },
	{ palette: 'cat', words: ['kedi', 'cat', 'kitten'] },
	{ palette: 'dog', words: ['kopek', 'köpek', 'dog', 'hound', 'tazi', 'tazı', 'puppy'] },
	{ palette: 'wolf', words: ['kurt', 'wolf', 'direwolf'] },
	{ palette: 'bear', words: ['ayi', 'ayı', 'bear'] },
	{ palette: 'deer', words: ['geyik', 'deer', 'stag', 'elk'] },
	{ palette: 'sheep', words: ['koyun', 'sheep', 'kuzu', 'lamb'] },
	{ palette: 'goat', words: ['keci', 'keçi', 'goat'] },
	{ palette: 'cow', words: ['inek', 'cow', 'okuz', 'öküz', 'ox', 'cattle', 'bufalo'] },
	{ palette: 'pig', words: ['domuz', 'pig', 'boar', 'hog'] },
	{ palette: 'chicken', words: ['tavuk', 'chicken', 'horoz', 'rooster', 'hen'] },
	{ palette: 'raven', words: ['kuzgun', 'raven', 'crow', 'karga'] },
	{ palette: 'eagle', words: ['kartal', 'eagle', 'hawk', 'sahin', 'şahin', 'falcon', 'kus', 'kuş', 'bird'] },
	{ palette: 'rabbit', words: ['tavsan', 'tavşan', 'rabbit', 'hare'] },
	{ palette: 'fish', words: ['balik', 'balık', 'fish'] },
	{ palette: 'snake', words: ['yilan', 'yılan', 'snake', 'serpent'] },
	{ palette: 'lion', words: ['aslan', 'lion'] },

	// --- Doğa ---
	{ palette: 'granite', words: ['granit', 'granite'] },
	{ palette: 'marble', words: ['mermer', 'marble'] },
	{ palette: 'rock', words: ['kaya', 'rock', 'boulder', 'kayalik', 'kayalık'] },
	{ palette: 'stone', words: ['tas', 'taş', 'stone'] },
	{ palette: 'grass', words: ['cim', 'çim', 'cimen', 'çimen', 'grass', 'meadow', 'cayir', 'çayır'] },
	{ palette: 'moss', words: ['yosun', 'moss'] },
	{ palette: 'dirt', words: ['toprak', 'dirt', 'soil', 'mud', 'camur', 'çamur'] },
	{ palette: 'sand', words: ['kum', 'sand', 'desert', 'col', 'çöl'] },
	{ palette: 'snow', words: ['kar', 'snow', 'karli', 'karlı'] },
	{ palette: 'ice', words: ['buz', 'ice', 'frost', 'frozen'] },
	{ palette: 'bark', words: ['kabuk', 'bark', 'govde', 'gövde', 'trunk'] },
	{ palette: 'pine', words: ['cam', 'çam', 'pine', 'fir', 'spruce', 'ladin'] },
	{ palette: 'tree', words: ['agac', 'ağaç', 'tree', 'orman', 'forest', 'wood tree'] },
	{ palette: 'leaf', words: ['yaprak', 'leaf', 'leaves', 'foliage'] },
	{ palette: 'bush', words: ['cali', 'çalı', 'bush', 'shrub', 'thicket'] },
	{ palette: 'lava', words: ['lav', 'lava', 'magma', 'volkan', 'volcano'] },

	// --- Su ---
	{ palette: 'sea', words: ['deniz', 'sea', 'ocean', 'okyanus'] },
	{ palette: 'river', words: ['nehir', 'river', 'irmak', 'dere', 'stream', 'creek'] },
	{ palette: 'lake', words: ['gol', 'göl', 'lake'] },
	{ palette: 'swamp', words: ['bataklik', 'bataklık', 'swamp', 'marsh'] },
	{ palette: 'water', words: ['su', 'water', 'aqua'] },

	// --- Gök ---
	{ palette: 'sun', words: ['gunes', 'güneş', 'sun', 'solar'] },
	{ palette: 'moon', words: ['ay', 'moon', 'lunar'] },
	{ palette: 'star', words: ['yildiz', 'yıldız', 'star'] },
	{ palette: 'cloud', words: ['bulut', 'cloud'] },

	// --- Yapı ---
	{ palette: 'castle-ice', words: ['buz hisari', 'buz hisarı', 'icebound', 'ice citadel'] },
	{ palette: 'castle-dark', words: ['kara kale', 'boztas', 'boztaş', 'greystone', 'dark castle'] },
	{ palette: 'castle', words: ['kale', 'castle', 'hisar', 'citadel', 'fortress', 'kule', 'tower', 'sur', 'keep', 'gatehouse', 'gecit', 'geçit'] },
	{ palette: 'house', words: ['ev', 'house', 'home', 'hut', 'kulube', 'kulübe', 'cottage', 'koy', 'köy', 'village'] },
	{ palette: 'roof-tile', words: ['kiremit', 'roof tile', 'cati', 'çatı', 'roof'] },
	{ palette: 'thatch', words: ['saman', 'thatch', 'straw'] },
	{ palette: 'brick', words: ['tugla', 'tuğla', 'brick'] },
	{ palette: 'wood', words: ['ahsap', 'ahşap', 'wood', 'timber', 'plank', 'tahta', 'log'] },
	{ palette: 'gold', words: ['altin', 'altın', 'gold', 'golden'] },
	{ palette: 'silver', words: ['gumus', 'gümüş', 'silver'] },
	{ palette: 'bronze', words: ['tunc', 'tunç', 'bronze'] },
	{ palette: 'copper', words: ['bakir', 'bakır', 'copper'] },
	{ palette: 'steel', words: ['celik', 'çelik', 'steel', 'kilic', 'kılıç', 'sword', 'blade', 'zirh', 'zırh', 'armor', 'armour'] },
	{ palette: 'iron', words: ['demir', 'iron', 'metal'] },
	{ palette: 'banner', words: ['sancak', 'banner', 'bayrak', 'flag', 'flama'] },
	{ palette: 'fabric', words: ['kumas', 'kumaş', 'fabric', 'cloth', 'perde', 'curtain', 'elbise'] },
	{ palette: 'leather', words: ['deri', 'leather', 'hide'] },
	{ palette: 'glass', words: ['cam pencere', 'glass', 'window', 'pencere', 'vitray'] },

	// --- Yol ---
	{ palette: 'road-cobble', words: ['tas yol', 'taş yol', 'cobble', 'kaldirim', 'kaldırım', 'paved'] },
	{ palette: 'path', words: ['patika', 'path', 'trail', 'footpath'] },
	{ palette: 'bridge', words: ['kopru', 'köprü', 'bridge'] },
	{ palette: 'road-dirt', words: ['yol', 'road', 'route'] },
]);

/**
 * Category fallbacks — used when no keyword matched, so an unnamed asset still gets something
 * sensible from its editor category rather than nothing.
 * @type {Readonly<Record<string, string>>}
 */
const CATEGORY_FALLBACKS = Object.freeze({
	'ejderha': 'dragon-black',
	'canli': 'fur',
	'canlı': 'fur',
	'hayvan': 'horse-bay',
	'npc': 'peasant',
	'asker': 'soldier',
	'insan': 'man',
	'bina': 'castle',
	'mimari': 'castle',
	'yapi': 'house',
	'yapı': 'house',
	'doga': 'tree',
	'doğa': 'tree',
	'arazi': 'grass',
	'yol': 'road-dirt',
	'su': 'water',
	'gok': 'moon',
	'gök': 'moon',
});

/** Category fallbacks may name a pattern rather than a palette; resolve those to a real palette. */
const PATTERN_FALLBACK_PALETTE = Object.freeze({ fur: 'wolf' });


/**
 * Word-aware keyword test.
 *
 * A plain `includes()` is wrong for both languages here: it matched "ana" inside "Ana Yol Segmenti"
 * and dressed a road as a woman, and it would match "at" (horse) inside "kanat" (wing). So matching
 * is done per token, with a suffix allowance sized to the keyword — Turkish is agglutinative, so
 * "kale" must still match "kalesi"/"kaleler", but two-letter words like "at"/"ay"/"su"/"ev" only
 * ever match exactly, because almost any allowance turns them into false positives.
 *
 * Multi-word keywords ("siyah ejderha") are specific enough to stay a plain substring test.
 * @param {string} text Normalized haystack.
 * @param {string} needle Normalized keyword.
 * @returns {boolean}
 */
function matchesWord(text, needle) {
	if (needle.includes(' ')) return text.includes(needle);
	for (const token of text.split(' ')) {
		if (token === needle) return true;
		if (!token.startsWith(needle)) continue;
		const suffixLength = token.length - needle.length;
		if (needle.length >= 4 && suffixLength <= 4) return true;
		if (needle.length === 3 && suffixLength <= 3) return true;
	}
	return false;
}

/**
 * @typedef {object} MatchResult
 * @property {string} paletteId
 * @property {import('./palettes.js').Palette} palette
 * @property {number} score Higher = more confident. 0 means "default, nothing actually matched".
 * @property {string} reason Human-readable explanation, shown in the editor toast.
 */

/**
 * Picks the best palette for a figure.
 *
 * @param {object} figure
 * @param {string} [figure.id] Asset id (`black-dragon`).
 * @param {string} [figure.name] Display or object name, Turkish or English.
 * @param {string} [figure.category] Editor category.
 * @param {string} [figure.src] Source path/filename.
 * @returns {MatchResult}
 */
export function matchPalette({ id = '', name = '', category = '', src = '' } = {}) {
	// The name is the most intentional signal (a user renames an object to say what it is), then the
	// asset id, then the file path. Weighted so a rename wins over a stale id.
	const fields = [
		{ text: normalizeText(name), weight: 3 },
		{ text: normalizeText(id), weight: 2 },
		{ text: normalizeText(src), weight: 1 },
	];

	let best = null;
	for (const rule of KEYWORD_RULES) {
		if (!PALETTES[rule.palette]) continue;
		for (const word of rule.words) {
			const needle = normalizeText(word);
			if (!needle) continue;
			for (const field of fields) {
				if (!matchesWord(field.text, needle)) continue;
				// Longer keywords are more specific, so they outrank short generic ones.
				// Priority dominates, then field weight, then keyword length — so an explicitly more
				// specific rule (wing) wins over a longer but more generic keyword (dragon).
				const score = (rule.priority ?? 0) * 1000 + field.weight * 10 + needle.length;
				if (!best || score > best.score) {
					best = { paletteId: rule.palette, score, matchedWord: word };
				}
			}
		}
	}

	if (best) {
		return {
			paletteId: best.paletteId,
			palette: PALETTES[best.paletteId],
			score: best.score,
			reason: `"${best.matchedWord}" eşleşmesi`,
		};
	}

	const categoryKey = normalizeText(category);
	const fallback = CATEGORY_FALLBACKS[categoryKey];
	if (fallback) {
		const paletteId = PATTERN_FALLBACK_PALETTE[fallback] || fallback;
		if (PALETTES[paletteId]) {
			return {
				paletteId,
				palette: PALETTES[paletteId],
				score: 1,
				reason: `"${category}" kategorisi`,
			};
		}
	}

	return {
		paletteId: 'stone',
		palette: PALETTES.stone,
		score: 0,
		reason: 'eşleşme yok — varsayılan taş',
	};
}

/**
 * Every palette a query could plausibly mean, best first. Backs a future "bunlardan birini seç"
 * picker in the editor without re-running the matcher per candidate.
 * @param {string} query
 * @param {number} [limit]
 * @returns {import('./palettes.js').Palette[]}
 */
export function suggestPalettes(query, limit = 8) {
	const text = normalizeText(query);
	if (!text) return [];
	const scored = [];
	for (const id of PALETTE_IDS) {
		const palette = PALETTES[id];
		const label = normalizeText(palette.label);
		const idText = normalizeText(id);
		let score = 0;
		if (idText === text || label === text) score = 100;
		else if (label.includes(text) || idText.includes(text)) score = 50 + text.length;
		else if (normalizeText(palette.family).includes(text)) score = 20;
		if (score > 0) scored.push({ palette, score });
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.palette);
}
