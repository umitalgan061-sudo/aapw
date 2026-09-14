/**
 * Settlement world coverage runtime slice.
 *
 * This is an additive orchestration seam over the authored settlement content
 * registry. It does not own the authoritative QuestSystem, inventory, economy,
 * crafting, travel, persistence, NPC, terrain, scene or model-placement state.
 *
 * Model-bearing callers must continue to use the merged MaterialAssignmentCore
 * + WorldAssetPlacementPipeline sequence. Asset observations in this module
 * are evidence only: LFS pointer state is preserved as `pointer`, while
 * `missing` means an actually absent caller observation.
 */
import {
  SETTLEMENT_CONTENT_VERSION,
  SETTLEMENT_CONTENT_LIMITS,
  createSettlementContentManifest,
  getSettlementService,
  getSettlementItem,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementDialogueCondition,
  getSettlementQuestObjective,
  getSettlementUxMessage,
  resolveTradeQuote,
  resolveCraftingRecipe,
  resolveTravelCost,
  validateSettlementContent,
} from './settlementCampaignContent.js';

export const SETTLEMENT_WORLD_COVERAGE_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_LIMITS = Object.freeze({
  history: 48,
  intents: 48,
  services: 8,
  assets: 64,
  objectives: 32,
  receipts: 32,
  panels: 12,
  text: 180,
});
export const SETTLEMENT_WORLD_COVERAGE_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_VERSION,
  services: Object.freeze(['gate','market','tavern','blacksmith','farm','barracks','stable','house']),
  intents: Object.freeze(['enter','exit','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save']),
  panels: Object.freeze(['overview','trade','craft','quests','dialogue','travel','equipment','rest','save']),
});

const SERVICE_META = Object.freeze({
  gate: Object.freeze({ role: 'door', domain: 'travel', panels: ['overview','travel'], intents: ['enter','exit','travel'], evidence: ['door','road'] }),
  market: Object.freeze({ role: 'vendor', domain: 'trade', panels: ['overview','trade'], intents: ['talk','trade','buy','sell'], evidence: ['vendor','stall'] }),
  tavern: Object.freeze({ role: 'interior', domain: 'rest-dialogue', panels: ['overview','dialogue','quests','rest'], intents: ['talk','rest','acceptQuest','advanceQuest'], evidence: ['interior','npc'] }),
  blacksmith: Object.freeze({ role: 'crafting', domain: 'smithing', panels: ['overview','craft','equipment'], intents: ['talk','trade','craft','equip'], evidence: ['forge','workbench'] }),
  farm: Object.freeze({ role: 'interior', domain: 'survival', panels: ['overview','rest','travel'], intents: ['interact','trade','rest','travel'], evidence: ['field','barn'] }),
  barracks: Object.freeze({ role: 'interior', domain: 'training', panels: ['overview','quests','equipment'], intents: ['talk','train','acceptQuest','equip'], evidence: ['barracks','training'] }),
  stable: Object.freeze({ role: 'interior', domain: 'mount-travel', panels: ['overview','travel','rest'], intents: ['talk','trade','travel','rest'], evidence: ['stable','mount'] }),
  house: Object.freeze({ role: 'interior', domain: 'persistence', panels: ['overview','equipment','rest','save'], intents: ['interact','talk','save','rest'], evidence: ['house','bed'] }),
});

const SERVICE_IDS = SETTLEMENT_WORLD_COVERAGE_API.services;
const INTENT_IDS = SETTLEMENT_WORLD_COVERAGE_API.intents;
const PANEL_IDS = SETTLEMENT_WORLD_COVERAGE_API.panels;
const INTENT_SERVICE = Object.freeze({ enter:'gate', exit:'gate', travel:'gate', talk:'tavern', trade:'market', buy:'market', sell:'market', craft:'blacksmith', equip:'blacksmith', acceptQuest:'tavern', advanceQuest:'tavern', rest:'tavern', train:'barracks', interact:'house', save:'house' });

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_WORLD_COVERAGE_LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const bool = (value, fallback = false) => value === undefined ? fallback : Boolean(value);
const list = (value) => Array.isArray(value) ? value : [];
const unique = (value) => [...new Set(list(value).map((item) => text(item)).filter(Boolean))];

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function normalizeSnapshot(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const map = (value, limit, normalize) => Object.fromEntries(Object.entries(value ?? {}).slice(0, limit).map(([key, item]) => [text(key), normalize(item)]));
  const quests = {};
  for (const [questId, quest] of Object.entries(source.quests ?? {}).slice(0, 64)) {
    const record = quest && typeof quest === 'object' ? quest : {};
    quests[text(questId)] = {
      state: text(record.state, 'unknown'),
      step: integer(record.step, 0, 999, 0),
      completed: bool(record.completed),
      rewardClaimed: bool(record.rewardClaimed),
      objectiveId: text(record.objectiveId),
    };
  }
  const health = Math.max(0, Math.min(100, finite(source.health, 100)));
  return {
    settlementId: text(source.settlementId, 'settlement'),
    locationId: text(source.locationId),
    inSettlement: source.inSettlement !== false,
    settlementOpen: source.settlementOpen !== false,
    defeated: bool(source.defeated) || health <= 0,
    saveEnabled: source.saveEnabled !== false,
    health,
    maxHealth: Math.max(1, Math.min(999, finite(source.maxHealth, 100))),
    copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    reputation: Math.max(-9999, Math.min(9999, finite(source.reputation, 0))),
    inventory: map(source.inventory, 96, (item) => integer(item, 0, 9999, 0)),
    equipment: map(source.equipment, 24, (item) => text(item)),
    skills: map(source.skills, 24, (item) => integer(item, 0, 999, 0)),
    flags: map(source.flags, 64, Boolean),
    quests,
    perks: unique(source.perks).slice(0, 48),
    survival: {
      hunger: Math.max(0, Math.min(100, finite(source.survival?.hunger, 0))),
      exposure: Math.max(0, Math.min(100, finite(source.survival?.exposure, 0))),
      morale: Math.max(-100, Math.min(100, finite(source.survival?.morale, 0))),
    },
  };
}

function normalizeAssetInventory(raw = []) {
  const rows = Array.isArray(raw)
    ? raw
    : Object.entries(raw ?? {}).flatMap(([family, items]) => list(items).map((item) => ({ ...item, family })));
  const seen = new Set();
  return rows.slice(0, SETTLEMENT_WORLD_COVERAGE_LIMITS.assets).map((rawAsset) => {
    const asset = rawAsset && typeof rawAsset === 'object' ? rawAsset : {};
    const assetId = text(asset.assetId ?? asset.id);
    const key = `${text(asset.family)}:${assetId}`;
    return {
      family: text(asset.family), assetId,
      status: ['ready','hydrated','loaded','pointer','missing'].includes(text(asset.status)) ? text(asset.status) : 'unknown',
      path: text(asset.path), format: text(asset.format),
      materialSlots: integer(asset.materialSlots, 0, 32, 0),
      textured: bool(asset.textured), grounded: bool(asset.grounded),
      key,
    };
  }).filter((asset) => asset.assetId && !seen.has(asset.key) && seen.add(asset.key));
}

function service(serviceId) {
  if (!SERVICE_IDS.includes(serviceId)) return null;
  const meta = SERVICE_META[serviceId];
  return deepFreeze({ id: serviceId, ...clone(meta) });
}

function assetCoverage(serviceId, assets) {
  const meta = SERVICE_META[serviceId];
  const relevant = assets.filter((asset) => ['settlements','houses','props'].includes(asset.family));
  const evidence = meta.evidence.map((token) => {
    const match = relevant.find((asset) => asset.assetId.toLowerCase().includes(token));
    return { id: token, ok: Boolean(match), assetId: match?.assetId ?? '', family: match?.family ?? '', status: match?.status ?? 'missing' };
  });
  return {
    status: evidence.every((item) => item.ok) ? 'covered' : relevant.length ? 'partial' : 'unobserved',
    total: relevant.length,
    ready: relevant.filter((asset) => ['ready','hydrated','loaded'].includes(asset.status)).length,
    pointer: relevant.filter((asset) => asset.status === 'pointer').length,
    missing: relevant.filter((asset) => asset.status === 'missing').length,
    grounded: relevant.filter((asset) => asset.grounded).length,
    textured: relevant.filter((asset) => asset.textured).length,
    evidence,
  };
}

function conditionState(conditionId, snapshot) {
  const condition = getSettlementDialogueCondition(conditionId);
  if (!condition) return { ok: false, reason: 'unknown-condition', condition: null };
  if (condition.type === 'flag') return { ok: snapshot.flags[condition.target] === true, reason: snapshot.flags[condition.target] === true ? '' : 'flag-required', condition };
  if (condition.type === 'reputation') return { ok: snapshot.reputation >= condition.threshold, reason: snapshot.reputation >= condition.threshold ? '' : 'reputation-too-low', condition };
  if (condition.type === 'quest') {
    const quest = snapshot.quests[condition.target];
    const ok = Boolean(quest?.completed) || quest?.state === 'completed';
    return { ok, reason: ok ? '' : 'quest-required', condition };
  }
  if (condition.type === 'item') {
    const ok = (snapshot.inventory[condition.target] ?? 0) >= condition.threshold;
    return { ok, reason: ok ? '' : 'item-required', condition };
  }
  if (condition.type === 'skill') {
    const ok = (snapshot.skills[condition.target] ?? 0) >= condition.threshold;
    return { ok, reason: ok ? '' : 'skill-required', condition };
  }
  return { ok: false, reason: 'unsupported-condition', condition };
}

function objectiveRow(questId, snapshot) {
  const quest = snapshot.quests[questId] ?? {};
  const objectiveId = text(quest.objectiveId, questId);
  const objective = getSettlementQuestObjective(objectiveId);
  const progress = integer(quest.step, 0, 999, 0);
  const target = integer(objective?.target, 1, 999, 1);
  const complete = Boolean(quest.completed) || progress >= target;
  return { id: objectiveId, questId, label: text(objective?.label, questId), action: text(objective?.action, 'advanceQuest'), progress, target, ratio: Math.min(1, progress / target), complete, reward: clone(objective?.reward) };
}

function gateReason(snapshot, intent, serviceId) {
  if (!INTENT_IDS.includes(intent)) return 'unknown-action';
  if (!snapshot.inSettlement && !['enter','exit'].includes(intent)) return 'outside-settlement';
  if (snapshot.defeated && !['save','exit'].includes(intent)) return 'player-defeated';
  if (intent === 'enter' && !snapshot.settlementOpen) return 'settlement-closed';
  if (intent === 'save' && !snapshot.saveEnabled) return 'save-disabled';
  if (!SERVICE_META[serviceId]?.intents.includes(intent)) return 'service-intent-unsupported';
  return '';
}

function quoteFor(snapshot, intent, payload) {
  if (['trade','buy','sell'].includes(intent)) {
    return resolveTradeQuote(text(payload.itemId), integer(payload.quantity, 1, 99, 1), intent === 'sell' ? 'sell' : text(payload.direction, 'buy'), {
      buyRate: snapshot.perks.includes('merchant_road') ? -0.04 : 0,
      sellRate: snapshot.perks.includes('market_eye') ? 0.05 : 0,
    });
  }
  if (intent === 'craft') return resolveCraftingRecipe(text(payload.recipeId), snapshot);
  if (intent === 'travel') {
    const rate = snapshot.perks.includes('roadwise') ? -0.07 : 0;
    return resolveTravelCost(text(payload.routeId), { costRate: rate, fatigueRate: rate });
  }
  return null;
}

function planAction(snapshot, intent, payload = {}) {
  const serviceId = INTENT_SERVICE[intent] ?? '';
  const baseReason = gateReason(snapshot, intent, serviceId);
  if (baseReason) return { ready: false, reason: baseReason, serviceId, panel: 'overview', quote: null };
  const quote = quoteFor(snapshot, intent, payload);
  if (['buy','sell','trade'].includes(intent)) {
    if (!quote?.ok) return { ready: false, reason: text(quote?.reason, 'trade-unavailable'), serviceId, panel: 'trade', quote };
    if (intent !== 'sell' && snapshot.copper < finite(quote.total, 0)) return { ready: false, reason: 'insufficient-copper', serviceId, panel: 'trade', quote };
  }
  if (intent === 'craft' && !quote?.ok) return { ready: false, reason: text(quote?.reason, 'craft-unavailable'), serviceId, panel: 'craft', quote };
  if (intent === 'travel') {
    if (!quote?.ok) return { ready: false, reason: text(quote?.reason, 'route-unavailable'), serviceId, panel: 'travel', quote };
    if (snapshot.copper < finite(quote.cost, 0)) return { ready: false, reason: 'insufficient-copper', serviceId, panel: 'travel', quote };
  }
  if (intent === 'train' && snapshot.fatigue > 85) return { ready: false, reason: 'too-fatigued', serviceId, panel: 'quests', quote: null };
  if (intent === 'rest' && snapshot.fatigue <= 0 && snapshot.survival.exposure <= 0 && snapshot.survival.morale >= 0) return { ready: false, reason: 'nothing-to-recover', serviceId, panel: 'rest', quote: null };
  const panel = ['trade','buy','sell','craft','travel','rest'].includes(intent) ? (intent === 'buy' || intent === 'sell' ? 'trade' : intent) : SERVICE_META[serviceId]?.panels[1] ?? 'overview';
  return { ready: true, reason: '', serviceId, panel, quote };
}

function serviceRows(snapshot, assets) {
  return SERVICE_IDS.map((serviceId, index) => {
    const meta = SERVICE_META[serviceId];
    const coverage = assetCoverage(serviceId, assets);
    const blocked = !snapshot.inSettlement && serviceId !== 'gate' ? 'outside-settlement' : snapshot.defeated && serviceId !== 'gate' ? 'player-defeated' : '';
    const readiness = planAction(snapshot, meta.intents[0], {});
    return {
      index, id: serviceId, label: text(serviceId), role: meta.role, domain: meta.domain,
      intents: [...meta.intents], panels: [...meta.panels], primaryIntent: meta.intents[0],
      status: blocked ? 'blocked' : coverage.status === 'covered' && readiness.ready ? 'ready' : coverage.status === 'partial' ? 'partial' : 'available-blocked',
      blockedReason: blocked || (readiness.ready ? '' : readiness.reason), assetCoverage: coverage,
    };
  });
}

function serviceSummary(rows) {
  return rows.reduce((result, row) => {
    const key = row.status === 'available-blocked' ? 'availableBlocked' : row.status;
    result[key] += 1;
    return result;
  }, { ready:0, blocked:0, partial:0, availableBlocked:0, unobserved:0 });
}

function tradeRows(snapshot) {
  return Object.keys(snapshot.inventory).slice(0, 24).map((itemId) => {
    const item = getSettlementItem(itemId);
    if (!item) return null;
    return { id:itemId, label:text(item.label,itemId), quantity:snapshot.inventory[itemId], buy:clone(resolveTradeQuote(itemId,1,'buy')), sell:clone(resolveTradeQuote(itemId,1,'sell')), weight:finite(item.weight,0) };
  }).filter(Boolean);
}
function craftRows(snapshot) {
  return ['iron_sword','iron_dagger','steel_buckle','linen_tunic','leather_gloves','travel_rations'].map((recipeId) => {
    const recipe = getSettlementRecipe(recipeId);
    if (!recipe) return null;
    const check = resolveCraftingRecipe(recipeId,snapshot);
    return { id:recipeId,label:text(recipe.label,recipeId),station:text(recipe.station,'blacksmith'),ready:Boolean(check?.ok),reason:text(check?.reason),missing:clone(check?.missing ?? []),xp:finite(recipe.xp,0),minutes:finite(recipe.minutes,0) };
  }).filter(Boolean);
}
function travelRows(snapshot) {
  return ['north_gate','river_market','hill_fort','old_mill','east_road','winter_pass'].map((routeId) => {
    const route = getSettlementRoute(routeId); if (!route) return null;
    const rate = snapshot.perks.includes('roadwise') ? -0.07 : 0;
    const quote = resolveTravelCost(routeId,{costRate:rate,fatigueRate:rate});
    return { id:routeId,label:text(route.label,routeId),destination:text(route.destination),checkpoint:text(route.checkpoint),risk:text(route.risk,'unknown'),quote:clone(quote),affordable:snapshot.copper>=finite(quote?.cost,0) };
  }).filter(Boolean);
}
function dialogueRows(snapshot) {
  const ids = ['tavern_greeting','tavern_quest','blacksmith_request','market_bargain','barracks_training','stable_route'];
  return ids.map((dialogueId) => {
    const source = getSettlementUxMessage(dialogueId) ?? { text: dialogueId.replace(/_/g,' ') };
    const conditionIds = unique(source.conditions ?? source.conditionIds).slice(0,8);
    const conditions = conditionIds.map((conditionId)=>({id:conditionId,...conditionState(conditionId,snapshot)}));
    return { id:dialogueId,label:text(source.label,dialogueId),text:text(source.text),available:conditions.every((check)=>check.ok),conditions };
  });
}
function equipmentRows(snapshot) {
  return Object.entries(snapshot.equipment).slice(0,24).map(([slot,itemId])=>{ const item=getSettlementItem(itemId); return {slot,itemId,label:text(item?.label,itemId||'empty'),known:Boolean(item),weight:finite(item?.weight,0),value:finite(item?.buy,0)}; });
}

function contentEvidence() {
  const validation = validateSettlementContent();
  const manifest = createSettlementContentManifest();
  return { contentVersion:SETTLEMENT_CONTENT_VERSION, limits:clone(SETTLEMENT_CONTENT_LIMITS), validation:clone(validation), manifestDigest:digest(manifest) };
}
function checkpointRecord(snapshot,state,metadata={}) {
  return deepFreeze({ version:1, settlementId:snapshot.settlementId, nodeId:state.activeService, activeService:state.activeService, panel:state.panel, sequence:state.sequence, stepIndex:state.sequence, savedAt:0, metadata:clone(metadata) });
}

function buildView(state,snapshot,assets) {
  const services = serviceRows(snapshot,assets);
  const objectives = Object.keys(snapshot.quests).slice(0,SETTLEMENT_WORLD_COVERAGE_LIMITS.objectives).map((questId)=>objectiveRow(questId,snapshot));
  const view = {
    version:SETTLEMENT_WORLD_COVERAGE_VERSION, contentVersion:SETTLEMENT_CONTENT_VERSION, settlementId:snapshot.settlementId, locationId:snapshot.locationId,
    activeService:state.activeService, panel:state.panel, sequence:state.sequence,
    currentService:service(state.activeService), services, serviceSummary:serviceSummary(services),
    trade:tradeRows(snapshot), craft:craftRows(snapshot), travel:travelRows(snapshot), quests:objectives, dialogue:dialogueRows(snapshot), equipment:equipmentRows(snapshot),
    rest:{fatigue:snapshot.fatigue,exposure:snapshot.survival.exposure,morale:snapshot.survival.morale,canRest:snapshot.inSettlement&&!snapshot.defeated&&(snapshot.fatigue>0||snapshot.survival.exposure>0||snapshot.survival.morale<0),suggestedService:snapshot.fatigue>=60?'tavern':'house'},
    save:{canSave:snapshot.saveEnabled&&snapshot.inSettlement&&!snapshot.defeated,reason:!snapshot.saveEnabled?'save-disabled':snapshot.defeated?'player-defeated':!snapshot.inSettlement?'outside-settlement':'',checkpoint:clone(state.checkpoint)},
    history:clone(state.history), receipts:clone(state.receipts), assetCoverage:services.map((row)=>({serviceId:row.id,...row.assetCoverage})),
    metrics:{visitedServices:new Set(state.history.map((entry)=>entry.serviceId).filter(Boolean)).size,interactionCount:state.history.length,completedObjectives:objectives.filter((row)=>row.complete).length,objectiveCount:objectives.length},
    content:contentEvidence(), player:{inSettlement:snapshot.inSettlement,defeated:snapshot.defeated,health:snapshot.health,fatigue:snapshot.fatigue,copper:snapshot.copper,reputation:snapshot.reputation},
  };
  return deepFreeze({...view,fingerprint:digest(view)});
}

export function createSettlementWorldCoveragePlan(input={}) {
  const snapshot=normalizeSnapshot(input.snapshot??input.player??{}); const assets=normalizeAssetInventory(input.assets);
  const services=serviceRows(snapshot,assets); const plan={version:1,contentVersion:SETTLEMENT_CONTENT_VERSION,settlementId:snapshot.settlementId,locationId:snapshot.locationId,services,serviceSummary:serviceSummary(services),nextService:services.find((row)=>row.status==='ready')??services.find((row)=>row.status==='partial')??services[0]??null,assetCoverage:services.map((row)=>({serviceId:row.id,...row.assetCoverage})),objectives:Object.keys(snapshot.quests).slice(0,32).map((questId)=>objectiveRow(questId,snapshot)),player:{inSettlement:snapshot.inSettlement,defeated:snapshot.defeated,health:snapshot.health,fatigue:snapshot.fatigue,copper:snapshot.copper},content:contentEvidence()};
  return deepFreeze({...plan,fingerprint:digest(plan)});
}
export function validateSettlementWorldCoveragePlan(input={}) {
  const plan=createSettlementWorldCoveragePlan(input); const errors=[];
  if(plan.services.length!==SETTLEMENT_WORLD_COVERAGE_LIMITS.services) errors.push('service-count');
  if(new Set(plan.services.map((row)=>row.id)).size!==plan.services.length) errors.push('duplicate-service');
  for(const row of plan.services){ if(!row.intents.length) errors.push(`missing-intent:${row.id}`); if(!row.assetCoverage) errors.push(`missing-asset-coverage:${row.id}`); }
  return deepFreeze({ok:errors.length===0,errors,fingerprint:digest(plan)});
}

export function createSettlementWorldCoverageSession(options={}) {
  let snapshot=normalizeSnapshot(options.initialState??{}); const assets=normalizeAssetInventory(options.assets); const handlers=options.handlers&&typeof options.handlers==='object'?options.handlers:{}; const now=typeof options.now==='function'?options.now:()=>Date.now();
  let state={revision:0,sequence:0,activeService:'gate',panel:'overview',history:[],receipts:[],intents:[],checkpoint:null,disposed:false};
  const historyLimit=integer(options.historyLimit,1,48,48); const receiptLimit=integer(options.receiptLimit,1,32,32);
  const push=(entry)=>{const sequence=state.sequence+1; const record={sequence,at:finite(now(),0),...clone(entry)}; state={...state,sequence,revision:state.revision+1,history:[...state.history,record].slice(-historyLimit)}; return record;};
  const blocked=(intent,reason,serviceId=INTENT_SERVICE[intent]??'')=>{push({intent,serviceId,panel:state.panel,ok:false,reason,nodeId:state.activeService}); return deepFreeze({ok:false,intent,reason,serviceId,view:buildView(state,snapshot,assets)});};
  const readiness=(intent,payload={})=>deepFreeze({intent,payload:clone(payload),...planAction(snapshot,intent,payload)});
  const open=(serviceId,panel='overview')=>{ const target=service(text(serviceId)); if(!target) return blocked('interact','unknown-service'); const next=SERVICE_META[target.id].panels.includes(panel)?panel:'overview'; state={...state,revision:state.revision+1,activeService:target.id,panel:next}; push({intent:'interact',serviceId:target.id,panel:next,ok:true,reason:'',nodeId:target.id}); return deepFreeze({ok:true,serviceId:target.id,panel:next,view:buildView(state,snapshot,assets)}); };
  const setPanel=(panel)=>{ const next=PANEL_IDS.includes(panel)?panel:'overview'; if(!SERVICE_META[state.activeService]?.panels.includes(next)&&next!=='overview') return blocked('interact','panel-not-supported',state.activeService); state={...state,revision:state.revision+1,panel:next}; push({intent:'interact',serviceId:state.activeService,panel:next,ok:true,reason:'',nodeId:state.activeService}); return deepFreeze({ok:true,panel:next,view:buildView(state,snapshot,assets)}); };
  const execute=async(intent,payload={})=>{ if(state.disposed)return blocked(intent,'disposed'); if(!INTENT_IDS.includes(intent))return blocked(intent,'unknown-action'); const plan=readiness(intent,payload); if(!plan.ready)return blocked(intent,plan.reason,plan.serviceId); let result; try{result=typeof handlers[intent]==='function'?await handlers[intent]({intent,payload:clone(payload),snapshot:clone(snapshot),plan:clone(plan)}):{ok:true,...plan};}catch{return blocked(intent,'handler-threw',plan.serviceId);} if(result?.ok===false)return blocked(intent,text(result.reason,'action-rejected'),plan.serviceId); if(intent==='rest')snapshot=normalizeSnapshot({...snapshot,fatigue:Math.max(0,snapshot.fatigue+finite(result.fatigueDelta,-20)),survival:{...snapshot.survival,exposure:Math.max(0,snapshot.survival.exposure-12)}}); if(intent==='train')snapshot=normalizeSnapshot({...snapshot,fatigue:Math.min(100,snapshot.fatigue+8)}); if(intent==='talk')snapshot=normalizeSnapshot({...snapshot,reputation:Math.min(9999,snapshot.reputation+1)}); if(intent==='travel')snapshot=normalizeSnapshot({...snapshot,copper:Math.max(0,snapshot.copper-finite(plan.quote?.cost,0)),fatigue:Math.min(100,snapshot.fatigue+finite(plan.quote?.fatigue,0)),locationId:text(plan.quote?.destination,plan.quote?.routeId,snapshot.locationId),inSettlement:false}); push({intent,serviceId:plan.serviceId,panel:plan.panel,ok:true,reason:'',nodeId:plan.serviceId}); const receipt=deepFreeze({id:`receipt-${state.sequence}`,intent,serviceId:plan.serviceId,ok:true,copperDelta:intent==='travel'?-finite(plan.quote?.cost,0):0,xpDelta:['craft','train','advanceQuest'].includes(intent)?8:0,fatigueDelta:intent==='rest'?-20:intent==='train'?8:intent==='travel'?finite(plan.quote?.fatigue,0):0,reputationDelta:intent==='talk'?1:0}); state={...state,revision:state.revision+1,receipts:[...state.receipts,receipt].slice(-receiptLimit),activeService:plan.serviceId||state.activeService,panel:plan.panel||state.panel}; return deepFreeze({ok:true,intent,serviceId:plan.serviceId,receipt,view:buildView(state,snapshot,assets)}); };
  const queue=(items=[])=>{ const plans=list(items).slice(0,48).map((item)=>readiness(text(item?.intent),item?.payload??{})); state={...state,revision:state.revision+1,intents:plans}; return deepFreeze({ok:true,plans,digest:digest(plans)}); };
  const runQueue=async(stopOnFailure=true)=>{const results=[]; for(const item of state.intents){const result=await execute(item.intent,item.payload??{});results.push(result);if(stopOnFailure&&!result.ok)break;} return deepFreeze({ok:results.every((result)=>result.ok),completed:results.filter((result)=>result.ok).length,blocked:results.filter((result)=>!result.ok).length,results,view:buildView(state,snapshot,assets)});};
  const checkpoint=(metadata={})=>{const value=checkpointRecord(snapshot,state,metadata);state={...state,revision:state.revision+1,checkpoint:value};return deepFreeze({ok:true,checkpoint:value,view:buildView(state,snapshot,assets)});};
  const resume=(raw={})=>{const restored=clone(raw)||{}; if(text(restored.settlementId,'settlement')!==snapshot.settlementId)return blocked('save','settlement-mismatch','house'); if(!service(text(restored.activeService,'gate')))return blocked('save','service-unavailable','house'); state={...state,revision:state.revision+1,sequence:Math.max(state.sequence,integer(restored.sequence,0,999999,0)),activeService:text(restored.activeService,'gate'),panel:PANEL_IDS.includes(text(restored.panel))?text(restored.panel):'overview',checkpoint:deepFreeze(restored)}; return deepFreeze({ok:true,checkpoint:state.checkpoint,view:buildView(state,snapshot,assets)}); };
  const snapshotState=()=>deepFreeze({version:1,revision:state.revision,sequence:state.sequence,activeService:state.activeService,panel:state.panel,history:clone(state.history),receipts:clone(state.receipts),intents:clone(state.intents),checkpoint:clone(state.checkpoint),player:clone(snapshot),digest:digest({state,snapshot})});
  const view=()=>buildView(state,snapshot,assets); const dispose=()=>{if(state.disposed)return false;state={...state,disposed:true,revision:state.revision+1,intents:[]};return true;};
  return Object.freeze({readiness,open,setPanel,execute,queue,runQueue,checkpoint,resume,snapshotState,view,dispose});
}
