#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async () => {
    const { createWolf } = await import('/src/3d/gameplay/animals.js');
    const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');
    const species = ANIMAL_CONFIG.SPECIES.wolf;
    const assetLoader = new AssetLoader();
    const groundCollider = { getGroundHeight: () => 0 };
    const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };

    async function makeWolf() {
      return createWolf({
        assetLoader,
        modelUrl: species.modelUrl,
        idleClipName: species.clips.idle,
        stripChildNames: species.stripChildNames,
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        groundCollider,
        playerCollider,
        fleeClipName: species.clips.flee,
        fleeTriggerRadiusMeters: ANIMAL_CONFIG.FLEE_TRIGGER_RADIUS_METERS,
        fleeSpeedMps: ANIMAL_CONFIG.FLEE_SPEED_MPS,
        packAlertRadiusMeters: ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS,
      });
    }

    const setWolf = await makeWolf();
    const setBefore = setWolf.object3D.position.clone();
    const setPack = new Set([
      { x: 0, z: -2 },
      { x: Number.NaN, z: 0 },
    ]);
    setWolf.update(3, undefined, setPack);
    const setMove = setWolf.object3D.position.distanceTo(setBefore);
    const setTelemetry = { ...setWolf.object3D.userData.wildlifeFlee };
    const setFinite = ['x', 'y', 'z'].every((axis) => Number.isFinite(setWolf.object3D.position[axis]));
    setWolf.dispose();

    const directWolf = await makeWolf();
    let iteratorNextReads = 0;
    const faultingPack = {
      [Symbol.iterator]() {
        return {
          next() {
            iteratorNextReads += 1;
            throw new Error('direct threat must not scan pack members');
          },
        };
      },
    };
    const directBefore = directWolf.object3D.position.clone();
    let directError = null;
    try {
      directWolf.update(3, { x: 0, z: -1 }, faultingPack);
    } catch (error) {
      directError = String(error);
    }
    const directMove = directWolf.object3D.position.distanceTo(directBefore);
    const directTelemetry = { ...directWolf.object3D.userData.wildlifeFlee };
    const directFinite = ['x', 'y', 'z'].every((axis) => Number.isFinite(directWolf.object3D.position[axis]));
    directWolf.dispose();

    return {
      modelUrl: species.modelUrl,
      setMove,
      setTelemetry,
      setFinite,
      iteratorNextReads,
      directError,
      directMove,
      directTelemetry,
      directFinite,
    };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.match(proof.modelUrl, /assets\/models\/animals\/wolf\/.+\.glb$/i, 'real configured wolf GLB must be used');
  assert.equal(proof.setTelemetry.phase, 'pack-flee');
  assert.equal(proof.setTelemetry.pack, true);
  assert.equal(proof.setTelemetry.direct, false);
  assert.equal(proof.setTelemetry.distanceMeters, null);
  assert.equal(proof.setFinite, true);
  assert.ok(proof.setMove > 0.35 && proof.setMove <= 0.45 + 1e-6, `Set-backed pack flee escaped budget: ${proof.setMove}`);
  assert.equal(proof.directError, null, `direct threat should short-circuit faulting pack scan: ${proof.directError}`);
  assert.equal(proof.iteratorNextReads, 0, 'direct threat must perform zero pack iterator next() reads');
  assert.equal(proof.directTelemetry.phase, 'flee');
  assert.equal(proof.directTelemetry.direct, true);
  assert.equal(proof.directTelemetry.pack, false);
  assert.equal(proof.directFinite, true);
  assert.ok(proof.directMove > 0.35 && proof.directMove <= 0.45 + 1e-6, `direct flee escaped budget: ${proof.directMove}`);

  console.log('WILDLIFE_PACK_ADAPTER_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
