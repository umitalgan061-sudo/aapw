// Şafak Kartalı NPC runtime offline shell extension.
// Guard perception and geographic placement are shipped runtime modules; cache them so
// offline PWA sessions can boot the same NPC vertical slice as online sessions.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/npc.js');
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/npcWorldPlacement.js');
});

// Günbatımı Ustası regional village architecture offline shell extension.
// Seven canonical settlement GLBs are now live runtime references from villages.js, so every
// existing PWA install must precache them rather than silently depending on network availability.
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./assets/models/settlements/log_cabin_et0OmFeZVkb.glb');
    GAME3D_SHELL_FILES.push('./assets/models/settlements/fantasy_house_dcPho4SUA3.glb');
    GAME3D_SHELL_FILES.push('./assets/models/settlements/cabin_shed_HTx7PZt6Zm.glb');
    GAME3D_SHELL_FILES.push('./assets/models/settlements/house_fdaqERLQCc.glb');
    GAME3D_SHELL_FILES.push('./assets/models/settlements/medium_house_4hI5fNvl6z.glb');
    GAME3D_SHELL_FILES.push('./assets/models/settlements/small_wooden_house.glb');
    GAME3D_SHELL_FILES.push('./assets/models/settlements/house_roqiHdrpgc.glb');
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