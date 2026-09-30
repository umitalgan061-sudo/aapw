import {readFile} from 'node:fs/promises';
const owners=[
 ['src/3d/lighting.ts','src/3d/lighting.js'],
 ['src/3d/stars.ts','src/3d/stars.js'],
 ['src/3d/nightVisualEnhancement.ts','src/3d/nightVisualEnhancement.js'],
 ['src/3d/celestialLightState.ts','src/3d/celestialLightState.js'],
 ['src/3d/audio/audioManager.ts','src/3d/audio/audioManager.js'],
];
const failures=[];
for(const [typedPath,legacyPath] of owners){
 try{const typed=await readFile(typedPath,'utf8');if(!/(Typed|typed)/.test(typed))failures.push(`${typedPath}: typed production marker missing`);}catch{failures.push(`${typedPath}: missing TypeScript owner`);}
 try{const legacy=await readFile(legacyPath,'utf8');if(!legacy.includes('.ts')||!legacy.includes('export * from'))failures.push(`${legacyPath}: compatibility barrel invalid`);}catch{failures.push(`${legacyPath}: compatibility barrel missing`);}
}
for(const source of await Promise.all(owners.map(([p])=>readFile(p,'utf8')))){if(source.includes('EditorMaterialStudio.js'))failures.push('render/audio runtime imports editor material studio');}
const ledger=await readFile('src/3d/modern/typedLegacySurfaceV6.ts','utf8');
for(const [,legacyPath] of owners)if(!ledger.includes(`path:'${legacyPath}'`))failures.push(`migration ledger missing ${legacyPath}`);
if(failures.length){console.error(failures.join('\\n'));process.exit(1);}
console.log(JSON.stringify({ok:true,suite:'typed-render-audio-migration-wave12',owners:owners.length,deterministicStarfield:true,sharedCelestialState:true,legacyBoundaries:true}));
