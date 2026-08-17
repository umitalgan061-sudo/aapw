import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
  analyzeMaterialSurfaces,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';

export const PLAYER_SWORD_EQUIPMENT = Object.freeze({
  id: 'player-narsil-sword',
  modelUrl: 'assets/models/props/sword_narsil_style.fbx',
  textureUrl: 'assets/models/props/sword_narsil_style_texture.png',
  targetLengthMeters: 1.08,
});

function findRightHandSocket(root) {
  let best = null;
  let bestScore = -1;
  root?.traverse?.((node) => {
    if (!node?.isBone) return;
    const normalized = String(node.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let score = 0;
    if (normalized.includes('righthand')) score = 100;
    else if (normalized.includes('handr')) score = 90;
    else if (normalized.includes('right') && normalized.includes('hand')) score = 80;
    else if (normalized.endsWith('hand')) score = 10;
    if (score > bestScore) { best = node; bestScore = score; }
  });
  return bestScore >= 80 ? best : null;
}

function applyTextureIfMissing(root, texture) {
  let texturedSlots = 0;
  root?.traverse?.((node) => {
    if (!node?.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      if (!material.map && texture) {
        material.map = texture;
        material.needsUpdate = true;
      }
      if (material.map) texturedSlots += 1;
    }
  });
  return texturedSlots;
}

function normalizeSwordScale(sword, targetLengthMeters) {
  sword.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(sword);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!(longest > 1e-5)) throw new Error('sword has no measurable geometry');
  sword.scale.multiplyScalar(targetLengthMeters / longest);
  sword.updateMatrixWorld(true);
  return { sourceLongestAxis: longest, targetLengthMeters };
}

export async function equipPlayerSword({ assetLoader, playerRoot }) {
  const hand = findRightHandSocket(playerRoot);
  if (!hand) throw new Error('[player-equipment] compatible right-hand bone not found');

  const sword = await assetLoader.loadFBXModel(PLAYER_SWORD_EQUIPMENT.modelUrl, {
    fallbackColor: 0x666666,
    fallbackSize: 0.8,
  });
  sword.userData.assetId = PLAYER_SWORD_EQUIPMENT.id;
  sword.userData.assetCategory = 'weapon';
  sword.userData.assetSrc = PLAYER_SWORD_EQUIPMENT.modelUrl;

  const preflight = validateMaterialAssignment(sword);
  if (!preflight.ok || preflight.placeholder) {
    AssetLoader.disposeObject3D(sword);
    throw new Error(`[player-equipment] sword model validation failed: ${preflight.errors.join(',') || 'placeholder'}`);
  }

  const texture = await assetLoader.loadTexture(PLAYER_SWORD_EQUIPMENT.textureUrl);
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  const texturedSlots = applyTextureIfMissing(sword, texture);
  const scale = normalizeSwordScale(sword, PLAYER_SWORD_EQUIPMENT.targetLengthMeters);

  // Mixamo right-hand local space: blade extends away from the closed palm. These offsets are
  // deliberately socket-local, so world terrain/player movement never has to special-case gear.
  sword.position.set(0.035, 0.04, 0.015);
  sword.rotation.set(0, Math.PI / 2, -Math.PI / 2);
  hand.add(sword);

  const validation = validateMaterialAssignment(sword);
  const surfaces = analyzeMaterialSurfaces(sword);
  const manifest = createMaterialManifest(sword, {
    metadata: {
      id: PLAYER_SWORD_EQUIPMENT.id,
      name: 'Narsil-style player sword',
      category: 'weapon',
      src: PLAYER_SWORD_EQUIPMENT.modelUrl,
    },
    placement: { mode: 'skeleton-socket', socket: hand.name },
  });
  manifest.equipment = {
    socket: hand.name,
    texturedSlots,
    textureUrl: PLAYER_SWORD_EQUIPMENT.textureUrl,
    sourceLongestAxis: Number(scale.sourceLongestAxis.toFixed(4)),
    targetLengthMeters: scale.targetLengthMeters,
  };
  sword.userData.materialManifest = manifest;
  sword.userData.equipmentSocket = hand.name;
  sword.userData.surfaceSummary = {
    meshCount: surfaces.meshCount,
    materialSlotCount: validation.materialSlotCount,
    texturedSlots,
    warnings: validation.warnings,
  };

  return {
    object3D: sword,
    socket: hand,
    manifest,
    dispose() { hand.remove(sword); AssetLoader.disposeObject3D(sword); },
  };
}
