import { readFile } from 'node:fs/promises';

const owners=[
 ['src/3d/world/weather.ts','src/3d/world/weather.js'],
 ['src/3d/world/roadSurfaceProfile.ts','src/3d/world/roadSurfaceProfile.js'],
 ['src/3d/world/worldReferenceMap.ts','src/3d/world/worldReferenceMap.js'],
 ['src/3d/world/valyriaEcology.ts','src/3d/world/valyriaEcology.js'],
];
const failures=[];
for(const [typedPath,legacyPath] of owners){
 const typed=await readFile(typedPath,'utf8').catch(()=>null);
 const legacy=await readFile(legacyPath,'utf8').catch(()=>null);
 if(!typed) failures.push(`${typedPath}: missing TS owner`);
 else if(!typed.includes('Production TypeScript owner')) failures.push(`${typedPath}: missing production owner marker`);
 if(!legacy) failures.push(`${legacyPath}: missing compatibility boundary`);
 else if(!legacy.includes('export * from')||!legacy.includes('.ts')) failures.push(`${legacyPath}: invalid compatibility boundary`);
}
const ledger=await readFile('src/3d/modern/migrationLedgerR10.ts','utf8');
for(const [typedPath] of owners) if(!ledger.includes(typedPath)) failures.push(`R10 ledger missing ${typedPath}`);
if(failures.length){console.error(`R10 typed world-support check failed with ${failures.length} issue(s):`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1);}
console.log('R10 typed world-support check passed.');
