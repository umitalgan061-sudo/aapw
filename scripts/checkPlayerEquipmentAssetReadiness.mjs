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
const EXPECTED_EQUIPMENT_BYTES = 72380;
const MATERIAL_TEXTURE_SIZE = 256;
const LFS_HEADER = 'version https://git-lfs.github.com/spec/v1';
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-equipment-readiness');
const need = (condition, message) => {
  if (!condition) throw new Error(`[player-equipment-readiness] ${message}`);
};

function inspectHydratedFile(relativePath, expectedBytes = null) {
  const absolute = path.join(ROOT, relativePath);
  need(fs.existsSync(absolute), `asset missing: ${relativePath}`);
  const stat = fs.statSync(absolute);
  need(stat.isFile(), `asset is not a file: ${relativePath}`);
  need(stat.size > 512, `asset still looks like an LFS pointer: ${relativePath} (${stat.size} bytes)`);
  const prefix = fs.readFileSync(absolute).subarray(0, 128).toString('utf8');
  need(!prefix.includes(LFS_HEADER), `asset was not hydrated: ${relativePath}`);
  if (Number.isFinite(expectedBytes)) {
    need(stat.size === expectedBytes, `asset byte-size drift for ${relativePath}: expected ${expectedBytes}, got ${stat.size}`);
  }
  return Object.freeze({ path: relativePath, bytes: stat.size, hydrated: true });
}

const characterFile = inspectHydratedFile(CHARACTER_ASSET);
const equipmentFile = inspectHydratedFile(EQUIPMENT_ASSET, EXPECTED_EQUIPMENT_BYTES);
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });

const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
});

try {
  await page.goto(`${server.baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const proof = await page.evaluate(async ({ characterAsset, characterUrl, equipmentAsset, equipmentUrl, textureSize }) => {
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

    const characterBones = [];
    character.traverse((node) => {
      if (node?.isBone) characterBones.push({ name: String(node.name || ''), uuid: node.uuid });
    });
    const handPatterns = [
      /mixamorig.*right.*hand/i,
      /right.*hand/i,
      /hand.*right/i,
      /hand[_ .-]*r(?:ight)?$/i,
      /r[_ .-]*hand/i,
    ];
    const rightHandCandidates = characterBones.filter((bone) => handPatterns.some((pattern) => pattern.test(bone.name)));

    const validation = materialCore.validateMaterialAssignment(equipment);
    const metadata = {
      id: 'player-main-hand-viking-sword',
      name: 'Viking Sword',
      category: 'weapon',
      src: equipmentAsset,
    };
    const manifest = materialCore.createMaterialManifest(equipment, { metadata });
    const recommendedAutoRecipe = materialCore.buildAutoMaterialRecipe(equipment, { metadata, textureSize });
    const recommendedLayerRecipe = validation.meshCount === 1 && validation.materialSlotCount === 1
      ? materialCore.buildRecommendedLayerRecipe(equipment, { metadata, textureSize })
      : null;

    const textureSlots = [];
    let namedMaterialCount = 0;
    let layeredMaterialCount = 0;
    equipment.traverse((node) => {
      if (!node?.isMesh || node.isInstancedMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material, materialIndex) => {
        if (!material) return;
        if (String(material.name || '').trim()) namedMaterialCount += 1;
        if (material.userData?.layeredMaterial) layeredMaterialCount += 1;
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const texture = material[slot];
          if (!texture) continue;
          const image = texture.image;
          textureSlots.push({
            mesh: node.name || `mesh-${validation.meshes.indexOf(node)}`,
            material: material.name || material.type || `material-${materialIndex}`,
            slot,
            width: Number(image?.naturalWidth || image?.videoWidth || image?.width || 0),
            height: Number(image?.naturalHeight || image?.videoHeight || image?.height || 0),
            paletteId: material.userData?.paletteId || null,
            generated: Boolean(material.userData?.generatedByTextureFactory || material.userData?.layeredMaterial),
          });
        }
      });
    });

    const bounds = new THREE.Box3().setFromObject(equipment);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const characterPlaceholder = Boolean(character.userData?.isPlaceholder);
    const equipmentPlaceholder = Boolean(equipment.userData?.isPlaceholder);
    const result = {
      character: {
        source: characterAsset,
        placeholder: characterPlaceholder,
        boneCount: characterBones.length,
        bones: characterBones.map((bone) => bone.name),
        rightHandCandidates: rightHandCandidates.map((bone) => bone.name),
        preferredRightHandBone: rightHandCandidates[0]?.name || null,
      },
      equipment: {
        source: equipmentAsset,
        placeholder: equipmentPlaceholder,
        meshCount: validation.meshCount,
        surfaceCount: validation.surfaceCount,
        uvMeshCount: validation.uvMeshCount,
        namedSurfaceCount: validation.namedSurfaceCount,
        materialSlotCount: validation.materialSlotCount,
        namedMaterialCount,
        generatedMaterialCount: validation.generatedMaterialCount,
        layeredMaterialCount,
        textureSlots,
        validation: {
          ok: validation.ok,
          errors: [...validation.errors],
          warnings: [...validation.warnings],
        },
        manifest: {
          asset: { ...manifest.asset },
          surfaces: manifest.surfaces.map((surface) => ({ ...surface })),
          validation: { ...manifest.validation },
        },
        boundsMetersBeforeSocketNormalization: {
          x: size.x,
          y: size.y,
          z: size.z,
          center: { x: center.x, y: center.y, z: center.z },
        },
        recommendedOnly: {
          autoRecipe: recommendedAutoRecipe ? { ...recommendedAutoRecipe } : null,
          layeredFallback: recommendedLayerRecipe ? { ...recommendedLayerRecipe } : null,
          appliedInProof: false,
        },
      },
      contract: {
        intendedSocket: 'right-hand',
        productionAttached: false,
        sourceOverwritten: false,
        sharedMaterialCoreUsed: true,
        editorMaterialStudioImported: false,
      },
    };

    AssetLoader.disposeObject3D(character);
    AssetLoader.disposeObject3D(equipment);
    return result;
  }, {
    characterAsset: CHARACTER_ASSET,
    characterUrl: CHARACTER_URL,
    equipmentAsset: EQUIPMENT_ASSET,
    equipmentUrl: EQUIPMENT_URL,
    textureSize: MATERIAL_TEXTURE_SIZE,
  });

  need(proof.character.placeholder === false, 'character loaded as placeholder');
  need(proof.character.boneCount > 0, 'hydrated player FBX exposes no skeleton bones');
  need(proof.character.rightHandCandidates.length > 0, `no right-hand socket candidate in player skeleton: ${JSON.stringify(proof.character.bones)}`);
  need(proof.equipment.placeholder === false, 'Viking sword loaded as placeholder');
  need(proof.equipment.meshCount > 0 && proof.equipment.surfaceCount > 0, 'Viking sword has no renderable/material surfaces');
  need(proof.equipment.materialSlotCount > 0, 'Viking sword has no material slots');
  need(proof.equipment.validation.ok && proof.equipment.validation.errors.length === 0, `shared material validation failed: ${JSON.stringify(proof.equipment.validation)}`);
  need(proof.equipment.recommendedOnly.autoRecipe?.basePaletteId === 'steel', `weapon matcher must recommend steel, got ${JSON.stringify(proof.equipment.recommendedOnly.autoRecipe)}`);
  need(proof.equipment.recommendedOnly.autoRecipe?.textureSize === MATERIAL_TEXTURE_SIZE, 'weapon material texture-size recommendation drift');
  const bounds = proof.equipment.boundsMetersBeforeSocketNormalization;
  need([bounds.x, bounds.y, bounds.z].every(Number.isFinite), `non-finite sword bounds: ${JSON.stringify(bounds)}`);
  need(Math.max(bounds.x, bounds.y, bounds.z) > 0, `empty sword bounds: ${JSON.stringify(bounds)}`);
  need(browserErrors.length === 0, `browser/page errors while parsing equipment candidate: ${JSON.stringify(browserErrors)}`);

  const output = {
    contract: 'player-equipment-asset-readiness',
    missingAssetCount: 0,
    hydration: {
      character: characterFile,
      equipment: equipmentFile,
    },
    character: proof.character,
    equipment: proof.equipment,
    attachment: {
      socketSemantic: proof.contract.intendedSocket,
      resolvedBone: proof.character.preferredRightHandBone,
      productionAttached: proof.contract.productionAttached,
      sourceOverwritten: proof.contract.sourceOverwritten,
    },
    materialContract: {
      sharedMaterialCoreUsed: proof.contract.sharedMaterialCoreUsed,
      editorMaterialStudioImported: proof.contract.editorMaterialStudioImported,
      recommendedPalette: proof.equipment.recommendedOnly.autoRecipe.basePaletteId,
      recommendedTextureSize: proof.equipment.recommendedOnly.autoRecipe.textureSize,
      layeredFallbackAvailable: Boolean(proof.equipment.recommendedOnly.layeredFallback),
      importedMaterialPreserved: proof.equipment.recommendedOnly.appliedInProof === false,
    },
    browserErrors,
  };
  fs.writeFileSync(path.join(outDir, 'equipment-asset-readiness.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log('PLAYER_EQUIPMENT_ASSET_READINESS_OK', JSON.stringify({
    equipment: EQUIPMENT_ASSET,
    bytes: equipmentFile.bytes,
    playerBones: proof.character.boneCount,
    rightHandBone: proof.character.preferredRightHandBone,
    swordMeshes: proof.equipment.meshCount,
    swordMaterialSlots: proof.equipment.materialSlotCount,
    recommendedPalette: output.materialContract.recommendedPalette,
    recommendedTextureSize: output.materialContract.recommendedTextureSize,
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
