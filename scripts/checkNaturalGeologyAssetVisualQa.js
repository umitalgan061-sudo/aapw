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
    scene.fog = new THREE.Fog(0xadb8bd, 520, 1280);
    scene.add(new THREE.HemisphereLight(0xdde8ea, 0x4b4a43, 1.45));
    const sun = new THREE.DirectionalLight(0xffedcf, 2.7);
    sun.position.set(420, 680, 360);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 40, far: 1400 });
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(42, viewport.width / viewport.height, 0.5, 2200);

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
      const width = 760, depth = 650, sx = 72, sz = 62;
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
      rebuildTerrain(focal);
      const primitives = visibleHydrated(family);
      if (primitives < 1) throw new Error(`hydrated ${family} primitives unavailable`);
      const isDesert = family === 'desert-rocks';
      scene.background.set(isDesert ? 0xc5b69d : 0xadb8bd);
      scene.fog.color.copy(scene.background);
      camera.position.set(245, 130, 300);
      camera.lookAt(0, 18, 0);
      label.textContent = [
        `NATURAL GEOLOGY · ${family}`,
        `zone=${focal.dryBiomeZoneId ?? 'non-dry'} · affinity=${(focal.dryBiomeAffinity ?? 0).toFixed(3)}`,
        `placement=${focal.id} · slope=${focal.slopeDegrees.toFixed(1)}° · primitives=${primitives}`,
        `surface=${geology.group.children.find((c) => c.name.startsWith(`natural-geology-hydrated-${family}-`))?.material?.userData?.naturalGeologyAssetSurface?.policyId ?? 'missing'}`,
      ].join('\n');
      renderer.render(scene, camera);
      return {
        family,
        focal: { id: focal.id, x: focal.x, y: focal.y, z: focal.z, slopeDegrees: focal.slopeDegrees, dryBiomeAffinity: focal.dryBiomeAffinity ?? 0, dryBiomeZoneId: focal.dryBiomeZoneId ?? null },
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
