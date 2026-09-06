/**
 * Figure/surface kits — how a *kind* of renderable asset is dressed part by part.
 *
 * A kit answers two separate questions:
 *   1. `slots`  — if a part was identified by name (eyes, claws, tunic, roof, window...), which
 *                 palette does it get?
 *   2. `bands`  — if nothing could be identified (a single unnamed mesh with one material, which is
 *                 exactly what `peasant-girl` and some settlement houses are), how should the asset
 *                 be dressed by height?
 *
 * The band fallback is the interesting half. Most character models in this project arrive as one
 * mesh with one material and no part names at all, so name-based classification has nothing to work
 * with. Rather than give up and paint the whole person one colour — the flaw this system exists to
 * fix — the bands describe a figure vertically: boots at the bottom, trousers, tunic, then skin and
 * hair at the top. Authored structures use the same fallback principle for footing/wall/timber/roof.
 * `layeredMaterial.js` turns those bands into a single shader that blends the textures by object-space
 * height, so one draw call can still retain surface hierarchy.
 *
 * Bands are expressed as normalized heights over the mesh's own bounding box (0 = bottom, 1 = top),
 * so they follow the model whatever its real scale is.
 * @module materials/figureKits
 */

/**
 * @typedef {object} FigureKit
 * @property {string} id
 * @property {string} label Turkish display name.
 * @property {string} base Palette for any identified part with no explicit slot mapping.
 * @property {Record<string, string>} slots slot -> palette id.
 * @property {{to: number, palette: string}[]} [bands] Vertical fallback, bottom to top; `to` is the
 *   normalized height where this band ends. The final band should end at 1.
 * @property {string[]} [variantSlots] Slots that may vary between individuals (see `pickVariant`).
 */

/** Alternatives used to make individuals differ without breaking determinism. */
const VARIANTS = Object.freeze({
	skin: ['skin-fair', 'skin-olive', 'skin-brown', 'skin-deep'],
	hair: ['hair-black', 'hair-blonde', 'hair-red'],
	eye: ['eye-brown', 'eye-blue', 'eye-green', 'eye-amber'],
	tunic: ['tunic-green', 'tunic-blue', 'tunic-red', 'tunic-cream'],
	trousers: ['trousers-brown', 'trousers-grey'],
});

/** @type {Readonly<Record<string, FigureKit>>} */
export const FIGURE_KITS = Object.freeze({
	human: {
		id: 'human',
		label: 'İnsan',
		base: 'skin-olive',
		slots: {
			skin: 'skin-olive', hair: 'hair-black', eye: 'eye-brown',
			tunic: 'tunic-green', trousers: 'trousers-brown', boot: 'boot',
			belt: 'belt', cloak: 'cloak', helmet: 'steel', armor: 'steel', tooth: 'tooth',
		},
		// Feet -> crown. Proportions follow a standing human: boots to the ankle, trousers to the
		// hip, tunic to the shoulder, then head.
		bands: [
			{ to: 0.09, palette: 'boot' },
			{ to: 0.46, palette: 'trousers-brown' },
			{ to: 0.50, palette: 'belt' },
			{ to: 0.82, palette: 'tunic-green' },
			{ to: 0.90, palette: 'skin-olive' },
			{ to: 1.00, palette: 'hair-black' },
		],
		variantSlots: ['skin', 'hair', 'eye', 'tunic', 'trousers'],
	},

	soldier: {
		id: 'soldier',
		label: 'Asker',
		base: 'steel',
		slots: {
			skin: 'skin-olive', hair: 'hair-black', eye: 'eye-brown',
			armor: 'steel', helmet: 'steel', tunic: 'tunic-red', trousers: 'trousers-grey',
			boot: 'boot', belt: 'belt', cloak: 'banner',
		},
		bands: [
			{ to: 0.10, palette: 'boot' },
			{ to: 0.44, palette: 'trousers-grey' },
			{ to: 0.50, palette: 'belt' },
			{ to: 0.84, palette: 'steel' },
			{ to: 0.90, palette: 'skin-olive' },
			{ to: 1.00, palette: 'steel' },
		],
		variantSlots: ['skin', 'eye'],
	},

	dragon: {
		id: 'dragon',
		label: 'Ejderha',
		base: 'dragon-black',
		slots: {
			scale: 'dragon-black', skin: 'dragon-black', fur: 'dragon-black',
			wing: 'dragon-wing', eye: 'eye-dragon', tooth: 'tooth',
			claw: 'claw', horn: 'horn', tongue: 'tongue',
		},
		bands: [
			{ to: 0.35, palette: 'dragon-black' },
			{ to: 1.00, palette: 'dragon-black' },
		],
	},

	wolf: {
		id: 'wolf',
		label: 'Kurt',
		base: 'wolf',
		slots: {
			fur: 'wolf', skin: 'wolf', mane: 'wolf',
			eye: 'eye-amber', tooth: 'tooth', claw: 'claw', tongue: 'tongue',
		},
		bands: [{ to: 1.00, palette: 'wolf' }],
	},

	horse: {
		id: 'horse',
		label: 'At',
		base: 'horse-bay',
		slots: {
			fur: 'horse-bay', skin: 'horse-bay', mane: 'hair-black',
			eye: 'eye-brown', hoof: 'hoof', tooth: 'tooth',
		},
		bands: [
			{ to: 0.14, palette: 'hoof' },
			{ to: 1.00, palette: 'horse-bay' },
		],
		variantSlots: ['eye'],
	},

	beast: {
		id: 'beast',
		label: 'Hayvan',
		base: 'wolf',
		slots: {
			fur: 'wolf', skin: 'wolf', mane: 'hair-black', eye: 'eye-brown',
			tooth: 'tooth', claw: 'claw', hoof: 'hoof', horn: 'horn', tongue: 'tongue',
			feather: 'chicken', scale: 'fish',
		},
		bands: [{ to: 1.00, palette: 'wolf' }],
		variantSlots: ['eye'],
	},

	castle: {
		id: 'castle',
		label: 'Kale',
		base: 'castle',
		slots: { armor: 'iron', tunic: 'banner', cloak: 'banner' },
		// Stone footing, walls, then roofing — the vertical make-up of a real keep.
		bands: [
			{ to: 0.18, palette: 'rock' },
			{ to: 0.78, palette: 'castle' },
			{ to: 1.00, palette: 'roof-tile' },
		],
	},

	house: {
		id: 'house',
		label: 'Ev',
		base: 'house',
		// The dominant wall deliberately has no fixed slot. Its palette is the matched main palette
		// (`house`, `brick`, `plaster`...), which lets a destination region keep authority over the
		// façade while artist-authored detail names retain their own physically distinct surfaces.
		slots: {
			armor: 'iron',
			'structure-window': 'glass',
			'structure-door': 'wood',
			'structure-thatch': 'thatch',
			'structure-roof': 'roof-tile',
			'structure-brick': 'brick',
			'structure-plaster': 'plaster',
			'structure-stone': 'stone',
			'structure-timber': 'wood',
			'structure-metal': 'iron',
		},
		bands: [
			{ to: 0.12, palette: 'stone' },
			{ to: 0.62, palette: 'house' },
			{ to: 0.70, palette: 'wood' },
			{ to: 1.00, palette: 'thatch' },
		],
	},

	tree: {
		id: 'tree',
		label: 'Ağaç',
		base: 'tree',
		slots: { fur: 'bark', skin: 'bark' },
		bands: [
			{ to: 0.34, palette: 'bark' },
			{ to: 1.00, palette: 'tree' },
		],
	},
});

/** Palette-id prefixes that imply a kit, checked before the generic family fallback. */
const PALETTE_TO_KIT = Object.freeze([
	{ test: (id) => id.startsWith('dragon-'), kit: 'dragon' },
	{ test: (id) => id.startsWith('horse-'), kit: 'horse' },
	{ test: (id) => id === 'wolf', kit: 'wolf' },
	{ test: (id) => ['soldier', 'knight'].includes(id), kit: 'soldier' },
	{ test: (id) => ['man', 'woman', 'child', 'peasant', 'noble', 'monk'].includes(id) || id.startsWith('skin-'), kit: 'human' },
	{ test: (id) => id.startsWith('castle'), kit: 'castle' },
	{ test: (id) => ['house', 'brick', 'thatch', 'roof-tile', 'plaster'].includes(id), kit: 'house' },
	{ test: (id) => ['tree', 'pine', 'leaf', 'bush', 'bark'].includes(id), kit: 'tree' },
]);

/** Palette families that map to a kit when no prefix rule hit. */
const FAMILY_TO_KIT = Object.freeze({ Hayvan: 'beast', İnsan: 'human', Ejderha: 'dragon' });

/**
 * Picks the kit for a matched palette, or null when the palette is a plain surface (stone, water,
 * road) that has no part structure worth modelling.
 * @param {import('./palettes.js').Palette|null} palette
 * @returns {FigureKit|null}
 */
export function kitForPalette(palette) {
	if (!palette) return null;
	for (const rule of PALETTE_TO_KIT) {
		if (rule.test(palette.id)) return FIGURE_KITS[rule.kit] || null;
	}
	const familyKit = FAMILY_TO_KIT[palette.family];
	return familyKit ? FIGURE_KITS[familyKit] || null : null;
}

/**
 * Deterministically picks one option for a variable slot, so two peasants in a scene differ in skin
 * tone and tunic colour while the same peasant is identical on every reload.
 * @param {string} slot
 * @param {number} seed
 * @returns {string|null}
 */
export function pickVariant(slot, seed) {
	const options = VARIANTS[slot];
	if (!options) return null;
	return options[Math.abs(seed) % options.length];
}

/**
 * Resolves a kit into concrete palette ids for this individual, applying deterministic variation to
 * the slots the kit marks as variable and keeping the vertical bands consistent with them.
 * @param {FigureKit} kit
 * @param {number} seed
 * @returns {{slots: Record<string, string>, bands: {to: number, palette: string}[], base: string}}
 */
export function resolveKit(kit, seed) {
	const slots = { ...kit.slots };
	const chosen = {};
	for (const slot of kit.variantSlots || []) {
		// Offset per slot so skin and hair do not vary in lockstep across a crowd.
		const picked = pickVariant(slot, seed + slot.length * 7919);
		if (picked) {
			slots[slot] = picked;
			chosen[slot] = picked;
		}
	}
	// Keep the band fallback in step with the variant choices, otherwise an unnamed mesh would wear
	// the kit's default tunic while a named one wore the varied colour.
	const bands = (kit.bands || []).map((band) => {
		for (const [slot, palette] of Object.entries(chosen)) {
			if (band.palette === kit.slots[slot]) return { ...band, palette };
		}
		return { ...band };
	});
	return { slots, bands, base: slots.skin || kit.base };
}
