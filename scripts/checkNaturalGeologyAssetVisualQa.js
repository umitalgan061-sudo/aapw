#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkNaturalGeologyAssetVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/natural-geology-asset-visual-qa';
const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
await mkdir(ARTIFACT_DIR, { recursive: true });

const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });

try {
  await page.goto(`${server.baseUrl}/natural-geology-asset-visual-qa.html`, { waitUntil: 'networkidle' });
  const initial = await page.evaluate(async ({ viewport }) => {
    const THREE = await import('three');
    const { WORLD_DEFAULTS, WORLD_SCALE } = await import('./src/3d/config.js');
    const { createHeightSampler } = await import('./src/3d/world/terrain.js');
    const { resolveTerrainBiomeColor, slopeDegreesFromNeighbours } = await import('./src/3d/world/terrainBiomeShading.js');
    const {
      NATURAL_GEOLOGY_RENDER_POLICY,
      createNaturalGeology,
      upgradeNaturalGeologyAssets,
    } = await import('./src/3d/world/naturalGeology.js');
    const { NATURAL_GEOLOGY_PLACEMENT_POLICY } = await import('./src/3d/world/naturalGeologyPlacement.js');

    const root = document.getElementById('qa-root');
    const label = document.getElementById('qa-label');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    root.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xadb8bd);
    scene.fog = new THREE.Fog(0xadb8bd, 140, 520);
    scene.add(new THREE.HemisphereLight(0xdde8ea, 0x4b4a43, 1.45));
    const sun = new THREE.DirectionalLight(0xffedcf, 2.7);
    sun.position.set(180, 300, 220);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 10, far: 700 });
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(39, viewport.width / viewport.height, 0.1, 900);

    const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, null, []);
    const geology = createNaturalGeology({
      sampleHeightMeters: sampleHeight,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      seed: WORLD_DEFAULTS.WORLD_SEED,
      seats: [],
      roadEdges: [],
      worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
      worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
      isMobileClass: false,
    });
    scene.add(geology.group);
    const upgrade = await upgradeNaturalGeologyAssets(geology.group, { isMobileClass: false });
    if (upgrade.status !== 'active' || upgrade.activeFamilyCount < 2) {
      throw new Error(`both hydrated geology families must activate: ${JSON.stringify(upgrade)}`);
    }

    const rocky = geology.placements.find((p) => p.assetFamily === 'rocky-terrain' && !p.volcanic && (p.dryBiomeAffinity ?? 0) < NATURAL_GEOLOGY_PLACEMENT_POLICY.desertRockMinBiomeInfluence)
      ?? geology.placements.find((p) => p.assetFamily === 'rocky-terrain');
    const desert = geology.placements.find((p) => p.assetFamily === 'desert-rocks');
    if (!rocky || !desert) throw new Error(`expected both rocky/desert asset placements; stats=${JSON.stringify(geology.stats.assetFamilies)}`);
    if ((desert.dryBiomeAffinity ?? 0) < NATURAL_GEOLOGY_PLACEMENT_POLICY.desertRockMinBiomeInfluence) {
      throw new Error(`desert asset escaped canonical dry biome: ${JSON.stringify(desert)}`);
    }

    let terrain = null;
    function rebuildTerrain(focal) {
      terrain?.geometry.dispose();
      terrain?.material.dispose();
      terrain?.parent?.remove(terrain);
      const focalReach = Math.max(focal.scale.x, focal.scale.y, focal.scale.z, 8);
      const width = Math.max(140, Math.min(280, focalReach * 9));
      const depth = Math.max(125, Math.min(250, focalReach * 8));
      const sx = 68, sz = 60;
      const geometry = new THREE.PlaneGeometry(width, depth, sx, sz);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.getAttribute('position');
      const colors = new Float32Array(positions.count * 3);
      const color = new THREE.Color();
      const probe = Math.min(width / sx, depth / sz);
      for (let i = 0; i < positions.count; i += 1) {
        const lx = positions.getX(i), lz = positions.getZ(i);
        const wx = focal.x + lx, wz = focal.z + lz;
        const surface = {};
        const y = sampleHeight(wx, wz, undefined, surface);
        positions.setY(i, y - focal.y);
        const west = sampleHeight(wx - probe, wz), east = sampleHeight(wx + probe, wz);
        const north = sampleHeight(wx, wz - probe), south = sampleHeight(wx, wz + probe);
        resolveTerrainBiomeColor(color, {
          heightAboveSeaMeters: y - WORLD_DEFAULTS.WATER_LEVEL_METERS,
          slopeDegrees: slopeDegreesFromNeighbours(west, east, north, south, probe),
          rockWeight: surface.rockWeight ?? 0,
          snowWeight: surface.snowWeight ?? 0,
          worldX: wx,
          worldZ: wz,
        });
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
      terrain.receiveShadow = true;
      scene.add(terrain);
      return { width, depth, focalReach };
    }

    function visibleHydrated(family) {
      let visibleCount = 0;
      geology.group.children.forEach((child) => {
        const active = child.name.startsWith(`natural-geology-hydrated-${family}-`);
        child.visible = active;
        if (active) visibleCount += 1;
      });
      return visibleCount;
    }

    function renderFamily(family) {
      const focal = family === 'desert-rocks' ? desert : rocky;
      geology.group.position.set(-focal.x, -focal.y, -focal.z);
      const framing = rebuildTerrain(focal);
      const primitives = visibleHydrated(family);
      if (primitives < 1) throw new Error(`hydrated ${family} primitives unavailable`);
      const isDesert = family === 'desert-rocks';
      scene.background.set(isDesert ? 0xc5b69d : 0xadb8bd);
      scene.fog.color.copy(scene.background);
      scene.fog.near = framing.focalReach * 7;
      scene.fog.far = framing.focalReach * 22;
      const reach = framing.focalReach;
      camera.position.set(reach * 2.65, reach * 1.45 + 6, reach * 3.05);
      camera.lookAt(0, Math.max(2.5, focal.scale.y * 0.16), 0);
      label.textContent = [
        `NATURAL GEOLOGY · ${family} · MATERIAL-SCALE QA`,
        `zone=${focal.dryBiomeZoneId ?? 'non-dry'} · affinity=${(focal.dryBiomeAffinity ?? 0).toFixed(3)}`,
        `placement=${focal.id} · slope=${focal.slopeDegrees.toFixed(1)}° · scale=${focal.scale.x.toFixed(1)}×${focal.scale.y.toFixed(1)}×${focal.scale.z.toFixed(1)}m`,
        `surface=${geology.group.children.find((c) => c.name.startsWith(`natural-geology-hydrated-${family}-`))?.material?.userData?.naturalGeologyAssetSurface?.policyId ?? 'missing'}`,
      ].join('\n');
      renderer.render(scene, camera);
      return {
        family,
        focal: {
          id: focal.id, x: focal.x, y: focal.y, z: focal.z,
          slopeDegrees: focal.slopeDegrees,
          scale: { ...focal.scale },
          dryBiomeAffinity: focal.dryBiomeAffinity ?? 0,
          dryBiomeZoneId: focal.dryBiomeZoneId ?? null,
        },
        framing,
        primitives,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    }

    window.__renderGeologyFamily = renderFamily;
    const rockyMetrics = renderFamily('rocky-terrain');
    return {
      renderPolicy: NATURAL_GEOLOGY_RENDER_POLICY.id,
      placementPolicy: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
      upgrade,
      stats: geology.stats,
      rockyMetrics,
    };
  }, { viewport: VIEWPORT });

  await page.screenshot({ path: `${ARTIFACT_DIR}/rocky-region.png`, fullPage: false });
  const desertMetrics = await page.evaluate(() => window.__renderGeologyFamily('desert-rocks'));
  await page.screenshot({ path: `${ARTIFACT_DIR}/desert-region.png`, fullPage: false });

  assert.equal(browserErrors.length, 0, `browser errors: ${browserErrors.join(' | ')}`);
  assert(initial.upgrade.activeFamilyCount >= 2, 'both geology asset families must hydrate');
  assert(desertMetrics.focal.dryBiomeAffinity >= 0.12, 'desert asset must remain inside canonical dry-biome influence');
  const report = { ...initial, desertMetrics, browserErrors };
  await writeFile(`${ARTIFACT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log('[checkNaturalGeologyAssetVisualQa] PASS', JSON.stringify({
    placementPolicy: report.placementPolicy,
    activeFamilies: report.upgrade.activeFamilyCount,
    rocky: report.rockyMetrics.focal,
    desert: report.desertMetrics.focal,
  }));
} finally {
  await browser.close();
  await server.close();
}
