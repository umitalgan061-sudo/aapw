#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHARACTER_ASSET = 'assets/models/characters/peasant_girl.fbx';
const CHARACTER_URL = '/assets/models/characters/peasant_girl.fbx';
const EQUIPMENT_ASSET = 'assets/models/fbx/Viking Sword Blend_Viking Sword.fbx';
const EQUIPMENT_URL = '/assets/models/fbx/Viking%20Sword%20Blend_Viking%20Sword.fbx';
const LFS_HEADER = 'version https://git-lfs.github.com/spec/v1';
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-equipment-socket-runtime');
const need = (condition, message) => {
  if (!condition) throw new Error(`[player-equipment-socket-runtime] ${message}`);
};

function requireHydrated(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  need(fs.existsSync(absolute), `missing asset: ${relativePath}`);
  const stat = fs.statSync(absolute);
  need(stat.isFile() && stat.size > 512, `asset is missing or still pointer-sized: ${relativePath}`);
  const prefix = fs.readFileSync(absolute).subarray(0, 128).toString('utf8');
  need(!prefix.includes(LFS_HEADER), `asset was not hydrated: ${relativePath}`);
  return { path: relativePath, bytes: stat.size };
}

const hydration = {
  character: requireHydrated(CHARACTER_ASSET),
  equipment: requireHydrated(EQUIPMENT_ASSET),
};
fs.mkdirSync(outDir, { recursive: true });

const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
});

try {
  await page.route('**/game3d.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/src/3d/vendor/three/three.module.js","three/addons/":"/src/3d/vendor/three/addons/"}}</script><title>player-equipment-socket-runtime</title>',
    });
  });
  await page.goto(`${server.baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });

  const proof = await page.evaluate(async ({ characterUrl, equipmentUrl }) => {
    const [{ AssetLoader }, materialCore, THREE] = await Promise.all([
      import('/src/3d/assetLoader.js'),
      import('/src/3d/materials/MaterialAssignmentCore.js'),
      import('/src/3d/vendor/three/three.module.js'),
    ]);
    const loader = new AssetLoader();
    const character = await loader.loadFBXModel(characterUrl, { fallbackColor: 0xff00ff, fallbackSize: 1.8 });
    const equipment = await loader.loadFBXModel(equipmentUrl, { fallbackColor: 0xff00ff, fallbackSize: 1 });
    AssetLoader.correctMixamoFbxScale(character);
    character.updateMatrixWorld(true);
    equipment.updateMatrixWorld(true);

    const bones = [];
    character.traverse((node) => {
      if (node?.isBone) bones.push(node);
    });
    const rightHand = bones.find((bone) => /mixamorig.*right.*hand/i.test(bone.name))
      || bones.find((bone) => /right.*hand|hand.*right|hand[_ .-]*r(?:ight)?$/i.test(bone.name));
    if (!rightHand) throw new Error(`no right-hand bone; bones=${bones.map((bone) => bone.name).join(',')}`);

    const validationBeforeAttach = materialCore.validateMaterialAssignment(equipment);
    const originalBounds = new THREE.Box3().setFromObject(equipment);
    const originalSize = originalBounds.getSize(new THREE.Vector3());

    rightHand.add(equipment);
    equipment.position.set(0, 0, 0);
    equipment.quaternion.identity();
    equipment.updateMatrixWorld(true);
    character.updateMatrixWorld(true);

    const worldPosition = equipment.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = equipment.getWorldQuaternion(new THREE.Quaternion());
    const worldScale = equipment.getWorldScale(new THREE.Vector3());
    const socketBounds = new THREE.Box3().setFromObject(equipment);
    const socketSize = socketBounds.getSize(new THREE.Vector3());
    const validationAfterAttach = materialCore.validateMaterialAssignment(equipment);

    const result = {
      characterPlaceholder: Boolean(character.userData?.isPlaceholder),
      equipmentPlaceholder: Boolean(equipment.userData?.isPlaceholder),
      socket: {
        semantic: 'right-hand',
        bone: rightHand.name,
        parentMatches: equipment.parent === rightHand,
        worldPosition: worldPosition.toArray(),
        worldQuaternion: worldQuaternion.toArray(),
        worldScale: worldScale.toArray(),
      },
      geometry: {
        originalSize: originalSize.toArray(),
        socketSize: socketSize.toArray(),
      },
      material: {
        beforeAttach: {
          ok: validationBeforeAttach.ok,
          errors: [...validationBeforeAttach.errors],
          meshCount: validationBeforeAttach.meshCount,
          materialSlotCount: validationBeforeAttach.materialSlotCount,
        },
        afterAttach: {
          ok: validationAfterAttach.ok,
          errors: [...validationAfterAttach.errors],
          meshCount: validationAfterAttach.meshCount,
          materialSlotCount: validationAfterAttach.materialSlotCount,
        },
      },
    };

    equipment.removeFromParent();
    AssetLoader.disposeObject3D(equipment);
    AssetLoader.disposeObject3D(character);
    return result;
  }, { characterUrl: CHARACTER_URL, equipmentUrl: EQUIPMENT_URL });

  const finite = (values) => Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
  need(proof.characterPlaceholder === false, 'character resolved to placeholder');
  need(proof.equipmentPlaceholder === false, 'equipment resolved to placeholder');
  need(proof.socket.semantic === 'right-hand' && proof.socket.parentMatches === true, `socket attachment failed: ${JSON.stringify(proof.socket)}`);
  need(finite(proof.socket.worldPosition), `non-finite socket position: ${JSON.stringify(proof.socket.worldPosition)}`);
  need(finite(proof.socket.worldQuaternion), `non-finite socket quaternion: ${JSON.stringify(proof.socket.worldQuaternion)}`);
  need(Math.abs(Math.hypot(...proof.socket.worldQuaternion) - 1) < 1e-5, `socket quaternion lost unit length: ${JSON.stringify(proof.socket.worldQuaternion)}`);
  need(finite(proof.socket.worldScale) && proof.socket.worldScale.every((value) => value > 1e-8), `mirrored or degenerate socket scale: ${JSON.stringify(proof.socket.worldScale)}`);
  need(finite(proof.geometry.originalSize) && Math.max(...proof.geometry.originalSize) > 0, 'equipment original bounds are empty');
  need(finite(proof.geometry.socketSize) && Math.max(...proof.geometry.socketSize) > 0, 'equipment socket bounds are empty');
  need(proof.material.beforeAttach.ok && proof.material.beforeAttach.errors.length === 0, `material invalid before attach: ${JSON.stringify(proof.material.beforeAttach)}`);
  need(proof.material.afterAttach.ok && proof.material.afterAttach.errors.length === 0, `material invalid after attach: ${JSON.stringify(proof.material.afterAttach)}`);
  need(proof.material.afterAttach.meshCount === proof.material.beforeAttach.meshCount, 'socket attach changed equipment mesh count');
  need(proof.material.afterAttach.materialSlotCount === proof.material.beforeAttach.materialSlotCount, 'socket attach changed equipment material slots');
  need(browserErrors.length === 0, `browser/page errors: ${JSON.stringify(browserErrors)}`);

  const output = {
    contract: 'player-equipment-socket-runtime',
    missingAssetCount: 0,
    hydration,
    proof,
    sourceOverwritten: false,
    productionTransformAuthored: false,
    sharedMaterialCoreUsed: true,
    editorMaterialStudioImported: false,
    browserErrors,
  };
  fs.writeFileSync(path.join(outDir, 'equipment-socket-runtime.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log('PLAYER_EQUIPMENT_SOCKET_RUNTIME_OK', JSON.stringify({
    bone: proof.socket.bone,
    meshCount: proof.material.afterAttach.meshCount,
    materialSlotCount: proof.material.afterAttach.materialSlotCount,
    browserErrors: browserErrors.length,
  }));
} catch (error) {
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await browser.close();
  await server.stop();
}