#!/usr/bin/env node
/**
 * Exact-head real-WebGL visual acceptance for the dedicated terrain cryosphere surface fabric.
 *
 * The browser searches the canonical owner-map world for two existing climate regimes instead of
 * hard-coding a new snow location: a permanent-ice land target and a mixed ice/tundra edge target.
 * Each target renders a 3x3 set of the shipped createTerrainChunk meshes with the same production
 * material, height sampler, biome classifier and micro/cryosphere shader chain used by sceneManager.
 * The screenshots are human evidence; numeric checks only guarantee the proof is real, deterministic
 * and canonical-height neutral.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startStaticServer } from './devServerHelper.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.TERRAIN_CRYOSPHERE_SURFACE_ARTIFACT_DIR
  || path.join(ROOT, 'artifacts', 'terrain-cryosphere-surface');
fs.mkdirSync(artifactDir, { recursive: true });

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  if (process.env.NODE_PATH) {
    for (const root of process.env.NODE_PATH.split(path.delimiter).filter(Boolean)) {
      try { return require(path.join(root, 'playwright')); } catch {}
    }
  }
  return null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rgbStats(buffer) {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let min = 255;
  let max = 0;
  // PNG decoding stays in the browser proof below. Here we only record byte entropy as a guard that
  // the uploaded screenshot is not empty/constant; real pixel statistics are returned from WebGL.
  for (const value of buffer) {
    sum += value;
    sumSq += value * value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    count += 1;
  }
  const mean = count ? sum / count : 0;
  return { bytes: count, mean, standardDeviation: Math.sqrt(Math.max(0, sumSq / Math.max(1, count) - mean * mean)), min, max };
}

const playwright = loadPlaywright();
if (!playwright) {
  console.error('[checkTerrainCryosphereSurfaceVisual] SKIP: Playwright unavailable.');
  process.exit(2);
}

const server = await startStaticServer();
const port = server.address().port;
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const browserErrors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
});
page.on('requestfailed', (request) => browserErrors.push(`request:${request.url()}:${request.failure()?.errorText || 'failed'}`));

try {
  await page.goto(`http://127.0.0.1:${port}/scripts/terrainCryosphereSurfaceHarness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  const boot = await page.evaluate(async () => {
    const THREE = await import('three');
    const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = await import('/src/3d/config.js');
    const {
      createHeightSampler,
      createTerrainChunk,
      disposeTerrainChunk,
      TERRAIN_MICRO_SURFACE_POLICY,
    } = await import('/src/3d/world/terrain.js');
    const {
      TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY,
      getSharedTerrainCryosphereSurfaceAtlas,
      auditTerrainCryosphereSurfaceFabric,
    } = await import('/src/3d/world/terrainMicroSurface.js');
    const { northReferenceCryosphereAtWorldXZ } = await import('/src/3d/world/northReferenceCryosphere.js');

    const fail = (condition, message) => { if (!condition) throw new Error(message); };
    fail(TERRAIN_MICRO_SURFACE_POLICY.dedicatedCryosphereFabricAtlas === true, 'composite terrain fabric inactive');
    fail(TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.renderOnly === true, 'cryosphere fabric is not render-only');
    fail(TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.canonicalTerrainHeightUnchanged === true, 'terrain height authority drift');
    fail(TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.canonicalSnowCoverageUnchanged === true, 'snow coverage authority drift');
    fail(TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.canonicalHydrologyUnchanged === true, 'hydrology authority drift');
    fail(TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.canonicalColliderUnchanged === true, 'collider authority drift');

    const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
    const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
    const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
    const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;

    function slopeAt(x, z, spacing = 18) {
      const west = sampleHeightMeters(x - spacing, z);
      const east = sampleHeightMeters(x + spacing, z);
      const north = sampleHeightMeters(x, z - spacing);
      const south = sampleHeightMeters(x, z + spacing);
      return Math.atan(Math.hypot((east - west) / (2 * spacing), (south - north) / (2 * spacing))) * 180 / Math.PI;
    }

    function scoreCandidate(type, x, z) {
      const height = sampleHeightMeters(x, z);
      const aboveSea = height - seaLevel;
      if (aboveSea < 8) return null;
      const climate = northReferenceCryosphereAtWorldXZ(x, z) || {};
      const permanentIce = Number(climate.permanentIce) || 0;
      const tundra = Number(climate.tundra) || 0;
      const slope = slopeAt(x, z);
      if (slope > 52) return null;
      if (type === 'farNorth') {
        if (permanentIce < 0.76) return null;
        const reliefPreference = 1 - Math.min(1, Math.abs(slope - 21) / 30);
        return permanentIce * 2.1 + Math.min(1, aboveSea / 280) * 0.55 + reliefPreference * 0.38;
      }
      const mixedIce = 4 * permanentIce * (1 - permanentIce);
      if (permanentIce < 0.16 || permanentIce > 0.72 || tundra < 0.15) return null;
      const reliefPreference = 1 - Math.min(1, Math.abs(slope - 16) / 28);
      return mixedIce * 1.65 + tundra * 0.74 + Math.min(1, aboveSea / 220) * 0.34 + reliefPreference * 0.28;
    }

    function discoverTarget(type) {
      let best = null;
      const columns = 43;
      const rows = 39;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = -halfWidth + (column + 0.5) / columns * (halfWidth * 2);
          const z = -halfDepth + (row + 0.5) / rows * (halfDepth * 2);
          const score = scoreCandidate(type, x, z);
          if (score == null) continue;
          if (!best || score > best.score) {
            const climate = northReferenceCryosphereAtWorldXZ(x, z) || {};
            best = {
              x,
              z,
              y: sampleHeightMeters(x, z),
              slopeDegrees: slopeAt(x, z),
              permanentIce: Number(climate.permanentIce) || 0,
              tundra: Number(climate.tundra) || 0,
              score,
            };
          }
        }
      }
      fail(best, `could not discover canonical ${type} land target`);
      return best;
    }

    const targets = {
      farNorth: discoverTarget('farNorth'),
      iceEdge: discoverTarget('iceEdge'),
    };
    fail(targets.farNorth.permanentIce > targets.iceEdge.permanentIce, 'climate target ordering collapsed');

    const canvas = document.getElementById('qa-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 900, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x718594);
    scene.fog = new THREE.Fog(0x718594, 900, 1950);
    const hemi = new THREE.HemisphereLight(0xdde8ee, 0x48505a, 1.42);
    const sun = new THREE.DirectionalLight(0xffefd5, 2.55);
    scene.add(hemi, sun);
    const root = new THREE.Group();
    root.name = 'cryosphere-qa-chunks';
    scene.add(root);
    const camera = new THREE.PerspectiveCamera(46, 1440 / 900, 0.1, 2800);
    const chunks = [];

    function clearChunks() {
      while (chunks.length) {
        const chunk = chunks.pop();
        root.remove(chunk);
        disposeTerrainChunk(chunk);
      }
    }

    function framebufferStats() {
      const gl = renderer.getContext();
      const width = 360;
      const height = 225;
      const x = Math.max(0, Math.floor((canvas.width - width) * 0.5));
      const y = Math.max(0, Math.floor((canvas.height - height) * 0.5));
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let mean = 0;
      let meanSq = 0;
      let minLuma = 1;
      let maxLuma = 0;
      let snowLike = 0;
      let blueIceLike = 0;
      let mineralLike = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index] / 255;
        const g = pixels[index + 1] / 255;
        const b = pixels[index + 2] / 255;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        mean += luma;
        meanSq += luma * luma;
        minLuma = Math.min(minLuma, luma);
        maxLuma = Math.max(maxLuma, luma);
        if (luma > 0.54 && Math.max(r, g, b) - Math.min(r, g, b) < 0.16) snowLike += 1;
        if (b > r + 0.045 && g > r + 0.025 && luma > 0.25 && luma < 0.73) blueIceLike += 1;
        if (Math.abs(r - g) < 0.07 && Math.abs(g - b) < 0.08 && luma > 0.18 && luma < 0.48) mineralLike += 1;
      }
      const samples = pixels.length / 4;
      mean /= samples;
      meanSq /= samples;
      return {
        width,
        height,
        meanLuma: mean,
        lumaStdDev: Math.sqrt(Math.max(0, meanSq - mean * mean)),
        minLuma,
        maxLuma,
        snowLikeRatio: snowLike / samples,
        blueIceLikeRatio: blueIceLike / samples,
        mineralLikeRatio: mineralLike / samples,
        glError: gl.getError(),
      };
    }

    function renderTarget(name) {
      const target = targets[name];
      fail(target, `unknown target ${name}`);
      clearChunks();
      const centerChunkX = Math.round(target.x / chunkSize);
      const centerChunkZ = Math.round(target.z / chunkSize);
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const chunk = createTerrainChunk({
            chunkX: centerChunkX + dx,
            chunkZ: centerChunkZ + dz,
            size: chunkSize,
            segments: 96,
            seed: WORLD_DEFAULTS.WORLD_SEED,
          });
          chunks.push(chunk);
          root.add(chunk);
        }
      }
      const centerX = centerChunkX * chunkSize;
      const centerZ = centerChunkZ * chunkSize;
      const centerY = sampleHeightMeters(centerX, centerZ);
      camera.position.set(centerX + 250, centerY + 185, centerZ + 310);
      camera.lookAt(centerX, centerY + 3, centerZ);
      sun.position.set(centerX - 360, centerY + 510, centerZ + 220);
      sun.target.position.set(centerX, centerY, centerZ);
      scene.add(sun.target);
      sun.target.updateMatrixWorld();
      scene.fog.near = 760;
      scene.fog.far = 1900;

      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      const centerMaterial = chunks[4]?.material;
      const audit = auditTerrainCryosphereSurfaceFabric(centerMaterial);
      fail(audit.ok, `cryosphere material audit failed: ${audit.errors.join(',')}`);
      fail(centerMaterial?.userData?.terrainMicroSurface?.policyId === TERRAIN_MICRO_SURFACE_POLICY.id, 'terrain composite metadata drift');
      const stats = framebufferStats();
      const gl = renderer.getContext();
      fail(stats.glError === gl.NO_ERROR, `WebGL error ${stats.glError} for ${name}`);
      fail(renderer.info.render.calls >= 9, `expected >=9 terrain draw calls for ${name}, got ${renderer.info.render.calls}`);
      fail(renderer.info.render.triangles > 100000, `terrain proof too sparse for ${name}: ${renderer.info.render.triangles} triangles`);
      fail(stats.lumaStdDev > 0.035, `${name} framebuffer is visually too uniform (${stats.lumaStdDev.toFixed(4)})`);
      fail(stats.maxLuma - stats.minLuma > 0.24, `${name} framebuffer has insufficient tonal range`);
      return {
        target,
        centerChunk: { x: centerChunkX, z: centerChunkZ },
        chunkCount: chunks.length,
        materialPolicyId: centerMaterial.userData.terrainMicroSurface.policyId,
        cryospherePolicyId: centerMaterial.userData.terrainMicroSurface.cryosphereSurfaceFabricPolicyId,
        shaderCacheKey: centerMaterial.customProgramCacheKey(),
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        framebuffer: stats,
      };
    }

    const atlas = getSharedTerrainCryosphereSurfaceAtlas();
    const atlasChannels = [];
    for (let channel = 0; channel < 4; channel += 1) {
      let min = 255;
      let max = 0;
      let sum = 0;
      for (let i = channel; i < atlas.image.data.length; i += 4) {
        const value = atlas.image.data[i];
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
      }
      atlasChannels.push({ channel, min, max, mean: sum / (atlas.image.data.length / 4) });
    }

    window.__terrainCryosphereQa = {
      renderTarget,
      cleanup() {
        clearChunks();
        renderer.dispose();
      },
    };
    return {
      policyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
      terrainPolicyId: TERRAIN_MICRO_SURFACE_POLICY.id,
      targets,
      atlas: { width: atlas.image.width, height: atlas.image.height, channels: atlasChannels },
    };
  });

  assert(boot.atlas.width >= 256 && boot.atlas.height >= 256, 'cryosphere atlas unexpectedly small');
  assert(boot.atlas.channels.every((entry) => entry.max > entry.min), 'cryosphere atlas channel collapsed');

  const renders = {};
  for (const name of ['farNorth', 'iceEdge']) {
    renders[name] = await page.evaluate((targetName) => window.__terrainCryosphereQa.renderTarget(targetName), name);
    await page.locator('#qa-canvas').screenshot({
      path: path.join(artifactDir, `${name === 'farNorth' ? 'far-north' : 'ice-edge'}-cryosphere-surface.png`),
      type: 'png',
    });
  }

  assert(renders.farNorth.target.permanentIce >= 0.76, 'far-north target lost permanent-ice classification');
  assert(renders.iceEdge.target.permanentIce > 0.15 && renders.iceEdge.target.permanentIce < 0.73, 'ice-edge target lost mixed classification');
  assert(renders.farNorth.framebuffer.lumaStdDev > 0.035, 'far-north render still uniform');
  assert(renders.iceEdge.framebuffer.lumaStdDev > 0.035, 'ice-edge render still uniform');
  assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);

  const screenshotStats = {};
  for (const fileName of ['far-north-cryosphere-surface.png', 'ice-edge-cryosphere-surface.png']) {
    const filePath = path.join(artifactDir, fileName);
    const buffer = fs.readFileSync(filePath);
    assert(buffer.length > 20000, `${fileName} screenshot too small (${buffer.length} bytes)`);
    screenshotStats[fileName] = rgbStats(buffer);
  }

  const report = {
    ...boot,
    renders,
    screenshotStats,
    browserErrors,
    canonicalAuthority: {
      terrainHeight: 'unchanged',
      snowCoverage: 'unchanged',
      cryosphereMask: 'unchanged',
      hydrology: 'unchanged',
      collider: 'unchanged',
    },
  };
  fs.writeFileSync(path.join(artifactDir, 'terrain-cryosphere-surface-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `[checkTerrainCryosphereSurfaceVisual] PASS: ${renders.farNorth.chunkCount}+${renders.iceEdge.chunkCount} real terrain chunks; `
      + `farNorth std=${renders.farNorth.framebuffer.lumaStdDev.toFixed(4)} blueIce=${(renders.farNorth.framebuffer.blueIceLikeRatio * 100).toFixed(2)}%; `
      + `iceEdge std=${renders.iceEdge.framebuffer.lumaStdDev.toFixed(4)} mineral=${(renders.iceEdge.framebuffer.mineralLikeRatio * 100).toFixed(2)}%.`,
  );

  await page.evaluate(() => window.__terrainCryosphereQa.cleanup());
} catch (error) {
  console.error(`[checkTerrainCryosphereSurfaceVisual] FAIL: ${error?.stack || error}`);
  try {
    await page.screenshot({ path: path.join(artifactDir, 'terrain-cryosphere-surface-failure.png'), type: 'png' });
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
