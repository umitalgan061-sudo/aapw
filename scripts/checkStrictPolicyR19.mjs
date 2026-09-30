import { readFile } from 'node:fs/promises';
const files=['src/3d/audio/audioCurveMath.ts','src/3d/audio/audioCueScheduler.ts','src/3d/rendering/gpuPassBudget.ts','src/3d/rendering/renderMetricsCollector.ts'];
const failures=[];
for(const path of files){const source=await readFile(path,'utf8').catch(()=>null);if(!source)failures.push(path+': missing');else{if(source.includes('@ts-nocheck'))failures.push(path+': @ts-nocheck remains');if(source.includes('@ts-ignore'))failures.push(path+': @ts-ignore remains');}}
if(failures.length){console.error('Strict policy R19 failed with '+failures.length+' issue(s):');for(const failure of failures)console.error('- '+failure);process.exit(1);}
console.log(JSON.stringify({ok:true,policy:'strict-policy-r19',files:files.length,tsNoCheck:false,tsIgnore:false}));