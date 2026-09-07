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
// finally drive, which shipped inert), so an offline install would fetch `dragons.js` from cache
// and then fail on its three uncached `export ... from` targets. Same
// reasoning as the run 71/ADR-0092 `dragons.js` split above: `SHELL_CACHE` bumped v3->v4 so an existing install
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
const SHELL_CACHE = 'westeros-shell-v21';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css',
    './ios-pwa-fix.css',
    './script.js',
    './manifest.json',
    './logo.png'
];

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
    './src/3d/world/terrainContinentalUplift.js',
    './src/3d/world/terrainMicroSurface.js',
    './src/3d/world/terrainReliefDetail.js',
    './src/3d/world/chunkManager.js',
    './src/3d/world/water.js',
    './src/3d/world/waterDepthField.js',
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
    './assets/models/animals/wolf/Wolf-Blender-2.82a.glb',
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
    './assets/models/settlements/castles/gatehouse_reference_decimated.glb',
    './src/3d/world/worldReferenceMap.js',
    './src/3d/world/worldReferenceWaterMask.js',
    './src/3d/world/worldReferenceAlignment.js',
    './src/3d/world/worldReferenceHydrology.js',
    './src/3d/world/worldReferenceExtent.js',
    './src/3d/world/worldReferenceMigrationPlan.js',
    './src/3d/world/worldReferenceTerrainAdapter.js',
    './src/3d/world/worldReferenceChunkShadow.js'
];
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceStoneBridgeMedievalArtV2.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSceneShadowAdapter.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSceneWindowMigrationShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceOptInMigrationControllerShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
GAME3D_SHELL_FILES.push('./src/3d/gameplay/npc.js');
GAME3D_SHELL_FILES.push('./src/3d/gameplay/npcWorldPlacement.js');

// Run213 read-only RTS selection readability module.
GAME3D_SHELL_FILES.push('./src/3d/rts/rtsSelectionReadability.js');
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(MEDIA_CACHE)
            .then(cache => cache.add('./assets/textures/yüzey/overlay/overlay.png'))
            .catch(error => console.warn('[SW] Run210 surface media cache skipped:', error))
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
                .catch(() => {}),
            caches.open(SHELL_CACHE)
                .then(cache => cache.addAll(GAME3D_SHELL_FILES))
                .catch(() => {}),
        ])
    );
    self.skipWaiting();
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

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

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (isFirebaseRequest(url)) return;

    if (isVideoRequest(url)) {
        return;
    }

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