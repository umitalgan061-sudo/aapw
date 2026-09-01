#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'castle-material-fidelity');

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('[checkCastleAuthoredPbrBrowser] FAIL: Playwright is required.');
    process.exit(2);
  }
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error.message)));
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { AssetLoader } = await import('/src/3d/assetLoader.js');
      const { gameEvents } = await import('/src/3d/eventBus.js');
      const {
        CASTLE_MODEL_ASSIGNMENTS,
        KINGDOM_SEATS,
        mapToWorldXZ,
        spawnRealCastleModels,
      } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE } = await import('/src/3d/config.js');

      const loader = new AssetLoader(gameEvents);
      const seats = KINGDOM_SEATS.map((seat) => {
        const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
        return { id: seat.id, name: seat.name, x, z, groundY: 0 };
      });
      const group = await spawnRealCastleModels({ assetLoader: loader, seats, seed: 1337 });
      const failures = [];
      const pivots = new Map(group.children.map((pivot) => [pivot.userData.kingdomSeatId, pivot]));
      const assignmentBySeat = new Map(CASTLE_MODEL_ASSIGNMENTS.map((assignment) => [assignment.seatId, assignment]));

      if (group.children.length !== KINGDOM_SEATS.length) failures.push(`placed ${group.children.length}/${KINGDOM_SEATS.length} castle pivots`);
      const gatehousePivot = pivots.get('twin');
      if (!gatehousePivot) failures.push('Twin Lannister gatehouse pivot missing');

      let authoredMeshes = 0;
      let fallbackMeshes = 0;
      let authoredWithAlbedo = 0;
      let authoredWithNormal = 0;
      let authoredWithRoughness = 0;
      let invalidTextureImage = 0;
      const regionalProfiles = new Set();
      for (const pivot of group.children) {
        regionalProfiles.add(pivot.userData.castleSurfaceProfile);
        const summary = pivot.userData.castleMaterialFidelity;
        if (!summary?.policyId) failures.push(`${pivot.userData.kingdomSeatId}: missing castle material fidelity summary`);
        pivot.traverse((node) => {
          if (!node.isMesh) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) {
            const fidelity = material?.userData?.castleMaterialFidelity;
            if (fidelity?.source === 'authored-pbr') {
              authoredMeshes += 1;
              if (material.map?.isTexture) authoredWithAlbedo += 1;
              if (material.normalMap?.isTexture) authoredWithNormal += 1;
              if (material.roughnessMap?.isTexture) authoredWithRoughness += 1;
              for (const slot of fidelity.preservedMapSlots ?? []) {
                const texture = material[slot];
                if (!texture?.isTexture || !texture.image) invalidTextureImage += 1;
              }
            } else if (fidelity?.source === 'generated-stone-fallback') {
              fallbackMeshes += 1;
              if (!material.map?.isTexture || !material.normalMap?.isTexture) failures.push(`${pivot.userData.kingdomSeatId}: generated fallback lost stone PBR maps`);
            } else {
              failures.push(`${pivot.userData.kingdomSeatId}: unclassified castle material`);
            }
          }
        });
      }

      let gatehouseAuthored = 0;
      gatehousePivot?.traverse((node) => {
        if (!node.isMesh) return;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (material?.userData?.castleMaterialFidelity?.source === 'authored-pbr') gatehouseAuthored += 1;
        }
      });
      if (gatehouseAuthored < 1) failures.push('gatehouse_reference_decimated.glb did not retain any authored-PBR material');
      if (authoredMeshes < 1) failures.push('no authored-PBR castle material survived runtime adoption');
      if (fallbackMeshes < 1) failures.push('no geometry-only castle exercised the generated-stone fallback');
      if (invalidTextureImage > 0) failures.push(`${invalidTextureImage} preserved authored texture slot(s) have no decoded image`);
      if (regionalProfiles.size < 5) failures.push(`only ${regionalProfiles.size} regional castle surface profiles are represented`);

      // The three Tyrell seats deliberately reuse one Emerald Citadel file. They must share geometry
      // and immutable texture resources but not mutable material instances, otherwise regional/seat
      // weathering can leak from one castle into another.
      const tyrellPivots = ['ziya', 'berk', 'olena'].map((id) => pivots.get(id));
      const firstMesh = (pivot) => {
        let found = null;
        pivot?.traverse((node) => { if (!found && node.isMesh) found = node; });
        return found;
      };
      const tyrellMeshes = tyrellPivots.map(firstMesh);
      if (tyrellMeshes.some((mesh) => !mesh)) failures.push('one or more reused Emerald Citadel meshes are missing');
      else {
        if (!(tyrellMeshes[0].geometry === tyrellMeshes[1].geometry && tyrellMeshes[1].geometry === tyrellMeshes[2].geometry)) failures.push('reused Emerald Citadel geometry is no longer shared');
        if (tyrellMeshes[0].material === tyrellMeshes[1].material || tyrellMeshes[1].material === tyrellMeshes[2].material) failures.push('reused Emerald Citadel seats share mutable material instances');
      }

      const assignmentProfiles = new Set([...assignmentBySeat.values()].map((assignment) => assignment.surfaceProfile));
      if (assignmentProfiles.size !== regionalProfiles.size) failures.push('placed regional profile set differs from authored assignment profile set');

      // Render the gatehouse itself so CI evidence proves the preserved authored map makes it through
      // the actual WebGL material path, not just object inspection.
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9db5c6);
      scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x525748, 1.8));
      const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
      sun.position.set(35, 55, 25);
      scene.add(sun);
      const renderCastle = gatehousePivot?.clone(true);
      if (renderCastle) {
        renderCastle.position.set(0, 0, 0);
        scene.add(renderCastle);
      }
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1280, 800, false);
      const camera = new THREE.PerspectiveCamera(40, 1280 / 800, 0.5, 1000);
      const bounds = renderCastle ? new THREE.Box3().setFromObject(renderCastle) : new THREE.Box3();
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const reach = Math.max(size.x || 40, size.z || 40);
      camera.position.set(reach * 1.15, Math.max(18, size.y * 0.55), reach * 1.2);
      camera.lookAt(0, Math.max(5, size.y * 0.35), 0);
      renderer.render(scene, camera);
      const screenshot = renderer.domElement.toDataURL('image/png');

      const gl = renderer.getContext();
      const pixels = new Uint8Array(1280 * 800 * 4);
      gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const lumas = [];
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const skyLike = b > r + 15 && b > 110;
        if (!skyLike && Math.max(r, g, b) > 18) lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
      const minLuma = lumas.length ? Math.min(...lumas) : 0;
      const maxLuma = lumas.length ? Math.max(...lumas) : 0;
      if (lumas.length < 500 || maxLuma - minLuma < 18) failures.push(`gatehouse WebGL surface variation too weak (${lumas.length} pixels, Δ${(maxLuma - minLuma).toFixed(1)})`);
      renderer.dispose();

      return {
        failures,
        authoredMeshes,
        fallbackMeshes,
        authoredWithAlbedo,
        authoredWithNormal,
        authoredWithRoughness,
        gatehouseAuthored,
        regionalProfiles: [...regionalProfiles].sort(),
        screenshot,
      };
    });

    if (result.screenshot) {
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'gatehouse-authored-pbr.png'), Buffer.from(result.screenshot.split(',')[1], 'base64'));
    }
    if (pageErrors.length) result.failures.push(`page errors: ${pageErrors.join(' | ')}`);
    if (result.failures.length) throw new Error(result.failures.join('\n'));
    console.log('[checkCastleAuthoredPbrBrowser] PASS', JSON.stringify({
      authoredMeshes: result.authoredMeshes,
      fallbackMeshes: result.fallbackMeshes,
      authoredWithAlbedo: result.authoredWithAlbedo,
      authoredWithNormal: result.authoredWithNormal,
      authoredWithRoughness: result.authoredWithRoughness,
      gatehouseAuthored: result.gatehouseAuthored,
      regionalProfiles: result.regionalProfiles,
    }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkCastleAuthoredPbrBrowser] FAIL: ${error.message}\n${error.stack ?? ''}`);
  process.exit(1);
});
