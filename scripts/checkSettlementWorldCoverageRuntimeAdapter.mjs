import {
  createSettlementWorldCoverageRuntimeAdapter,
  buildSettlementWorldCoverageRuntimeProof,
  validateSettlementWorldCoverageRuntime,
  SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION,
} from '../src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const frozen = (value) => {
  assert(Object.isFrozen(value), 'expected frozen value');
  if (value && typeof value === 'object') for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child);
};
const clone = (value) => JSON.parse(JSON.stringify(value));

const assetEvidence = [
  { family:'settlements', assetId:'door-north', status:'loaded', hydrated:true, materialSlots:4, textured:true, grounded:true, path:'assets/models/settlements/door.glb' },
  { family:'settlements', assetId:'road-east', status:'loaded', hydrated:true, materialSlots:2, textured:true, grounded:true, path:'assets/models/settlements/road.glb' },
  { family:'settlements', assetId:'vendor-market', status:'loaded', hydrated:true, materialSlots:5, textured:true, grounded:true, path:'assets/models/settlements/market.glb' },
  { family:'settlements', assetId:'stall-market', status:'loaded', hydrated:true, materialSlots:3, textured:true, grounded:true, path:'assets/models/settlements/stall.glb' },
  { family:'houses', assetId:'interior-tavern', status:'loaded', hydrated:true, materialSlots:7, textured:true, grounded:true, path:'assets/models/houses/tavern.glb' },
  { family:'props', assetId:'npc-tavern', status:'loaded', hydrated:true, materialSlots:2, textured:true, grounded:true, path:'assets/models/props/npc.glb' },
  { family:'settlements', assetId:'forge-blacksmith', status:'loaded', hydrated:true, materialSlots:6, textured:true, grounded:true, path:'assets/models/settlements/forge.glb' },
  { family:'props', assetId:'workbench-blacksmith', status:'loaded', hydrated:true, materialSlots:4, textured:true, grounded:true, path:'assets/models/props/workbench.glb' },
  { family:'settlements', assetId:'field-farm', status:'loaded', hydrated:true, materialSlots:4, textured:true, grounded:true, path:'assets/models/settlements/field.glb' },
  { family:'settlements', assetId:'barn-farm', status:'loaded', hydrated:true, materialSlots:4, textured:true, grounded:true, path:'assets/models/settlements/barn.glb' },
  { family:'houses', assetId:'barracks-main', status:'loaded', hydrated:true, materialSlots:8, textured:true, grounded:true, path:'assets/models/houses/barracks.glb' },
  { family:'props', assetId:'training-barracks', status:'loaded', hydrated:true, materialSlots:3, textured:true, grounded:true, path:'assets/models/props/training.glb' },
  { family:'settlements', assetId:'stable-main', status:'loaded', hydrated:true, materialSlots:5, textured:true, grounded:true, path:'assets/models/settlements/stable.glb' },
  { family:'props', assetId:'mount-stable', status:'loaded', hydrated:true, materialSlots:2, textured:true, grounded:true, path:'assets/models/props/mount.glb' },
  { family:'houses', assetId:'house-main', status:'loaded', hydrated:true, materialSlots:6, textured:true, grounded:true, path:'assets/models/houses/house.glb' },
  { family:'props', assetId:'bed-house', status:'loaded', hydrated:true, materialSlots:2, textured:true, grounded:true, path:'assets/models/props/bed.glb' },
];

const materialEvidence = [
  { id:'wall-a', role:'wall', kind:'pbr', textured:true, textureSize:2048, albedo:'wall-albedo', normal:'wall-normal', roughness:'wall-roughness' },
  { id:'roof-a', role:'roof', kind:'pbr', textured:true, textureSize:2048, albedo:'roof-albedo', normal:'roof-normal', roughness:'roof-roughness' },
  { id:'wood-a', role:'wood', kind:'pbr', textured:true, textureSize:1024, albedo:'wood-albedo', normal:'wood-normal', roughness:'wood-roughness' },
  { id:'door-a', role:'door', kind:'pbr', textured:true, textureSize:1024, albedo:'door-albedo', normal:'door-normal', roughness:'door-roughness' },
  { id:'window-a', role:'window', kind:'pbr', textured:true, textureSize:1024, albedo:'window-albedo', normal:'window-normal', roughness:'window-roughness' },
  { id:'metal-a', role:'metal', kind:'pbr', textured:true, textureSize:1024, albedo:'metal-albedo', normal:'metal-normal', roughness:'metal-roughness', metalness:'metal-metalness' },
  { id:'trim-a', role:'stone-trim', kind:'pbr', textured:true, textureSize:2048, albedo:'trim-albedo', normal:'trim-normal', roughness:'trim-roughness' },
];

const manifestEvidence = [
  { id:'gate-material-manifest', assetId:'door-north', serviceId:'gate', materialManifestId:'gate-materials', status:'validated', surfaceRoles:['wall','roof','wood','door','window','metal','stone-trim'], materialIds:['wall-a','roof-a','wood-a','door-a','window-a','metal-a','trim-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'market-material-manifest', assetId:'vendor-market', serviceId:'market', materialManifestId:'market-materials', status:'validated', surfaceRoles:['wall','roof','wood','metal'], materialIds:['wall-a','roof-a','wood-a','metal-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'tavern-material-manifest', assetId:'interior-tavern', serviceId:'tavern', materialManifestId:'tavern-materials', status:'validated', surfaceRoles:['wall','roof','wood','door','window'], materialIds:['wall-a','roof-a','wood-a','door-a','window-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'blacksmith-material-manifest', assetId:'forge-blacksmith', serviceId:'blacksmith', materialManifestId:'forge-materials', status:'validated', surfaceRoles:['wall','roof','wood','metal','stone-trim'], materialIds:['wall-a','roof-a','wood-a','metal-a','trim-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'farm-material-manifest', assetId:'field-farm', serviceId:'farm', materialManifestId:'farm-materials', status:'validated', surfaceRoles:['wood','stone-trim'], materialIds:['wood-a','trim-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'barracks-material-manifest', assetId:'barracks-main', serviceId:'barracks', materialManifestId:'barracks-materials', status:'validated', surfaceRoles:['wall','roof','wood','door','window','stone-trim'], materialIds:['wall-a','roof-a','wood-a','door-a','window-a','trim-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'stable-material-manifest', assetId:'stable-main', serviceId:'stable', materialManifestId:'stable-materials', status:'validated', surfaceRoles:['wall','roof','wood'], materialIds:['wall-a','roof-a','wood-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
  { id:'house-material-manifest', assetId:'house-main', serviceId:'house', materialManifestId:'house-materials', status:'validated', surfaceRoles:['wall','roof','wood','door','window'], materialIds:['wall-a','roof-a','wood-a','door-a','window-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true },
];

const placementEvidence = [
  { id:'gate-placement', assetId:'door-north', serviceId:'gate', status:'attached', manifestId:'gate-material-manifest', materialManifestId:'gate-materials', position:{x:0,y:0,z:0}, groundPosition:{x:0,y:0,z:0}, expectedGroundY:0, slope:4, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'market-placement', assetId:'vendor-market', serviceId:'market', status:'attached', manifestId:'market-material-manifest', materialManifestId:'market-materials', position:{x:4,y:0,z:3}, groundPosition:{x:4,y:0,z:3}, expectedGroundY:0, slope:6, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'tavern-placement', assetId:'interior-tavern', serviceId:'tavern', status:'attached', manifestId:'tavern-material-manifest', materialManifestId:'tavern-materials', position:{x:-5,y:0,z:2}, groundPosition:{x:-5,y:0,z:2}, expectedGroundY:0, slope:3, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'forge-placement', assetId:'forge-blacksmith', serviceId:'blacksmith', status:'attached', manifestId:'blacksmith-material-manifest', materialManifestId:'forge-materials', position:{x:8,y:0,z:-4}, groundPosition:{x:8,y:0,z:-4}, expectedGroundY:0, slope:7, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'farm-placement', assetId:'field-farm', serviceId:'farm', status:'attached', manifestId:'farm-material-manifest', materialManifestId:'farm-materials', position:{x:-9,y:0,z:-5}, groundPosition:{x:-9,y:0,z:-5}, expectedGroundY:0, slope:5, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'barracks-placement', assetId:'barracks-main', serviceId:'barracks', status:'attached', manifestId:'barracks-material-manifest', materialManifestId:'barracks-materials', position:{x:10,y:0,z:8}, groundPosition:{x:10,y:0,z:8}, expectedGroundY:0, slope:4, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'stable-placement', assetId:'stable-main', serviceId:'stable', status:'attached', manifestId:'stable-material-manifest', materialManifestId:'stable-materials', position:{x:14,y:0,z:2}, groundPosition:{x:14,y:0,z:2}, expectedGroundY:0, slope:8, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
  { id:'house-placement', assetId:'house-main', serviceId:'house', status:'attached', manifestId:'house-material-manifest', materialManifestId:'house-materials', position:{x:-11,y:0,z:7}, groundPosition:{x:-11,y:0,z:7}, expectedGroundY:0, slope:5, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false },
];

const cameras = [
  { profile:'full-world', width:1536, height:1024, projection:'orthographic', readable:true },
  { profile:'settlement-far', width:1536, height:1024, projection:'orthographic', readable:true },
  { profile:'settlement-center', width:1536, height:1024, projection:'orthographic', readable:true },
  { profile:'settlement-northwest', width:1536, height:1024, projection:'orthographic', readable:true },
];

const runtimeState = {
  settlementId:'winterhold', locationId:'winterhold-gate', inSettlement:true, settlementOpen:true, health:90, maxHealth:100,
  copper:220, fatigue:35, reputation:4, saveEnabled:true,
  inventory:{ bread:4, iron_ore:9, coal:5, leather:3, linen:5 }, equipment:{ mainHand:'iron_sword' },
  skills:{ smithing:4, commerce:3, survival:3 }, perks:['roadwise','merchant_road'],
  quests:{ 'forge-order':{ state:'active', step:1, completed:false, rewardClaimed:false } },
  flags:{ met_smith:true, gate_open:true }, survival:{ hunger:20, exposure:5, morale:6 },
};

const runtime = {
  snapshot:()=>clone(runtimeState),
  execute:()=>({ ok:true }),
  enterSettlement:()=>({ ok:true, serviceId:'gate' }),
  exitSettlement:()=>({ ok:true, serviceId:'gate' }),
  talk:()=>({ ok:true, serviceId:'tavern', reputationDelta:1 }),
  trade:()=>({ ok:true, serviceId:'market' }),
  buy:()=>({ ok:true, serviceId:'market' }),
  sell:()=>({ ok:true, serviceId:'market' }),
  craft:()=>({ ok:true, serviceId:'blacksmith', xpDelta:10 }),
  equip:()=>({ ok:true, serviceId:'blacksmith' }),
  acceptQuest:()=>({ ok:true, serviceId:'tavern', xpDelta:4 }),
  advanceQuest:()=>({ ok:true, serviceId:'tavern', xpDelta:8 }),
  travel:()=>({ ok:true, serviceId:'gate' }),
  rest:()=>({ ok:true, serviceId:'tavern', fatigueDelta:-20 }),
  train:()=>({ ok:true, serviceId:'barracks', xpDelta:8 }),
  save:()=>({ ok:true, serviceId:'house' }),
  interact:()=>({ ok:true, serviceId:'house' }),
  getAssetEvidence:()=>clone(assetEvidence),
  getMaterialEvidence:()=>clone(materialEvidence),
  getMaterialManifests:()=>clone(manifestEvidence),
  getPlacementEvidence:()=>clone(placementEvidence),
  getCameraEvidence:()=>clone(cameras),
  getInteractionEvidence:()=>[
    { id:'i1', serviceId:'gate', action:'enter', ok:true, sequence:1, at:1 },
    { id:'i2', serviceId:'market', action:'trade', ok:true, sequence:2, at:2 },
    { id:'i3', serviceId:'tavern', action:'talk', ok:true, sequence:3, at:3 },
    { id:'i4', serviceId:'blacksmith', action:'craft', ok:true, sequence:4, at:4 },
    { id:'i5', serviceId:'house', action:'save', ok:true, sequence:5, at:5 },
  ],
};

const options = { settlementId:'winterhold', assetEvidence:()=>clone(assetEvidence), materialEvidence:()=>clone(materialEvidence), manifestEvidence:()=>clone(manifestEvidence), placementEvidence:()=>clone(placementEvidence), cameraEvidence:()=>clone(cameras), interactionEvidence:()=>runtime.getInteractionEvidence(), initialState:clone(runtimeState) };

assert(SETTLEMENT_WORLD_COVERAGE_RUNTIME_ADAPTER_VERSION === 1, 'adapter version drift');
const adapter = createSettlementWorldCoverageRuntimeAdapter(runtime, options);
assert(adapter.valid, 'runtime shape should be valid');
assert(adapter.shape.ok, 'shape check should pass');
frozen(adapter.state());

const firstView = adapter.state().view;
assert(firstView.services.length === 8, `expected 8 services, got ${firstView.services.length}`);
assert(firstView.services.some((service)=>service.id==='blacksmith'), 'blacksmith service missing');
assert(firstView.services.some((service)=>service.id==='tavern'), 'tavern service missing');
assert(firstView.services.some((service)=>service.id==='market'), 'market service missing');
assert(firstView.services.some((service)=>service.id==='stable'), 'stable service missing');
assert(firstView.services.some((service)=>service.id==='house'), 'house service missing');
assert(firstView.content.validation.ok !== false, 'content validation must not be explicitly false');

const gate = await adapter.enter('gate','overview');
assert(gate.ok, 'gate open failed');
const market = await adapter.enter('market','trade');
assert(market.ok, 'market open failed');
assert(market.view.panel === 'trade', 'market panel failed');
const buy = await adapter.buy('bread',2);
assert(buy.ok, `adapter buy failed: ${buy.reason}`);
const talk = await adapter.interact('talk',{});
assert(talk.ok, `adapter talk failed: ${talk.reason}`);
const craft = await adapter.craft('iron_sword');
assert(craft.ok, `adapter craft failed: ${craft.reason}`);
const travel = await adapter.travel('north_gate',{cost:18,fatigue:12});
assert(travel.ok, `adapter travel failed: ${travel.reason}`);
const saveAfterTravel = await adapter.save({ from:'post-travel' });
assert(saveAfterTravel.ok, 'checkpoint should be creatable even when save authority is outside runtime');

const verification = adapter.verify();
assert(verification.runtime.ok, 'verification runtime shape failed');
assert(verification.planValidation.ok, `plan validation failed: ${verification.planValidation.errors.join(',')}`);
assert(verification.acceptance.flags.noPlaceholderMaterials, 'placeholder material flag failed');
assert(verification.acceptance.flags.noMissingMaterials, 'missing material flag failed');
assert(verification.acceptance.flags.noPlacementRisk, 'placement flag failed');
assert(verification.acceptance.flags.camerasValid, 'camera flag failed');
assert(verification.acceptance.flags.interactionsValid, 'interaction flag failed');
frozen(verification);

const verificationAgain = adapter.verify();
assert(verification.fingerprint === verificationAgain.fingerprint, 'verification fingerprint changed');
assert(JSON.stringify(verification.proof) === JSON.stringify(verificationAgain.proof), 'proof serialization changed');

const directProof = buildSettlementWorldCoverageRuntimeProof(runtime, options);
assert(directProof.acceptance.status === 'green', `direct proof not green: ${directProof.acceptance.status}`);
assert(directProof.proof.assetProof.missing === 0, 'direct proof missing assets');
assert(directProof.proof.materialProof.placeholderCount === 0, 'direct proof placeholder materials');
assert(directProof.proof.placementProof.invalidCount === 0, 'direct proof invalid placement');
frozen(directProof);

const directValidation = validateSettlementWorldCoverageRuntime(runtime, options);
assert(directValidation.ok, `direct runtime validation failed: ${directValidation.errors.join(',')}`);
frozen(directValidation);

const brokenRuntime = { execute:()=>({ok:true}), getAssetEvidence:()=>[] };
const brokenAdapter = createSettlementWorldCoverageRuntimeAdapter(brokenRuntime, { initialState:{} });
assert(!brokenAdapter.valid, 'broken runtime should not be valid');
const brokenValidation = validateSettlementWorldCoverageRuntime(brokenRuntime, { initialState:{} });
assert(!brokenValidation.ok, 'broken runtime validation must fail');

const throwingRuntime = {
  execute:()=>({ok:true}),
  getAssetEvidence:()=>{ throw new Error('asset evidence unavailable'); },
  getMaterialEvidence:()=>{ throw new Error('material evidence unavailable'); },
};
const safeAdapter = createSettlementWorldCoverageRuntimeAdapter(throwingRuntime, { initialState:runtimeState });
assert(safeAdapter.valid, 'throwing evidence provider must not invalidate runtime shape');
const safeVerification = safeAdapter.verify();
assert(safeVerification.acceptance.status !== 'green', 'missing evidence cannot claim green');

const customHandlerLog=[];
const customAdapter = createSettlementWorldCoverageRuntimeAdapter(runtime, { ...options, handlers:{ talk:async ({ intent, plan })=>{ customHandlerLog.push({intent,plan}); return {ok:true,serviceId:'tavern',reputationDelta:2}; } } });
const customTalk = await customAdapter.interact('talk',{});
assert(customTalk.ok, 'custom talk failed');
assert(customHandlerLog.length === 1, 'custom handler was not called exactly once');

const proofClone = clone(directProof);
proofClone.proof.assetProof.missing = 3;
const proofAgain = buildSettlementWorldCoverageRuntimeProof(runtime, options);
assert(proofAgain.proof.assetProof.missing === 0, 'proof should not share mutable references');

assert(adapter.dispose() === true, 'adapter dispose should succeed');
assert(adapter.dispose() === false, 'adapter dispose should be idempotent');
const disposedAction = await adapter.interact('talk',{});
assert(!disposedAction.ok && disposedAction.reason === 'disposed', 'disposed adapter must fail closed');

console.log('Settlement World Coverage Runtime Adapter: PASS');
console.log(JSON.stringify({
  adapterVersion:adapter.version,
  services:firstView.services.map((service)=>service.id),
  coverageScore:verification.acceptance.score,
  acceptanceStatus:verification.acceptance.status,
  runtimeFingerprint:verification.fingerprint,
  proofFingerprint:directProof.proof.fingerprint,
  interactions:verification.acceptance.interactions.count,
},null,2));
