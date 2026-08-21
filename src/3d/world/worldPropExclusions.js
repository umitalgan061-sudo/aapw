/**
 * Every model in `assets/` that is deliberately **not** scattered across the world, and why.
 *
 * **This file exists because the reasons used to be a number.** `world/worldPropCatalogue.js` recorded
 * its exclusions as `{ riggedLivingEntity: 14, isItselfTerrain: 11, seatCastleModel: 32, ... }` — counts
 * with no filenames behind them. Nobody could answer "is this model placed, or was it withheld on
 * purpose?" for any particular file, which meant nobody could answer it for the library as a whole.
 * Run 377 measured the library and found the answer had drifted badly: of **360 distinct models** in
 * `assets/`, **203 were referenced by no system at all** — not placed, not withheld, simply invisible.
 * A count cannot catch that. A list can, and `scripts/checkAssetCoverage.js` now holds every model in
 * the repository to it: placed, owned by a named system, or listed here with a reason. Nothing else.
 *
 * **Paths are relative to `assets/models/`**, matching `PROP_CATALOGUE`'s `file`. The handful of models
 * that live outside that directory are written `../<rest>`, relative to `assets/`.
 *
 * @module world/worldPropExclusions
 */

/** Models withheld from the scatter, by reason — the decision, reviewable file by file. */
export const PROP_EXCLUSIONS_BY_REASON = Object.freeze({
	/**
	 * Rigged, animated figures — people and beasts. `gameplay/livingWorldSpawner.js` spawns and moves
	 *   the ones this game uses; the rest are alternates it may be pointed at. Scattering any of them as
	 *   static scenery would freeze a Farmer or a Bison mid-stride in a field.
	 */
	riggedLivingEntity: Object.freeze([
		"characters/casual_confidence.glb",
		"characters/elven_warrior.glb",
		"characters/farmer_7pn3R6hPvE.glb",
		"characters/guy_0eU7bl0a6Cg.glb",
		"characters/ionic_grace.glb",
		"characters/king_I1gTjmuK2m.glb",
		"characters/knight_isC73B8SKq.glb",
		"characters/knights_character_kit_3r2JcOZShpE.glb",
		"characters/Meshy_AI_Golden_Vanguard_Knigh_0809074809_texture.fbx",
		"characters/Meshy_AI_Iron_Sentinel_0809085351_texture.fbx",
		"characters/roman_centurion_g2ckFsGszB.glb",
		"characters/verdant_knight.glb",
		"characters/viking_6UxTboeQ2G.glb",
		"characters/witch_QBEOV9ZUT8.glb",
		"characters/wooden_legion.glb",
		"fbx/adventurer1.fbx",
		"fbx/Blender File_Black Student.fbx",
		"fbx/BodyMaleTemplate.fbx",
		"fbx/Buffalo.fbx",
		"fbx/female_blender_5.0.fbx",
		"fbx/karakter.fbx",
		"fbx/Labrador-Retriever_03.fbx",
		"fbx/low_poly_lion.fbx",
		"fbx/Meshy_AI_Boho_Western_Muse_0730060053_texture.glb",
		"fbx/Meshy_AI_Create_exactly_ONE_hi_0808194328_generate.fbx",
		"fbx/Meshy_AI_Gilded_Knight_of_the__0809083228_texture.fbx",
		"fbx/Meshy_AI_Ivory_Ascendancy_0808200513_texture_fbx/Meshy_AI_Ivory_Ascendancy_0808200513_texture.fbx",
		"fbx/Meshy_AI_Slice_of_Truth_0730094215_texture.glb",
		"fbx/Meshy_AI_Winter_s_Sentinel_0809081717_texture.fbx",
		"fbx/Mongoose.fbx",
		"fbx/rhino.fbx",
		"fbx/riggedcat.fbx",
		"fbx/son.fbx",
		"fbx/street_rat_4k.fbx",
		"fbx/tiger.fbx",
	]),
	/**
	 * A lower-detail copy of a mesh already in the catalogue. Placing both would put the same slab on
	 *   the ground twice, one of them blurry.
	 */
	lodVariantOfAnotherEntry: Object.freeze([
		"fbx/StoneFloor_FragmentFive_LOD1.fbx",
		"fbx/StoneFloor_FragmentFive_LOD2.fbx",
		"fbx/StoneFloor_FragmentFour_LOD1.fbx",
		"fbx/StoneFloor_FragmentFour_LOD2.fbx",
		"fbx/StoneFloor_FragmentOne_LOD1.fbx",
		"fbx/StoneFloor_FragmentOne_LOD2.fbx",
		"fbx/StoneFloor_FragmentThree_LOD1.fbx",
		"fbx/StoneFloor_FragmentThree_LOD2.fbx",
		"fbx/StoneFloor_FragmentTwo_LOD1.fbx",
		"fbx/StoneFloor_FragmentTwo_LOD2.fbx",
		"fbx/StoneFloor_GrassOne_LOD1.fbx",
		"fbx/StoneFloor_GrassOne_LOD2.fbx",
		"fbx/StoneFloor_GrassTwo_LOD1.fbx",
		"fbx/StoneFloor_GrassTwo_LOD2.fbx",
		"fbx/StoneFloor_Ground_LOD1.fbx",
		"fbx/StoneFloor_Ground_LOD2.fbx",
		"fbx/StoneFloor_SlabOne_LOD1.fbx",
		"fbx/StoneFloor_SlabOne_LOD2.fbx",
		"fbx/StoneFloor_SlabTwo_LOD1.fbx",
		"fbx/StoneFloor_SlabTwo_LOD2.fbx",
	]),
	/**
	 * A whole landscape — a mountain, a coastline, a stretch of road, a forest floor. Dropping one onto
	 *   this world leaves a duplicate hillside floating through the real one.
	 */
	isItselfTerrain: Object.freeze([
		"fbx/3d_sea.fbx",
		"fbx/Alien_LandscapeFBX.fbx",
		"fbx/american_road_snowy_terrain.glb",
		"fbx/brdy_forest.glb",
		"fbx/Cliff.fbx",
		"fbx/CoastScan.fbx",
		"fbx/dirt_road_test.glb",
		"fbx/Mount_Fuji.fbx",
		"fbx/Mount_Hood.fbx",
		"fbx/road_terrain.glb",
		"fbx/rocky_terrain_low_poly.glb",
		"fbx/rugged_mountain_landscape.glb",
		"fbx/singlemountain.FBX",
		"fbx/snow_terrain_low_poly.glb",
		"fbx/sNOWlaNDSCAPE.glb",
		"fbx/terrain_01.fbx",
		"fbx/terrain_test.glb",
		"fbx/terrain_test_2.glb",
		"fbx/the_landscape_is_a_forest_in_the_mountains.glb",
	]),
	/**
	 * Dragons and wyverns. `gameplay/dragonConfig.js` owns the one that flies; the others are
	 *   alternates kept for it to choose from, not scenery to strew across the ground.
	 */
	dragonModel: Object.freeze([
		"creatures/dragons/auric_dragon.glb",
		"creatures/dragons/frostscale_dragon.glb",
		"creatures/dragons/reference_dragon_v1.glb",
		"creatures/dragons/reference_dragon_v2.glb",
		"creatures/dragons/reference_dragon_v2_decimated.glb",
		"creatures/dragons/reference_dragon_v3.glb",
		"creatures/dragons/spiked_serpent.glb",
		"creatures/dragons/verdant_wyrm.glb",
		"fbx/Meshy_AI_Create_exactly_ONE_dr_0808193627_generate.glb",
		"fbx/Meshy_AI_Frostwing_Dragon_0808195300_generate.fbx",
		"fbx/Meshy_AI_Golden_Ember_Dragon_0808200332_generate.fbx",
		"fbx/Meshy_AI_Obsidian_Wyvern_0808195051_generate.fbx",
	]),
	/**
	 * Furniture, household objects and jokes. There are no interiors to dress, and a cigarette butt, a
	 *   jerrycan and a pair of rubber boots are not Westeros.
	 */
	interiorOrJokeAsset: Object.freeze([
		"fbx/chinese_sofa_4k.fbx",
		"fbx/Cigarette butt by Poly by Google - 5EpZHvuZplk.glb",
		"fbx/dining_table_4k.fbx",
		"fbx/metal_jerrycan_green_4k.fbx",
		"fbx/oil_tin_4k.fbx",
		"fbx/old_bed_frame_4k.fbx",
		"fbx/rubber_boots_4k.fbx",
		"fbx/vintage_day_bed_4k.fbx",
		"fbx/wooden_broom_4k.fbx",
		"fbx/wooden_shelf_fbx_file.fbx",
		"props/candle_aH83BlSFxJu.glb",
		"props/curtains_aFWefo0cEFo.glb",
	]),
	/**
	 * `world/settlements.js` places these at the fourteen kingdom seats via `CASTLE_MODEL_ASSIGNMENTS`.
	 *   Scattering them too would strew unowned castles across open country and make the seats meaningless.
	 */
	seatCastleModel: Object.freeze([
		"fbx/castle.fbx",
		"settlements/castle_1234_dmP1nRE_2GM.glb",
		"settlements/castle_4360GdbxRe.glb",
		"settlements/castle_kit_2pA966ztJJX.glb",
		"settlements/castle_opTOmcN3o9.glb",
		"settlements/castles/brickstone_citadel.glb",
		"settlements/castles/castle_on_a_rock.glb",
		"settlements/castles/emerald_citadel.glb",
		"settlements/castles/fortress_of_the_crown.glb",
		"settlements/castles/greystone_castle.glb",
		"settlements/castles/icebound_citadel.glb",
		"settlements/castles/walled_city_fortress.glb",
	]),
	/**
	 * Files whose names say nothing about what is inside — `untitled.fbx`, `Others2.fbx`, `2.FBX`. Every
	 *   model here is a Git LFS pointer in a fresh clone (RCA_RUN344), so their contents cannot be inspected
	 *   from a checkout to find out. Guessing a biome for an unknown mesh is how a sofa ends up on a
	 *   mountainside; these wait for someone who can open them.
	 */
	unidentifiedContents: Object.freeze([
		"fbx/2.FBX",
		"fbx/fbx export.fbx",
		"fbx/FreeAllBLEND.fbx",
		"fbx/Meshes_-_V1.fbx",
		"fbx/Meshes_-_V2.fbx",
		"fbx/Meshes_-_V3.fbx",
		"fbx/Others.fbx",
		"fbx/Others2.fbx",
		"fbx/RCR01.fbx",
		"fbx/untitled.fbx",
		"props/unidentified_prop_t1.glb",
	]),
	/**
	 * Swords, spears, gloves, a throne — things a character holds or sits on, at a scale that makes no
	 *   sense lying in a meadow.
	 */
	heldItemOrRegalia: Object.freeze([
		"fbx/medieval_gloves.fbx",
		"fbx/Meshy_AI_Iron_Throne_0808200614_generate.fbx",
		"fbx/Spear.fbx",
		"fbx/Viking Sword Blend_Viking Sword.fbx",
		"fbx/weapons.fbx",
		"props/sword_narsil_style.fbx",
	]),
	/**
	 * An animation clip under `assets/animations/`, not a mesh at all. `gameplay/npcConfig.js` drives these.
	 */
	animationClipNotAModel: Object.freeze([
		"../animations/peasant_girl/idle.fbx",
		"../animations/peasant_girl/running.fbx",
		"../animations/peasant_girl/walking.fbx",
	]),
	/**
	 * A material sample (dirt, roof tiles, a surface test), not a discrete object.
	 */
	materialSwatchNotAnObject: Object.freeze([
		"../textures/yüzey/model.fbx",
		"fbx/clay_roof_tiles_4k.fbx",
		"fbx/dirt_aerial_02_4k.fbx",
	]),
	/**
	 * Bridges. Run 376 gave the world eleven rivers, and a bridge belongs on a crossing rather than
	 *   dropped at a random point in a field. Placing them properly needs the crossing system that owner
	 *   question S-0038 settles, so they wait for it instead of being scattered wrongly.
	 */
	needsARiverCrossingToStandOn: Object.freeze([
		"fbx/bridge1.fbx",
		"fbx/Old Bridge.fbx",
	]),
	/**
	 * The moon. `sky.js` owns what is in the sky.
	 */
	/**
	 * A Git LFS pointer sitting beside the same model in full, committed form. Run 377 repointed the
	 * animal system, the editor library and the service worker from `Wolf-Blender-2.82a.glb` — 132 bytes
	 * that never resolve without LFS objects, so the wolf rendered as a placeholder box — to the real
	 * `.gltf` next to it. The stub is left in place rather than deleted (removing a committed LFS asset
	 * is not this run's call to make) but nothing points at it any more, and nothing should.
	 */
	unusableLfsPointerBesideTheRealModel: Object.freeze([
		"animals/wolf/Wolf-Blender-2.82a.glb",
	]),
	skyBody: Object.freeze([
		"Ay/Moon 2K.fbx",
	]),
	/**
	 * `shark.glb` — an ocean animal, and this scatter only places things on dry land.
	 */
	/**
	 * Photogrammetry scans, kept out of the scatter on measured cost rather than on taste. These two are
	 * the only models in the whole repository that are not Git LFS pointers — real files, with their
	 * `.bin` and textures committed — and they are exactly the stone architecture this world wants: the
	 * winery of Montemor-o-Novo castle and the church of Santa Maria do Bispo. They are also
	 * **800,000 and 1,995,658 triangles**. The scatter budgets 220 live props at a time; one of these is
	 * eight hundred times the entire eleven-river water system. They belong somewhere hand-placed and
	 * decimated, as a landmark worth the cost, not dropped at a random point in a meadow.
	 */
	tooHeavyForChunkStreaming: Object.freeze([
		"fbx/adega-castelo-de-montemor-o-novo-3d-model/scene.gltf",
		"fbx/igreja-de-santa-maria-do-bispo-3d-model/scene.gltf",
	]),
	underwaterOnly: Object.freeze([
		"animals/shark.glb",
	]),
	/**
	 * `fence_fence.fbx` renders as a flat sheet, not a fence. Run 381 hydrated it and the render was
	 * unambiguous: its bounding box is dominated by a baked ground plane from the photogrammetry capture,
	 * so scaling "widest dimension = footprint" shrinks the actual rails to nothing and lays a white
	 * sheet flat on the terrain — a glitch wherever it lands, in a village or scattered on farmland. It
	 * was 17,254 triangles for that. Removed from village buildings (`world/villageBuildings.js`, run
	 * 381) and now from the scatter too; `world/villages.js` draws the field boundaries this was meant to
	 * provide as instanced walls. Kept in the repository, placed nowhere.
	 */
	photogrammetryGroundPlaneNotAnObject: Object.freeze([
		"fbx/fence_fence.fbx",
	]),});

/** Every excluded path, flattened — what `scripts/checkAssetCoverage.js` checks against. */
export const PROP_EXCLUDED_FILES = Object.freeze(
	Object.values(PROP_EXCLUSIONS_BY_REASON).flat(),
);

/** The reason a given path was withheld, or `null` if it was not. */
export function propExclusionReason(file) {
	for (const [reason, files] of Object.entries(PROP_EXCLUSIONS_BY_REASON)) {
		if (files.includes(file)) return reason;
	}
	return null;
}

export const PROP_EXCLUSIONS_POLICY = Object.freeze({
	id: 'world-prop-exclusions-2026-08-21-v1',
	reasonCount: Object.keys(PROP_EXCLUSIONS_BY_REASON).length,
	fileCount: PROP_EXCLUDED_FILES.length,
	assetRoot: 'assets/models/',
});
