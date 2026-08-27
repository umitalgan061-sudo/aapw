/**
 * Models withheld because **no system in this game can run them** — run 407.
 *
 * Split out of `worldPropExclusionsEntities`' parent, `world/worldPropExclusions.js`, when the
 * `yeniglb` branch's 29 uploads took that file to 662 lines against this project's 600-line cap
 * (GOVERNANCE.md Altın Kural 7). The split is along a real seam rather than at a convenient line
 * number: everything here is withheld for a *systems* reason — a creature with no skeleton to walk it,
 * a ship with no water system to sail it, a chariot with no cart system to pull it, a building from a
 * continent this map does not draw — while its parent file holds the reasons that are about the
 * scatter itself (too many triangles, too many draw calls, too many megabytes, a ground plane wearing
 * a prop's filename).
 *
 * Merged back into `PROP_EXCLUSIONS_BY_REASON` by the parent, so `scripts/checkAssetCoverage.js` and
 * every other reader still see one flat list of reasons.
 *
 * @module world/worldPropExclusionsEntities
 */

/** Entity, vehicle and place models withheld because the game has no system that could use them. */
export const ENTITY_EXCLUSIONS_BY_REASON = Object.freeze({
	/**
	 * The `yeniglb` branch's creature models that cannot be live creatures (run 407).
	 *
	 * The owner added ten creature-shaped models and asked for the Doom of Valyria to be populated from
	 * them. Measured rather than picked by name, and only one survived — `infernal_magma_hound`, which
	 * is now a real species in `gameplay/animalConfig.js`. These are the other nine and why each is out:
	 *
	 * | model | measured | why not |
	 * |---|---|---|
	 * | `giant_stone_magma_golem.glb` | **1,000,042 triangles** | twice the whole mobile scene budget in one creature |
	 * | `volcanic_stone_lava_magma_golem.glb` | **971,932 triangles** | same |
	 * | `volcanic_damaged_elemental.glb` | 72,060 tris, **117 x 158 x 153 m**, no rig | a landscape-scale statue, and rigless |
	 * | `cod_ghosts_hellhound.glb` | rigged, **zero animation clips**, 33 m tall | a skeleton with nothing to play; would stand frozen |
	 * | `hell_hound.glb` | 12,554 tris across **40 meshes / 40 submissions**, no rig | rigless, and 40 draw calls per animal |
	 * | `ember_hellhound_-_dark_fantasy_demon_hound.glb` | **115.3 MB** | download alone is a third of the whole catalogue |
	 * | `skinless_hound_-_exposed_muscle_beast.glb` | **115.2 MB** | same |
	 * | `shadow_hound_dark_fantasy_bone-spiked_beast.glb` | **108.9 MB** | same |
	 * | `magma_fire_dragon_knight.glb` | 67.7 MB | a mounted figure, and `gameplay/dragonConfig.js` owns the dragon this world flies |
	 * | `realistic_whitetailed_deer__free_commercial_use.glb` | 39,392 tris, no rig, **97.9 x 84.9 x 39.1 m** | a deer this world would genuinely use, but rigless and authored a hundred metres tall |
	 *
	 * The rigless ones are the `arya_stark.glb` trap above, one category down: a creature with no
	 * skeleton cannot walk, and a wild animal standing perfectly still reads worse than an empty field.
	 * The three 110 MB hounds are the `tooLargeToDownloadForScatter` trap on the creature axis. Any of
	 * them returns from a decimated, rigged derivative.
	 *
	 * **Not measured, and said so:** the three 110 MB hounds were priced from their Git-LFS pointers,
	 * not hydrated and opened. Their triangle counts and rigs are unknown; the download size alone
	 * decides them here.
	 */
	creatureModelThatCannotBeAnimated: Object.freeze([
		"fbx/giant_stone_magma_golem.glb",
		"fbx/volcanic_stone_lava_magma_golem.glb",
		"fbx/volcanic_damaged_elemental.glb",
		"fbx/cod_ghosts_hellhound.glb",
		"fbx/hell_hound.glb",
		"fbx/ember_hellhound_-_dark_fantasy_demon_hound.glb",
		"fbx/skinless_hound_-_exposed_muscle_beast.glb",
		"fbx/shadow_hound_dark_fantasy_bone-spiked_beast.glb",
		"fbx/magma_fire_dragon_knight.glb",
		"fbx/realistic_whitetailed_deer__free_commercial_use.glb",
	]),
	/**
	 * Ships, and this world has no water to sail them on (run 407).
	 *
	 * Ten sailing vessels arrived on the `yeniglb` branch. `world/water.js` draws a surface; there is no
	 * buoyancy, no harbour, no vessel that moves, and `roadNetworkSafetyCheck.js` still reports three
	 * seat-to-seat links as **"SEA (ferry owed)"** — the open question in `QUESTIONS_FOR_OWNER.md` about
	 * how `umit->doran`, `twin->balon` and `umit->Xaro` should be crossed. These are the models that
	 * answer it, and scattering them across the ground in the meantime would put a frigate in a meadow.
	 * They are withheld pending that owner decision, not because they are unwanted.
	 */
	/**
	 * The `valyria` branch's eleven uploads — Tripo sculpts with no skeleton in any of them (run 408).
	 *
	 * The owner asked for `bas_melek.glb` to become the player character, "kanatlarına hareket
	 * verdirelim, yükselebilme özelliği olsun". Read straight out of the glTF JSON rather than inferred:
	 *
	 * ```
	 * bas_melek.glb   skins: 0   animations: 0   nodes: 25   meshes: 21   generator: Sketchfab-0.5.0
	 * ```
	 *
	 * **`skins: 0` and `animations: 0` means there is no skeleton and no clip.** Wings cannot be made to
	 * beat on a mesh with no bones, and the figure cannot walk. Nor can the wings be moved as separate
	 * objects: the 21 meshes are not body parts — every one carries the identical name
	 * `tripo_node_ca66fc79_tripo_mat_ca66fc79_0` and holds 88,000-107,000 triangles, which is one dense
	 * Tripo generation sliced into equal chunks by the exporter, not a head, a torso and two wings.
	 *
	 * And the size is the second wall: **1,963,878 triangles**, about four times the entire 500,000
	 * mobile scene budget for one character. Nine of the eleven are the same shape:
	 *
	 * | model | triangles |
	 * |---|---|
	 * | `corrupted_king_in_black_armor_with_bone_crown.glb` | 1,991,181 |
	 * | `black_owl_familiar__amber-eyed_dark_fantasy.glb` | 1,989,794 |
	 * | `bas_melek.glb` | 1,963,878 |
	 * | `bandaged_asylum_matron_needle_horror.glb` | 1,948,332 |
	 * | `realistic_woolly_sheep_-_thick_curled_fleece.glb` | 1,919,960 |
	 * | `black_wolf__pale-eyed_fierce_dark_predator.glb` | 1,909,436 |
	 * | `night_falcon_dark_fantasy_amber-eyed_bird.glb` | 1,895,313 |
	 * | `dark_necromancer_-_corrupted_staff__skulls.glb` | 1,893,733 |
	 * | `ember_winged_fallen_angel_warrior.glb` | 1,881,092 |
	 *
	 * `kni1.glb` (3,086 triangles) and `p-0r_noon.glb` (28,232) are the two light ones and are also
	 * rigless, so they are statues rather than characters as they stand.
	 *
	 * **None of this is a judgement on the models — they are the right subjects.** Every one comes back
	 * the moment it is re-exported rigged, with clips, and decimated: the same Tripo/Sketchfab pipeline
	 * can do all three. Until then a rigless two-million-triangle sculpt cannot be a player character,
	 * a villager or a wild animal, and putting it in the world as scenery would stand a named
	 * archangel motionless in a field.
	 */
	riglessSculptAwaitingARigAndDecimation: Object.freeze([
		"fbx/bandaged_asylum_matron_needle_horror.glb",
		"fbx/bas_melek.glb",
		"fbx/black_owl_familiar__amber-eyed_dark_fantasy.glb",
		"fbx/black_wolf__pale-eyed_fierce_dark_predator.glb",
		"fbx/corrupted_king_in_black_armor_with_bone_crown.glb",
		"fbx/dark_necromancer_-_corrupted_staff__skulls.glb",
		"fbx/ember_winged_fallen_angel_warrior.glb",
		"fbx/kni1.glb",
		"fbx/night_falcon_dark_fantasy_amber-eyed_bird.glb",
		"fbx/p-0r_noon.glb",
		"fbx/realistic_woolly_sheep_-_thick_curled_fleece.glb",
	]),
	needsANavalSystemThatDoesNotExistYet: Object.freeze([
		"fbx/aleksandr_class_archipelago_frigate.glb",
		"fbx/anno_1401_-_explorer_ship.glb",
		"fbx/brigg-_joachim-_allwordt_sail_open.glb",
		"fbx/dutch_ship_large.glb",
		"fbx/dutch_ship_medium.glb",
		"fbx/hms_agamemnon.glb",
		"fbx/hms_bounty.glb",
		"fbx/hms_victory_a_medieval_warship.glb",
		"fbx/nao_victoria_galleon_ship.glb",
		"fbx/shipking.glb",
	]),
	/**
	 * Drawn vehicles with no draught animal attached and no cart system to join (run 407).
	 *
	 * `gameplay/cartBrain.js` drives this world's horse-drawn carts, and it drives *its* model. These
	 * four are chariots authored as one piece — `lord_surya_on_divine_chariot.glb` at 99.3 MB and
	 * `arjunas_chariot_rath.glb` at 131.0 MB include their own horses, riders and deities. Nothing in
	 * the cart system can take them, and dropped on the ground as scenery they are Hindu and Norse
	 * mythological set-pieces standing in Westerosi fields.
	 */
	drawnVehicleWithNoSystemToJoin: Object.freeze([
		"fbx/ancient_horse_chariot_mauryan_era.glb",
		"fbx/arjunas_chariot_rath.glb",
		"fbx/lord_surya_on_divine_chariot.glb",
		"fbx/thors_chariot.glb",
	]),
	/**
	 * Real places from other continents (run 407).
	 *
	 * `hengshan_hanging_temple.glb` (73.2 MB) is the Hanging Temple of Mount Heng, `aguilar_chateau.glb`
	 * a French château, `jaaninoja_bridge_in_turku_kurala_finland.glb` (42.6 MB) a named bridge in
	 * Turku. Each is a recognisable real building, and the owner's standing instruction is not to
	 * deviate from `map.png`'s Westeros. A named Chinese temple on the Trident is a deviation whatever
	 * its polygon count. `ancient_blue_hoplite_warrior.glb` joins them: a Greek hoplite is a character
	 * for a world this one is not.
	 */
	realPlaceFromAnotherWorld: Object.freeze([
		"fbx/aguilar_chateau.glb",
		"fbx/ancient_blue_hoplite_warrior.glb",
		"fbx/hengshan_hanging_temple.glb",
		"fbx/jaaninoja_bridge_in_turku_kurala_finland.glb",
	]),
});
