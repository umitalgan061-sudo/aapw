import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/world/geographicAssetDistributionAdapter.ts','src/3d/world/geographicAssetDistributionAdapter.js'],
  ['src/3d/world/geographicAssetClusterPlanner.ts','src/3d/world/geographicAssetClusterPlanner.js'],
  ['src/3d/world/roadPathfinder.ts','src/3d/world/roadPathfinder.js'],
  ['src/3d/world/roads.ts','src/3d/world/roads.js'],
  ['src/3d/world/villages.ts','src/3d/world/villages.js'],
  ['src/3d/world/geographicSettlementPropQuality.ts','src/3d/world/geographicSettlementPropQuality.js'],
  ['src/3d/world/worldReferenceSurfaceTerrainVisual.ts','src/3d/world/worldReferenceSurfaceTerrainVisual.js'],
];

const failures=[];
for(const [typed,legacy] of owners){
  const a=await readFile(typed,'utf8').catch(()=>null);
  const b=await readFile(legacy,'utf8').catch(()=>null);
  if(!a) failures.push(typed+' missing');
  if(!b || !b.includes('export * from') || !b.includes('.ts')) failures.push(legacy+' is not a TS compatibility shim');
}
for(const [path,needles] of [
  ['src/3d/game3d.ts',['./world/roads.ts','./world/settlements.ts','./world/villages.ts']],
  ['src/3d/sceneManager.ts',['./world/roads.ts','./world/settlements.ts','./world/villages.ts']],
  ['src/3d/world/geographicAssetRuntimeOrchestrator.ts',['./geographicAssetDistributionAdapter.ts','./geographicAssetClusterPlanner.ts']]
]){
  const source=await readFile(path,'utf8').catch(()=> '');
  for(const needle of needles) if(!source.includes("from '"+needle+"'")) failures.push(path+' missing '+needle);
}
if(failures.length){ console.error(failures.join('\n')); process.exit(1); }
console.log('R10 typed world ownership gate passed.');
