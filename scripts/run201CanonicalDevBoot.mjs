/** Run201 opt-in developer-only canonical startup surface. Default game3d.html does not import this file. */
import { createScene } from '../src/3d/sceneManager.js';
import { buildClippedBridgeOwnershipTargets } from '../src/3d/world/worldReferenceClippedWindowOwnershipShadow.js';
import { createRun200StartupSelector } from './run200CanonicalStartupSelectorShadow.mjs';

const CACHE_NAME = 'westeros-shell-v11';
const DEV_FILES = ['./canonical-dev.html?worldSource=canonical-dev','./scripts/run201CanonicalDevBoot.mjs','./scripts/run200CanonicalStartupSelectorShadow.mjs'];
const status = document.getElementById('run201-status');
const canvas = document.getElementById('run201-canvas');
const state = createScene(canvas);
state.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
state.renderer.setSize(innerWidth, innerHeight, false);
const target = buildClippedBridgeOwnershipTargets().slice().sort((a,b)=>a.bridgeId.localeCompare(b.bridgeId))[0];
const selector = createRun200StartupSelector({ state, search: location.search, bridgeId: target.bridgeId, profile: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop' });
state.renderer.render(state.scene, state.camera);

document.body.dataset.run201ActiveSource = selector.getActiveSource();
document.body.dataset.run201RequestedSource = selector.requestedSource;
document.body.dataset.run201Offline = navigator.onLine ? 'false' : 'true';
document.body.dataset.run201BridgeId = target.bridgeId;
status.textContent = `Run201 dev-only | requested=${selector.requestedSource} | active=${selector.getActiveSource()} | offline=${!navigator.onLine} | bridge=${target.bridgeId}`;

async function warmOfflineSurface() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return;
  await navigator.serviceWorker.register('./service-worker.js');
  await navigator.serviceWorker.ready;
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(DEV_FILES);
  document.body.dataset.run201CacheReady = 'true';
}

warmOfflineSurface().catch((error) => {
  document.body.dataset.run201CacheReady = 'false';
  console.error('[run201CanonicalDevBoot] cache warm failed', error);
});

addEventListener('resize', () => {
  state.renderer.setSize(innerWidth, innerHeight, false);
  state.camera.aspect = innerWidth / innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.render(state.scene, state.camera);
});

addEventListener('pagehide', () => {
  try { selector.rollbackToCurrent(); } catch {}
  selector.dispose();
  state.controls.dispose();
  state.freeCamera.dispose();
  state.chunkManager.disposeAll();
  state.renderer.dispose();
}, { once: true });

// Run276 canonical owner-map semantic terrain surface activation.
import { applyReferenceSurfaceToTerrainGroup } from '../src/3d/world/worldReferenceSurfaceTerrainVisual.js';
if (selector.getActiveSource() === 'canonical' && selector.activation?.windowState?.terrainGroup) {
  const run276Surface = applyReferenceSurfaceToTerrainGroup(selector.activation.windowState.terrainGroup);
  document.body.dataset.run273SurfaceReady = 'true';
  document.body.dataset.run273SurfaceSourceSha = run276Surface.sourceMapSha256;
  document.body.dataset.run273SurfaceCounts = JSON.stringify(run276Surface.counts);
  document.body.dataset.run273SurfacePindexes = JSON.stringify(run276Surface.pindexVertexCounts);
  document.body.dataset.run273SurfaceMeshCount = String(run276Surface.meshCount);
  document.body.dataset.run273SurfaceVertexCount = String(run276Surface.vertexCount);
  status.textContent += ' | map-surface=' + run276Surface.vertexCount + 'v';
  state.renderer.render(state.scene, state.camera);
}

// Run277 deterministic Pindex-01 micro-surface detail activation.
if (selector.getActiveSource() === 'canonical' && selector.activation?.windowState?.terrainGroup) {
  const { applyPindex01DetailToTerrainGroup } = await import('../src/3d/world/worldReferencePindex01Detail.js');
  const run277Detail = applyPindex01DetailToTerrainGroup(selector.activation.windowState.terrainGroup);
  document.body.dataset.run277Pindex01Ready = 'true';
  document.body.dataset.run277Pindex01TouchedVertices = String(run277Detail.touchedVertices);
  status.textContent += ' | pindex01-detail=' + run277Detail.touchedVertices + 'v';
  state.renderer.render(state.scene, state.camera);
}

// Run278 deterministic Pindex-02 micro-surface detail activation.
if (selector.getActiveSource() === 'canonical' && selector.activation?.windowState?.terrainGroup) {
  const { applyPindex02DetailToTerrainGroup } = await import('../src/3d/world/worldReferencePindex02Detail.js');
  const run278Detail = applyPindex02DetailToTerrainGroup(selector.activation.windowState.terrainGroup);
  document.body.dataset.run278Pindex02Ready = 'true';
  document.body.dataset.run278Pindex02TouchedVertices = String(run278Detail.touchedVertices);
  status.textContent += ' | pindex02-detail=' + run278Detail.touchedVertices + 'v';
  state.renderer.render(state.scene, state.camera);
}

// Run281 deterministic Pindex-03 micro-surface detail activation.
if (selector.getActiveSource() === 'canonical' && selector.activation?.windowState?.terrainGroup) {
  const { applyPindex03DetailToTerrainGroup } = await import('../src/3d/world/worldReferencePindex03Detail.js');
  const run281Detail = applyPindex03DetailToTerrainGroup(selector.activation.windowState.terrainGroup);
  document.body.dataset.run281Pindex03Ready = 'true';
  document.body.dataset.run281Pindex03TouchedVertices = String(run281Detail.touchedVertices);
  status.textContent += ' | pindex03-detail=' + run281Detail.touchedVertices + 'v';
  state.renderer.render(state.scene, state.camera);
}

// Run282 deterministic Pindex-04 micro-surface detail activation.
if (selector.getActiveSource() === 'canonical' && selector.activation?.windowState?.terrainGroup) {
  const { applyPindex04DetailToTerrainGroup } = await import('../src/3d/world/worldReferencePindex04Detail.js');
  const run282Detail = applyPindex04DetailToTerrainGroup(selector.activation.windowState.terrainGroup);
  document.body.dataset.run282Pindex04Ready = 'true';
  document.body.dataset.run282Pindex04TouchedVertices = String(run282Detail.touchedVertices);
  status.textContent += ' | pindex04-detail=' + run282Detail.touchedVertices + 'v';
  state.renderer.render(state.scene, state.camera);
}

// Run306 deterministic Pindex-05 micro-surface detail activation.
if (selector.getActiveSource() === 'canonical' && selector.activation?.windowState?.terrainGroup) {
  const { applyPindex05DetailToTerrainGroup } = await import('../src/3d/world/worldReferencePindex05Detail.js');
  const run306Detail = applyPindex05DetailToTerrainGroup(selector.activation.windowState.terrainGroup);
  document.body.dataset.run306Pindex05Ready = 'true';
  document.body.dataset.run306Pindex05TouchedVertices = String(run306Detail.touchedVertices);
  status.textContent += ' | pindex05-detail=' + run306Detail.touchedVertices + 'v';
  state.renderer.render(state.scene, state.camera);
}
