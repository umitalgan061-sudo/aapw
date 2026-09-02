#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import devServerHelper from './devServerHelper.js';

const { startStaticServer } = devServerHelper;
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.WORLD_ASSET_GEOGRAPHIC_ARTIFACT_DIR
  || path.join(ROOT, 'artifacts', 'world-asset-geographic-adaptation');
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

const playwright = loadPlaywright();
if (!playwright) {
  console.error('[checkWorldAssetGeographicVisualQa] SKIP: Playwright unavailable.');
  process.exit(2);
}

const server = await startStaticServer();
const port = server.address().port;
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console:${message.text()}`); });
page.on('requestfailed', (request) => browserErrors.push(`request:${request.url()}:${request.failure()?.errorText || 'failed'}`));

try {
  await page.goto(`http://127.0.0.1:${port}/scripts/worldAssetGeographicHarness.html`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });

  const boot = await page.evaluate(async () => {
    const THREE = await import('three');
    const { WORLD_SCALE } = await import('/src/3d/config.js');
    const {
      WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY,
      evaluateWorldAssetGeographicEligibility,
      resolveWorldAssetGeographicProfile,
    } = await import('/src/3d/world/worldAssetGeographicProfile.js');
    const {
      WORLD_ASSET_SURFACE_WEATHERING_POLICY,
      applyWorldAssetGeographicWeathering,
      auditWorldAssetGeographicWeathering,
    } = await import('/src/3d/world/worldAssetSurfaceWeathering.js');
    const { northReferenceCryosphereAtWorldXZ } = await import('/src/3d/world/northReferenceCryosphere.js');

    const fail = (condition, message) => { if (!condition) throw new Error(message); };
    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
    const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;

    function discover(mode) {
      let best = null;
      for (let row = 0; row < 35; row += 1) {
        for (let column = 0; column < 39; column += 1) {
          const x = -halfWidth + (column + 0.5) / 39 * halfWidth * 2;
          const z = -halfDepth + (row + 0.5) / 35 * halfDepth * 2;
          const climate = northReferenceCryosphereAtWorldXZ(x, z) || {};
          const ice = clamp01(Number(climate.permanentIce) || 0);
          const tundra = clamp01(Number(climate.tundra) || 0);
          const score = mode === 'ice' ? ice * 2 + tundra * 0.25 : (1 - ice) * 1.4 + (1 - tundra) * 0.6;
          if (!best || score > best.score) best = { x, z, ice, tundra, score };
        }
      }
      return best;
    }

    const iceTarget = discover('ice');
    const temperateTarget = discover('temperate');
    fail(iceTarget?.ice > 0.76, 'canonical permanent-ice target not found');

    const profiles = {
      coldRock: resolveWorldAssetGeographicProfile({
        worldX: iceTarget.x,
        worldZ: iceTarget.z,
        surface: { height: 185, slopeDegrees: 34, moisture: 0.30, biome: 'alpine-bare' },
        metadata: { category: 'rock', id: 'visual-cold-rock' },
      }),
      dampWood: resolveWorldAssetGeographicProfile({
        worldX: temperateTarget.x,
        worldZ: temperateTarget.z,
        surface: { height: 9, slopeDegrees: 4, moisture: 0.92, biome: 'riparian', waterType: 'ocean', waterDepth: 0.04 },
        metadata: { category: 'waterside', id: 'visual-damp-wood' },
      }),
      dryRock: resolveWorldAssetGeographicProfile({
        worldX: temperateTarget.x,
        worldZ: temperateTarget.z,
        surface: { height: 155, slopeDegrees: 27, moisture: 0.13, biome: 'dry-upland' },
        metadata: { category: 'rock', id: 'visual-dry-rock' },
      }),
    };
    fail(evaluateWorldAssetGeographicEligibility(profiles.coldRock).ok, 'cold rock unexpectedly rejected');
    fail(evaluateWorldAssetGeographicEligibility(profiles.dampWood).ok, 'damp waterside asset unexpectedly rejected');
    fail(evaluateWorldAssetGeographicEligibility(profiles.dryRock).ok, 'dry rock unexpectedly rejected');

    const canvas = document.getElementById('qa-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 900, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x73818b);
    scene.fog = new THREE.Fog(0x73818b, 45, 115);
    const camera = new THREE.PerspectiveCamera(40, 1440 / 900, 0.1, 180);
    const hemi = new THREE.HemisphereLight(0xdce7ec, 0x39413d, 1.15);
    const sun = new THREE.DirectionalLight(0xffefd3, 3.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 120;
    scene.add(hemi, sun, sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 55),
      new THREE.MeshStandardMaterial({ color: 0x55584f, roughness: 0.96, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const active = new THREE.Group();
    scene.add(active);

    function clearAsset() {
      while (active.children.length) {
        const child = active.children.pop();
        child.traverse?.((node) => {
          node.geometry?.dispose?.();
          const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
          materials.forEach((material) => material.dispose?.());
        });
      }
    }

    function createRockAssembly(material) {
      const group = new THREE.Group();
      const specs = [
        [-4.8, 1.7, 0.4, 5.6, 3.4, 4.2, -0.28],
        [0.2, 2.1, -0.8, 6.8, 4.2, 4.9, 0.18],
        [5.0, 1.4, 1.2, 4.9, 2.8, 3.6, 0.42],
        [-1.8, 1.0, 3.6, 3.2, 2.0, 2.6, -0.12],
      ];
      for (const [x, y, z, sx, sy, sz, yaw] of specs) {
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), material);
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        mesh.rotation.set(0.08, yaw, -0.06);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return group;
    }

    function createWoodAssembly(material) {
      const group = new THREE.Group();
      for (let index = 0; index < 7; index += 1) {
        const x = -6 + index * 2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 5.6, 18), material);
        post.position.set(x, 2.8, Math.sin(index * 1.3) * 0.7);
        post.rotation.z = (index - 3) * 0.018;
        post.castShadow = true;
        post.receiveShadow = true;
        group.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(15, 0.9, 1.1, 18, 2, 2), material);
      beam.position.set(0, 5.1, 0);
      beam.castShadow = true;
      beam.receiveShadow = true;
      group.add(beam);
      return group;
    }

    function framebufferStats() {
      const gl = renderer.getContext();
      const width = 480;
      const height = 300;
      const x = Math.floor((canvas.width - width) / 2);
      const y = Math.floor((canvas.height - height) / 2);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      let sumSq = 0;
      let chroma = 0;
      let samples = 0;
      let minLuma = 1;
      let maxLuma = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index] / 255;
        const g = pixels[index + 1] / 255;
        const b = pixels[index + 2] / 255;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += luma;
        sumSq += luma * luma;
        chroma += Math.max(r, g, b) - Math.min(r, g, b);
        minLuma = Math.min(minLuma, luma);
        maxLuma = Math.max(maxLuma, luma);
        samples += 1;
      }
      const meanLuma = sum / samples;
      return {
        meanLuma,
        lumaStdDev: Math.sqrt(Math.max(0, sumSq / samples - meanLuma * meanLuma)),
        meanChroma: chroma / samples,
        minLuma,
        maxLuma,
        glError: gl.getError(),
      };
    }

    const baseColor = new THREE.Color(0x7d776d);
    const metadataByProfile = {
      coldRock: { category: 'rock', name: 'cold granite outcrop' },
      dampWood: { category: 'waterside', name: 'oak timber pier' },
      dryRock: { category: 'rock', name: 'dry granite outcrop' },
    };

    window.__renderWorldAssetGeographicProfile = (name) => {
      const profile = profiles[name];
      fail(profile, `unknown visual profile ${name}`);
      clearAsset();
      const source = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.72, metalness: 0 });
      source.name = name === 'dampWood' ? 'oak timber' : 'granite rock';
      source.userData.generatedByTextureFactory = true;
      const asset = name === 'dampWood' ? createWoodAssembly(source) : createRockAssembly(source);
      asset.name = `world-asset-${name}`;
      const result = applyWorldAssetGeographicWeathering(asset, profile, { metadata: metadataByProfile[name] });
      fail(result.ok, `weathering failed for ${name}`);
      const audit = auditWorldAssetGeographicWeathering(asset);
      fail(audit.ok, `weathering audit failed for ${name}: ${audit.errors.join(',')}`);
      active.add(asset);

      const geographicX = profile.worldX;
      const geographicZ = profile.worldZ;
      // Preserve canonical coordinates in shader world space while keeping camera precision high:
      // the staging root carries the geographic offset and the camera follows that root.
      active.position.set(geographicX, 0, geographicZ);
      ground.position.set(geographicX, 0, geographicZ);
      camera.position.set(geographicX + 17.5, 12.5, geographicZ + 24);
      camera.lookAt(geographicX, 2.2, geographicZ);
      sun.position.set(geographicX - 16, 26, geographicZ + 14);
      sun.target.position.set(geographicX, 1.5, geographicZ);
      sun.target.updateMatrixWorld();
      scene.fog.near = 45;
      scene.fog.far = 115;

      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const stats = framebufferStats();
      fail(stats.glError === gl.NO_ERROR, `WebGL error ${stats.glError} for ${name}`);
      fail(renderer.info.render.calls >= 5, `insufficient draw calls for ${name}: ${renderer.info.render.calls}`);
      fail(renderer.info.render.triangles > 1200, `insufficient geometry for ${name}`);
      fail(stats.lumaStdDev > 0.025, `${name} material proof is too uniform`);
      fail(stats.maxLuma - stats.minLuma > 0.18, `${name} material proof lacks tonal range`);
      return {
        name,
        profile: {
          worldX: profile.worldX,
          worldZ: profile.worldZ,
          category: profile.category,
          suitability: profile.suitability.score,
          climate: profile.climate,
          weathering: profile.weathering,
        },
        weatheringResult: result,
        audit,
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        framebuffer: stats,
      };
    };

    return {
      geographicPolicyId: WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.id,
      weatheringPolicyId: WORLD_ASSET_SURFACE_WEATHERING_POLICY.id,
      targets: { iceTarget, temperateTarget },
      profileNames: Object.keys(profiles),
    };
  });

  const results = {};
  for (const name of boot.profileNames) {
    results[name] = await page.evaluate((profileName) => window.__renderWorldAssetGeographicProfile(profileName), name);
    await page.locator('#qa-canvas').screenshot({
      path: path.join(artifactDir, `world-asset-${name}.png`),
    });
  }

  assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
  const cold = results.coldRock.framebuffer;
  const damp = results.dampWood.framebuffer;
  const dry = results.dryRock.framebuffer;
  assert(results.coldRock.profile.weathering.frost > results.dryRock.profile.weathering.frost + 0.35, 'cold/dry frost separation collapsed');
  assert(results.dampWood.profile.weathering.wet > results.dryRock.profile.weathering.wet + 0.35, 'wet/dry material separation collapsed');
  assert(results.dryRock.profile.weathering.dry > results.dampWood.profile.weathering.dry + 0.25, 'dry/wet material separation collapsed');
  assert(Math.max(
    Math.abs(cold.meanLuma - damp.meanLuma),
    Math.abs(cold.meanLuma - dry.meanLuma),
    Math.abs(damp.meanLuma - dry.meanLuma),
  ) > 0.006, 'geographic material profiles produce indistinguishable framebuffer means');

  const report = {
    ...boot,
    browserErrors,
    results,
  };
  fs.writeFileSync(path.join(artifactDir, 'world-asset-geographic-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log('[checkWorldAssetGeographicVisualQa] PASS: real WebGL canonical-climate asset weathering renders are distinct and non-uniform.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
