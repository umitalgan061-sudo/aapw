import { access, readFile } from 'node:fs/promises';

const REQUIRED = [
  'src/3d/modern/r25/contracts.ts',
  'src/3d/modern/r25/scheduler.ts',
  'src/3d/modern/r25/renderGraph.ts',
  'src/3d/modern/r25/backend.ts',
  'src/3d/modern/r25/adaptiveQuality.ts',
  'src/3d/modern/r25/assetRuntime.ts',
  'src/3d/modern/r25/worldRuntime.ts',
  'src/3d/modern/r25/observability.ts',
  'src/3d/modern/r25/security.ts',
  'src/3d/modern/r25/inputIntent.ts',
  'src/3d/modern/r25/simulation.ts',
  'src/3d/modern/r25/workerProtocol.ts',
  'src/3d/modern/r25/renderQueue.ts',
  'src/3d/modern/r25/health.ts',
  'src/3d/modern/r25/networkPrediction.ts',
  'src/3d/modern/r25/objectPool.ts',
  'src/3d/modern/r25/browserHost.ts',
  'src/3d/modern/r25/runtime.ts',
  'tests/modern/r25/runtimeCore.test.ts',
  'tsconfig.modern-r25.json',
];
const forbidden = [
  /@ts-nocheck/,
  /@ts-ignore/,
  /eval\s*\(/,
  /new\s+Function\s*\(/,
];
const failures=[];
const read=async path=>{try{return await readFile(path,'utf8')}catch{failures.push(path+': missing or unreadable');return ''}};

for(const path of REQUIRED){
  try{await access(path)}catch{failures.push(path+': missing')}
}
for(const path of REQUIRED.filter(p=>p.endsWith('.ts') && p.startsWith('src/'))){
  const source=await read(path);
  for(const pattern of forbidden){
    if(pattern.test(source)) failures.push(path+': forbidden pattern '+pattern);
  }
}
const index=await read('src/3d/modern/index.ts');
for(const name of REQUIRED.filter(p=>p.startsWith('src/3d/modern/r25/') && p.endsWith('.ts')).map(p=>p.split('/').pop().replace('.ts',''))){
  const expected='./r25/'+name;
  if(!index.includes(expected)) failures.push('src/3d/modern/index.ts: missing '+expected);
}
const tsconfig=await read('tsconfig.modern-r25.json');
for(const required of ['allowJs','false','noUncheckedIndexedAccess','exactOptionalPropertyTypes','strict']){
  if(!tsconfig.includes(required)) failures.push('tsconfig.modern-r25.json: missing '+required);
}
if(failures.length){console.error('R25 guard failed');for(const failure of failures) console.error(' - '+failure);process.exit(1)}
console.log('R25 guard passed: '+REQUIRED.length+' required surfaces; strict TypeScript and forbidden-runtime checks active.');
