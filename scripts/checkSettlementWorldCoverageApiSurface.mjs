import fs from 'node:fs';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const files={
  slice:'src/3d/gameplay/settlementWorldCoverageSlice.js',
  acceptance:'src/3d/gameplay/settlementWorldCoverageAcceptance.js',
  adapter:'src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js',
};
const source=Object.fromEntries(Object.entries(files).map(([key,file])=>[key,fs.readFileSync(file,'utf8')]));

const required={
  slice:['SETTLEMENT_WORLD_COVERAGE_VERSION','SETTLEMENT_WORLD_COVERAGE_LIMITS','SETTLEMENT_WORLD_COVERAGE_API','createSettlementWorldCoveragePlan','validateSettlementWorldCoveragePlan','createSettlementWorldCoverageSession'],
  acceptance:['SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_VERSION','SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS','SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES','createSettlementWorldCoverageAcceptance','validateSettlementWorldCoverageAcceptance','createSettlementWorldCoverageProof','SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API'],
  adapter:['SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION','createSettlementWorldCoverageRuntimeAdapter','buildSettlementWorldCoverageRuntimeProof','validateSettlementWorldCoverageRuntime'],
};
for(const [key,names] of Object.entries(required)){
  for(const name of names)assert(source[key].includes(name),`${key} missing public symbol ${name}`);
}

const services=['gate','market','tavern','blacksmith','farm','barracks','stable','house'];
const intents=['enter','exit','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save'];
const panels=['overview','trade','craft','quests','dialogue','travel','equipment','rest','save'];
for(const value of [...services,...intents,...panels])assert(source.slice.includes(`'${value}'`),`slice public contract missing ${value}`);

const resolverImports=['getSettlementService','getSettlementItem','getSettlementRecipe','getSettlementRoute','getSettlementDialogueCondition','getSettlementQuestObjective','getSettlementUxMessage','resolveTradeQuote','resolveCraftingRecipe','resolveTravelCost','createSettlementContentManifest','validateSettlementContent'];
for(const name of resolverImports)assert(source.slice.includes(name),`slice must reuse authored resolver ${name}`);

const ownershipGuards=['EditorMaterialStudio.js','MaterialAssignmentCore.js','WorldAssetPlacementPipeline.js','BoxGeometry','MeshBasicMaterial','MeshStandardMaterial'];
for(const [key,text] of Object.entries(source))for(const token of ownershipGuards)assert(!text.includes(token),`${key} includes forbidden runtime ownership token ${token}`);

const requiredServiceEvidence={gate:['door','road'],market:['vendor','stall'],tavern:['interior','npc'],blacksmith:['forge','workbench'],farm:['field','barn'],barracks:['barracks','training'],stable:['stable','mount'],house:['house','bed']};
for(const [service,tokens] of Object.entries(requiredServiceEvidence))for(const token of tokens)assert(source.acceptance.includes(`'${token}'`),`acceptance missing ${service} evidence token ${token}`);

const methods=['readiness','open','setPanel','execute','queue','runQueue','checkpoint','resume','snapshotState','view','dispose'];
for(const method of methods)assert(source.slice.includes(method),`slice session method missing ${method}`);
for(const method of ['enter','interact','travel','buy','sell','craft','save','verify','state','dispose'])assert(source.adapter.includes(`const ${method}`),`adapter method missing ${method}`);

for(const [key,text] of Object.entries(source)){
  const lineCount=text.split('\n').length;
  assert(lineCount>=40,`${key} unexpectedly small (${lineCount} lines)`);
}

const packageJson=JSON.parse(fs.readFileSync('package.json','utf8'));
assert(packageJson.type==='module','coverage tests require ESM package mode');

const report={
  files,
  lineCounts:Object.fromEntries(Object.entries(source).map(([key,text])=>[key,text.split('\n').length])),
  services:services.length,
  intents:intents.length,
  panels:panels.length,
  authoredResolvers:resolverImports.length,
  forbiddenRuntimeTokens:ownershipGuards.length,
  requiredPublicSymbols:Object.fromEntries(Object.entries(required).map(([key,names])=>[key,names.length])),
  serviceEvidence:Object.fromEntries(Object.entries(requiredServiceEvidence).map(([key,value])=>[key,value.length])),
};

console.log('Settlement World Coverage API Surface: PASS');
console.log(JSON.stringify(report,null,2));
