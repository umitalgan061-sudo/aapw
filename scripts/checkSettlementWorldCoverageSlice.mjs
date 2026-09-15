import {
  SETTLEMENT_WORLD_COVERAGE_API,
  SETTLEMENT_WORLD_COVERAGE_LIMITS,
  createSettlementWorldCoveragePlan,
  createSettlementWorldCoverageSession,
  validateSettlementWorldCoveragePlan,
} from '../src/3d/gameplay/settlementWorldCoverageSlice.js';
import {
  createSettlementWorldCoverageAcceptance,
  createSettlementWorldCoverageProof,
  validateSettlementWorldCoverageAcceptance,
  SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API,
} from '../src/3d/gameplay/settlementWorldCoverageAcceptance.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const deepClone = (value) => JSON.parse(JSON.stringify(value));
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const expectFrozen = (value, label) => {
  assert(Object.isFrozen(value), `${label} is not frozen`);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') expectFrozen(child, `${label}.${key}`);
    }
  }
};

const assets = [
  { family:'settlements', id:'door-north', status:'loaded', materialSlots:3, textured:true, grounded:true },
  { family:'settlements', id:'road-east', status:'loaded', materialSlots:2, textured:true, grounded:true },
  { family:'settlements', id:'vendor-market', status:'loaded', materialSlots:4, textured:true, grounded:true },
  { family:'settlements', id:'stall-market', status:'loaded', materialSlots:3, textured:true, grounded:true },
  { family:'houses', id:'interior-tavern', status:'loaded', materialSlots:5, textured:true, grounded:true },
  { family:'props', id:'npc-tavern', status:'loaded', materialSlots:2, textured:true, grounded:true },
  { family:'settlements', id:'forge-blacksmith', status:'loaded', materialSlots:6, textured:true, grounded:true },
  { family:'props', id:'workbench-blacksmith', status:'loaded', materialSlots:3, textured:true, grounded:true },
  { family:'settlements', id:'field-farm', status:'loaded', materialSlots:3, textured:true, grounded:true },
  { family:'settlements', id:'barn-farm', status:'loaded', materialSlots:4, textured:true, grounded:true },
  { family:'houses', id:'barracks-main', status:'loaded', materialSlots:7, textured:true, grounded:true },
  { family:'props', id:'training-barracks', status:'loaded', materialSlots:3, textured:true, grounded:true },
  { family:'settlements', id:'stable-main', status:'loaded', materialSlots:5, textured:true, grounded:true },
  { family:'props', id:'mount-stable', status:'loaded', materialSlots:2, textured:true, grounded:true },
  { family:'houses', id:'house-main', status:'loaded', materialSlots:5, textured:true, grounded:true },
  { family:'props', id:'bed-house', status:'loaded', materialSlots:2, textured:true, grounded:true },
  { family:'settlements', id:'pointer-decoration', status:'pointer', lfsPointer:true, materialSlots:0, textured:false, grounded:false },
];

const initialState = {
  settlementId:'winterhold',
  locationId:'winterhold-gate',
  inSettlement:true,
  settlementOpen:true,
  health:88,
  maxHealth:100,
  copper:180,
  fatigue:44,
  reputation:3,
  inventory:{ bread:4, iron_ore:8, coal:4, leather:3, linen:4, stew:1 },
  equipment:{ mainHand:'iron_sword', gloves:'leather_gloves' },
  skills:{ smithing:3, commerce:2, survival:4 },
  perks:['roadwise','merchant_road','market_eye'],
  quests:{
    'forge-order':{ state:'active', step:1, completed:false, rewardClaimed:false },
    'arrival':{ state:'completed', step:1, completed:true, rewardClaimed:true },
  },
  flags:{ gate_open:true, met_smith:true },
  survival:{ hunger:35, exposure:10, morale:5 },
  saveEnabled:true,
};

function makeHandlers(log) {
  return {
    enter: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'gate' }; },
    exit: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'gate' }; },
    talk: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'tavern', reputationDelta:1 }; },
    trade: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'market' }; },
    buy: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'market' }; },
    sell: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'market' }; },
    craft: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'blacksmith', xpDelta:12 }; },
    equip: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'blacksmith' }; },
    acceptQuest: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'tavern', xpDelta:4 }; },
    advanceQuest: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'tavern', xpDelta:8 }; },
    travel: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'gate' }; },
    rest: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'tavern', fatigueDelta:-20 }; },
    train: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'barracks', xpDelta:10 }; },
    save: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'house' }; },
    interact: ({ intent }) => { log.push(intent); return { ok:true, serviceId:'house' }; },
  };
}

const plan = createSettlementWorldCoveragePlan({ snapshot:initialState, assets });
assert(plan.services.length === 8, `expected 8 services, got ${plan.services.length}`);
assert(new Set(plan.services.map((service) => service.id)).size === 8, 'duplicate service ids');
assert(plan.serviceSummary.ready + plan.serviceSummary.partial + plan.serviceSummary.blocked + plan.serviceSummary.availableBlocked === 8, 'service summary mismatch');
assert(plan.nextService?.id, 'next service missing');
assert(plan.assetCoverage.length === 8, 'asset coverage length mismatch');
assert(plan.fingerprint === digest({ ...plan, fingerprint:undefined }), 'fingerprint generation is not stable with own payload');
expectFrozen(plan, 'plan');

const secondPlan = createSettlementWorldCoveragePlan({ snapshot:deepClone(initialState), assets:deepClone(assets) });
assert(plan.fingerprint === secondPlan.fingerprint, 'deterministic plan fingerprint mismatch');
assert(JSON.stringify(plan) === JSON.stringify(secondPlan), 'deterministic plan serialization mismatch');

const validPlan = validateSettlementWorldCoveragePlan({ snapshot:initialState, assets });
assert(validPlan.ok, `valid plan rejected: ${validPlan.errors.join(',')}`);
expectFrozen(validPlan, 'validPlan');

const missingSnapshotPlan = createSettlementWorldCoveragePlan({ snapshot:null, assets });
assert(missingSnapshotPlan.player.inSettlement === true, 'default snapshot should be settlement-ready');
assert(missingSnapshotPlan.player.copper === 0, 'default copper must be zero');

const outsidePlan = createSettlementWorldCoveragePlan({ snapshot:{ ...initialState, inSettlement:false }, assets });
assert(outsidePlan.services.filter((service) => service.status === 'blocked').length >= 7, 'outside settlement did not block service rows');
const defeatedPlan = createSettlementWorldCoveragePlan({ snapshot:{ ...initialState, defeated:true, health:0 }, assets });
assert(defeatedPlan.services.filter((service) => service.status === 'blocked').length >= 7, 'defeated state did not block service rows');
const closedPlan = createSettlementWorldCoveragePlan({ snapshot:{ ...initialState, settlementOpen:false }, assets });
assert(closedPlan.services.some((service) => service.id === 'gate'), 'closed settlement must retain gate');

const eventLog = [];
const handlerLog = [];
const session = createSettlementWorldCoverageSession({
  initialState,
  assets,
  handlers:makeHandlers(handlerLog),
  now:()=>1700000000000 + eventLog.length,
  historyLimit:32,
});

assert(session.view().activeService === 'gate', 'session default service must be gate');
assert(session.view().panel === 'overview', 'session default panel must be overview');
expectFrozen(session.view(), 'session.view');

const marketOpen = session.open('market', 'trade');
assert(marketOpen.ok, 'market trade panel should open');
assert(marketOpen.view.activeService === 'market', 'market did not become active');
assert(marketOpen.view.panel === 'trade', 'market trade panel not active');

const craftPanel = session.open('blacksmith', 'craft');
assert(craftPanel.ok, 'blacksmith craft panel should open');
assert(craftPanel.view.activeService === 'blacksmith', 'blacksmith not active');
assert(craftPanel.view.panel === 'craft', 'craft panel not active');

const unsupportedPanel = session.setPanel('dialogue');
assert(unsupportedPanel.ok, 'panel should safely return to overview when unsupported');
assert(unsupportedPanel.view.panel === 'overview', 'unsupported panel fallback failed');

const readinessBuy = session.readiness('buy', { itemId:'bread', quantity:2 });
assert(readinessBuy.ready === true, `buy should be ready: ${readinessBuy.reason}`);
assert(readinessBuy.serviceId === 'market', 'buy service mapping failed');
assert(readinessBuy.panel === 'trade', 'buy panel mapping failed');
expectFrozen(readinessBuy, 'readinessBuy');

const readinessUnknown = session.readiness('unknown-action', {});
assert(readinessUnknown.ready === false, 'unknown action must be blocked');
assert(readinessUnknown.reason === 'unknown-action', 'unknown action reason mismatch');

const buy = await session.execute('buy', { itemId:'bread', quantity:2 });
assert(buy.ok, `buy handler failed: ${buy.reason}`);
assert(buy.receipt.intent === 'buy', 'buy receipt missing intent');
assert(buy.receipt.serviceId === 'market', 'buy receipt service mismatch');
assert(handlerLog.includes('buy'), 'buy handler not observed');

const blockedBuy = await session.execute('buy', { itemId:'', quantity:1 });
assert(!blockedBuy.ok, 'missing item buy should be blocked');
assert(blockedBuy.reason === 'item-required', 'missing item reason mismatch');

const blockedCraft = await session.execute('craft', {});
assert(!blockedCraft.ok, 'missing recipe craft should be blocked');
assert(blockedCraft.reason === 'recipe-required', 'recipe-required reason mismatch');

const craft = await session.execute('craft', { recipeId:'iron_sword' });
assert(craft.ok, `craft handler failed: ${craft.reason}`);
assert(craft.receipt.serviceId === 'blacksmith', 'craft receipt service mismatch');

const rest = await session.execute('rest', {});
assert(rest.ok, `rest handler failed: ${rest.reason}`);
assert(rest.view.player.fatigue < 44, 'rest must reduce fatigue in local coverage state');

const train = await session.execute('train', {});
assert(train.ok, `train handler failed: ${train.reason}`);
assert(train.view.player.fatigue > rest.view.player.fatigue, 'train must increase fatigue');

const checkpoint = session.checkpoint({ tag:'world-coverage', source:'automated-test' });
assert(checkpoint.ok, 'checkpoint failed');
assert(checkpoint.checkpoint.settlementId === 'winterhold', 'checkpoint settlement mismatch');
assert(checkpoint.checkpoint.activeService === 'barracks', 'checkpoint active service mismatch');
expectFrozen(checkpoint, 'checkpoint');

const snapshotBeforeResume = session.snapshotState();
const resume = session.resume(checkpoint.checkpoint);
assert(resume.ok, 'resume failed');
assert(resume.view.activeService === 'barracks', 'resume did not restore active service');
assert(resume.view.panel === 'quests', 'resume did not restore service panel');
expectFrozen(resume, 'resume');

const mismatch = session.resume({ settlementId:'elsewhere', activeService:'gate', panel:'overview', sequence:1 });
assert(!mismatch.ok, 'settlement mismatch should be blocked');
assert(mismatch.reason === 'settlement-mismatch', 'settlement mismatch reason mismatch');

const queuePlan = session.queue([
  { id:'q1', intent:'talk', payload:{} },
  { id:'q2', intent:'trade', payload:{} },
  { id:'q3', intent:'save', payload:{} },
]);
assert(queuePlan.ok, 'queue planning failed');
assert(queuePlan.plans.length === 3, 'queue length mismatch');
assert(queuePlan.digest === digest(queuePlan.plans), 'queue digest mismatch');

const queueResult = await session.runQueue(false);
assert(queueResult.completed >= 2, 'queue did not execute expected actions');
assert(queueResult.results.length === 3, 'queue result count mismatch');
expectFrozen(queueResult, 'queueResult');

const outsideSession = createSettlementWorldCoverageSession({ initialState:{...initialState,inSettlement:false}, assets, handlers:makeHandlers([]) });
const outsideTalk = await outsideSession.execute('talk', {});
assert(!outsideTalk.ok, 'outside settlement talk must be blocked');
assert(outsideTalk.reason === 'outside-settlement', 'outside settlement reason mismatch');
const outsideExit = await outsideSession.execute('exit', {});
assert(outsideExit.ok, 'outside settlement exit should remain allowed');

const defeatedSession = createSettlementWorldCoverageSession({ initialState:{...initialState,health:0}, assets, handlers:makeHandlers([]) });
const defeatedTalk = await defeatedSession.execute('talk', {});
assert(!defeatedTalk.ok && defeatedTalk.reason === 'player-defeated', 'defeated dialogue should be blocked');
const defeatedExit = await defeatedSession.execute('exit', {});
assert(defeatedExit.ok, 'defeated exit should be allowed');

const saveDisabledSession = createSettlementWorldCoverageSession({ initialState:{...initialState,saveEnabled:false}, assets, handlers:makeHandlers([]) });
const saveDisabledCheckpoint = saveDisabledSession.checkpoint({ reason:'save-disabled-preflight' });
assert(saveDisabledCheckpoint.ok, 'checkpoint projection must remain read-only even when save authority is disabled');
assert(saveDisabledCheckpoint.view.save.canSave === false, 'save availability should report disabled');

const fatiguedSession = createSettlementWorldCoverageSession({ initialState:{...initialState,fatigue:94}, assets, handlers:makeHandlers([]) });
const trainBlocked = await fatiguedSession.execute('train', {});
assert(!trainBlocked.ok && trainBlocked.reason === 'too-fatigued', 'high fatigue training guard failed');
const restFromFatigue = await fatiguedSession.execute('rest', {});
assert(restFromFatigue.ok, 'high fatigue rest should be allowed');

const restedSession = createSettlementWorldCoverageSession({ initialState:{...initialState,fatigue:0,survival:{...initialState.survival,exposure:0,morale:0}}, assets, handlers:makeHandlers([]) });
const uselessRest = await restedSession.execute('rest', {});
assert(!uselessRest.ok && uselessRest.reason === 'nothing-to-recover', 'unnecessary rest guard failed');

const travelSession = createSettlementWorldCoverageSession({ initialState:{...initialState,copper:120}, assets, handlers:makeHandlers([]) });
const travelReady = travelSession.readiness('travel', { routeId:'north_gate', cost:18, fatigue:12 });
assert(travelReady.ready, `travel should be ready: ${travelReady.reason}`);
const travelResult = await travelSession.execute('travel', { routeId:'north_gate', cost:18, fatigue:12 });
assert(travelResult.ok, 'travel should execute');
assert(travelResult.view.player.inSettlement === false, 'travel should move coverage context outside settlement');
assert(travelResult.receipt.copperDelta === -18, 'travel copper receipt mismatch');

const expensiveTravel = createSettlementWorldCoverageSession({ initialState:{...initialState,copper:5}, assets, handlers:makeHandlers([]) });
const expensive = await expensiveTravel.execute('travel', { routeId:'winter_pass', cost:34, fatigue:24 });
assert(!expensive.ok && expensive.reason === 'insufficient-copper', 'travel affordability guard failed');

const badHandlerLog = [];
const throwing = createSettlementWorldCoverageSession({
  initialState,
  assets,
  handlers:{ talk:()=>{ badHandlerLog.push('talk'); throw new Error('synthetic failure'); } },
});
const thrown = await throwing.execute('talk', {});
assert(!thrown.ok && thrown.reason === 'handler-threw', 'handler throw must fail closed');
assert(badHandlerLog.length === 1, 'throwing handler did not execute exactly once');

const reject = createSettlementWorldCoverageSession({
  initialState,
  assets,
  handlers:{ talk:()=>({ ok:false, reason:'npc-busy' }) },
});
const rejected = await reject.execute('talk', {});
assert(!rejected.ok && rejected.reason === 'npc-busy', 'handler rejection reason must propagate');

const disposeSession = createSettlementWorldCoverageSession({ initialState, assets });
assert(disposeSession.dispose() === true, 'first dispose should return true');
assert(disposeSession.dispose() === false, 'second dispose should return false');
const disposed = await disposeSession.execute('talk', {});
assert(!disposed.ok && disposed.reason === 'disposed', 'disposed session should fail closed');

const stateClone = session.snapshotState();
assert(JSON.stringify(stateClone.player) !== '"undefined"', 'snapshot player missing');
assert(stateClone.digest === digest({
  state:{ revision:stateClone.revision, sequence:stateClone.sequence, activeService:stateClone.activeService, panel:stateClone.panel, history:stateClone.history, receipts:stateClone.receipts, intents:stateClone.intents, checkpoint:stateClone.checkpoint, disposed:false },
  snapshot:stateClone.player,
}), 'snapshot digest must be deterministic for normalized state');
expectFrozen(stateClone, 'snapshotState');

const assetPointerPlan = createSettlementWorldCoveragePlan({ snapshot:initialState, assets:assets.filter((asset)=>asset.status==='pointer') });
assert(assetPointerPlan.assetCoverage.every((entry)=>entry.status === 'partial' || entry.status === 'unobserved'), 'pointer-only asset input must not be treated as missing');
assert(assetPointerPlan.assetCoverage.every((entry)=>entry.pointer >= 0), 'pointer evidence must be preserved');

const missingAssetProof = createSettlementWorldCoverageAcceptance({
  settlementId:'winterhold',
  assets:[{ id:'real-door', family:'settlements', status:'loaded', hydrated:true }],
  materials:[], manifests:[], placements:[], cameras:[], interactions:[],
});
assert(missingAssetProof.assets.length === 1, 'acceptance assets normalize incorrectly');
assert(missingAssetProof.status === 'blocked' || missingAssetProof.status === 'warning', 'sparse acceptance should not be green');

const completeAcceptanceInput = {
  settlementId:'winterhold',
  assets:assets,
  materials:[
    { id:'wall-a', role:'wall', kind:'pbr', textured:true, textureSize:2048 },
    { id:'roof-a', role:'roof', kind:'pbr', textured:true, textureSize:2048 },
    { id:'wood-a', role:'wood', kind:'pbr', textured:true, textureSize:1024 },
    { id:'door-a', role:'door', kind:'pbr', textured:true, textureSize:1024 },
    { id:'window-a', role:'window', kind:'pbr', textured:true, textureSize:1024 },
    { id:'metal-a', role:'metal', kind:'pbr', textured:true, textureSize:1024 },
    { id:'trim-a', role:'stone-trim', kind:'pbr', textured:true, textureSize:2048 },
  ],
  manifests:[{ id:'gate-manifest', assetId:'door-north', serviceId:'gate', materialManifestId:'gate-materials', surfaceRoles:SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API.materialRoles, materialIds:['wall-a','roof-a','wood-a','door-a','window-a','metal-a','trim-a'], placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true }],
  placements:[{ id:'gate-placement', assetId:'door-north', serviceId:'gate', status:'attached', manifestId:'gate-manifest', materialManifestId:'gate-materials', position:{x:0,y:0,z:0}, groundPosition:{x:0,y:0,z:0}, expectedGroundY:0, slope:5, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false }],
  cameras:[
    { profile:'full-world', width:1536, height:1024, projection:'orthographic', readable:true },
    { profile:'settlement-far', width:1536, height:1024, projection:'orthographic', readable:true },
    { profile:'settlement-center', width:1536, height:1024, projection:'orthographic', readable:true },
    { profile:'settlement-northwest', width:1536, height:1024, projection:'orthographic', readable:true },
  ],
  interactions:[
    { id:'i1', serviceId:'gate', action:'enter', ok:true, sequence:1, at:1 },
    { id:'i2', serviceId:'market', action:'trade', ok:true, sequence:2, at:2 },
  ],
};
const acceptance = createSettlementWorldCoverageAcceptance(completeAcceptanceInput);
assert(acceptance.manifests.invalidCount === 0, 'complete manifest should be valid');
assert(acceptance.placements.invalidCount === 0, 'complete placement should be valid');
assert(acceptance.cameras.valid, 'complete camera evidence should be valid');
assert(acceptance.interactions.valid, 'complete interaction evidence should be valid');
expectFrozen(acceptance, 'acceptance');
const acceptanceAgain = createSettlementWorldCoverageAcceptance(deepClone(completeAcceptanceInput));
assert(acceptance.fingerprint === acceptanceAgain.fingerprint, 'acceptance fingerprint must be deterministic');
const acceptanceValidation = validateSettlementWorldCoverageAcceptance(completeAcceptanceInput);
assert(acceptanceValidation.ok, `complete acceptance rejected: ${acceptanceValidation.errors.join(',')}`);
const proof = createSettlementWorldCoverageProof(completeAcceptanceInput);
assert(proof.fingerprint, 'coverage proof fingerprint missing');
assert(proof.acceptance.status === 'green', 'complete coverage proof should be green');
assert(proof.assetProof.missing === 0, 'coverage proof must report missing assets as zero');
assert(proof.materialProof.placeholderCount === 0, 'coverage proof must report placeholder materials as zero');
assert(proof.materialProof.missingMaterialCount === 0, 'coverage proof must report missing materials as zero');
assert(proof.placementProof.invalidCount === 0, 'coverage proof must report valid placement');
expectFrozen(proof, 'proof');

const invalidCamera = createSettlementWorldCoverageAcceptance({ ...completeAcceptanceInput, cameras:[{ profile:'full-world', width:1, height:1, projection:'perspective', readable:false, blackSkyRisk:true }] });
assert(!invalidCamera.cameras.valid, 'invalid camera evidence must fail');
const invalidPlacement = createSettlementWorldCoverageAcceptance({ ...completeAcceptanceInput, placements:[{ ...completeAcceptanceInput.placements[0], grounded:false, overlapRisk:true, status:'attached' }] });
assert(invalidPlacement.placements.invalidCount === 1, 'invalid placement must be detected');
const invalidMaterials = createSettlementWorldCoverageAcceptance({ ...completeAcceptanceInput, manifests:[{ ...completeAcceptanceInput.manifests[0], placeholderCount:1, missingMaterialCount:2, singleSurfaceRisk:true }] });
assert(invalidMaterials.manifests.invalidCount === 1, 'invalid material manifest must be detected');

assert(SETTLEMENT_WORLD_COVERAGE_API.services.length === SETTLEMENT_WORLD_COVERAGE_LIMITS.services, 'API/service limits drift');
assert(SETTLEMENT_WORLD_COVERAGE_API.intents.includes('craft'), 'craft intent missing');
assert(SETTLEMENT_WORLD_COVERAGE_API.intents.includes('travel'), 'travel intent missing');
assert(SETTLEMENT_WORLD_COVERAGE_API.panels.includes('equipment'), 'equipment panel missing');
assert(SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API.materialRoles.includes('stone-trim'), 'stone trim role missing');

console.log('Settlement World Coverage Slice: PASS');
console.log(JSON.stringify({
  services:plan.services.map((service)=>({id:service.id,status:service.status,coverage:service.assetCoverage.status})),
  sessionFingerprint:session.snapshotState().digest,
  acceptanceFingerprint:acceptance.fingerprint,
  proofFingerprint:proof.fingerprint,
  acceptanceStatus:acceptance.status,
  acceptanceScore:acceptance.score,
  handlerEvents:handlerLog.length,
  historyEntries:session.view().history.length,
}, null, 2));
