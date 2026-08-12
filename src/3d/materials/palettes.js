/**
 * Colour-palette catalogue for every figure family the project can dress.
 *
 * Each entry is a small, deliberately readable record rather than a single flat colour, because a
 * believable surface needs a *range*: `base` carries the identity, `dark`/`light` drive the shading
 * pass so detail reads at distance, and `accent` is the material's distinguishing mark (a dragon's
 * belly, a soldier's tabard, moss in a stone crack).
 *
 * `pattern` names the drawing routine in `texturePatterns.js` / `dragonTextures.js` that paints this
 * family; `roughness`/`metalness` are the PBR hints applied alongside the generated map so a gold
 * ring and a wool cloak do not end up with the same shading response.
 *
 * All values are authored here from scratch as a generic medieval/fantasy palette. Nothing is traced
 * from, sampled from, or derived from real HBO Game of Thrones material — GOVERNANCE.md's single
 * hard constraint.
 * @module materials/palettes
 */

/**
 * @typedef {object} Palette
 * @property {string} id Stable key used by the matcher and by serialized scenes.
 * @property {string} label Turkish display name (in-game/editor text is Turkish per GOVERNANCE.md §20).
 * @property {string} family Grouping used by the editor UI.
 * @property {number} base Identity colour.
 * @property {number} dark Shadow/crevice colour.
 * @property {number} light Highlight colour.
 * @property {number} accent Distinguishing secondary colour.
 * @property {string} pattern Drawing routine key.
 * @property {number} roughness PBR roughness hint (0 = mirror, 1 = fully diffuse).
 * @property {number} metalness PBR metalness hint.
 * @property {number} [emissive] Optional self-illumination colour (sun, moon, lava, fire).
 * @property {number} [emissiveIntensity]
 */

/** @type {(entries: Palette[]) => Readonly<Record<string, Palette>>} */
function indexById(entries) {
	const table = {};
	for (const entry of entries) table[entry.id] = Object.freeze(entry);
	return Object.freeze(table);
}

/* ---------------------------------------------------------------------------------------------
 * İNSANLAR — skin tones are authored as a neutral, non-caricatured range (four tones spanning fair
 * to deep), with clothing/armour kept separate so a figure's skin and outfit can be matched apart.
 * ------------------------------------------------------------------------------------------- */
const HUMAN = [
	{ id: 'skin-fair', label: 'Ten — Açık', family: 'İnsan', base: 0xe8c4a8, dark: 0xc39a7d, light: 0xf6ddc8, accent: 0xb87f6a, pattern: 'skin', roughness: 0.72, metalness: 0 },
	{ id: 'skin-olive', label: 'Ten — Buğday', family: 'İnsan', base: 0xd2a578, dark: 0xa87c52, light: 0xe8c49b, accent: 0x9c6b48, pattern: 'skin', roughness: 0.72, metalness: 0 },
	{ id: 'skin-brown', label: 'Ten — Esmer', family: 'İnsan', base: 0xa9713f, dark: 0x7d4f28, light: 0xc7915c, accent: 0x6d4224, pattern: 'skin', roughness: 0.72, metalness: 0 },
	{ id: 'skin-deep', label: 'Ten — Koyu', family: 'İnsan', base: 0x6b4326, dark: 0x452a17, light: 0x8d5f38, accent: 0x3a2213, pattern: 'skin', roughness: 0.7, metalness: 0 },
	{ id: 'man', label: 'Erkek', family: 'İnsan', base: 0x5a6b7d, dark: 0x3a4653, light: 0x7d8fa1, accent: 0x8a6a4a, pattern: 'fabric', roughness: 0.85, metalness: 0 },
	{ id: 'woman', label: 'Kadın', family: 'İnsan', base: 0x8a5a72, dark: 0x5e3a4d, light: 0xb07d95, accent: 0xd4a05e, pattern: 'fabric', roughness: 0.85, metalness: 0 },
	{ id: 'child', label: 'Çocuk', family: 'İnsan', base: 0xc9b48e, dark: 0x998663, light: 0xe3d3b4, accent: 0x7d9c6a, pattern: 'fabric', roughness: 0.88, metalness: 0 },
	{ id: 'peasant', label: 'Köylü', family: 'İnsan', base: 0x9c8563, dark: 0x6b5a42, light: 0xbfa787, accent: 0x6d5336, pattern: 'fabric', roughness: 0.92, metalness: 0 },
	{ id: 'noble', label: 'Soylu', family: 'İnsan', base: 0x6b2f4a, dark: 0x431b2d, light: 0x9c5372, accent: 0xd4af37, pattern: 'fabric', roughness: 0.6, metalness: 0.05 },
	{ id: 'soldier', label: 'Asker', family: 'İnsan', base: 0x707a82, dark: 0x454d54, light: 0x9aa4ad, accent: 0x8c2f2f, pattern: 'metal', roughness: 0.42, metalness: 0.75 },
	{ id: 'knight', label: 'Şövalye', family: 'İnsan', base: 0xa8b0b8, dark: 0x6d757d, light: 0xd6dde3, accent: 0x2f5c8c, pattern: 'metal', roughness: 0.28, metalness: 0.9 },
	{ id: 'monk', label: 'Rahip', family: 'İnsan', base: 0x6b5a3f, dark: 0x453a28, light: 0x8d7a58, accent: 0xd8cbb0, pattern: 'fabric', roughness: 0.94, metalness: 0 },
	{ id: 'hair-black', label: 'Saç — Siyah', family: 'İnsan', base: 0x2a2422, dark: 0x141110, light: 0x4a403c, accent: 0x5d514a, pattern: 'fur', roughness: 0.62, metalness: 0 },
	{ id: 'hair-blonde', label: 'Saç — Sarı', family: 'İnsan', base: 0xc9a961, dark: 0x94793f, light: 0xe6cf92, accent: 0xa88a4a, pattern: 'fur', roughness: 0.6, metalness: 0 },
	{ id: 'hair-red', label: 'Saç — Kızıl', family: 'İnsan', base: 0x9c4a24, dark: 0x6b3016, light: 0xc4703f, accent: 0x7d3a1c, pattern: 'fur', roughness: 0.6, metalness: 0 },
];

/* ---------------------------------------------------------------------------------------------
 * PARÇA SLOTLARI — the small, specific materials a single figure needs alongside its main surface.
 * A person is not one texture: eyes, hair, tunic, trousers and boots are all different materials on
 * the same body, and a wolf has claws, teeth and eyes distinct from its fur. These exist so
 * `figureKits.js` can dress each part separately instead of painting a whole character one colour.
 * ------------------------------------------------------------------------------------------- */
const PARTS = [
	{ id: 'eye-brown', label: 'Göz — Kahve', family: 'Parça', base: 0x5a3a1e, dark: 0x140c06, light: 0xa8783f, accent: 0xf4f0e8, pattern: 'eye', roughness: 0.16, metalness: 0 },
	{ id: 'eye-blue', label: 'Göz — Mavi', family: 'Parça', base: 0x3a6b96, dark: 0x0d1520, light: 0x82b4d8, accent: 0xf4f0e8, pattern: 'eye', roughness: 0.16, metalness: 0 },
	{ id: 'eye-green', label: 'Göz — Yeşil', family: 'Parça', base: 0x4a7a45, dark: 0x0f1a0d, light: 0x90c47f, accent: 0xf4f0e8, pattern: 'eye', roughness: 0.16, metalness: 0 },
	{ id: 'eye-amber', label: 'Göz — Kehribar', family: 'Parça', base: 0xc4922a, dark: 0x2a1c06, light: 0xf0cf6b, accent: 0xfaf6ec, pattern: 'eye', roughness: 0.14, metalness: 0 },
	{ id: 'eye-dragon', label: 'Göz — Ejderha', family: 'Parça', base: 0xd4a017, dark: 0x160d02, light: 0xffe07a, accent: 0x8c2f1f, pattern: 'eye', roughness: 0.1, metalness: 0.1 },
	{ id: 'tooth', label: 'Diş', family: 'Parça', base: 0xe4dccb, dark: 0xa89c85, light: 0xf8f4ea, accent: 0xc4b49a, pattern: 'bone', roughness: 0.35, metalness: 0 },
	{ id: 'claw', label: 'Pençe', family: 'Parça', base: 0x3a332c, dark: 0x15110d, light: 0x6d6055, accent: 0x8a7a68, pattern: 'bone', roughness: 0.4, metalness: 0.05 },
	{ id: 'horn', label: 'Boynuz', family: 'Parça', base: 0x8a7a5e, dark: 0x4a3f2d, light: 0xc0ad8a, accent: 0x2f2820, pattern: 'bone', roughness: 0.55, metalness: 0 },
	{ id: 'hoof', label: 'Toynak', family: 'Parça', base: 0x40382f, dark: 0x1c1712, light: 0x6d5f4e, accent: 0x8a7a63, pattern: 'bone', roughness: 0.45, metalness: 0 },
	{ id: 'tongue', label: 'Dil', family: 'Parça', base: 0xa85f63, dark: 0x6b3538, light: 0xd08d90, accent: 0x7d4245, pattern: 'skin', roughness: 0.4, metalness: 0 },
	{ id: 'tunic-green', label: 'Üst Giysi — Yeşil', family: 'Parça', base: 0x4a6b42, dark: 0x2a4024, light: 0x77966b, accent: 0x8a7a52, pattern: 'fabric', roughness: 0.9, metalness: 0 },
	{ id: 'tunic-blue', label: 'Üst Giysi — Mavi', family: 'Parça', base: 0x3a5670, dark: 0x1e3242, light: 0x6d8fa8, accent: 0xc4b48a, pattern: 'fabric', roughness: 0.9, metalness: 0 },
	{ id: 'tunic-red', label: 'Üst Giysi — Kırmızı', family: 'Parça', base: 0x8a3a30, dark: 0x54201a, light: 0xb06a5e, accent: 0xd4c08a, pattern: 'fabric', roughness: 0.9, metalness: 0 },
	{ id: 'tunic-cream', label: 'Üst Giysi — Krem', family: 'Parça', base: 0xc9b894, dark: 0x94836a, light: 0xe6dcc4, accent: 0x8a6a4a, pattern: 'fabric', roughness: 0.92, metalness: 0 },
	{ id: 'trousers-brown', label: 'Alt Giysi — Kahve', family: 'Parça', base: 0x5e4a35, dark: 0x36291c, light: 0x877055, accent: 0x2f2419, pattern: 'fabric', roughness: 0.93, metalness: 0 },
	{ id: 'trousers-grey', label: 'Alt Giysi — Gri', family: 'Parça', base: 0x55565a, dark: 0x303134, light: 0x7d7e84, accent: 0x2a2b2e, pattern: 'fabric', roughness: 0.93, metalness: 0 },
	{ id: 'boot', label: 'Çizme', family: 'Parça', base: 0x4a3628, dark: 0x261a12, light: 0x6d5340, accent: 0x2a1d14, pattern: 'leather', roughness: 0.72, metalness: 0 },
	{ id: 'belt', label: 'Kemer', family: 'Parça', base: 0x3f2d20, dark: 0x1f150e, light: 0x634834, accent: 0xa8912f, pattern: 'leather', roughness: 0.68, metalness: 0.05 },
	{ id: 'cloak', label: 'Pelerin', family: 'Parça', base: 0x4a3a52, dark: 0x2a2030, light: 0x74617d, accent: 0x8a7a4a, pattern: 'fabric', roughness: 0.94, metalness: 0 },
];

/* ---------------------------------------------------------------------------------------------
 * EJDERHALAR — the family the owner asked to be treated with the most care, so each morph gets its
 * own scale colour, belly accent and shading range rather than a recoloured copy of one template.
 * Painted by `dragonTextures.js` (overlapping scale rows + ridge + belly plates), not the generic
 * pattern set.
 * ------------------------------------------------------------------------------------------- */
const DRAGON = [
	{ id: 'dragon-black', label: 'Ejderha — Siyah', family: 'Ejderha', base: 0x24262b, dark: 0x0e0f12, light: 0x474b54, accent: 0x8c2f1f, pattern: 'dragon-scales', roughness: 0.52, metalness: 0.18 },
	{ id: 'dragon-red', label: 'Ejderha — Kızıl', family: 'Ejderha', base: 0x7d2318, dark: 0x45100a, light: 0xb8452c, accent: 0xe8a33c, pattern: 'dragon-scales', roughness: 0.48, metalness: 0.16 },
	{ id: 'dragon-green', label: 'Ejderha — Yeşil', family: 'Ejderha', base: 0x2f5230, dark: 0x162a18, light: 0x568a4e, accent: 0xc2b24a, pattern: 'dragon-scales', roughness: 0.55, metalness: 0.12 },
	{ id: 'dragon-ice', label: 'Ejderha — Buz', family: 'Ejderha', base: 0x8fb4c9, dark: 0x4f7387, light: 0xd2e6f0, accent: 0x3f8fc4, pattern: 'dragon-scales', roughness: 0.35, metalness: 0.22 },
	{ id: 'dragon-gold', label: 'Ejderha — Altın', family: 'Ejderha', base: 0xb8912f, dark: 0x7a5c18, light: 0xe8ca6b, accent: 0xf0e0a0, pattern: 'dragon-scales', roughness: 0.3, metalness: 0.68 },
	{ id: 'dragon-bronze', label: 'Ejderha — Tunç', family: 'Ejderha', base: 0x8a5a2f, dark: 0x54341a, light: 0xb8854c, accent: 0x3f2a18, pattern: 'dragon-scales', roughness: 0.38, metalness: 0.55 },
	{ id: 'dragon-shadow', label: 'Ejderha — Gölge', family: 'Ejderha', base: 0x2e2740, dark: 0x151125, light: 0x554a70, accent: 0x7d4ac4, pattern: 'dragon-scales', roughness: 0.5, metalness: 0.24 },
	{ id: 'dragon-wing', label: 'Ejderha — Kanat Zarı', family: 'Ejderha', base: 0x5e3a35, dark: 0x33201d, light: 0x8a5c52, accent: 0xb08070, pattern: 'membrane', roughness: 0.68, metalness: 0.05 },
];

/* ---------------------------------------------------------------------------------------------
 * HAYVANLAR
 * ------------------------------------------------------------------------------------------- */
const ANIMAL = [
	{ id: 'horse-bay', label: 'At — Doru', family: 'Hayvan', base: 0x7d4a26, dark: 0x4a2b14, light: 0xa66c3f, accent: 0x241813, pattern: 'fur', roughness: 0.78, metalness: 0 },
	{ id: 'horse-grey', label: 'At — Kır', family: 'Hayvan', base: 0xa8a49e, dark: 0x6d6a66, light: 0xd4d0c9, accent: 0x4a4642, pattern: 'fur', roughness: 0.78, metalness: 0 },
	{ id: 'horse-black', label: 'At — Yağız', family: 'Hayvan', base: 0x2a2523, dark: 0x120f0e, light: 0x4d4441, accent: 0x6b5f5a, pattern: 'fur', roughness: 0.76, metalness: 0 },
	{ id: 'giraffe', label: 'Zürafa', family: 'Hayvan', base: 0xd9b168, dark: 0x8a6b30, light: 0xf0dCaa, accent: 0x7d5220, pattern: 'giraffe-patches', roughness: 0.8, metalness: 0 },
	{ id: 'elephant', label: 'Fil', family: 'Hayvan', base: 0x8e8a86, dark: 0x5a5754, light: 0xb3afaa, accent: 0x6d6763, pattern: 'wrinkled-hide', roughness: 0.9, metalness: 0 },
	{ id: 'cat', label: 'Kedi', family: 'Hayvan', base: 0x9c7a52, dark: 0x63492c, light: 0xc4a377, accent: 0x35271a, pattern: 'tabby-fur', roughness: 0.8, metalness: 0 },
	{ id: 'dog', label: 'Köpek', family: 'Hayvan', base: 0x8a6b45, dark: 0x574126, light: 0xb08f66, accent: 0xe0d5c0, pattern: 'fur', roughness: 0.82, metalness: 0 },
	{ id: 'wolf', label: 'Kurt', family: 'Hayvan', base: 0x6b6660, dark: 0x3d3935, light: 0x968f87, accent: 0x2a2724, pattern: 'fur', roughness: 0.82, metalness: 0 },
	{ id: 'bear', label: 'Ayı', family: 'Hayvan', base: 0x513826, dark: 0x2c1e14, light: 0x7a583d, accent: 0x1d1410, pattern: 'fur', roughness: 0.86, metalness: 0 },
	{ id: 'deer', label: 'Geyik', family: 'Hayvan', base: 0x9c7448, dark: 0x66492a, light: 0xc49d6d, accent: 0xe8dcc4, pattern: 'fur', roughness: 0.8, metalness: 0 },
	{ id: 'sheep', label: 'Koyun', family: 'Hayvan', base: 0xdcd6c8, dark: 0xa39d90, light: 0xf4f0e6, accent: 0x3d3934, pattern: 'wool', roughness: 0.95, metalness: 0 },
	{ id: 'goat', label: 'Keçi', family: 'Hayvan', base: 0x8a7a63, dark: 0x574c3c, light: 0xb0a289, accent: 0x2f2820, pattern: 'fur', roughness: 0.84, metalness: 0 },
	{ id: 'cow', label: 'İnek', family: 'Hayvan', base: 0xe0dad2, dark: 0x8a8580, light: 0xf6f2ec, accent: 0x4a3a2c, pattern: 'cow-patches', roughness: 0.82, metalness: 0 },
	{ id: 'pig', label: 'Domuz', family: 'Hayvan', base: 0xd4a094, dark: 0x9c6e63, light: 0xecc4ba, accent: 0x7d5248, pattern: 'skin', roughness: 0.8, metalness: 0 },
	{ id: 'chicken', label: 'Tavuk', family: 'Hayvan', base: 0xe3d5b8, dark: 0xa89877, light: 0xf6efdc, accent: 0xc4432a, pattern: 'feather', roughness: 0.78, metalness: 0 },
	{ id: 'raven', label: 'Kuzgun', family: 'Hayvan', base: 0x22242a, dark: 0x0d0e12, light: 0x454a58, accent: 0x5a6480, pattern: 'feather', roughness: 0.55, metalness: 0.15 },
	{ id: 'eagle', label: 'Kartal', family: 'Hayvan', base: 0x6b543a, dark: 0x3f3122, light: 0x9c7f5c, accent: 0xe8dfd0, pattern: 'feather', roughness: 0.65, metalness: 0.05 },
	{ id: 'rabbit', label: 'Tavşan', family: 'Hayvan', base: 0xb5a894, dark: 0x7d7263, light: 0xd9cfc0, accent: 0xf0ebe4, pattern: 'fur', roughness: 0.88, metalness: 0 },
	{ id: 'fish', label: 'Balık', family: 'Hayvan', base: 0x6d8fa3, dark: 0x3f5b6b, light: 0xa8c4d4, accent: 0xd4c46b, pattern: 'fish-scales', roughness: 0.35, metalness: 0.3 },
	{ id: 'snake', label: 'Yılan', family: 'Hayvan', base: 0x5a6b32, dark: 0x33401b, light: 0x8a9c52, accent: 0xc4b45a, pattern: 'fish-scales', roughness: 0.45, metalness: 0.12 },
	{ id: 'lion', label: 'Aslan', family: 'Hayvan', base: 0xc49a5a, dark: 0x8a6733, light: 0xe0bd85, accent: 0x6b4522, pattern: 'fur', roughness: 0.8, metalness: 0 },
];

/* ---------------------------------------------------------------------------------------------
 * DOĞA / ARAZİ
 * ------------------------------------------------------------------------------------------- */
const NATURE = [
	{ id: 'rock', label: 'Kaya', family: 'Doğa', base: 0x7d7a6d, dark: 0x4a4740, light: 0xa8a396, accent: 0x5a6b42, pattern: 'stone', roughness: 0.94, metalness: 0 },
	{ id: 'stone', label: 'Taş', family: 'Doğa', base: 0x8e8b82, dark: 0x5a5750, light: 0xb8b4aa, accent: 0x6d6a62, pattern: 'stone', roughness: 0.9, metalness: 0 },
	{ id: 'granite', label: 'Granit', family: 'Doğa', base: 0x6d6a70, dark: 0x3f3d43, light: 0x9c98a0, accent: 0xd4d0c8, pattern: 'speckled-stone', roughness: 0.82, metalness: 0.04 },
	{ id: 'marble', label: 'Mermer', family: 'Doğa', base: 0xe4e1d8, dark: 0xb0ada4, light: 0xf6f4ee, accent: 0x8a8f96, pattern: 'marble', roughness: 0.32, metalness: 0.05 },
	{ id: 'grass', label: 'Çimen', family: 'Doğa', base: 0x4a7a32, dark: 0x2c4d1d, light: 0x77a854, accent: 0x8a9c3a, pattern: 'grass', roughness: 0.92, metalness: 0 },
	{ id: 'dirt', label: 'Toprak', family: 'Doğa', base: 0x6b5236, dark: 0x453321, light: 0x907152, accent: 0x3d2c1c, pattern: 'dirt', roughness: 0.96, metalness: 0 },
	{ id: 'sand', label: 'Kum', family: 'Doğa', base: 0xd6c294, dark: 0xa89a70, light: 0xefe2c0, accent: 0xb8a173, pattern: 'sand', roughness: 0.94, metalness: 0 },
	{ id: 'snow', label: 'Kar', family: 'Doğa', base: 0xeef2f6, dark: 0xb8c4d0, light: 0xffffff, accent: 0xd0dce8, pattern: 'snow', roughness: 0.7, metalness: 0 },
	{ id: 'ice', label: 'Buz', family: 'Doğa', base: 0xb0d4e4, dark: 0x6d9ab0, light: 0xe0f2fa, accent: 0x4a8ab0, pattern: 'ice', roughness: 0.18, metalness: 0.1 },
	{ id: 'bark', label: 'Ağaç Kabuğu', family: 'Doğa', base: 0x5e4630, dark: 0x362718, light: 0x866b4a, accent: 0x4a6b3a, pattern: 'bark', roughness: 0.95, metalness: 0 },
	{ id: 'tree', label: 'Ağaç', family: 'Doğa', base: 0x3f6b2a, dark: 0x24401a, light: 0x6b9c4a, accent: 0x5e4630, pattern: 'leaf', roughness: 0.9, metalness: 0 },
	{ id: 'pine', label: 'Çam', family: 'Doğa', base: 0x2c4d33, dark: 0x172b1d, light: 0x4a7a52, accent: 0x5e4630, pattern: 'leaf', roughness: 0.9, metalness: 0 },
	{ id: 'leaf', label: 'Yaprak', family: 'Doğa', base: 0x568a3a, dark: 0x33591f, light: 0x8ab85e, accent: 0xc4b04a, pattern: 'leaf', roughness: 0.86, metalness: 0 },
	{ id: 'bush', label: 'Çalı', family: 'Doğa', base: 0x4a6b30, dark: 0x2a401b, light: 0x77964f, accent: 0x8a4a3a, pattern: 'leaf', roughness: 0.9, metalness: 0 },
	{ id: 'moss', label: 'Yosun', family: 'Doğa', base: 0x4a6b32, dark: 0x2c4020, light: 0x77964f, accent: 0x8a9c4a, pattern: 'moss', roughness: 0.96, metalness: 0 },
	{ id: 'lava', label: 'Lav', family: 'Doğa', base: 0x8a2410, dark: 0x2a0f08, light: 0xf0803a, accent: 0xffd050, pattern: 'lava', roughness: 0.75, metalness: 0, emissive: 0xff5a1e, emissiveIntensity: 0.9 },
];

/* ---------------------------------------------------------------------------------------------
 * SU
 * ------------------------------------------------------------------------------------------- */
const WATER = [
	{ id: 'water', label: 'Su', family: 'Su', base: 0x3f7a96, dark: 0x244d63, light: 0x6ba8c4, accent: 0xd4ecf6, pattern: 'water', roughness: 0.12, metalness: 0.05 },
	{ id: 'sea', label: 'Deniz', family: 'Su', base: 0x1f5670, dark: 0x0f3346, light: 0x468aa8, accent: 0xc4e4f0, pattern: 'water', roughness: 0.1, metalness: 0.06 },
	{ id: 'river', label: 'Nehir', family: 'Su', base: 0x4a8299, dark: 0x2a5363, light: 0x7ab0c4, accent: 0xdcf0f6, pattern: 'water', roughness: 0.14, metalness: 0.05 },
	{ id: 'lake', label: 'Göl', family: 'Su', base: 0x35708a, dark: 0x1d4557, light: 0x63a0b8, accent: 0xcce8f2, pattern: 'water', roughness: 0.11, metalness: 0.05 },
	{ id: 'swamp', label: 'Bataklık', family: 'Su', base: 0x4a5a3a, dark: 0x2a3522, light: 0x738257, accent: 0x8a9c4a, pattern: 'water', roughness: 0.35, metalness: 0.02 },
];

/* ---------------------------------------------------------------------------------------------
 * GÖK CİSİMLERİ — the only families that ship an emissive hint, since they are light sources
 * rather than lit surfaces.
 * ------------------------------------------------------------------------------------------- */
const SKY = [
	{ id: 'sun', label: 'Güneş', family: 'Gök', base: 0xffd24a, dark: 0xd68a1e, light: 0xfff4c0, accent: 0xff8a2a, pattern: 'sun', roughness: 1, metalness: 0, emissive: 0xffc43a, emissiveIntensity: 1.4 },
	{ id: 'moon', label: 'Ay', family: 'Gök', base: 0xd8dce4, dark: 0x9aa0ab, light: 0xf4f6fa, accent: 0x7d8492, pattern: 'moon', roughness: 0.95, metalness: 0, emissive: 0xb8c0cc, emissiveIntensity: 0.45 },
	{ id: 'star', label: 'Yıldız', family: 'Gök', base: 0xe8eef8, dark: 0xa8b4c8, light: 0xffffff, accent: 0x8ab4e8, pattern: 'sun', roughness: 1, metalness: 0, emissive: 0xdce8ff, emissiveIntensity: 1.1 },
	{ id: 'cloud', label: 'Bulut', family: 'Gök', base: 0xe6eaef, dark: 0xa8b0bc, light: 0xffffff, accent: 0xc4ccd8, pattern: 'cloud', roughness: 1, metalness: 0 },
];

/* ---------------------------------------------------------------------------------------------
 * YAPI / MİMARİ
 * ------------------------------------------------------------------------------------------- */
const BUILDING = [
	{ id: 'castle', label: 'Kale', family: 'Yapı', base: 0x9a958a, dark: 0x625e56, light: 0xc2bcaf, accent: 0x5a6b42, pattern: 'castle-block', roughness: 0.88, metalness: 0.02 },
	{ id: 'castle-dark', label: 'Kale — Kara Taş', family: 'Yapı', base: 0x5e5c58, dark: 0x35342f, light: 0x86837d, accent: 0x3f4a35, pattern: 'castle-block', roughness: 0.9, metalness: 0.03 },
	{ id: 'castle-ice', label: 'Kale — Buz Hisarı', family: 'Yapı', base: 0xb4cede, dark: 0x7493a6, light: 0xe4f2fa, accent: 0x4a8ab0, pattern: 'castle-block', roughness: 0.35, metalness: 0.08 },
	{ id: 'house', label: 'Ev', family: 'Yapı', base: 0xc4b294, dark: 0x8e7f65, light: 0xe0d3ba, accent: 0x6b4a30, pattern: 'plaster', roughness: 0.9, metalness: 0 },
	{ id: 'wood', label: 'Ahşap', family: 'Yapı', base: 0x8a6435, dark: 0x573e1f, light: 0xb08a55, accent: 0x3f2c16, pattern: 'wood', roughness: 0.85, metalness: 0 },
	{ id: 'brick', label: 'Tuğla', family: 'Yapı', base: 0x9c4f37, dark: 0x63301f, light: 0xc47a5c, accent: 0xd8d0c0, pattern: 'brick', roughness: 0.88, metalness: 0 },
	{ id: 'roof-tile', label: 'Kiremit', family: 'Yapı', base: 0x8a4030, dark: 0x55241a, light: 0xb0644c, accent: 0x3f2a20, pattern: 'roof-tile', roughness: 0.85, metalness: 0 },
	{ id: 'thatch', label: 'Saman Çatı', family: 'Yapı', base: 0xb59a5e, dark: 0x7d6836, light: 0xd8c288, accent: 0x5e4c26, pattern: 'thatch', roughness: 0.96, metalness: 0 },
	{ id: 'iron', label: 'Demir', family: 'Yapı', base: 0x6b7078, dark: 0x3d4147, light: 0x9aa0a8, accent: 0x8a5a3a, pattern: 'metal', roughness: 0.45, metalness: 0.85 },
	{ id: 'steel', label: 'Çelik', family: 'Yapı', base: 0xa8b0b8, dark: 0x6d757d, light: 0xdce2e8, accent: 0x5a6068, pattern: 'metal', roughness: 0.25, metalness: 0.95 },
	{ id: 'gold', label: 'Altın', family: 'Yapı', base: 0xd4af37, dark: 0x94781f, light: 0xf4e08a, accent: 0xfff4c8, pattern: 'metal', roughness: 0.2, metalness: 1 },
	{ id: 'silver', label: 'Gümüş', family: 'Yapı', base: 0xc4cad2, dark: 0x878d95, light: 0xf0f4f8, accent: 0x6d737a, pattern: 'metal', roughness: 0.18, metalness: 1 },
	{ id: 'bronze', label: 'Tunç', family: 'Yapı', base: 0xa87434, dark: 0x6d4a1e, light: 0xd0a05e, accent: 0x4a7a6b, pattern: 'metal', roughness: 0.34, metalness: 0.9 },
	{ id: 'copper', label: 'Bakır', family: 'Yapı', base: 0xa85f36, dark: 0x6d3c1f, light: 0xd08a5c, accent: 0x4aa88a, pattern: 'metal', roughness: 0.3, metalness: 0.92 },
	{ id: 'fabric', label: 'Kumaş', family: 'Yapı', base: 0x8a5a6b, dark: 0x573644, light: 0xb0808f, accent: 0xd4af37, pattern: 'fabric', roughness: 0.92, metalness: 0 },
	{ id: 'leather', label: 'Deri', family: 'Yapı', base: 0x6b4830, dark: 0x422b1b, light: 0x94684a, accent: 0x2f1e13, pattern: 'leather', roughness: 0.78, metalness: 0 },
	{ id: 'banner', label: 'Sancak', family: 'Yapı', base: 0x8c2f2f, dark: 0x561c1c, light: 0xb85555, accent: 0xd4af37, pattern: 'fabric', roughness: 0.88, metalness: 0 },
	{ id: 'glass', label: 'Cam', family: 'Yapı', base: 0xa8c8d4, dark: 0x6d8f9c, light: 0xdcf0f6, accent: 0x4a7a8a, pattern: 'ice', roughness: 0.08, metalness: 0.15 },
];

/* ---------------------------------------------------------------------------------------------
 * YOL
 * ------------------------------------------------------------------------------------------- */
const ROAD = [
	{ id: 'road-dirt', label: 'Toprak Yol', family: 'Yol', base: 0x9c7b4a, dark: 0x6b5230, light: 0xbfa070, accent: 0x4a3a24, pattern: 'road-dirt', roughness: 0.95, metalness: 0 },
	{ id: 'road-cobble', label: 'Taş Yol', family: 'Yol', base: 0x8a8780, dark: 0x565450, light: 0xb2aea6, accent: 0x4a5a3a, pattern: 'cobble', roughness: 0.88, metalness: 0 },
	{ id: 'path', label: 'Patika', family: 'Yol', base: 0xbfae82, dark: 0x8a7c58, light: 0xd9cba8, accent: 0x5a6b42, pattern: 'road-dirt', roughness: 0.94, metalness: 0 },
	{ id: 'bridge', label: 'Köprü', family: 'Yol', base: 0x94908a, dark: 0x5e5b56, light: 0xbcb8b0, accent: 0x4a5a3a, pattern: 'castle-block', roughness: 0.9, metalness: 0 },
];

/** Every palette, keyed by id. */
export const PALETTES = indexById([
	...HUMAN, ...PARTS, ...DRAGON, ...ANIMAL, ...NATURE, ...WATER, ...SKY, ...BUILDING, ...ROAD,
]);

/** Ordered id list — stable iteration for UI listings and regression checks. */
export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));

/** Distinct family names, in catalogue order. */
export const PALETTE_FAMILIES = Object.freeze([...new Set(PALETTE_IDS.map((id) => PALETTES[id].family))]);

/**
 * @param {string} id
 * @returns {Palette|null}
 */
export function findPalette(id) {
	return PALETTES[id] || null;
}

/**
 * @param {string} family
 * @returns {Palette[]}
 */
export function palettesByFamily(family) {
	return PALETTE_IDS.map((id) => PALETTES[id]).filter((palette) => palette.family === family);
}
