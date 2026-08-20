/**
 * The prop catalogue — every model in `assets/` that belongs on the ground, and the country it belongs in.
 *
 * **What the owner asked for.** "assets'de bulunan butun modelleri butun cografyaya dagit. Hepsini dogru
 * yere dogru dokularla yerlestir." Earlier runs placed fourteen hand-picked models in a disc around the
 * player. This is the whole library, across the whole map.
 *
 * **Why some models are not here, stated rather than quietly skipped.** "All the models" cannot mean
 * literally every `.glb`, because four groups would damage the geography rather than furnish it:
 *
 *   - **Living entities** (50 files: people, animals, birds, insects). These are spawned, moved and
 *     animated by `gameplay/livingWorldSpawner.js`. Scattering them as static props would freeze a
 *     Farmer, a Stag and a Seagull mid-stride across the world.
 *   - **Models that are themselves terrain** (11 files: `terrain_test`, `rugged_mountain_landscape`,
 *     `snow_terrain_low_poly`, `road_terrain`, `the_landscape_is_a_forest_in_the_mountains`, ...). Each is
 *     a whole landscape mesh. Dropping them onto this world would leave duplicate hillsides floating
 *     through the real one.
 *   - **Seat castle models** (32 files, the Meshy_AI citadels and full castles). `world/settlements.js`
 *     already places these at the fourteen kingdom seats via `CASTLE_MODEL_ASSIGNMENTS`. Scattering them
 *     too would strew unowned castles across open country and make the seats meaningless.
 *   - **Interior and joke assets** (7 files: `Curtains`, `Candle`, `Cigarette butt`, ...). There are no
 *     interiors to dress, and a cigarette butt is not Westeros.
 *
 * Fortification *props* — gates, wall towers, wall segments, ruin kits — are kept and placed as upland
 * landmarks; only the seat castles themselves are withheld.
 *
 * **`terrain` is a claim about country, checked against the owner map.** `world/worldReferenceBiomeField.js`
 * answers forest and aridity per cell, the live height field answers elevation and slope, and
 * `world/worldPropScatter.js` only places an entry where all of them agree. A barn cannot land in the
 * Red Waste and a palm cannot land on the Wall.
 *
 * **`weight` is relative frequency inside its own biome, not a count.** `footprintMeters` is the clearance
 * the placer keeps around the model, so a church does not grow out of a barn.
 *
 * @module world/worldPropCatalogue
 */

/** Biomes an entry can claim. `world/worldPropScatter.js` owns what each one means on the ground. */
export const PROP_BIOMES = Object.freeze(['coast', 'meadow', 'farmland', 'woodland', 'upland', 'arid', 'snowline', 'roadside']);

/** Models withheld from the scatter, by reason — kept in the source so the decision is reviewable. */
export const PROP_CATALOGUE_EXCLUSIONS = Object.freeze({
	livingEntity: 50,
	isItselfTerrain: 11,
	seatCastleModel: 32,
	interiorOrJokeAsset: 7,
});

/**
 * Every placeable model, with the country it suits.
 * `file` is relative to `assets/models/`.
 */
export const PROP_CATALOGUE = Object.freeze([
	// ---- arid --------------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Dead Tree by Quaternius - n8FhMgMldD.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/Dead Trees With Snow by dook - iEuwXWner0.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/Dead Trees by Quaternius - F5I0Q7TwO5.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/Modular Ruins Pack by Quaternius - F2LAK03B0r.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'fbx/Palm Trees by Quaternius - VYslw9DEi6.glb', terrain: 'arid', footprintMeters: 11, weight: 4 }),
	Object.freeze({ file: 'fbx/Twisted Tree by Quaternius - 8oraKn9m0x.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'fbx/Twisted Tree by Quaternius - 9aWlx82xUf.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'fbx/Twisted Tree by Quaternius - GVTsMmuzv7.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'fbx/desert_rocks.glb', terrain: 'arid', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'props/greek_stone_bench.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/hand_statue_prop.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_arms.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_clothes.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_face.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_shield.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_spear.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_base_pedestal.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_david.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_hand.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_nike.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_arch_single.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_parthenon_base.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_parthenon_roof.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_pillar_broken_half.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_pillar_broken_quarter.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_pillar_intact.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_small_garden.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_stone_stairs.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/modular_ruins_pack_F2LAK03B0r.glb', terrain: 'arid', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'vegetation/dead_tree_n8FhMgMldD.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'vegetation/dead_trees_F5I0Q7TwO5.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'vegetation/dead_trees_with_snow_iEuwXWner0.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'vegetation/palm_trees_VYslw9DEi6.glb', terrain: 'arid', footprintMeters: 11, weight: 4 }),
	Object.freeze({ file: 'vegetation/twisted_tree_8oraKn9m0x.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'vegetation/twisted_tree_9aWlx82xUf.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'vegetation/twisted_tree_GVTsMmuzv7.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	// ---- coast -------------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Docks by Quaternius - F7twMHWPXY.glb', terrain: 'coast', footprintMeters: 14, weight: 2 }),
	Object.freeze({ file: 'settlements/docks_F7twMHWPXY.glb', terrain: 'coast', footprintMeters: 14, weight: 2 }),
	// ---- farmland ----------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Barn by CreativeTrio - A6UkPq33aZ.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Barn by Poly by Google - 0QTh_KUZRYE.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Barn by Poly by Google - dSsUaUlaxHk.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Barn by Quaternius - vSqQNA7ez6.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Big Barn by Quaternius - q1N3xn2SpC.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Bird House by Zsky - jSpF4LjoQp.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/Blacksmith by Quaternius - bV52eTG1Aj.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'fbx/Church by CreativeTrio - GHzPfvoyzX.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'fbx/Church by Poly by Google - 6vzTphxL9w4.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'fbx/Crops by Quaternius - Ro6K0Yg7mx.glb', terrain: 'farmland', footprintMeters: 8, weight: 4 }),
	Object.freeze({ file: 'fbx/Fantasy House by Quaternius - dcPho4SUA3.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/Fantasy Stable by Quaternius - qhNQSOGGbi.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Farm Dirt by Quaternius - 8BQFbUMOeC.glb', terrain: 'farmland', footprintMeters: 8, weight: 4 }),
	Object.freeze({ file: 'fbx/Farm by Poly by Google - 5GDbUJV2vQb.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/Farm by Quaternius - 91wMLb9kKo.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'fbx/House by Pixel - fdaqERLQCc.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/House by Quaternius - HeHDd2rTpX.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/House by Quaternius - roqiHdrpgc.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/House_with_Garden_GLB.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/Medium House by Pixel - 4hI5fNvl6z.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/Palace by Poly by Google - f5wb0x6Qk3j.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/Silo House by Quaternius - ZgstejsAcN.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'props/farm_dirt_8BQFbUMOeC.glb', terrain: 'farmland', footprintMeters: 8, weight: 4 }),
	Object.freeze({ file: 'settlements/barn_0QTh_KUZRYE.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/barn_A6UkPq33aZ.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/barn_dSsUaUlaxHk.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/barn_vSqQNA7ez6.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/big_barn_q1N3xn2SpC.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/bird_house_jSpF4LjoQp.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/blacksmith_bV52eTG1Aj.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'settlements/church_6vzTphxL9w4.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'settlements/church_GHzPfvoyzX.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'settlements/fantasy_house_dcPho4SUA3.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/fantasy_stable_qhNQSOGGbi.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/house_HeHDd2rTpX.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/house_fdaqERLQCc.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/house_roqiHdrpgc.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/medium_house_4hI5fNvl6z.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/palace_f5wb0x6Qk3j.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/silo_house_ZgstejsAcN.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'vegetation/crops_Ro6K0Yg7mx.glb', terrain: 'farmland', footprintMeters: 8, weight: 4 }),
	// ---- meadow ------------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Flowers by Quaternius - NBUxHir6FJ.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'fbx/Grass by Quaternius - UGTOzcO3P2.glb', terrain: 'meadow', footprintMeters: 3, weight: 6 }),
	Object.freeze({ file: 'vegetation/flower_brown_tall.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_fern.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_fun_short.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_grass_tall.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_green_short.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_meadow_short.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_pink_short.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_purple_tall.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flower_yellow_tall.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/flowers_NBUxHir6FJ.glb', terrain: 'meadow', footprintMeters: 2, weight: 8 }),
	Object.freeze({ file: 'vegetation/grass_UGTOzcO3P2.glb', terrain: 'meadow', footprintMeters: 3, weight: 6 }),
	// ---- roadside ----------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Barrel by Quaternius - zjCQP1TAci.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'fbx/Bonfire by Quaternius - Azj9hJwwwG.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'fbx/Crate by Quaternius - 3OEFd1AWfa.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'fbx/Wooden Door Rounded by Kenney - tPsxxWUdTn.glb', terrain: 'roadside', footprintMeters: 2, weight: 3 }),
	Object.freeze({ file: 'props/barrel_zjCQP1TAci.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'props/bonfire_Azj9hJwwwG.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'props/crate_3OEFd1AWfa.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'props/wooden_door_rounded_tPsxxWUdTn.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	// ---- snowline ----------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/low_poly_winter_tree_pack.glb', terrain: 'snowline', footprintMeters: 9, weight: 4 }),
	Object.freeze({ file: 'vegetation/winter_tree.glb', terrain: 'snowline', footprintMeters: 9, weight: 4 }),
	// ---- upland ------------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Barracks by Quaternius - UXCOwRBSxx.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'fbx/Fortress by CreativeTrio - HZPOZU2NiM.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'fbx/Modular Castle Kit by Quaternius - AhhyXvO6Fd.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'fbx/Pine Trees by Quaternius - oYtDty0fR6.glb', terrain: 'upland', footprintMeters: 14, weight: 5 }),
	Object.freeze({ file: 'fbx/Pine by Quaternius - Zt62gceKXZ.glb', terrain: 'upland', footprintMeters: 14, weight: 5 }),
	Object.freeze({ file: 'fbx/Stone Wall Towers by Quaternius - geisKzlSFZ.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/barracks_UXCOwRBSxx.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/castle_gate_tKTchdiQzV.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/fortress_HZPOZU2NiM.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/modular_castle_kit_AhhyXvO6Fd.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/stone_wall_towers_geisKzlSFZ.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/wall_segment_muro.glb', terrain: 'upland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'vegetation/pine_Zt62gceKXZ.glb', terrain: 'upland', footprintMeters: 14, weight: 5 }),
	Object.freeze({ file: 'vegetation/pine_trees_oYtDty0fR6.glb', terrain: 'upland', footprintMeters: 14, weight: 5 }),
	// ---- woodland ----------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Big Tree by 3Donimus - dNWh762PN-6.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Birch Trees by Quaternius - R7qMWzb7nk.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Cabin Shed by CreativeTrio - HTx7PZt6Zm.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Cabin by Poly by Google - 1GpgtI-C05M.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Cabin by Poly by Google - dTSrDa0oz0a.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Cottage by CreativeTrio - YDGLLT0emC.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Fall Tree by Danni Bittman - 4GYen9Xm3Kj.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Log Cabin by Jarlan Perez - et0OmFeZVkb.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Maple Trees by Quaternius - iGFtQd0PJO.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Tree by Quaternius - QVOop92WmG.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Tree by Quaternius - aVOxaHRPWe.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Tree by Quaternius - qZtx0AHhcy.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Tree by Zsky - VfZbAkek1r.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Tree stump by Poly by Google - esFOngb0uwl.glb', terrain: 'woodland', footprintMeters: 3, weight: 4 }),
	Object.freeze({ file: 'fbx/Trees by Quaternius - etFGNvsiFv.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'fbx/Wood Log by Quaternius - L4E32Wee6C.glb', terrain: 'woodland', footprintMeters: 3, weight: 4 }),
	Object.freeze({ file: 'fbx/medieval_house.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'props/wood_log_L4E32Wee6C.glb', terrain: 'woodland', footprintMeters: 3, weight: 4 }),
	Object.freeze({ file: 'settlements/cabin_by_poly_by_google_1gpgti_c05m_na.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/cabin_dTSrDa0oz0a.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/cabin_shed_HTx7PZt6Zm.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/log_cabin_et0OmFeZVkb.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/small_wooden_house.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/big_tree_by_3donimus_dnwh762pn_6_na.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/birch_trees_R7qMWzb7nk.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/fall_tree_4GYen9Xm3Kj.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/maple_trees_iGFtQd0PJO.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_QVOop92WmG.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_VfZbAkek1r.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_aVOxaHRPWe.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_qZtx0AHhcy.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_stump_esFOngb0uwl.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/trees_etFGNvsiFv.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
]);

/** Entries grouped by biome, built once — the scatter asks for a biome, not a filename. */
export const PROP_CATALOGUE_BY_BIOME = Object.freeze(Object.fromEntries(
	PROP_BIOMES.map((biome) => [biome, Object.freeze(PROP_CATALOGUE.filter((entry) => entry.terrain === biome))]),
));

export const PROP_CATALOGUE_POLICY = Object.freeze({
	id: 'world-prop-catalogue-2026-08-20-v1',
	entryCount: PROP_CATALOGUE.length,
	assetRoot: 'assets/models/',
});
