/** R10b world legacy-payload migration ledger. */
export const R10B_WORLD_MODULES = Object.freeze([
  ['terrainMacroWeathering','terrainMacroWeathering.legacy.js','terrainMacroWeathering.ts'],
  ['terrainReliefDetail','terrainReliefDetail.legacy.js','terrainReliefDetail.ts'],
  ['valyriaGeology','valyriaGeology.legacy.js','valyriaGeology.ts'],
  ['worldReferenceMountainRelief','worldReferenceMountainRelief.legacy.js','worldReferenceMountainRelief.ts'],
  ['worldReferenceTerrainAdapter','worldReferenceTerrainAdapter.legacy.js','worldReferenceTerrainAdapter.ts'],
  ['naturalGeology','naturalGeology.legacy.js','naturalGeology.ts'],
  ['naturalGeologyPlacement','naturalGeologyPlacement.legacy.js','naturalGeologyPlacement.ts'],
  ['terrainMicroSurface','terrainMicroSurface.legacy.js','terrainMicroSurface.ts'],
  ['winterVegetationAsset','winterVegetationAsset.legacy.js','winterVegetationAsset.ts'],
  ['iceLandmarkRealism','iceLandmarkRealism.legacy.js','iceLandmarkRealism.ts'],
  ['iceLandmarks','iceLandmarks.legacy.js','iceLandmarks.ts'],
  ['geographicVegetationAsset','geographicVegetationAsset.legacy.js','geographicVegetationAsset.ts'],
  ['terrainFoundationConformer','terrainFoundationConformer.legacy.js','terrainFoundationConformer.ts'],
  ['terrainGroundwaterRegime','terrainGroundwaterRegime.legacy.js','terrainGroundwaterRegime.ts'],
  ['terrainGroundwaterSurfaceDetail','terrainGroundwaterSurfaceDetail.legacy.js','terrainGroundwaterSurfaceDetail.ts'],
  ['terrainSnowReliefDirector','terrainSnowReliefDirector.legacy.js','terrainSnowReliefDirector.ts'],
] as const);

export function getR10BWorldMigrationSnapshot(){
  const totalTracked=R10B_WORLD_MODULES.length;
  return Object.freeze({version:'10b',totalTracked,migratedCount:totalTracked,coveragePercent:100});
}
