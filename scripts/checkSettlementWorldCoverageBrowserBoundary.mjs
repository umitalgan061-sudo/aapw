import fs from 'node:fs';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const files=[
  'src/3d/gameplay/settlementWorldCoverageSlice.js',
  'src/3d/gameplay/settlementWorldCoverageAcceptance.js',
  'src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js',
];

const sources=Object.fromEntries(files.map((file)=>[file,fs.readFileSync(file,'utf8')]));
const forbiddenDom=['document.','window.','HTMLElement','querySelector','createElement','getElementById','innerHTML','addEventListener'];
const forbiddenEditor=['EditorMaterialStudio.js','EditorAutoTexture.js','MaterialStudio'];
const forbiddenPrimitive=['BoxGeometry','MeshBasicMaterial','MeshStandardMaterial','SphereGeometry','CylinderGeometry','new Mesh('];
const requiredExports={
  'src/3d/gameplay/settlementWorldCoverageSlice.js':['createSettlementWorldCoveragePlan','validateSettlementWorldCoveragePlan','createSettlementWorldCoverageSession'],
  'src/3d/gameplay/settlementWorldCoverageAcceptance.js':['createSettlementWorldCoverageAcceptance','validateSettlementWorldCoverageAcceptance','createSettlementWorldCoverageProof'],
  'src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js':['createSettlementWorldCoverageRuntimeAdapter','buildSettlementWorldCoverageRuntimeProof','validateSettlementWorldCoverageRuntime'],
};
const requiredTerms=['deepFreeze','fingerprint','settlementId','serviceId'];

for(const [file,source] of Object.entries(sources)){
  for(const token of forbiddenDom)assert(!source.includes(token),`${file} contains DOM runtime token ${token}`);
  for(const token of forbiddenEditor)assert(!source.includes(token),`${file} contains editor/material-studio token ${token}`);
  for(const token of forbiddenPrimitive)assert(!source.includes(token),`${file} contains primitive geometry token ${token}`);
  for(const token of requiredTerms)assert(source.includes(token),`${file} lost required contract term ${token}`);
  for(const exportName of requiredExports[file])assert(source.includes(`export function ${exportName}`),`${file} missing export ${exportName}`);
}

assert(sources['src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js'].includes('createSettlementWorldCoverageSession'),'runtime adapter must consume the existing world coverage session');
assert(sources['src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js'].includes('createSettlementWorldCoverageAcceptance'),'runtime adapter must consume acceptance contract');
assert(sources['src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js'].includes('createSettlementWorldCoverageProof'),'runtime adapter must produce shipped proof');
assert(sources['src/3d/gameplay/settlementWorldCoverageSlice.js'].includes('resolveTradeQuote'),'slice must reuse authored trade resolver');
assert(sources['src/3d/gameplay/settlementWorldCoverageSlice.js'].includes('resolveCraftingRecipe'),'slice must reuse authored crafting resolver');
assert(sources['src/3d/gameplay/settlementWorldCoverageSlice.js'].includes('resolveTravelCost'),'slice must reuse authored travel resolver');
assert(sources['src/3d/gameplay/settlementWorldCoverageSlice.js'].includes('validateSettlementContent'),'slice must reuse authored content validation');

const serviceIds=['gate','market','tavern','blacksmith','farm','barracks','stable','house'];
const intentIds=['enter','exit','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save'];
for(const serviceId of serviceIds)assert(sources['src/3d/gameplay/settlementWorldCoverageSlice.js'].includes(`'${serviceId}'`),`slice lost service ${serviceId}`);
for(const intent of intentIds)assert(sources['src/3d/gameplay/settlementWorldCoverageSlice.js'].includes(`'${intent}'`),`slice lost intent ${intent}`);

const lineCounts=Object.fromEntries(Object.entries(sources).map(([file,source])=>[file,source.split('\n').length]));
for(const [file,count] of Object.entries(lineCounts))assert(count>=50,`${file} unexpectedly small`);

console.log('Settlement World Coverage Browser Boundary: PASS');
console.log(JSON.stringify({files,lineCounts,serviceCount:serviceIds.length,intentCount:intentIds.length,domTokensBlocked:forbiddenDom.length,editorTokensBlocked:forbiddenEditor.length,primitiveTokensBlocked:forbiddenPrimitive.length},null,2));
