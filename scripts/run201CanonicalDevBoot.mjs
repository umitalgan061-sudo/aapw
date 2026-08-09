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
