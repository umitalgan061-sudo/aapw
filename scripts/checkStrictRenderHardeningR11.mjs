import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/rendering/gpuPressureModel.ts','src/3d/rendering/gpuPressureModel.js'],
  ['src/3d/rendering/renderPassBudgetPlanner.ts','src/3d/rendering/renderPassBudgetPlanner.js'],
  ['src/3d/rendering/dynamicResolutionGovernor.ts','src/3d/rendering/dynamicResolutionGovernor.js'],
];
const failures=[];
for(const [typed,legacy] of owners){
 const source=await readFile(typed,'utf8').catch(()=>null);
 const boundary=await readFile(legacy,'utf8').catch(()=>null);
 if(!source)failures.push(`${typed}: missing typed owner`);
 else if(source.includes('@ts-nocheck'))failures.push(`${typed}: @ts-nocheck forbidden`);
 if(!boundary||!boundary.includes('export * from')||!boundary.includes('.ts'))failures.push(`${legacy}: compatibility boundary invalid`);
}
const orchestrator=await readFile('src/3d/rendering/nextGenRenderOrchestrator.ts','utf8');
for(const spec of ['./gpuPressureModel.ts','./renderPassBudgetPlanner.ts','./dynamicResolutionGovernor.ts']){
 if(orchestrator.includes(`from '${spec}'`)===false) failures.push(`nextGenRenderOrchestrator.ts: missing direct TS import ${spec}`);
}
const ledger=await readFile('src/3d/modern/migrationLedgerR11.ts','utf8');
for(const [,legacy] of owners)if(!ledger.includes(`legacyPath:'${legacy}'`))failures.push(`R11 ledger missing ${legacy}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(JSON.stringify({ok:true,suite:'strict-render-hardening-r11',owners:owners.length,noTsNocheck:true,directTsProductionImports:true}));
