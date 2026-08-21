/**
 * The prop catalogue — every model in `assets/` that belongs on the ground, and the country it belongs in.
 *
 * **What the owner asked for.** "assets'de bulunan butun modelleri butun cografyaya dagit. Hepsini dogru
 * yere dogru dokularla yerlestir." Earlier runs placed fourteen hand-picked models in a disc around the
 * player. This is the whole library, across the whole map.
 *
 * **Why some models are not here, and which ones — stated file by file.** "All the models" cannot mean
 * literally every `.glb`: a mountain mesh, a rigged Farmer and a cigarette butt would damage the
 * geography rather than furnish it. Those decisions now live in `world/worldPropExclusions.js`, one
 * named reason per file. They used to live here as bare counts — `riggedLivingEntity: 14,
 * isItselfTerrain: 11, ...` — with no filenames behind them, and run 377 found what that hid: of the
 * **360 distinct models** in `assets/`, **203 were referenced by nothing at all**. Not placed, not
 * withheld; invisible. `scripts/checkAssetCoverage.js` now fails if a single model in the repository is
 * neither placed here, owned by a named system, nor listed there with a reason.
 *
 * **One entry per model, not per path.** `assets/models/fbx/` is the raw download folder and the
 * organised directories are copies of the same files, so 117 of this catalogue's 185 entries used to be
 * 58 models listed twice — each placed at double weight and loaded into the GPU twice under two cache
 * keys. Entries are deduplicated by their Git LFS content hash, which is the only thing that survives
 * being copied under a different name.
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

import { PROP_EXCLUSIONS_BY_REASON } from './worldPropExclusions.js';

/** Biomes an entry can claim. `world/worldPropScatter.js` owns what each one means on the ground. */
export const PROP_BIOMES = Object.freeze(['coast', 'meadow', 'farmland', 'woodland', 'upland', 'arid', 'snowline', 'roadside']);

/**
 * Models withheld from the scatter, by reason, with a count per reason.
 *
 * The files themselves are in `world/worldPropExclusions.js` — this is the summary, derived from that
 * list rather than written beside it, so the two can never disagree.
 */
export const PROP_CATALOGUE_EXCLUSIONS = Object.freeze(Object.fromEntries(
	Object.entries(PROP_EXCLUSIONS_BY_REASON).map(([reason, files]) => [reason, files.length]),
));

/**
 * Every placeable model, with the country it suits.
 * `file` is relative to `assets/models/`.
 */
export const PROP_CATALOGUE = Object.freeze([
	// ---- coast -----------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/flying_seagull_6Tpj_vcWP3f.glb', terrain: 'coast', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/seagull_0WRzrtCIIRp.glb', terrain: 'coast', footprintMeters: 1, weight: 4 }),
	Object.freeze({ file: 'fbx/Boat.fbx', terrain: 'coast', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Building_pier1_building.fbx', terrain: 'coast', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/ganges_river_pebbles_4k.fbx', terrain: 'coast', footprintMeters: 3, weight: 4 }),
	Object.freeze({ file: 'settlements/docks_F7twMHWPXY.glb', terrain: 'coast', footprintMeters: 14, weight: 2 }),
	// ---- meadow ----------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/bee_f0lW38lzjd4.glb', terrain: 'meadow', footprintMeters: 1, weight: 4 }),
	Object.freeze({ file: 'animals/bison_by_poly_by_google_9strha_txds_na.glb', terrain: 'meadow', footprintMeters: 4, weight: 2 }),
	Object.freeze({ file: 'animals/bizon_RqkLNYPnfx.glb', terrain: 'meadow', footprintMeters: 4, weight: 2 }),
	Object.freeze({ file: 'animals/butterfly_e9NAQQrCbLu.glb', terrain: 'meadow', footprintMeters: 1, weight: 4 }),
	Object.freeze({ file: 'animals/wasp_by_poly_by_google_4udwqxbm0_b_na.glb', terrain: 'meadow', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'fbx/Ancient_Assets_Pack.fbx', terrain: 'meadow', footprintMeters: 9, weight: 2 }),
	Object.freeze({ file: 'fbx/AncientHouseV5_house.fbx', terrain: 'meadow', footprintMeters: 10, weight: 3 }),
	Object.freeze({ file: 'fbx/Basic_Temple_temple.fbx', terrain: 'meadow', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/flower_heliophila_4k.fbx', terrain: 'meadow', footprintMeters: 2, weight: 5 }),
	Object.freeze({ file: 'fbx/Free_Building_House_house.fbx', terrain: 'meadow', footprintMeters: 10, weight: 3 }),
	Object.freeze({ file: 'fbx/Free_Dome_dome.fbx', terrain: 'meadow', footprintMeters: 11, weight: 1 }),
	Object.freeze({ file: 'fbx/Free_Roman_Building_building.fbx', terrain: 'meadow', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/Free_temple_temple.fbx', terrain: 'meadow', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/grass_bermuda_01_4k.fbx', terrain: 'meadow', footprintMeters: 2, weight: 6 }),
	Object.freeze({ file: 'fbx/grass_medium_02_4k.fbx', terrain: 'meadow', footprintMeters: 2, weight: 6 }),
	Object.freeze({ file: 'fbx/Old House 2/Old House Files/Old House 2 3D Models.FBX', terrain: 'meadow', footprintMeters: 10, weight: 2 }),
	Object.freeze({ file: 'fbx/Stairs_Orient_stairs.fbx', terrain: 'meadow', footprintMeters: 9, weight: 1 }),
	Object.freeze({ file: 'fbx/StoneFloor_FragmentOne.fbx', terrain: 'meadow', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_GrassOne.fbx', terrain: 'meadow', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_GrassTwo.fbx', terrain: 'meadow', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_SlabOne.fbx', terrain: 'meadow', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/Twin_Pillar_pilalrs.fbx', terrain: 'meadow', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'props/statue_athena_shield.glb', terrain: 'meadow', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_parthenon_base.glb', terrain: 'meadow', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_parthenon_roof.glb', terrain: 'meadow', footprintMeters: 7, weight: 2 }),
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
	Object.freeze({ file: 'vegetation/grass_ground_cover.fbx', terrain: 'meadow', footprintMeters: 2, weight: 6 }),
	Object.freeze({ file: 'vegetation/grass_UGTOzcO3P2.glb', terrain: 'meadow', footprintMeters: 3, weight: 6 }),
	// ---- farmland --------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/cat_6dM1J6f6pm9.glb', terrain: 'farmland', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/chicken_1YE8U35HXsI.glb', terrain: 'farmland', footprintMeters: 1, weight: 4 }),
	Object.freeze({ file: 'animals/cow_0OToIgkcVM7.glb', terrain: 'farmland', footprintMeters: 3, weight: 3 }),
	Object.freeze({ file: 'animals/dog_9bqPCxOyrk.glb', terrain: 'farmland', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/farm_5GDbUJV2vQb.glb', terrain: 'farmland', footprintMeters: 14, weight: 3 }),
	Object.freeze({ file: 'animals/farm_91wMLb9kKo.glb', terrain: 'farmland', footprintMeters: 14, weight: 3 }),
	Object.freeze({ file: 'animals/goat_d7dImmjtF8E.glb', terrain: 'farmland', footprintMeters: 2, weight: 3 }),
	Object.freeze({ file: 'animals/horse_by_poly_by_google_5ocnvsh_zf_na.glb', terrain: 'farmland', footprintMeters: 3, weight: 3 }),
	Object.freeze({ file: 'fbx/Classic_Building_building.fbx', terrain: 'farmland', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/fence_fence.fbx', terrain: 'farmland', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/Founain-Square_fountain.fbx', terrain: 'farmland', footprintMeters: 8, weight: 2 }),
	Object.freeze({ file: 'fbx/Fountain_fount.fbx', terrain: 'farmland', footprintMeters: 8, weight: 2 }),
	Object.freeze({ file: 'fbx/FreeBuilding_building.fbx', terrain: 'farmland', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/House_free_house.fbx', terrain: 'farmland', footprintMeters: 10, weight: 3 }),
	Object.freeze({ file: 'fbx/House_with_Garden_GLB.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/MedHouse.fbx', terrain: 'farmland', footprintMeters: 10, weight: 4 }),
	Object.freeze({ file: 'fbx/Medieval_Market_.fbx', terrain: 'farmland', footprintMeters: 14, weight: 2 }),
	Object.freeze({ file: 'fbx/Medieval_Market_Asset_Pack.fbx', terrain: 'farmland', footprintMeters: 14, weight: 2 }),
	Object.freeze({ file: 'props/farm_dirt_8BQFbUMOeC.glb', terrain: 'farmland', footprintMeters: 8, weight: 4 }),
	Object.freeze({ file: 'settlements/barn_0QTh_KUZRYE.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/barn_A6UkPq33aZ.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/barn_dSsUaUlaxHk.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/barn_vSqQNA7ez6.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/big_barn_q1N3xn2SpC.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/bird_house_jSpF4LjoQp.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/blacksmith_bV52eTG1Aj.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'settlements/building_components_4.glb', terrain: 'farmland', footprintMeters: 10, weight: 2 }),
	Object.freeze({ file: 'settlements/church_6vzTphxL9w4.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'settlements/church_GHzPfvoyzX.glb', terrain: 'farmland', footprintMeters: 16, weight: 1 }),
	Object.freeze({ file: 'settlements/fantasy_house_dcPho4SUA3.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/fantasy_stable_qhNQSOGGbi.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'settlements/house_fdaqERLQCc.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/house_HeHDd2rTpX.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/house_roqiHdrpgc.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/medieval_house_pack.fbx', terrain: 'farmland', footprintMeters: 14, weight: 3 }),
	Object.freeze({ file: 'settlements/medium_house_4hI5fNvl6z.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/palace_f5wb0x6Qk3j.glb', terrain: 'farmland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'settlements/silo_house_ZgstejsAcN.glb', terrain: 'farmland', footprintMeters: 13, weight: 3 }),
	Object.freeze({ file: 'vegetation/crops_Ro6K0Yg7mx.glb', terrain: 'farmland', footprintMeters: 8, weight: 4 }),
	// ---- woodland --------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/badger_8k4cduyRhi4.glb', terrain: 'woodland', footprintMeters: 1, weight: 2 }),
	Object.freeze({ file: 'animals/bear_0PXWfxfb0Hu.glb', terrain: 'woodland', footprintMeters: 3, weight: 1 }),
	Object.freeze({ file: 'animals/bird_8Ph79kHbt9s.glb', terrain: 'woodland', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/cottage_YDGLLT0emC.glb', terrain: 'woodland', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'animals/crow_1MIvWQ5Q3R9.glb', terrain: 'woodland', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/elk_bO8XPdrAb5G.glb', terrain: 'woodland', footprintMeters: 3, weight: 2 }),
	Object.freeze({ file: 'animals/fox_10u8FYPC5Br.glb', terrain: 'woodland', footprintMeters: 1, weight: 2 }),
	Object.freeze({ file: 'animals/great_horned_owl_fNkq9CwSG6d.glb', terrain: 'woodland', footprintMeters: 1, weight: 2 }),
	Object.freeze({ file: 'animals/mouse_4KKE4D2FV1D.glb', terrain: 'woodland', footprintMeters: 1, weight: 2 }),
	Object.freeze({ file: 'animals/rabbit_8_ZF1ZGRpk5.glb', terrain: 'woodland', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/rabbit_9OBTRVYUSmt.glb', terrain: 'woodland', footprintMeters: 1, weight: 3 }),
	Object.freeze({ file: 'animals/skunk_bf8IDe1qb7u.glb', terrain: 'woodland', footprintMeters: 1, weight: 2 }),
	Object.freeze({ file: 'animals/woodrat_24Xnzj_Nmln.glb', terrain: 'woodland', footprintMeters: 1, weight: 2 }),
	Object.freeze({ file: 'fbx/Ancient_Assets.fbx', terrain: 'woodland', footprintMeters: 9, weight: 2 }),
	Object.freeze({ file: 'fbx/Big_Long_stairs_stairs.fbx', terrain: 'woodland', footprintMeters: 10, weight: 1 }),
	Object.freeze({ file: 'fbx/dead_tree_trunk_02_4k.fbx', terrain: 'woodland', footprintMeters: 5, weight: 4 }),
	Object.freeze({ file: 'fbx/dry_branches_medium_01_4k.fbx', terrain: 'woodland', footprintMeters: 3, weight: 5 }),
	Object.freeze({ file: 'fbx/Free_tower22_tower.fbx', terrain: 'woodland', footprintMeters: 10, weight: 2 }),
	Object.freeze({ file: 'fbx/medieval_house.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/nettle_plant_4k.fbx', terrain: 'woodland', footprintMeters: 2, weight: 5 }),
	Object.freeze({ file: 'fbx/Pillar_World_pillar.fbx', terrain: 'woodland', footprintMeters: 7, weight: 3 }),
	Object.freeze({ file: 'fbx/pine_realistic.fbx', terrain: 'woodland', footprintMeters: 8, weight: 4 }),
	Object.freeze({ file: 'fbx/StoneFloor_FragmentFive.fbx', terrain: 'woodland', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_FragmentFour.fbx', terrain: 'woodland', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_FragmentThree.fbx', terrain: 'woodland', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_SlabTwo.fbx', terrain: 'woodland', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/Temple_Building5_building.fbx', terrain: 'woodland', footprintMeters: 12, weight: 2 }),
	Object.freeze({ file: 'fbx/temple_tower_temple.fbx', terrain: 'woodland', footprintMeters: 11, weight: 2 }),
	Object.freeze({ file: 'fbx/tree_stump_01_4k.fbx', terrain: 'woodland', footprintMeters: 4, weight: 5 }),
	Object.freeze({ file: 'props/hand_statue_prop.glb', terrain: 'woodland', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_face.glb', terrain: 'woodland', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_hand.glb', terrain: 'woodland', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/wood_log_L4E32Wee6C.glb', terrain: 'woodland', footprintMeters: 3, weight: 4 }),
	Object.freeze({ file: 'settlements/cabin_by_poly_by_google_1gpgti_c05m_na.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/cabin_dTSrDa0oz0a.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/cabin_shed_HTx7PZt6Zm.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/fortress_HZPOZU2NiM.glb', terrain: 'woodland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/greek_pillar_broken_half.glb', terrain: 'woodland', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_pillar_broken_quarter.glb', terrain: 'woodland', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/log_cabin_et0OmFeZVkb.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'settlements/modular_castle_kit_AhhyXvO6Fd.glb', terrain: 'woodland', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/small_wooden_house.glb', terrain: 'woodland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/birch_trees_R7qMWzb7nk.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/fall_tree_4GYen9Xm3Kj.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/maple_trees_iGFtQd0PJO.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/pine_trees_oYtDty0fR6.glb', terrain: 'woodland', footprintMeters: 14, weight: 5 }),
	Object.freeze({ file: 'vegetation/tree_aVOxaHRPWe.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_QVOop92WmG.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_qZtx0AHhcy.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_stump_esFOngb0uwl.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/tree_VfZbAkek1r.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	Object.freeze({ file: 'vegetation/trees_etFGNvsiFv.glb', terrain: 'woodland', footprintMeters: 10, weight: 6 }),
	// ---- upland ----------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/bighorn_sheep_4kUChlMv8Vp.glb', terrain: 'upland', footprintMeters: 2, weight: 3 }),
	Object.freeze({ file: 'animals/cougar_1ICRwBHSin7.glb', terrain: 'upland', footprintMeters: 2, weight: 2 }),
	Object.freeze({ file: 'fbx/Ancient_Columns_Blend_Ancient_Columns.fbx', terrain: 'upland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/Free_rock_Rock_1.fbx', terrain: 'upland', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/Ruins_Column_columns.fbx', terrain: 'upland', footprintMeters: 8, weight: 3 }),
	Object.freeze({ file: 'fbx/tower22_tower.fbx', terrain: 'upland', footprintMeters: 10, weight: 2 }),
	Object.freeze({ file: 'settlements/modular_ruins_pack_F2LAK03B0r.glb', terrain: 'upland', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'vegetation/pine_Zt62gceKXZ.glb', terrain: 'upland', footprintMeters: 14, weight: 5 }),
	// ---- arid ------------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/coyote_auVAs_kT6nE.glb', terrain: 'arid', footprintMeters: 2, weight: 3 }),
	Object.freeze({ file: 'animals/elephant_a27MA0rXyyj.glb', terrain: 'arid', footprintMeters: 5, weight: 1 }),
	Object.freeze({ file: 'animals/lion_3XAJojWxSWz.glb', terrain: 'arid', footprintMeters: 3, weight: 2 }),
	Object.freeze({ file: 'animals/spider_monkey_4Ci4DWwucRd.glb', terrain: 'arid', footprintMeters: 1, weight: 1 }),
	Object.freeze({ file: 'fbx/desert_rocks.glb', terrain: 'arid', footprintMeters: 9, weight: 3 }),
	Object.freeze({ file: 'fbx/namaqualand_boulder_02_4k.fbx', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/namaqualand_boulder_05_4k.fbx', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'fbx/quiver_tree_02_4k.fbx', terrain: 'arid', footprintMeters: 7, weight: 4 }),
	Object.freeze({ file: 'vegetation/dead_tree_n8FhMgMldD.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'vegetation/dead_trees_F5I0Q7TwO5.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'vegetation/dead_trees_with_snow_iEuwXWner0.glb', terrain: 'arid', footprintMeters: 6, weight: 4 }),
	Object.freeze({ file: 'vegetation/palm_trees_VYslw9DEi6.glb', terrain: 'arid', footprintMeters: 11, weight: 4 }),
	Object.freeze({ file: 'vegetation/twisted_tree_8oraKn9m0x.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'vegetation/twisted_tree_9aWlx82xUf.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'vegetation/twisted_tree_GVTsMmuzv7.glb', terrain: 'arid', footprintMeters: 7, weight: 5 }),
	// ---- snowline --------------------------------------------------------------------------------
	Object.freeze({ file: 'animals/snow_leopard_26tTvxyxkPC.glb', terrain: 'snowline', footprintMeters: 2, weight: 3 }),
	Object.freeze({ file: 'fbx/fir_tree_01_4k.fbx', terrain: 'snowline', footprintMeters: 7, weight: 5 }),
	Object.freeze({ file: 'fbx/low_poly_winter_tree_pack.glb', terrain: 'snowline', footprintMeters: 9, weight: 4 }),
	Object.freeze({ file: 'vegetation/winter_tree.glb', terrain: 'snowline', footprintMeters: 9, weight: 4 }),
	// ---- roadside --------------------------------------------------------------------------------
	Object.freeze({ file: 'fbx/Arch_Free_arch.fbx', terrain: 'roadside', footprintMeters: 8, weight: 2 }),
	Object.freeze({ file: 'fbx/GovernmentBuilding_building.fbx', terrain: 'roadside', footprintMeters: 14, weight: 1 }),
	Object.freeze({ file: 'fbx/Lamp6_lamp.fbx', terrain: 'roadside', footprintMeters: 5, weight: 3 }),
	Object.freeze({ file: 'fbx/Lamp_Pillar_lamp.fbx', terrain: 'roadside', footprintMeters: 5, weight: 3 }),
	Object.freeze({ file: 'fbx/MedievalPackSTY_Chest1.fbx', terrain: 'roadside', footprintMeters: 3, weight: 3 }),
	Object.freeze({ file: 'fbx/Oval_Lamp_lamp.fbx', terrain: 'roadside', footprintMeters: 5, weight: 3 }),
	Object.freeze({ file: 'fbx/StoneFloor_FragmentTwo.fbx', terrain: 'roadside', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/StoneFloor_Ground.fbx', terrain: 'roadside', footprintMeters: 6, weight: 2 }),
	Object.freeze({ file: 'fbx/Street_Lamp_lamp.fbx', terrain: 'roadside', footprintMeters: 5, weight: 3 }),
	Object.freeze({ file: 'fbx/Structure_gate_gate.fbx', terrain: 'roadside', footprintMeters: 9, weight: 2 }),
	Object.freeze({ file: 'fbx/treasure_chest_4k.fbx', terrain: 'roadside', footprintMeters: 3, weight: 3 }),
	Object.freeze({ file: 'fbx/Triple_Lamp_lamp.fbx', terrain: 'roadside', footprintMeters: 5, weight: 3 }),
	Object.freeze({ file: 'fbx/wooden_ladder_02_4k.fbx', terrain: 'roadside', footprintMeters: 3, weight: 2 }),
	Object.freeze({ file: 'fbx/wooden_military_crate_4k.fbx', terrain: 'roadside', footprintMeters: 3, weight: 3 }),
	Object.freeze({ file: 'props/barrel_zjCQP1TAci.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'props/bonfire_Azj9hJwwwG.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'props/crate_3OEFd1AWfa.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'props/greek_stone_bench.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_arms.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_clothes.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_athena_spear.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_base_pedestal.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_david.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/statue_nike.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'props/wooden_door_rounded_tPsxxWUdTn.glb', terrain: 'roadside', footprintMeters: 2, weight: 4 }),
	Object.freeze({ file: 'settlements/barracks_UXCOwRBSxx.glb', terrain: 'roadside', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/castle_gate_tKTchdiQzV.glb', terrain: 'roadside', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/greek_arch_single.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_pillar_intact.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_small_garden.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/greek_stone_stairs.glb', terrain: 'roadside', footprintMeters: 7, weight: 2 }),
	Object.freeze({ file: 'settlements/stone_wall_towers_geisKzlSFZ.glb', terrain: 'roadside', footprintMeters: 12, weight: 1 }),
	Object.freeze({ file: 'settlements/wall_segment_muro.glb', terrain: 'roadside', footprintMeters: 12, weight: 1 }),
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
