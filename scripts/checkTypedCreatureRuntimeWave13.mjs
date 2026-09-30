import { readFile } from 'node:fs/promises';

const owners=[
 ['src/3d/gameplay/dialogueChoices.ts','src/3d/gameplay/dialogueChoices.js'],
 ['src/3d/gameplay/creatureBodyPlans.ts','src/3d/gameplay/creatureBodyPlans.js'],
 ['src/3d/gameplay/creatureRig.ts','src/3d/gameplay/creatureRig.js'],
 ['src/3d/gameplay/creatureGait.ts','src/3d/gameplay/creatureGait.js'],
 ['src/3d/gameplay/dragonSpawns.ts','src/3d/gameplay/dragonSpawns.js'],
];
const failures=[];
for(const [typed,legacy] of owners){
 const t=await readFile(typed,'utf8').catch(()=>null);
 const l=await readFile(legacy,'utf8').catch(()=>null);
 if(!t) failures.push(`${typed}: missing TypeScript owner`);
 else if(!t.includes('Production TypeScript owner')) failures.push(`${typed}: production-owner marker missing`);
 if(!l) failures.push(`${legacy}: missing compatibility boundary`);
 else if(!l.includes('export * from')||!l.includes('.ts')) failures.push(`${legacy}: not a TypeScript compatibility barrel`);
}
for(const p of ['src/3d/gameplay/creatureBodyPlans.ts','src/3d/gameplay/dialogueChoices.ts']){
 const s=await readFile(p,'utf8').catch(()=> '');
 if(s.includes('@ts-nocheck')) failures.push(`${p}: strict typed data owner still uses @ts-nocheck`);
}
const consumers=[
 ['src/3d/gameplay/creatureBrain.ts',[`from './creatureRig.ts'`,`from './creatureGait.ts'`,`from './creatureBodyPlans.ts'`]],
 ['src/3d/gameplay/creatureLocomotionStateSynthesis.ts',[`from './creatureGait.ts'`]],
 ['src/3d/gameplay/dragons.js',[`from './dragonSpawns.ts'`]],
 ['src/3d/gameplay/interactionConfig.ts',[`from './dialogueChoices.ts'`]],
];
for(const [p,need] of consumers){
 const s=await readFile(p,'utf8').catch(()=> '');
 for(const token of need) if(!s.includes(token)) failures.push(`${p}: typed consumer edge missing ${token}`);
}
const sw=await readFile('service-worker.js','utf8');
for(const legacy of owners.map(([,legacy])=>legacy)) if(!sw.includes(legacy)) failures.push(`service-worker.js: cache contract missing ${legacy}`);
if(failures.length){
 console.error(`Typed creature runtime Wave 13 failed with ${failures.length} issue(s):`);
 for(const f of failures) console.error(`- ${f}`);
 process.exit(1);
}
console.log(JSON.stringify({ok:true,suite:'typed-creature-runtime-wave13',owners:owners.length,strictDataOwners:2,compatibilityBoundaries:true,consumerEdges:true}));
