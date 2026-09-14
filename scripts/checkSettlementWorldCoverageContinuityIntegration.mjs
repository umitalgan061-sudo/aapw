import { strict as assert } from 'node:assert';
import { createSettlementWorldCoverageRuntimeAdapter } from '../src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js';
import { createSettlementWorldCoverageContinuitySession } from '../src/3d/gameplay/settlementWorldCoverageContinuity.js';
import { createSettlementWorldCoverageContinuityPlan } from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';
import { validateSettlementWorldCoverageContinuityAudit } from '../src/3d/gameplay/settlementWorldCoverageContinuityAudit.js';
import { validateSettlementWorldCoverageContinuityCatalogue } from '../src/3d/gameplay/settlementWorldCoverageContinuityCatalog.js';

const settlement = {
  id: 'winterhold', regionId: 'north_temperate_forest',
  anchor: { x: 512, y: 18, z: 768 }, entrance: { x: 520, y: 18, z: 768 },
  services: ['gate','market','tavern','blacksmith','farm','barracks','stable','house'],
};
const surface = { biome: 'north-temperate', layer: 'forest', moisture: .68, elevationMeters: 312, slopeDegrees: 7, roadDistanceMeters: 10 };
const player = { position: { x: 538, y: 18, z: 768 }, inSettlement: false, settlementOpen: true, health: 92, maxHealth: 100, fatigue: 36, copper: 240 };
const assets = [
  ['settlements','door-north'], ['settlements','road-east'], ['settlements','vendor-market'], ['settlements','stall-market'],
  ['houses','interior-tavern'], ['props','npc-tavern'], ['settlements','forge-blacksmith'], ['props','workbench-blacksmith'],
  ['settlements','field-farm'], ['settlements','barn-farm'], ['houses','barracks-main'], ['props','training-barracks'],
  ['settlements','stable-main'], ['props','mount-stable'], ['houses','house-main'], ['props','bed-house'],
].map(([family, assetId]) => ({ family, assetId, status:'loaded', hydrated:true, materialSlots:4, textured:true, grounded:true }));
const materials = ['wall','roof','wood','door','window','metal','stone-trim'].map((role) => ({ id:`${role}-m`, role, kind:'pbr', textured:true, textureSize:1024 }));
const manifests = settlement.services.map((serviceId) => ({
  id:`${serviceId}-manifest`, assetId:assets.find((asset) => asset.assetId.startsWith(serviceId === 'gate' ? 'door' : serviceId === 'market' ? 'vendor' : serviceId === 'tavern' ? 'interior' : serviceId === 'blacksmith' ? 'forge' : serviceId === 'farm' ? 'field' : serviceId === 'barracks' ? 'barracks' : serviceId === 'stable' ? 'stable' : 'house'))?.assetId ?? 'door-north',
  serviceId, materialManifestId:`${serviceId}-materials`, status:'validated', surfaceRoles:['wall','roof','wood','door','window','metal','stone-trim'], materialIds:materials.map((m) => m.id), placeholderCount:0, missingMaterialCount:0, singleSurfaceRisk:false, groundAligned:true, sceneAttached:true,
}));
const placements = manifests.map((manifest) => ({ id:`${manifest.serviceId}-placement`, assetId:manifest.assetId, serviceId:manifest.serviceId, status:'attached', manifestId:manifest.id, materialManifestId:manifest.materialManifestId, position:{x:0,y:0,z:0}, groundPosition:{x:0,y:0,z:0}, expectedGroundY:0, slope:5, scale:{x:1,y:1,z:1}, visible:true, collisionReady:true, materialValidated:true, grounded:true, overlapRisk:false }));
const cameras = ['full-world','settlement-far','settlement-center','settlement-northwest'].map((profile) => ({ profile, width:1536, height:1024, projection:'orthographic', readable:true }));
const interactions = settlement.services.map((serviceId, index) => ({ id:`i-${index}`, serviceId, action:'interact', ok:true, sequence:index + 1, at:index + 1 }));
const proofOptions = { settlementId:settlement.id, assets, materials, manifests, placements, cameras, interactions };

const catalog = validateSettlementWorldCoverageContinuityCatalogue();
assert.equal(catalog.ok, true);
assert.equal(catalog.count, 560);

const runtimeState = {
  settlementId:'winterhold', locationId:'winterhold-gate', inSettlement:true, settlementOpen:true,
  health:92, maxHealth:100, copper:240, fatigue:36, reputation:3, saveEnabled:true,
  inventory:{ bread:5, iron_ore:10, coal:5, leather:4 }, equipment:{ mainHand:'iron_sword' },
  skills:{ smithing:4, commerce:4, survival:4 }, perks:['roadwise','merchant_road'], quests:{}, flags:{ gate_open:true }, survival:{ hunger:20, exposure:3, morale:4 },
};
const handlerLog = [];
const runtime = {
  snapshot: () => ({ ...runtimeState }),
  talk: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'tavern' }; },
  enterSettlement: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'gate' }; },
  exitSettlement: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'gate' }; },
  trade: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'market' }; },
  buy: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'market' }; },
  sell: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'market' }; },
  craft: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'blacksmith' }; },
  equip: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'blacksmith' }; },
  acceptQuest: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'tavern' }; },
  advanceQuest: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'tavern' }; },
  travel: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'gate' }; },
  rest: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'tavern', fatigueDelta:-10 }; },
  train: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'barracks' }; },
  save: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'house' }; },
  interact: ({ intent }) => { handlerLog.push(intent); return { ok:true, serviceId:'house' }; },
  getAssetEvidence: () => assets,
  getMaterialEvidence: () => materials,
  getMaterialManifests: () => manifests,
  getPlacementEvidence: () => placements,
  getCameraEvidence: () => cameras,
  getInteractionEvidence: () => interactions,
};

const events = [];
const adapter = createSettlementWorldCoverageRuntimeAdapter(runtime, { ...proofOptions, settlementId:'winterhold', onEvent:(event) => events.push(event) });
assert.equal(adapter.valid, true);
const start = adapter.state();
assert.equal(start.view.services.length, 8);
assert.equal(start.view.settlementId, 'winterhold');

const market = await adapter.enter('market', 'trade');
assert.equal(market.ok, true);
assert.equal(market.view.panel, 'trade');
const purchase = await adapter.buy('bread', 1);
assert.equal(purchase.ok, true);
const forge = await adapter.enter('blacksmith', 'craft');
assert.equal(forge.ok, true);
const forged = await adapter.craft('iron_sword');
assert.equal(forged.ok, true);
assert.ok(handlerLog.includes('buy'));
assert.ok(handlerLog.includes('craft'));
assert.ok(events.length >= 3);
assert.ok(events.every((event) => Number.isFinite(event.sequence)));

const verification = adapter.verify();
assert.equal(verification.acceptance.status, 'green');
assert.equal(verification.acceptance.score, 1);
assert.equal(verification.planValidation.ok, true);
const verificationAgain = adapter.verify();
assert.equal(verification.fingerprint, verificationAgain.fingerprint);

const bridgeSession = createSettlementWorldCoverageContinuitySession({
  settlement,
  initialPlayer: player,
  surface,
  regionId: settlement.regionId,
  seed: 7733,
  now: () => 1700000000000,
});
const before = bridgeSession.transition();
assert.equal(before.transition.gatewayState, 'available');
const enter = bridgeSession.enter();
assert.equal(enter.ok, true);
assert.equal(enter.player.inSettlement, true);
const bridgeCheckpoint = bridgeSession.checkpoint({ from:'integration' });
assert.equal(bridgeCheckpoint.ok, true);
const moved = bridgeSession.move({ position:{ x:700, y:18, z:768 }, inSettlement:false, health:92 });
assert.equal(moved.ok, true);
const resume = bridgeSession.resume(bridgeCheckpoint.checkpoint);
assert.equal(resume.ok, true);
assert.equal(resume.checkpoint.settlementId, 'winterhold');

const plan = createSettlementWorldCoverageContinuityPlan({ settlement, player, surface, regionId:settlement.regionId, seed:7733 });
assert.equal(plan.catalogue.count, 560);
assert.equal(plan.stage, 'threshold');
assert.equal(plan.gatewayState, 'available');
assert.equal(plan.serviceRecommendations.length, 8);
assert.equal(plan.recommendedService.serviceId, 'market');

const audit = validateSettlementWorldCoverageContinuityAudit({ settlement, player, surface, regionId:settlement.regionId, seed:7733 });
assert.equal(audit.ok, true, audit.errors.join(','));
assert.equal(audit.report.services.count, 8);
assert.equal(audit.matrix.rowCount, 8);

const strippedRuntime = { execute: async () => ({ ok:true }) };
const strippedAdapter = createSettlementWorldCoverageRuntimeAdapter(strippedRuntime, { initialState: runtimeState, settlementId:'winterhold' });
assert.equal(strippedAdapter.valid, true);
const sparse = strippedAdapter.verify();
assert.notEqual(sparse.acceptance.status, 'green');

const wrongSettlementCheckpoint = bridgeSession.resume({ ...bridgeCheckpoint.checkpoint, settlementId:'other-settlement' });
assert.equal(wrongSettlementCheckpoint.ok, false);
assert.equal(wrongSettlementCheckpoint.reason, 'settlement-mismatch');

const final = adapter.state();
assert.equal(final.disposed, false);
assert.ok(final.sequence >= start.sequence);
assert.ok(final.session.history.length >= 1);
assert.equal(adapter.dispose(), true);
assert.equal(adapter.dispose(), false);
const afterDispose = await adapter.interact('talk', {});
assert.equal(afterDispose.ok, false);
assert.equal(afterDispose.reason, 'disposed');

console.log('Settlement World Coverage Continuity Integration: PASS');
console.log(JSON.stringify({ adapterFingerprint:verification.fingerprint, continuityPlan:plan.fingerprint, auditFingerprint:audit.fingerprint, events:events.length, handlerEvents:handlerLog.length }));
