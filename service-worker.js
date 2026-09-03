// Run385 ground-colour-field offline shell extension — `worldReferenceGroundColorField.js` is imported
// by `world/terrainBiomeShading.js`, so an offline PWA load needs it cached or terrain cannot shade.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceGroundColorField.js');
});

// Run384 sky-bodies offline shell extension — `skyBodies.js` is imported by `sceneManager.js` and
// `game3d.js`, so an offline PWA load needs it cached or the scene cannot boot at all.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/skyBodies.js');
});

// Owner-map mountain relief offline shell extension. terrain.js imports this canonical live-height
// source, so an offline 3D boot must cache it before any chunk can be generated.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceMountainRelief.js');
});

// Run341 offline-shell completeness fix — not this run's own feature (the settings screen, ADR-0289),
// but a real `checkServiceWorkerCache.js` FAIL found while running this run's full DoD sweep: two
// `src/3d` files landed on `main` between run 340 and this run (the renderer-realism-baseline commit's
// `renderQuality.js`, now imported by `sceneManager.js`/`game3d.js`, and a concurrent NW-corner
// terrain-agent commit's `world/g01Terrain3dRuntimeAdapter.js`) without either being added here, so an
// offline PWA load would have failed to boot the scene at all. Closed here since it blocks this run's
// own required full sweep from passing, not deferred.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/renderQuality.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g01Terrain3dRuntimeAdapter.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g70Terrain3dRuntimeAdapter.js');
});

// Run341 offline-shell completeness fix (continued) — the same category of gap, this time 10 rigged
// animal models a prior run's own "wire 10 unused rigged animal models into the live world" commit
// added to `livingWorldSpawner.js`'s per-species clip table without registering any of the 10 in the
// offline precache list, so an offline PWA session would spawn zero of them.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./assets/models/animals/white_horse_bEdE4rmZy9.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/cow_26zM1outCr.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/bull_a8PIIYwF7r.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/deer_T6Cs7tmMHJ.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/stag_tQdzbZ1Cmw.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/fox_Bc97C66HKi.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/husky_wcWiuEqwzq.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/alpaca_bCVFD48i2l.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/zebra_iclPBR6SBZ.glb');
    GAME3D_SHELL_FILES.push('./assets/models/animals/sheep_C39AUXUUes.glb');
});

// Run417 near-detail tree offline shell extension — the two real tree models
// `world/vegetationNearDetail.js` stands in place of the primitive scatter within 220 m of the
// camera. Without them cached an offline session keeps the cones and spheres, which degrades rather
// than breaks; with them the near field looks the same offline as online.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./assets/models/vegetation/pine_Zt62gceKXZ.glb');
    GAME3D_SHELL_FILES.push('./assets/models/vegetation/tree_QVOop92WmG.glb');
    // Run423 — the dry-country model, added when the near-detail layer started choosing by biome.
    GAME3D_SHELL_FILES.push('./assets/models/vegetation/tree_VfZbAkek1r.glb');
});

// Run407 Valyria magma-hound offline shell extension — `gameplay/animalConfig.js`'s new `magmaHound`
// species model, spawned nine times in the Doom of Valyria. Without it an offline session puts nine
// placeholder boxes there instead of the pack.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./assets/models/fbx/infernal_magma_hound_-_free_lava_creature_asset.glb');
    GAME3D_SHELL_FILES.push('./src/3d/world/worldPropExclusionsEntities.js');
});

// Run339 pause-menu offline shell extension — `ui/pauseMenu.js` (ADR-0285), now imported by
// `game3d.js`, so an offline PWA load needs it cached or the scene cannot boot at all.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/ui/pauseMenu.js');
});

// Run336 cart-brain offline shell extension — `gameplay/cartBrain.js` (ADR-0282), now imported by
// `gameplay/livingWorldSpawner.js`, so an offline PWA load needs it cached or the scene cannot spawn
// FAZ 6's horse-drawn carts at all.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/cartBrain.js');
});

// Run332 living-world-spawner offline shell extension — `gameplay/livingWorldSpawner.js` is now
// imported by `game3d.js` (the NPC/animal/procedural-creature/dragon spawn wiring extracted out of
// it purely to stay under the 600-line file cap, no behavior change), so an offline PWA load needs
// it cached or the scene cannot spawn its living population at all.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/livingWorldSpawner.js');
});

// Run330 villages offline shell extension — `world/villages.js` is imported by `sceneManager.js`, so
// an offline PWA load needs it cached or the scene cannot build at all.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/villages.js');
});

// Run329 creature-brain offline shell extension — `gameplay/creatureBrain.js`/`creatureSpawner.js`
// (ADR-0274), now actually imported by `game3d.js` (unlike the run 326/327 rig/gait modules they
// finally drive, which shipped inert), so an offline PWA load needs these cached to boot the scene.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/creatureBrain.js');
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/creatureSpawner.js');
});

// G07 Terrain3D runtime parity offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBake.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBakeHeights.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBakeRock.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBakeColor.js');
});

// Run317 Pindex-10 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex10Detail.js');
});

// Run296 Pindex-09 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex09Detail.js');
});

// Run295 Pindex-08 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex08Detail.js');
});

// Run294 Pindex-07 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex07Detail.js');
});

// Run293 Pindex-06 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex06Detail.js');
});

// Run292 Pindex-05 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex05Detail.js');
});

// Run216 complete World Editor offline shell extension.
// Run282 Pindex-04 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex04Detail.js');
});

// Run281 Pindex-03 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex03Detail.js');
});

// Run278 Pindex-02 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex02Detail.js');
});

// Run277 Pindex-01 detail offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex01Detail.js');
});

// Run276 owner-map semantic terrain offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSurfacePindexes.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSurfaceTerrainVisual.js');
});

// Run216 complete World Editor offline shell extension.
// Run221 realistic gameplay aurora offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/auroraRealism.js');
    GAME3D_SHELL_FILES.push('./src/3d/nightVisualEnhancement.js');
    GAME3D_SHELL_FILES.push('./src/3d/auroraRayCurtainV4.js');
    GAME3D_SHELL_FILES.push('./src/3d/auroraNightAtmosphereV5.js');
});

// Run216 complete World Editor offline shell extension.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorAssetScalePolicy.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorClipboardController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorEditModeEnvironment.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorGamePatchPreview.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorGamePatchPreviewGate.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorGamePatchPreviewGateSafe.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorGamePreviewLauncher.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorHistoryController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceBoundsSafety.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceCoordinatorLifecycle.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceEditCoordinator.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceEditCoordinatorSafe.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceEditOperations.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceEditSession.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceInteractionBootstrap.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceInteractionInstaller.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceInteractionPipeline.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceInteractionRuntime.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceInteractionSingleton.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceLifecycleSafety.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstancePickingModel.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstancePointerController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstancePointerOwnership.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceRaycastSource.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceRenderAdapter.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceSelectionModel.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceTransformBridge.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceTransformProxy.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorLiveWorldAuthoring.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorLiveWorldBridge.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorLiveWorldResourceCleanup.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorLiveWorldVisualSync.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorLocalSession.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorLocationNavigator.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorMaterialStudio.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorPlacementController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorPlacementControllerSafe.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorRoadController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorRoadModel.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorScaleInputController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorTerrainCellModel.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorTerrainPaintController.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorTerrainSemantics.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorTransformControls.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorWorldPatchCompiler.js');
    GAME3D_SHELL_FILES.push('./src/3d/vendor/three/addons/controls/TransformControls.js');
});

// Run214 Westeros World Editor offline authoring shell; registered before the established cache install handler.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./editor.html');
    GAME3D_SHELL_FILES.push('./editor.css');
    GAME3D_SHELL_FILES.push('./src/3d/editor/worldEditor.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/editorAssetLibrary.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorAssetManager.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorInstanceManager.js');
    GAME3D_SHELL_FILES.push('./src/3d/editor/EditorSceneSerializer.js');
    GAME3D_SHELL_FILES.push('./scenes/westeros-world.example.json');
});

// Run207 registers first so the established install handler receives the RTS entries without replacing any prior cache line.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./rts.html');
    GAME3D_SHELL_FILES.push('./rts.css');
    GAME3D_SHELL_FILES.push('./src/3d/rts/rtsArmy.js');
    GAME3D_SHELL_FILES.push('./src/3d/rts/rtsGame.js');
});

// ══ WESTEROS SERVICE WORKER v4 — iOS VIDEO FIX + OFFLINE APP SHELL ══
// Video (mp4): SW BYPASS — iOS Safari Range request için direkt ağa git
// Resimler: cache-first
// App shell (html/css/js/manifest): network-first, offline'da cache'e düş
// Diğer: network-first

const SW_VERSION = 'westeros-media-v4';
const MEDIA_CACHE = 'westeros-media-v4';
// `SHELL_CACHE` bumped v11->v12 (run 341): GAME3D_SHELL_FILES gained `renderQuality.js`,
// `world/g01Terrain3dRuntimeAdapter.js` and 10 animal model .glb files above, same "existing installs
// must actually clean up the old, now-stale entry" reasoning as every prior bump entry in this file.
// G70 runtime parity adds another offline-loadable `src/3d` module, so v12->v13 forces existing
// installs to replace the old shell rather than retaining a cache that cannot load the G70 adapter.
// Material Studio adds a new editor module to the offline graph; v14->v15 replaces existing editor caches.
// Shared material placement adds two runtime/headless modules; v15->v16 forces existing installs to cache them.
// Run346 first-audio addition (module + one .wav click sound); v16->v17 forces existing installs to
// fetch+cache both so the game's first sound works offline too, not only on a fresh install.
// RPG expedition readiness adds an offline-loadable gameplay module; v19->v20 refreshes existing installs.
// Merge of run 355-359 (skirts, road corridor, forest scatter, forest affinity) with that work: both
// sides bumped this independently, so the merged install needs a version above either branch's.
// Run 380 rewrites the height field itself: `worldReferenceMap.js` gained fifteen mountain chains read
// off `map.png` and `worldReferenceMountainRelief.js` sharpened every ridge cross-section. The shell is
// cache-first, so an existing install would keep serving the old modules and the player would see the
// old single smooth massif — a stale cache here is a stale *world*, not just a stale script. v39->v40.
// Run 381 rewrites the height field again — every mountain chain in `worldReferenceMountainRelief.js`
// was widened so ranges stop reading as walls. Same reasoning as v40 immediately above: the shell is
// cache-first, so a stale cache serves a stale *world*. v40->v41.
// Run 382 grounds buildings and scattered props on the lowest ground under their whole footprint
// (`villageBuildings.js`, `worldPropScatter.js`) so no corner floats, and drops the flat-sheet fence
// model. Both are offline-loadable runtime modules, so an existing install keeps floating buildings
// until the shell refreshes. v41->v42.
// Run 383 lays snow on the far north by latitude in `terrain.js`, so the Lands of Always Winter render
// as ice instead of grassland. Ground colour comes from that module at runtime; a cache-first shell
// would keep the old green north. v42->v43.
// Run 384 adds `skyBodies.js` — a visible sun and moon and the moon's light. It is a new offline-
// loadable module *and* a look change, so an existing install needs the refreshed shell for both
// reasons. v43->v44.
// Run 385 gives the ground its regional colour from map.png's own pixels — a new offline-loadable
// module and a look change both. v44->v45.
// Run 386 rewrites the height field again: every mountain peak is lower and each chain is broken
// into separate massifs, and the northern snow tail now follows map.png's own profile. A stale
// cache-first shell would keep the old, oversized single ridges. v45->v46.
// Run 387 removes a 1.68 m vertical step from the height field where road corridors meet, and grounds
// each road-ribbon edge on its own terrain. Both change what the ground is, so a cache-first shell
// would keep serving the old cliff. v46->v47.
// Run 388 rebakes the water depth field with a third channel (optical depth over 60 m) and rewrites
// the water shader to a per-channel Beer-Lambert extinction, so shallows read clear and depth darkens
// with distance through the body. A cache-first shell would keep the old depth-factor lerp. v47->v48.
// Run 389 stops the flat full-world water plane drawing underneath the displaced near mesh. The two
// were interpenetrating, and every intersection contour cut a hard silhouette — the sea's "repeating
// pale blobs". A cache-first shell would keep serving the blobs. v48->v49.
// Run 390 unburies the rivers: each bank is grounded on its own terrain and the ribbon is resampled
// to ~10m quads, so a watercourse that rendered as disconnected shards is now continuous. New
// offline-loadable module (riverRibbonPath.js) and a look change both. v49->v50.
// Run 391 carries the named rivers the last stretch into canonical water, so green-fork and
// white-knife empty into the sea instead of stopping on a beach. New offline-loadable module
// (riverMouth.js) and a change to the ground the rivers carve. v50->v51.
// Run 392 makes water optics latitude-dependent: the far north's sea is cold grey-green instead of
// the same Caribbean turquoise as Dorne. New offline-loadable module (waterLatitude.js) and a look
// change both. v51->v52.
// Run 393 keeps vegetation and village buildings out of the rivers — 96 instances stood in a channel,
// some half a metre from the centreline. Placement is generated at runtime from this code, so a
// cache-first shell would keep scattering trees mid-stream. v52->v53.
// Run 394 ties river foam to the bed's own speed, so calm reaches read as water instead of a barcode
// of transverse white bands. New offline-loadable module (riverFlowAppearance.js) and a look change
// both. v53->v54.
// Run 395 accounts for the last eight models in `assets/` that no system named. No look change — the
// scatter places exactly what it placed before — but `worldPropExclusions.js` is a cached shell module
// that `worldPropCatalogue.js` imports for its own summary, so a cache-first shell would keep serving
// the old, wrong "these eight are unaccounted for" picture. v54->v55.
// Run 396 cuts ~4.0s off the mobile world build by skipping relief chains that provably contribute
// zero. Every returned value is bit-identical, so nothing looks different — but a cache-first shell
// would keep serving the slow module, which is the whole point of the change. v55->v56.
// Run 398 takes 21 oversize models out of the scatter catalogue, cutting what a boot downloads from
// 878MB to 339MB. Density is unchanged (the chunk planner places the same count and picks from what
// remains), so this is a variety change rather than an emptier world — but it is still a look change
// plus a cached-module change, and a stale shell would keep fetching the 520MB house. v56->v57.
// Run 399 drops five more props: four whose texture sets were never committed — they 404'd on every
// map and rendered in flat untextured colour — and one FBX too old for the loader to open at all,
// which put a placeholder box on the meadow. A look change and a cached-module change both. v57->v58.
// Run 399b withholds a fifth: `Ancient_Assets_Pack.fbx`, 419 missing textures. Found by the gate run
// 399 added, on its first CI run, because that gate walks the whole catalogue where my own measurement
// had only sampled the models the boot requests. v58->v59.
// Run 400 withholds nine multi-building asset packs that each submitted hundreds of draw calls per
// placement — one alone submitted 1,252 against a whole-scene budget of 500. Mobile draw calls fall
// 1442 -> 230 and triangles 631,650 -> 427,188. A look change and a cached-module change. v59->v60.
// Run 405 collapses every imported prop's geometry groups to one per material at load — a new cached
// module plus a change to `worldPropScatter.js`. Nothing about the world looks different (the renders
// are pixel-identical and the mobile sample is bit-identical, 235 draw calls / 465,174 triangles), but
// a stale shell would keep serving the old `worldPropScatter.js` with an import of a module it has
// never cached, which fails offline outright rather than degrading. v60->v61.
// Run 407 puts the Doom of Valyria's magma hounds in the world — a new species model, a new
// map-anchored spawn kind in `gameplay/animals.js`, and the aggression branch that makes them charge
// instead of bolt. A stale shell would serve the old `animals.js` and a cache with no hound model in
// it, so an offline session would spawn nine placeholder boxes in Valyria. v61->v62.
// Run 409 adds ascent: hold the jump control to climb. It changes `gameplay/player.js`,
// `gameplay/playerConfig.js`, `input.js` and `game3d.js`, all four already cached, so the offline copy
// has to turn over or a returning player keeps the old modules and the control does nothing. v62->v63.
// Run 410 puts the cursed-region rule in the canonical placement gate (`world/vegetation.js`) and
// fixes the map-anchor conversion that had run 407's magma hounds 9.6 km from Valyria. Villages,
// villagers, herds and trees stop appearing in the Doom, and the hounds start appearing in it — both
// are look changes served from cached modules, so the offline copy has to turn over. v63->v64.
// Run 414 gives the road an actual dirt surface -- broad damp patching, wheel ruts, a drier crown,
// grit and scattered stones, all procedural because this container has no git-lfs and so no texture
// file can be committed. A stale shell keeps drawing the flat tan band. v64->v65.
const SHELL_CACHE = 'westeros-shell-v76';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css',
    './ios-pwa-fix.css',
    './script.js',
    './manifest.json',
    './logo.png'
];

// 3D mode's own app shell — precached separately (own cache.addAll call, own catch) so a failure
// here can never block the 2D shell above from installing. FAZ 4 was the first system to actually
// fetch a character/animation asset (peasant_girl + its 3 clips); FAZ 5 added the 6 shared-skeleton
// NPC character FBXes; FAZ 6 added the wolf glTF and the
// horse glb; FAZ 7 added the dragon FBX + its unbaked texture folder (9 files — the FBX references
// them externally, unlike the wolf/horse glbs, so each one needs its own entry here).
//
// run 65 (GOVERNANCE.md §15 "PWA Cache Versiyonlama"): this list had drifted badly behind
// `src/3d`'s real import graph and the settlements/dragon/horse assets actually spawned in-game —
// 10 live JS modules (sceneManager.js, both debug/ files, worldEvents.js + its toast UI, the
// dragon/dialogue-choice gameplay files, both road files) and 3 asset groups (the dragon FBX +
// textures, the horse glb, all 7 real castle glbs) were being fetched over the network on every
// load with no offline fallback at all, silently, because a missing cache entry fails open (network
// request) rather than throwing — see `scripts/checkServiceWorkerCache.js` for the standing
// regression check that prevents this from silently drifting again (asserts every `src/3d/**/*.js`
// file and every model asset path referenced from anywhere under `src/3d/` is present in this exact
// list). Cache names bumped (v1->v2 shell, v3->v4 media) so every existing install actually
// re-fetches this file and its new entries instead of quietly keeping a stale, incomplete
// `SHELL_CACHE`.
//
// run 67 (DECISIONS.md ADR-0086): added the 8th real castle model (`gatehouse_reference_decimated
// .glb`, the `twin` kingdom seat) once `world/settlements.js`'s `CASTLE_MODEL_ASSIGNMENTS` grew a
// new entry. `SHELL_CACHE` bumped v2->v3 so existing installs actually clean up the old, now-stale
// cache entry set rather than accumulating it alongside the new one (the `activate` handler's
// `KEEP`-array cleanup deletes the unreferenced old cache automatically).
//
// run 71 (DECISIONS.md ADR-0092): `gameplay/dragons.js` reached the 600-line cap and was split by
// subsystem into `dragonController.js` + `dragonFlightMath.js` + `dragonSpawns.js` (`dragons.js`
// itself stays, now as the re-exporting entry point every caller still imports), so the three new
// modules are precached here alongside it — without them an offline install would fetch
// `dragons.js` from cache and then fail on its three uncached `export ... from` targets. Same
// reasoning as the run 65/67 entries above: `SHELL_CACHE` bumped v3->v4 so an existing install
// replaces its now-incomplete entry set wholesale instead of mixing the new `dragons.js` facade
// with a cache that has no modules to re-export from.
//
// run 72 (DECISIONS.md ADR-0095): added `gameplay/creatureSpeciesConfig.js` (FAZ 11 planning
// scaffold — see that file's own header). Not imported by any runtime code yet, but
// `checkServiceWorkerCache.js`'s own standing guard treats every file under `src/3d/` as something
// an offline install must be able to load, so it's precached here from the start rather than added
// later once a real species implementation actually imports it. `SHELL_CACHE` bumped v4->v5, same
// reasoning as every entry above.
//
// run 77 (DECISIONS.md ADR-0100): `gameplay/gameplayConfig.js` reached 597/600 lines and was split
// by domain into `playerConfig.js` + `npcConfig.js` + `animalConfig.js` + `dragonConfig.js` +
// `interactionConfig.js` (`gameplayConfig.js` itself stays, now as the re-exporting barrel every
// caller still imports) — same pattern as the run 71/ADR-0092 `dragons.js` split above. The 5 new
// modules are precached here alongside it, same reasoning as that entry: without them an offline
// install would fetch `gameplayConfig.js` from cache and then fail on its 5 uncached
// `export ... from` targets. `SHELL_CACHE` bumped v5->v6.
//
// run 82 (DECISIONS.md ADR-0105): added `safeMode.js` — the GOVERNANCE.md §8.13 error-isolation
// helpers extracted out of `game3d.js`'s tick loop (which had reached 571/600 lines carrying five
// near-identical inline try/catch blocks). `game3d.js` now imports it, so without this entry an
// offline install would load `game3d.js` from cache and immediately fail on an uncached import —
// exactly the failure mode the run 65/77 entries above describe. `SHELL_CACHE` bumped v6->v7.
//
// run 90 (DECISIONS.md ADR-0116): added `gameplay/health.js` + `ui/healthBar.js` — the new FAZ 7
// dragon-combat player health state + its HUD, both now imported directly by `game3d.js`. Same
// failure mode as every entry above without them. `SHELL_CACHE` bumped v7->v8.
//
// run 107 (DECISIONS.md ADR-0134): added `ui/dayNightClock.js` — the new FAZ 8 discoverability HUD,
// now imported directly by `game3d.js`. Same failure mode as every entry above without it.
// `SHELL_CACHE` bumped v8->v9.
//
// run 109 (DECISIONS.md ADR-0136): added `gameplay/dragonReactionState.js` — the per-frame notice/
// reactive/pursuit/give-up/dive/telegraph/attack blend bookkeeping split out of
// `dragonController.js` when that file approached the 600-line cap a second time (same reasoning
// as the run 71/ADR-0092 `dragons.js` split above). Without this entry an offline install would
// fetch `dragonController.js` from cache and immediately fail on its uncached import — the same
// failure mode every entry above without a new module describes. `SHELL_CACHE` bumped v9->v10.
//
// run 111 (DECISIONS.md ADR-0138): added `world/vegetation.js` — procedural instanced trees, now
// imported directly by `sceneManager.js`/`game3d.js`. Same failure mode as every entry above
// without it. `SHELL_CACHE` bumped v10->v11.
//
// run 357 (DECISIONS.md ADR-0304): added `world/roadCorridorSmoothing.js` — the road cut-and-fill bed,
// imported directly by `sceneManager.js`. Same failure mode as every entry below without it: an
// offline install cached before this run would 404 on it and take the whole 3D mode down.
// `SHELL_CACHE` bumped v20->v21.
//
// run 355 (DECISIONS.md ADR-0301): added `world/terrainChunkSkirt.js` — the per-chunk crack skirt,
// imported directly by `world/terrain.js`. Offline installs that cached the shell before this run
// would fetch a `terrain.js` whose import of it 404s, taking the whole 3D mode down rather than
// degrading — the same failure mode every entry above describes. `SHELL_CACHE` bumped v19->v20.
//
// run 366 (DECISIONS.md ADR-0313): added `world/heroTrees.js` and `world/worldDressing.js` — the
// authored tree models and the dressing layer that composes them with the landmark scatter, imported
// directly by `game3d.js`. (`world/windGrass.js` came in the same run, extracted out of
// `sceneManager.js`.) An offline install cached before this run would 404 on all three and take the
// whole 3D mode down. `SHELL_CACHE` bumped v29->v30.
//
// run 367 (DECISIONS.md ADR-0314): added `world/terrainGroundRealism.js` — the drainage/aspect/mottle
// pass over the biome colour, imported directly by `world/terrain.js`. An offline install cached before
// this run would fetch a `terrain.js` whose import of it 404s, taking the whole 3D mode down rather than
// degrading. `SHELL_CACHE` bumped v30->v31.
//
// run 368 (DECISIONS.md ADR-0315): no new module, but `world/terrainMicroSurface.js` changed
// materially — its detail atlas was rebuilt from plane waves to tileable value noise. An existing
// offline install would otherwise keep serving the cached copy and keep rendering the diagonal weave
// this run removed, so `SHELL_CACHE` is bumped v31->v32 to retire it.
//
// run 416 (3D_GAME_PROGRESS.md ADR-0364): added `world/groundSurfaceGrain.js` — the 1.6-7.3 m detail layer
// imported by `world/terrainMicroSurface.js` and `world/roads.js`, plus its three image tiles. An
// offline install cached before this run would fetch a `terrainMicroSurface.js` whose import of it
// 404s, taking the whole 3D mode down rather than degrading, so `SHELL_CACHE` is bumped v65->v66.
//
// run 417 (3D_GAME_PROGRESS.md ADR-0365): added `world/vegetationNearDetail.js`, imported by
// `sceneManager.js`, plus the two real tree models it draws. Same reason as above: an offline install
// holding the older `sceneManager.js` would 404 on the new module. `SHELL_CACHE` bumped v66->v67.
//
// run 421 (3D_GAME_PROGRESS.md ADR-0369): added `world/riverEdgeAppearance.js`, imported by
// `world/rivers.js`. Same reason again — an offline install holding the older `rivers.js` would 404 on
// it and take the whole 3D mode down. `SHELL_CACHE` bumped v67->v68.
//
// run 423 (3D_GAME_PROGRESS.md ADR-0371): no new module, but the near-detail tree layer now picks its
// model by biome and needs a third one cached. An offline install would otherwise keep serving two.
// `SHELL_CACHE` bumped v68->v69.
const GAME3D_SHELL_FILES = [
    './src/3d/editor/EditorFallbackMaterialPalette.js',
    './game3d.html',
    './game3d.css',
    './src/3d/game3d.js',
    './src/3d/gameLoopHelpers.js',
    './src/3d/safeMode.js',
    './src/3d/eventBus.js',
    './src/3d/state.js',
    './src/3d/assetLoader.js',
    './src/3d/config.js',
    './src/3d/sceneManager.js',
    './src/3d/camera.js',
    './src/3d/sky.js',
    './src/3d/stars.js',
    './src/3d/lighting.js',
    './src/3d/fog.js',
    './src/3d/physics.js',
    './src/3d/input.js',
    './src/3d/debug/freeCamera.js',
    './src/3d/debug/perfPanel.js',
    './src/3d/ui/touchJoystick.js',
    './src/3d/ui/interactionPrompt.js',
    './src/3d/ui/dialogueBox.js',
    './src/3d/ui/worldEventToast.js',
    './src/3d/ui/healthBar.js',
    './src/3d/ui/controlsHelp.js',
    './src/3d/ui/settlementCompass.js',
    './src/3d/ui/settlementDiscovery.js',
    './src/3d/ui/dayNightClock.js',
    './src/3d/gameplay/health.js',
    './src/3d/gameplay/gameplayConfig.js',
    './src/3d/gameplay/playerConfig.js',
    './src/3d/gameplay/npcConfig.js',
    './src/3d/gameplay/animalConfig.js',
    './src/3d/gameplay/dragonConfig.js',
    './src/3d/gameplay/interactionConfig.js',
    './src/3d/gameplay/interactionEconomy.js',
    './src/3d/gameplay/interactionFieldReadiness.js',
    './src/3d/gameplay/creatureSpeciesConfig.js',
    './src/3d/gameplay/dialogueChoices.js',
    './src/3d/gameplay/player.js',
    './src/3d/gameplay/npc.js',
    './src/3d/gameplay/animals.js',
    './src/3d/gameplay/dragons.js',
    './src/3d/gameplay/dragonController.js',
    './src/3d/gameplay/dragonFlightMath.js',
    './src/3d/gameplay/dragonReactionState.js',
    './src/3d/gameplay/dragonSpawns.js',
    './src/3d/gameplay/creatureBodyPlans.js',
    './src/3d/gameplay/creatureRig.js',
    './src/3d/gameplay/creatureGait.js',
    './src/3d/gameplay/interaction.js',
    './src/3d/gameplay/worldEvents.js',
    './src/3d/world/terrain.js',
    './src/3d/world/terrainBiomeShading.js',
    './src/3d/world/terrainChunkSkirt.js',
    './src/3d/world/roadCorridorSmoothing.js',
    './src/3d/world/vegetationForestScatter.js',
    './src/3d/world/worldReferenceForestAffinity.js',
    './src/3d/world/worldReferenceBiomeField.js',
    './src/3d/world/windGrass.js',
    './src/3d/world/worldPropCatalogue.js',
    './src/3d/world/worldPropExclusions.js',
    './src/3d/world/worldReferenceValyria.js',
    './src/3d/world/theWall.js',
    './src/3d/world/nightsWatchCastles.js',
    './src/3d/world/worldReferenceRivers.js',
    './src/3d/world/worldPropScatter.js',
    './src/3d/world/propGeometryGroupCoalescing.js',
    './src/3d/world/villageBuildings.js',
    './src/3d/world/terrainGroundRealism.js',
    './src/3d/world/worldDressing.js',
    './src/3d/world/terrainValleyCarving.js',
    './src/3d/world/worldReferenceRoadRoutes.js',
    './src/3d/world/worldReferenceRoadNetwork.js',
    './src/3d/worldFoundation.js',
    './src/3d/world/terrainContinentalUplift.js',
    './src/3d/world/terrainMicroSurface.js',
    './src/3d/world/groundSurfaceGrain.js',
    './src/3d/world/vegetationNearDetail.js',
    './src/3d/world/terrainReliefDetail.js',
    './src/3d/world/chunkManager.js',
    './src/3d/world/waterLatitude.js',
    './src/3d/world/water.js',
    './src/3d/world/waterDepthField.js',
    './src/3d/world/riverFlowAppearance.js',
    './src/3d/world/riverMouth.js',
    './src/3d/world/riverRibbonPath.js',
    './src/3d/world/riverEdgeAppearance.js',
    './src/3d/world/skyFacingShadingNormal.js',
    './src/3d/world/roadRiverBridges.js',
    './src/3d/world/rivers.js',
    './src/3d/world/settlements.js',
    './src/3d/world/materials.js',
    './src/3d/world/roadPathfinder.js',
    './src/3d/world/roads.js',
    './src/3d/world/vegetation.js',
    './src/3d/world/mobileVegetationCulling.js',
    './src/3d/world/worldReferenceRockShadow.js',
    './src/3d/world/worldReferenceStoneBridgeShadow.js',
    './src/3d/vendor/three/three.module.js',
    './src/3d/vendor/three/LICENSE',
    './src/3d/vendor/three/addons/loaders/GLTFLoader.js',
    './src/3d/vendor/three/addons/utils/BufferGeometryUtils.js',
    './src/3d/vendor/three/addons/controls/OrbitControls.js',
    './src/3d/vendor/three/addons/loaders/FBXLoader.js',
    './src/3d/vendor/three/addons/libs/fflate.module.js',
    './src/3d/vendor/three/addons/curves/NURBSCurve.js',
    './src/3d/vendor/three/addons/curves/NURBSUtils.js',
    './assets/models/characters/peasant_girl.fbx',
    './assets/animations/peasant_girl/idle.fbx',
    './assets/animations/peasant_girl/walking.fbx',
    './assets/animations/peasant_girl/running.fbx',
    './assets/models/characters/paladin_j_nordstrom.fbx',
    './assets/models/characters/arissa.fbx',
    './assets/models/characters/dreyar.fbx',
    './assets/models/characters/paladin_wprop_j_nordstrom.fbx',
    './assets/models/characters/erika_archer.fbx',
    './assets/models/characters/uriel_a_plotexia.fbx',
    // The wolf is the `.gltf`, not the `.glb` beside it (run 377): the `.glb` is a Git LFS pointer
    // that never resolves, so the wolf loaded as a placeholder box. The `.gltf` is a real committed
    // model, but unlike a `.glb` its buffer and textures are *external* files, so each needs its own
    // entry here or the wolf breaks offline. `Fur_*.png` are deliberately absent: the glTF never
    // references them and its fur-card mesh is stripped at load (see `gameplay/animalConfig.js`).
    './assets/models/animals/wolf/Wolf-Blender-2.82a.gltf',
    './assets/models/animals/wolf/Wolf-Blender-2.82a.bin',
    './assets/models/animals/wolf/Material__wolf_col_tga_diffuse_jpeg.jpg',
    './assets/models/animals/wolf/eyes_diffuse_jpeg.jpg',
    './assets/models/animals/ivory_stallion.glb',
    './assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx',
    './assets/models/creatures/dragon/textures/Ani_Fire_A.png',
    './assets/models/creatures/dragon/textures/Dragon_Bump_Col2.jpg',
    './assets/models/creatures/dragon/textures/Dragon_Nor.jpg',
    './assets/models/creatures/dragon/textures/Dragon_Nor_mirror2.jpg',
    './assets/models/creatures/dragon/textures/Dragon_ground_color.jpg',
    './assets/models/creatures/dragon/textures/Fire_A_2.png',
    './assets/models/creatures/dragon/textures/Floor_C.jpg',
    './assets/models/creatures/dragon/textures/Floor_N.jpg',
    './assets/models/creatures/dragon/textures/Floor_S.jpg',
    './assets/models/settlements/castles/icebound_citadel_decimated.glb',
    './assets/models/settlements/castles/walled_city_fortress_decimated.glb',
    './assets/models/settlements/castles/fortress_of_the_crown_decimated.glb',
    './assets/models/settlements/castles/castle_on_a_rock_decimated.glb',
    './assets/models/settlements/castles/emerald_citadel_decimated.glb',
    './assets/models/settlements/castles/greystone_castle_decimated.glb',
    './assets/models/settlements/castles/brickstone_citadel_decimated.glb',
    './assets/models/settlements/castles/gatehouse_reference_decimated.glb'
    ,
    './src/3d/world/worldReferenceMap.js'
    ,
    './src/3d/world/worldReferenceWaterMask.js'
    ,
    './src/3d/world/worldReferenceAlignment.js'
    ,
    './src/3d/world/worldReferenceHydrology.js'
    ,
    './src/3d/world/worldReferenceExtent.js'
    ,
    './src/3d/world/worldReferenceMigrationPlan.js'
    ,
    './src/3d/world/worldReferenceTerrainAdapter.js'
    ,
    './src/3d/world/worldReferenceChunkShadow.js'
];
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceStoneBridgeMedievalArtV2.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSceneShadowAdapter.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSceneWindowMigrationShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceOptInMigrationControllerShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');

// Run210 owner surface offline cache: additive-only extension for the current RTS terrain detail.
// Image requests are cache-first in MEDIA_CACHE, while the JS module belongs to the shell graph.
GAME3D_SHELL_FILES.push('./src/3d/rts/rtsSurfaceTexture.js');
// Run213 read-only RTS selection readability module.
GAME3D_SHELL_FILES.push('./src/3d/rts/rtsSelectionReadability.js');
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(MEDIA_CACHE)
            .then(cache => cache.add('./assets/textures/yüzey/overlay/overlay.png'))
            .catch(error => console.warn('[SW] Run210 surface media cache skipped:', error))
    );
});

// Run416 ground-grain media cache — the three tiles `world/groundSurfaceGrain.js` and `world/roads.js`
// load. Unlike a JS module these are not part of the shell graph, so they follow the overlay above into
// MEDIA_CACHE. Without them an offline session renders ground and roads as flat untextured colour,
// which is the exact defect this run closed; the shader itself still runs, so it degrades rather than
// breaks, and the `.catch` keeps a missing tile from failing the whole install.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(MEDIA_CACHE)
            .then(cache => cache.addAll([
                './assets/textures/ground/ground_grain_normal.png',
                './assets/textures/ground/ground_grain_albedo.png',
                './assets/textures/roads/road_verge_grass.png',
            ]))
            .catch(error => console.warn('[SW] Run416 ground grain media cache skipped:', error))
    );
});

// Run211 RTS keyboard-command parity: module-only shell entry; no new asset/cache role.
GAME3D_SHELL_FILES.push('./src/3d/rts/rtsCommandShortcuts.js');

// Run215 World Editor formation JSON rehydration module.
GAME3D_SHELL_FILES.push('./src/3d/editor/EditorFormationRehydrator.js');

// Run319 procedural texture/palette library — generated at runtime from these modules, so the offline
// shell needs the code but never any image files.
GAME3D_SHELL_FILES.push('./src/3d/materials/textureCore.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/palettes.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/creaturePatterns.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/terrainPatterns.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/structurePatterns.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/dragonTextures.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/textureMatcher.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/textureFactory.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/meshPartClassifier.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/figureKits.js');
GAME3D_SHELL_FILES.push('./src/3d/materials/layeredMaterial.js');
GAME3D_SHELL_FILES.push('./src/3d/editor/EditorAutoTexture.js');
// Shared Material Studio core used by autonomous/headless world placement.
GAME3D_SHELL_FILES.push('./src/3d/materials/MaterialAssignmentCore.js');
GAME3D_SHELL_FILES.push('./src/3d/world/WorldAssetPlacementPipeline.js');

// Run346: first audio in the game — `audio/audioManager.js` (imported by `game3d.js`) plus the one
// CC0 click sound it plays (see CREDITS.md). `.wav` is neither in IMAGE_EXTENSIONS nor
// VIDEO_EXTENSIONS below, so it already takes the same network-first/shell-cache-fallback fetch
// path every other non-image asset in this file does — it only needs to be precached here, same as
// the `.fbx`/`.glb` model entries above.
GAME3D_SHELL_FILES.push('./src/3d/audio/audioManager.js');
GAME3D_SHELL_FILES.push('./assets/audio/ui-click.wav');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg'];

function isVideoRequest(url) {
    return VIDEO_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));
}

function isImageRequest(url) {
    return IMAGE_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));
}

function isFirebaseRequest(url) {
    return url.hostname.includes('firestore.googleapis.com') ||
           url.hostname.includes('firebaseio.com') ||
           url.hostname.includes('firebase.googleapis.com') ||
           url.hostname.includes('googleapis.com');
}

// ── INSTALL ──
self.addEventListener('install', (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(SHELL_CACHE)
                .then(cache => cache.addAll(SHELL_FILES))
                .catch(() => {}), // offline ilk kurulum: sessizce geç, sonraki ziyaretlerde tamamlanır
            // Ayrı addAll + ayrı catch: 3D shell'in önbelleğe alınması başarısız olsa bile (örn. bir
            // dosya geçici olarak erişilemez), yukarıdaki kritik 2D shell kurulumunu asla engellemez.
            caches.open(SHELL_CACHE)
                .then(cache => cache.addAll(GAME3D_SHELL_FILES))
                .catch(() => {}),
        ])
    );
    self.skipWaiting();
});

// ── MESSAGE (index.html: reg.waiting.postMessage({type:'SKIP_WAITING'})) ──
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ── ACTIVATE ──
self.addEventListener('activate', (event) => {
    const KEEP = [MEDIA_CACHE, SHELL_CACHE];
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => !KEEP.includes(key))
                    .map(key => {
                        return caches.delete(key);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ── FETCH ──
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Firebase: bypass
    if (isFirebaseRequest(url)) return;

    // *** VIDEO: tamamen bypass — iOS Safari Range request için SW'den geçirme ***
    if (isVideoRequest(url)) {
        return; // SW hiçbir şey yapmaz, tarayıcı direkt ağa gider
    }

    // Resimler: cache-first
    if (isImageRequest(url)) {
        event.respondWith(
            caches.open(MEDIA_CACHE).then(cache => {
                return cache.match(event.request).then(cached => {
                    if (cached) {
                        return cached;
                    }
                    return fetch(event.request).then(response => {
                        if (response && response.status === 200) {
                            cache.put(event.request, response.clone()).catch(() => {});
                        }
                        return response;
                    }).catch(() => new Response('', { status: 503 }));
                });
            })
        );
        return;
    }

    // Diğer (app shell dahil): network-first, başarısız olursa shell cache'e düş
    const isSameOrigin = url.origin === self.location.origin;
    event.respondWith(
        fetch(event.request, { cache: 'no-store' }).then(response => {
            if (isSameOrigin && response && response.status === 200 && event.request.method === 'GET') {
                const clone = response.clone();
                caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone)).catch(() => {});
            }
            return response;
        }).catch(() => {
            return caches.match(event.request).then(cached => {
                if (cached) return cached;
                if (event.request.destination === 'document') {
                    return caches.match('./index.html').then(shellDoc => shellDoc || new Response(
                        '<html><body style="background:#06040a;color:#c8960a;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:18px;">İnternet bağlantısı yok</body></html>',
                        { headers: { 'Content-Type': 'text/html' } }
                    ));
                }
            });
        })
    );
});

// ── PUSH ──
self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    event.waitUntil(self.registration.showNotification(
        data.title || 'Westeros',
        { body: data.body || 'Yeni bir olay gerçekleşti', icon: data.icon || 'logo.png', tag: data.tag || 'westeros-notification' }
    ));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            for (const c of list) { if ('focus' in c) return c.focus(); }
            if (clients.openWindow) return clients.openWindow('./');
        })
    );
});