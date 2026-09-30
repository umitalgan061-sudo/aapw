import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/gameplay/livingWorldFaunaEcologyDirector.ts','src/3d/gameplay/livingWorldFaunaEcologyDirector.js'],
  ['src/3d/gameplay/livingWorldEcologyPolicy.ts','src/3d/gameplay/livingWorldEcologyPolicy.js'],
  ['src/3d/gameplay/livingWorldReactionRuntime.ts','src/3d/gameplay/livingWorldReactionRuntime.js'],
  ['src/3d/gameplay/livingWorldReactionPolicy.ts','src/3d/gameplay/livingWorldReactionPolicy.js'],
  ['src/3d/gameplay/livingWorldReactionIntegrationAdapter.ts','src/3d/gameplay/livingWorldReactionIntegrationAdapter.js'],
  ['src/3d/gameplay/playerEquipmentCombatProfile.ts','src/3d/gameplay/playerEquipmentCombatProfile.js'],
  ['src/3d/gameplay/playerEquipmentCombatRules.ts','src/3d/gameplay/playerEquipmentCombatRules.js'],
  ['src/3d/gameplay/playerEquipmentCombatRuntime.ts','src/3d/gameplay/playerEquipmentCombatRuntime.js'],
  ['src/3d/world/WorldAssetPlacementPipeline.ts','src/3d/world/WorldAssetPlacementPipeline.js'],
  ['src/3d/world/WorldSurfacePolicySchema.ts','src/3d/world/WorldSurfacePolicySchema.js'],
  ['src/3d/world/WorldAssetFootprintGeometry.ts','src/3d/world/WorldAssetFootprintGeometry.js'],
  ['src/3d/world/geographicSettlementProps.ts','src/3d/world/geographicSettlementProps.js'],
];

const failures=[];
for(const [typed,legacy] of owners){
  const a=await readFile(typed,'utf8').catch(()=>null);
  const b=await readFile(legacy,'utf8').catch(()=>null);
  if(!a) failures.push(typed+' missing TS owner');
  else if(!a.includes('Production TypeScript owner')) failures.push(typed+' missing ownership marker');
  if(!b || !b.includes('export * from') || !b.includes('.ts')) failures.push(legacy+' invalid compatibility shim');
}
const linkage=[
  ['src/3d/gameplay/livingWorldFaunaEcologyDirector.ts','./livingWorldEcologyPolicy.ts'],
  ['src/3d/gameplay/livingWorldReactionRuntime.ts','./livingWorldReactionPolicy.ts'],
  ['src/3d/gameplay/livingWorldReactionIntegrationAdapter.ts','./livingWorldReactionRuntime.ts'],
  ['src/3d/gameplay/playerEquipmentCombatRuntime.ts','./playerEquipmentCombatProfile.ts'],
  ['src/3d/gameplay/playerEquipmentCombatRules.ts','./playerEquipmentCombatProfile.ts'],
  ['src/3d/world/WorldAssetPlacementPipeline.ts','./WorldAssetFootprintGeometry.ts'],
  ['src/3d/world/WorldAssetPlacementPipeline.ts','./WorldSurfacePolicySchema.ts'],
  ['src/3d/world/geographicSettlementProps.ts','./WorldAssetPlacementPipeline.ts'],
];
for(const [file,spec] of linkage){ const s=await readFile(file,'utf8').catch(()=> ''); if(!s.includes(spec)) failures.push(file+' missing typed dependency '+spec); }
const gateText=await readFile('scripts/checkTypedGameplayWorldR13.mjs','utf8').catch(()=> '');
if(!gateText.includes('livingWorldFaunaEcologyDirector.ts')) failures.push('R13 gate self-check failed');
if(failures.length){ console.error(failures.join('\n')); process.exit(1); }
console.log('R13 typed gameplay/world ownership gate passed.');
