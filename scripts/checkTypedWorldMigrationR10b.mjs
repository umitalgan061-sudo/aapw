import { readFile } from 'node:fs/promises';
const owners = [
  ['terrainMacroWeathering','terrainMacroWeathering.legacy.js'],['terrainReliefDetail','terrainReliefDetail.legacy.js'],
  ['valyriaGeology','valyriaGeology.legacy.js'],['worldReferenceMountainRelief','worldReferenceMountainRelief.legacy.js'],
  ['worldReferenceTerrainAdapter','worldReferenceTerrainAdapter.legacy.js'],['naturalGeology','naturalGeology.legacy.js'],
  ['naturalGeologyPlacement','naturalGeologyPlacement.legacy.js'],['terrainMicroSurface','terrainMicroSurface.legacy.js'],
  ['winterVegetationAsset','winterVegetationAsset.legacy.js'],['iceLandmarkRealism','iceLandmarkRealism.legacy.js'],
  ['iceLandmarks','iceLandmarks.legacy.js'],['geographicVegetationAsset','geographicVegetationAsset.legacy.js'],
  ['terrainFoundationConformer','terrainFoundationConformer.legacy.js'],['terrainGroundwaterRegime','terrainGroundwaterRegime.legacy.js'],
  ['terrainGroundwaterSurfaceDetail','terrainGroundwaterSurfaceDetail.legacy.js'],['terrainSnowReliefDirector','terrainSnowReliefDirector.legacy.js']
];
const failures=[];
for(const [name,legacy] of owners){
 const ts=await readFile(`src/3d/world/${name}.ts`,'utf8').catch(()=>null);
 const js=await readFile(`src/3d/world/${legacy}`,'utf8').catch(()=>null);
 if(!ts || !ts.includes('Production TypeScript owner')) failures.push(`${name}: TS owner missing`);
 if(!js || !js.includes(`./${name}.ts`)) failures.push(`${name}: legacy compatibility boundary missing`);
}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('R10b world TypeScript ownership check passed.');
