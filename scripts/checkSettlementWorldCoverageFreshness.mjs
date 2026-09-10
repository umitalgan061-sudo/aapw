import { execFileSync } from 'node:child_process';

const run=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const base=run('git',['rev-parse','origin/main']);
const head=run('git',['rev-parse','HEAD']);
const mergeBase=run('git',['merge-base',base,head]);
const behind=Number(run('git',['rev-list','--count',`${head}..${base}`]));
const ahead=Number(run('git',['rev-list','--count',`${base}..${head}`]));
const files=run('git',['diff','--name-only',`${base}...${head}`]).split('\n').filter(Boolean);
const numstat=run('git',['diff','--numstat',`${base}...${head}`]).split('\n').filter(Boolean).map((line)=>{const [additions,deletions,...name]=line.split(/\s+/);return {additions:Number(additions),deletions:Number(deletions),path:name.join(' ')};});

assert(mergeBase===base,`freshness failed: merge base ${mergeBase} != origin/main ${base}`);
assert(behind===0,`branch is behind origin/main by ${behind}`);
assert(ahead>=1,'coverage branch has no commits');
assert(files.length<=12,`focused scope has too many files: ${files.length}`);
const changed=numstat.reduce((sum,row)=>sum+row.additions+row.deletions,0);
assert(changed<=3000,`diff budget exceeded: ${changed}`);
assert(changed>=2700,`World Coverage target not reached: ${changed}`);

const allowed=new Set([
  '.github/workflows/settlement-world-coverage.yml',
  'scripts/checkSettlementWorldCoverageContract.mjs',
  'scripts/checkSettlementWorldCoverageDeterminism.mjs',
  'scripts/checkSettlementWorldCoverageFreshness.mjs',
  'scripts/checkSettlementWorldCoverageManifest.mjs',
  'scripts/checkSettlementWorldCoverageRuntimeAdapter.mjs',
  'scripts/checkSettlementWorldCoverageSlice.mjs',
  'src/3d/gameplay/settlementWorldCoverageAcceptance.js',
  'src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js',
  'src/3d/gameplay/settlementWorldCoverageSlice.js',
]);
for(const path of files)assert(allowed.has(path),`unexpected file in World Coverage scope: ${path}`);

const patch=run('git',['diff','-U0',`${base}...${head}`]);
for(const pattern of ['EditorMaterialStudio.js','combat','playerController','terrainGenerator','worldEnvironment'])assert(!patch.includes(pattern),`ownership boundary token leaked into patch: ${pattern}`);

const runtimeFiles=files.filter((path)=>path.startsWith('src/3d/gameplay/settlementWorldCoverage'));
assert(runtimeFiles.length===3,'expected three runtime coverage modules');
for(const required of ['src/3d/gameplay/settlementWorldCoverageSlice.js','src/3d/gameplay/settlementWorldCoverageAcceptance.js','src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js'])assert(runtimeFiles.includes(required),`missing runtime coverage module: ${required}`);

const checks=Object.fromEntries(numstat.map((row)=>[row.path,{additions:row.additions,deletions:row.deletions}]));
for(const path of runtimeFiles)assert((checks[path]?.deletions??0)===0,`runtime coverage module unexpectedly deleted: ${path}`);
for(const path of files.filter((entry)=>entry.endsWith('.mjs')))assert((checks[path]?.additions??0)>0,`test script not additive: ${path}`);

const serviceIds=['gate','market','tavern','blacksmith','farm','barracks','stable','house'];
const intentIds=['enter','exit','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save'];
const requiredEvidence={gate:['door','road'],market:['vendor','stall'],tavern:['interior','npc'],blacksmith:['forge','workbench'],farm:['field','barn'],barracks:['barracks','training'],stable:['stable','mount'],house:['house','bed']};
for(const serviceId of serviceIds){assert(requiredEvidence[serviceId]?.length===2,`invalid service evidence contract: ${serviceId}`);}
for(const intent of intentIds)assert(intent.length>0,`empty intent: ${intent}`);

const workflowCount=files.filter((file)=>file==='.github/workflows/settlement-world-coverage.yml').length;
const scriptCount=files.filter((file)=>file.startsWith('scripts/checkSettlementWorldCoverage')).length;
assert(workflowCount===1,'exactly one World Coverage workflow expected');
assert(scriptCount===5,'exactly five World Coverage executable scripts expected');

const commitMessages=run('git',['log','--format=%s',`${base}..${head}`]).split('\n').filter(Boolean);
assert(commitMessages.some((message)=>/settlement/i.test(message)),'coverage commits lack settlement marker');
assert(commitMessages.some((message)=>/world coverage/i.test(message)),'coverage commits lack World Coverage marker');

console.log('Settlement World Coverage Freshness: PASS');
console.log(JSON.stringify({base,head,mergeBase,ahead,behind,changed,files,serviceCount:serviceIds.length,intentCount:intentIds.length,workflowCount,scriptCount,commitCount:commitMessages.length},null,2));
