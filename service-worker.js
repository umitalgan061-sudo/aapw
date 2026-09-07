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

self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/ui/pauseMenu.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/cartBrain.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/livingWorldSpawner.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/villages.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/creatureBrain.js');
    GAME3D_SHELL_FILES.push('./src/3d/gameplay/creatureSpawner.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBake.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBakeHeights.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBakeRock.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/g07Terrain3dBakeColor.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex10Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex09Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex08Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex07Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex06Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex05Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex04Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex03Detail.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex02Detail.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferencePindex01Detail.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSurfacePindexes.js');
    GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSurfaceTerrainVisual.js');
});
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./src/3d/auroraRealism.js');
    GAME3D_SHELL_FILES.push('./src/3d/nightVisualEnhancement.js');
    GAME3D_SHELL_FILES.push('./src/3d/auroraRayCurtainV4.js');
    GAME3D_SHELL_FILES.push('./src/3d/auroraNightAtmosphereV5.js');
});
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
self.addEventListener('install', () => {
    GAME3D_SHELL_FILES.push('./rts.html');
    GAME3D_SHELL_FILES.push('./rts.css');
    GAME3D_SHELL_FILES.push('./src/3d/rts/rtsArmy.js');
    GAME3D_SHELL_FILES.push('./src/3d/rts/rtsGame.js');
});

const SW_VERSION = 'westeros-media-v4';
const MEDIA_CACHE = 'westeros-media-v4';
const SHELL_CACHE = 'westeros-shell-v21';
const SHELL_FILES = ['./','./index.html','./style.css','./ios-pwa-fix.css','./script.js','./manifest.json','./logo.png'];
const GAME3D_SHELL_FILES = [
    './src/3d/editor/EditorFallbackMaterialPalette.js','./game3d.html','./game3d.css','./src/3d/game3d.js','./src/3d/gameLoopHelpers.js','./src/3d/safeMode.js','./src/3d/eventBus.js','./src/3d/state.js','./src/3d/assetLoader.js','./src/3d/config.js','./src/3d/sceneManager.js','./src/3d/camera.js','./src/3d/sky.js','./src/3d/stars.js','./src/3d/lighting.js','./src/3d/fog.js','./src/3d/physics.js','./src/3d/input.js','./src/3d/debug/freeCamera.js','./src/3d/debug/perfPanel.js','./src/3d/ui/touchJoystick.js','./src/3d/ui/interactionPrompt.js','./src/3d/ui/dialogueBox.js','./src/3d/ui/worldEventToast.js','./src/3d/ui/healthBar.js','./src/3d/ui/controlsHelp.js','./src/3d/ui/settlementCompass.js','./src/3d/ui/settlementDiscovery.js','./src/3d/ui/dayNightClock.js','./src/3d/gameplay/health.js','./src/3d/gameplay/gameplayConfig.js','./src/3d/gameplay/playerConfig.js','./src/3d/gameplay/npcConfig.js','./src/3d/gameplay/animalConfig.js','./src/3d/gameplay/dragonConfig.js','./src/3d/gameplay/interactionConfig.js','./src/3d/gameplay/interactionEconomy.js','./src/3d/gameplay/interactionFieldReadiness.js','./src/3d/gameplay/creatureSpeciesConfig.js','./src/3d/gameplay/dialogueChoices.js','./src/3d/gameplay/player.js','./src/3d/gameplay/npc.js','./src/3d/gameplay/animals.js','./src/3d/gameplay/dragons.js','./src/3d/gameplay/dragonController.js','./src/3d/gameplay/dragonFlightMath.js','./src/3d/gameplay/dragonReactionState.js','./src/3d/gameplay/dragonSpawns.js','./src/3d/gameplay/creatureBodyPlans.js','./src/3d/gameplay/creatureRig.js','./src/3d/gameplay/creatureGait.js','./src/3d/gameplay/interaction.js','./src/3d/gameplay/worldEvents.js','./src/3d/world/terrain.js','./src/3d/world/terrainBiomeShading.js','./src/3d/world/terrainContinentalUplift.js','./src/3d/world/terrainMicroSurface.js','./src/3d/world/terrainReliefDetail.js','./src/3d/world/chunkManager.js','./src/3d/world/water.js','./src/3d/world/waterDepthField.js','./src/3d/world/rivers.js','./src/3d/world/settlements.js','./src/3d/world/materials.js','./src/3d/world/roadPathfinder.js','./src/3d/world/roads.js','./src/3d/world/vegetation.js','./src/3d/world/mobileVegetationCulling.js','./src/3d/world/worldReferenceRockShadow.js','./src/3d/world/worldReferenceStoneBridgeShadow.js','./src/3d/vendor/three/three.module.js','./src/3d/vendor/three/LICENSE','./src/3d/vendor/three/addons/loaders/GLTFLoader.js','./src/3d/vendor/three/addons/utils/BufferGeometryUtils.js','./src/3d/vendor/three/addons/controls/OrbitControls.js','./src/3d/vendor/three/addons/loaders/FBXLoader.js','./src/3d/vendor/three/addons/libs/fflate.module.js','./src/3d/vendor/three/addons/curves/NURBSCurve.js','./src/3d/vendor/three/addons/curves/NURBSUtils.js','./assets/models/characters/peasant_girl.fbx','./assets/animations/peasant_girl/idle.fbx','./assets/animations/peasant_girl/walking.fbx','./assets/animations/peasant_girl/running.fbx','./assets/models/characters/paladin_j_nordstrom.fbx','./assets/models/characters/arissa.fbx','./assets/models/characters/dreyar.fbx','./assets/models/characters/paladin_wprop_j_nordstrom.fbx','./assets/models/characters/erika_archer.fbx','./assets/models/characters/uriel_a_plotexia.fbx','./assets/models/animals/wolf/Wolf-Blender-2.82a.glb','./assets/models/animals/ivory_stallion.glb','./assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx','./src/3d/materials/MaterialAssignmentCore.js','./src/3d/world/WorldAssetPlacementPipeline.js'
];
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
GAME3D_SHELL_FILES.push('./src/3d/audio/audioManager.js');
GAME3D_SHELL_FILES.push('./assets/audio/ui-click.wav');

const IMAGE_EXTENSIONS = ['.png','.jpg','.jpeg','.gif','.webp','.svg'];
const VIDEO_EXTENSIONS = ['.mp4','.webm','.ogg'];
const isVideoRequest = url => VIDEO_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));
const isImageRequest = url => IMAGE_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));
const isFirebaseRequest = url => url.hostname.includes('firestore.googleapis.com') || url.hostname.includes('firebaseio.com') || url.hostname.includes('firebase.googleapis.com') || url.hostname.includes('googleapis.com');
self.addEventListener('install', event => { event.waitUntil(Promise.all([caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)).catch(() => {}), caches.open(SHELL_CACHE).then(cache => cache.addAll(GAME3D_SHELL_FILES)).catch(() => {})])); self.skipWaiting(); });
self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', event => { const KEEP = [MEDIA_CACHE,SHELL_CACHE]; event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => !KEEP.includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => { const url = new URL(event.request.url); if (isFirebaseRequest(url)) return; if (isVideoRequest(url)) return; if (isImageRequest(url)) { event.respondWith(caches.open(MEDIA_CACHE).then(cache => cache.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response && response.status === 200) cache.put(event.request,response.clone()).catch(() => {}); return response; }).catch(() => new Response('',{status:503})))); return; } event.respondWith(fetch(event.request,{cache:'no-store'}).then(response => { if (url.origin === self.location.origin && response && response.status === 200 && event.request.method === 'GET') caches.open(SHELL_CACHE).then(cache => cache.put(event.request,response.clone())).catch(() => {}); return response; }).catch(() => caches.match(event.request).then(cached => cached || (event.request.destination === 'document' ? caches.match('./index.html').then(shellDoc => shellDoc || new Response('İnternet bağlantısı yok',{headers:{'Content-Type':'text/html'}})) : undefined)))); });
self.addEventListener('push', event => { const data = event.data?.json() ?? {}; event.waitUntil(self.registration.showNotification(data.title || 'Westeros',{body:data.body || 'Yeni bir olay gerçekleşti',icon:data.icon || 'logo.png',tag:data.tag || 'westeros-notification'})); });
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(clients.matchAll({type:'window'}).then(list => { for (const c of list) if ('focus' in c) return c.focus(); if (clients.openWindow) return clients.openWindow('./'); })); });