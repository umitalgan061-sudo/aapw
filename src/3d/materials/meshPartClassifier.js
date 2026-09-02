/**
 * Mesh/material -> body-part and authored-structure surface classification.
 *
 * A figure is not one surface. Dressing a whole character in a single texture is what the first
 * version of this library did, and it is wrong: a person needs separate skin, hair, eyes, tunic,
 * trousers and boots; a wolf needs fur, claws, teeth and eyes; a dragon needs scales, wing membrane
 * and eyes. The same rule applies to authored architecture: a named roof, timber frame, window,
 * door, footing or plaster slot should not be flattened into the wall material.
 *
 * Classification is name-driven because that is what the project's real assets actually carry —
 * verified by inspecting them rather than assumed:
 *   - `wolf`   : meshes `Wolf2_fur`, `Wolf3_claws`, `Wolf3_eyes`, `Wolf3_teeth`; materials
 *                `Wolf_Fur`, `Wolf_claws`, `Wolf Eyes`, `Wolf Teeth`.
 *   - `dragon` : ONE mesh carrying FIVE materials (`Game_dragon.002/.003`, `EYES.001`, ...), so
 *                classification must run per material slot, not per mesh.
 *   - `paladin`: meshes `Paladin_J_Nordstrom_Helmet` + `Paladin_J_Nordstrom`, one shared material.
 *   - `peasant-girl`: a single mesh with a single material and no part hint at all.
 *
 * That last case is why `classifyPart` is allowed to return `null`: callers fall back to the layered
 * vertical-band material (`layeredMaterial.js`) instead of pretending a slot was identified.
 * @module materials/meshPartClassifier
 */

import { normalizeText } from './textureMatcher.js';

/**
 * Slot keywords, Turkish + English. Order matters only through `priority`; a longer keyword beats a
 * shorter one at equal priority, same rule the palette matcher uses.
 *
 * Structure slots deliberately avoid generic bare substance names such as `wood`, `stone`, `glass`
 * and `metal`. Those are useful signals only after the caller knows it is dressing architecture;
 * making them global would relabel unrelated props, vegetation and equipment. A narrow contextual
 * fallback below permits those exact substances only when the mesh itself is explicitly a building.
 * Generic `wall` likewise remains unclassified so the destination architecture policy can decide
 * whether to preserve or replace the façade.
 * @type {ReadonlyArray<{slot: string, priority?: number, words: string[]}>}
 */
const SLOT_RULES = Object.freeze([
	// Eyes first: "eye" is short but must never lose to a body-wide keyword sharing the mesh name.
	{ slot: 'eye', priority: 2, words: ['eye', 'eyes', 'iris', 'pupil', 'goz', 'göz', 'gozler'] },
	{ slot: 'tooth', priority: 2, words: ['tooth', 'teeth', 'fang', 'tusk', 'dis', 'diş', 'disler'] },
	{ slot: 'claw', priority: 2, words: ['claw', 'claws', 'talon', 'nail', 'pence', 'pençe', 'tirnak', 'tırnak'] },
	{ slot: 'horn', priority: 2, words: ['horn', 'horns', 'antler', 'boynuz'] },
	{ slot: 'hoof', priority: 2, words: ['hoof', 'hooves', 'toynak'] },
	{ slot: 'tongue', priority: 2, words: ['tongue', 'dil'] },
	{ slot: 'wing', priority: 2, words: ['wing', 'wings', 'membrane', 'kanat', 'kanad'] },

	{ slot: 'hair', priority: 1, words: ['hair', 'beard', 'moustache', 'braid', 'sac', 'saç', 'sakal', 'bıyık', 'biyik'] },
	// A named helmet mesh is more specific than a generic `plate` material shared across an armour
	// set. Keep the helmet identity dominant so architecture work cannot regress existing equipment
	// semantics merely because material-name weighting is intentionally stronger than mesh-name weight.
	{ slot: 'helmet', priority: 2, words: ['helmet', 'helm', 'hood', 'cap', 'kask', 'miğfer', 'migfer', 'baslik', 'başlık'] },
	{ slot: 'boot', priority: 1, words: ['boot', 'boots', 'shoe', 'shoes', 'foot', 'feet', 'cizme', 'çizme', 'ayakkabi', 'ayakkabı'] },
	{ slot: 'belt', priority: 1, words: ['belt', 'buckle', 'strap', 'kemer', 'toka'] },
	{ slot: 'cloak', priority: 1, words: ['cloak', 'cape', 'mantle', 'pelerin', 'harmani', 'harmaniye'] },
	{ slot: 'trousers', priority: 1, words: ['trouser', 'trousers', 'pants', 'leg', 'legs', 'skirt', 'pantolon', 'bacak', 'etek'] },
	{ slot: 'tunic', priority: 1, words: ['tunic', 'shirt', 'robe', 'dress', 'torso', 'chest', 'cloth', 'coat', 'jacket', 'gomlek', 'gömlek', 'giysi', 'elbise', 'govde', 'gövde'] },
	// Explicit equipment nouns are stronger contextual evidence than a structural-looking material
	// such as `Wooden_Plank`. Keep this narrow: generic `plate`/`mail` remain at normal armour priority,
	// while shield/sword/weapon meshes cannot be re-owned by the settlement architecture classifier.
	{ slot: 'armor', priority: 4, words: ['shield', 'sword', 'blade', 'weapon', 'kalkan', 'kilic', 'kılıç', 'silah'] },
	{ slot: 'armor', priority: 1, words: ['armor', 'armour', 'plate', 'mail', 'zirh', 'zırh'] },
	{ slot: 'skin', priority: 1, words: ['skin', 'head', 'face', 'body', 'hand', 'arm', 'flesh', 'cilt', 'ten', 'kafa', 'yuz', 'yüz', 'el', 'kol'] },

	// Authored architecture. Strong, explicit nouns only; generic walls and bare substances stay
	// contextual so one shared classifier does not accidentally own every wooden/stone object.
	// Window nouns receive the highest explicit-structure priority because Turkish `pencere` begins
	// with the normalized claw token `pence`. The shared suffix matcher intentionally accepts inflected
	// creature words (for example `penceler`), so an exact architectural window noun must outrank that
	// lexical prefix without weakening animal classification globally.
	{ slot: 'structure-window', priority: 3, words: ['window', 'windows', 'windowpane', 'glass pane', 'pencere', 'vitray'] },
	{ slot: 'structure-door', priority: 1, words: ['door', 'doors', 'doorway', 'doorframe', 'kapi', 'kapı'] },
	{ slot: 'structure-thatch', priority: 1, words: ['thatch', 'thatched', 'straw roof', 'reed roof', 'saman cati', 'saman çatı'] },
	{ slot: 'structure-roof', priority: 1, words: ['roof', 'roofing', 'roof tile', 'rooftile', 'shingle', 'shingles', 'slate roof', 'cati', 'çatı', 'kiremit'] },
	{ slot: 'structure-brick', words: ['brick', 'brickwork', 'tugla', 'tuğla'] },
	{ slot: 'structure-plaster', words: ['plaster', 'stucco', 'render coat', 'siva', 'sıva'] },
	// `footing` begins with the body keyword `foot`. Give explicit foundation/masonry language the
	// same semantic priority as other authored structure roles so a building foundation cannot be
	// dressed as a boot. Material-name weight still makes artist-authored foundation semantics win.
	{ slot: 'structure-stone', priority: 1, words: ['stonework', 'masonry', 'foundation', 'footing', 'rubble stone', 'tas temel', 'taş temel'] },
	// A window frame is structural timber, not glazing. It contains the high-priority `window` token,
	// so the explicit compound must beat the generic window rule when both are expressed on the same
	// naming field. Keep it at the same priority as glazing so an artist-authored `Window_Glass`
	// material (the stronger field) can still override a parent mesh named `House_Window_Frame`.
	// Bare `frame` stays excluded: frames also occur on shields, carts and other non-building assets.
	{ slot: 'structure-timber', priority: 3, words: ['window frame', 'windowframe', 'pencere cerceve', 'pencere çerçeve', 'timber', 'wooden beam', 'wood beam', 'plank', 'rafter', 'joist', 'log wall', 'ahsap', 'ahşap', 'tahta'] },
	// Artist-authored fitting materials (for example Wrought_Iron_Hinge on a mesh named Door)
	// describe the surface more precisely than the parent mesh. Keep that metal treatment dominant
	// without making bare "iron"/"metal" global classifier words.
	{ slot: 'structure-metal', priority: 2, words: ['hinge', 'door handle', 'latch', 'ironwork', 'wrought iron', 'metal trim', 'metal fitting'] },

	{ slot: 'fur', words: ['fur', 'pelt', 'coat', 'hide', 'kurk', 'kürk', 'post', 'tuy', 'tüy'] },
	{ slot: 'scale', words: ['scale', 'scales', 'pul', 'pullar'] },
	{ slot: 'feather', words: ['feather', 'plume', 'tuy', 'kanat tuyu'] },
	{ slot: 'mane', words: ['mane', 'tail', 'yele', 'kuyruk'] },
]);

const ARCHITECTURE_CONTEXT_WORDS = Object.freeze([
	'house', 'cottage', 'cabin', 'building', 'dwelling', 'home', 'hut', 'ev', 'kulube', 'kulübe',
]);

const CONTEXTUAL_STRUCTURE_MATERIALS = Object.freeze(new Map([
	['wood', 'structure-timber'],
	['wood light', 'structure-timber'],
	['wood dark', 'structure-timber'],
	['wood side', 'structure-timber'],
	['stone', 'structure-stone'],
	['stone light', 'structure-stone'],
	['stone dark', 'structure-stone'],
	['rock', 'structure-stone'],
	['glass', 'structure-window'],
	['iron', 'structure-metal'],
	// `normalizeText` intentionally maps Turkish uppercase I -> dotless ı. Imported English assets
	// frequently capitalize `Iron`, so preserve that canonical English material family without
	// weakening the global fail-closed rule for bare metal substances outside building context.
	['ıron', 'structure-metal'],
	['metal', 'structure-metal'],
	['steel', 'structure-metal'],
]));

// Imported vehicle/prop meshes commonly use names such as CartBody/WagonBody. Generic anatomy
// suffixes on those non-character contexts must preserve authored materials just like ToolHead does.
const NON_CHARACTER_CONTEXT_WORDS = Object.freeze(['tool', 'cart', 'wagon', 'carriage']);
const GENERIC_SKIN_WORDS = Object.freeze(new Set(['head', 'body', 'hand', 'arm']));

/**
 * Word-boundary match with the same Turkish-aware suffix allowance the palette matcher uses, but
 * additionally splitting on digits and camelCase — asset names are `Wolf3_eyes_0`, `Paladin_J_Nordstrom_Helmet`,
 * `Game_dragon.002`, so tokens only appear once numbers and case transitions are treated as separators.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
	return normalizeText(
		String(text ?? '')
			.replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
			.replace(/\d+/g, ' '),
	).split(' ').filter(Boolean);
}

function contextualArchitectureMatch(meshName, materialName) {
	const meshTokens = tokenize(meshName);
	if (!meshTokens.some((token) => ARCHITECTURE_CONTEXT_WORDS.includes(token))) return null;
	const materialKey = tokenize(materialName).join(' ');
	const slot = CONTEXTUAL_STRUCTURE_MATERIALS.get(materialKey);
	if (!slot) return null;
	// Stronger than generic body/clothing vocabulary, weaker than explicit structural/equipment nouns.
	return { slot, score: 1500 + materialKey.length, matchedWord: materialKey, contextual: true };
}

function suppressNonCharacterAnatomy(meshName, match) {
	if (match?.slot !== 'skin' || !GENERIC_SKIN_WORDS.has(match.matchedWord)) return false;
	const meshTokens = tokenize(meshName);
	return meshTokens.some((token) => NON_CHARACTER_CONTEXT_WORDS.includes(token));
}

/**
 * Classifies one mesh/material name pair into a body-part or authored-structure slot.
 *
 * @param {object} input
 * @param {string} [input.meshName]
 * @param {string} [input.materialName]
 * @returns {{slot: string, score: number, matchedWord: string}|null} Null when nothing identifiable
 *   was found — the caller must then decide what to do, rather than receiving a wrong guess.
 */
export function classifyPart({ meshName = '', materialName = '' } = {}) {
	// Material name is the stronger signal: an artist names a material for what it *is*, while mesh
	// names often just carry the model's own name (`Wolf1_Material__wolf_col_tga_0`).
	const fields = [
		{ tokens: tokenize(materialName), weight: 3 },
		{ tokens: tokenize(meshName), weight: 2 },
	];

	let best = null;
	for (const rule of SLOT_RULES) {
		for (const word of rule.words) {
			const needle = normalizeText(word);
			if (!needle) continue;
			for (const field of fields) {
				if (!matchesToken(field.tokens, needle)) continue;
				const score = (rule.priority ?? 0) * 1000 + field.weight * 10 + needle.length;
				if (!best || score > best.score) best = { slot: rule.slot, score, matchedWord: word };
			}
		}
	}

	const contextual = contextualArchitectureMatch(meshName, materialName);
	if (contextual && (!best || contextual.score > best.score)) best = contextual;
	// Compound prop names such as `ToolHead`/`CartBody` are common in imported models. Their generic
	// anatomy suffix must not turn a non-character object into skin; preserve its authored material
	// unless a stronger explicit equipment/structure semantic exists.
	if (!contextual && suppressNonCharacterAnatomy(meshName, best)) return null;
	return best;
}

/**
 * @param {string[]} tokens
 * @param {string} needle
 * @returns {boolean}
 */
function matchesToken(tokens, needle) {
	if (needle.includes(' ')) return tokens.join(' ').includes(needle);
	for (const token of tokens) {
		if (token === needle) return true;
		if (!token.startsWith(needle)) continue;
		const suffix = token.length - needle.length;
		if (needle.length >= 4 && suffix <= 4) return true;
		if (needle.length === 3 && suffix <= 3) return true;
	}
	return false;
}

/**
 * Walks an object and reports every dressable surface with its classification.
 *
 * Multi-material meshes are expanded into one entry per material index, because the dragon in this
 * project is a single mesh carrying five materials — treating it as one surface would flatten the
 * eyes and wing into the body scales. Architecture uses the same per-slot rule for authored roofs,
 * windows, doors and structural trims.
 *
 * @param {import('three').Object3D} root
 * @returns {{mesh: object, materialIndex: number, meshName: string, materialName: string, slot: string|null}[]}
 */
export function surveyParts(root) {
	const surfaces = [];
	if (!root) return surfaces;
	root.traverse((child) => {
		if (!child.isMesh && !child.isInstancedMesh) return;
		const materials = Array.isArray(child.material) ? child.material : [child.material];
		materials.forEach((material, materialIndex) => {
			const meshName = child.name || '';
			const materialName = material?.name || '';
			const match = classifyPart({ meshName, materialName });
			surfaces.push({
				mesh: child,
				materialIndex,
				meshName,
				materialName,
				slot: match ? match.slot : null,
				matchedWord: match ? match.matchedWord : null,
			});
		});
	});
	return surfaces;
}