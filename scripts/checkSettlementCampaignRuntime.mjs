import { strict as assert } from 'node:assert';
import { createSettlementCampaignRuntime } from '../src/3d/gameplay/settlementCampaignRuntime.js';
import {
  SETTLEMENT_CONTENT_LIMITS, createSettlementContentManifest, listSettlementServices,
  listSettlementItems, listSettlementRecipes, listSettlementRoutes, listSettlementPerks,
  listSettlementDialogueConditions, listSettlementQuestObjectives, listSettlementUxMessages,
  listSettlementSaveMigrations, getSettlementService, getSettlementItem, getSettlementRecipe,
  getSettlementRoute, getSettlementPerk, getSettlementDialogueCondition, getSettlementQuestObjective,
  getSettlementUxMessage, getSettlementSaveMigration, resolveCraftingRecipe, resolveTradeQuote,
  resolveTravelCost, validateSettlementContent,
} from '../src/3d/gameplay/settlementCampaignContent.js';
import { evaluateSettlementGate, createSettlementVerticalSlice } from '../src/3d/gameplay/settlementVerticalSlice.js';

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const content = createSettlementContentManifest();
const validation = validateSettlementContent();
equal(validation.ok, true, 'content-valid');
equal(content.version, 2, 'content-version');
equal(listSettlementServices().length, SETTLEMENT_CONTENT_LIMITS.services, 'service-count');
equal(listSettlementItems().length, SETTLEMENT_CONTENT_LIMITS.items, 'item-count');
equal(listSettlementRecipes().length, SETTLEMENT_CONTENT_LIMITS.recipes, 'recipe-count');
equal(listSettlementRoutes().length, SETTLEMENT_CONTENT_LIMITS.routes, 'route-count');
equal(listSettlementPerks().length, SETTLEMENT_CONTENT_LIMITS.perks, 'perk-count');
equal(listSettlementDialogueConditions().length, SETTLEMENT_CONTENT_LIMITS.dialogueConditions, 'dialogue-condition-count');
equal(listSettlementQuestObjectives().length, SETTLEMENT_CONTENT_LIMITS.questObjectives, 'quest-objective-count');
equal(listSettlementUxMessages().length, SETTLEMENT_CONTENT_LIMITS.uxMessages, 'ux-message-count');
equal(listSettlementSaveMigrations().length, SETTLEMENT_CONTENT_LIMITS.saveMigrations, 'migration-count');

for (const id of listSettlementServices()) {
  const value = getSettlementService(id);
  ok(value.id === id, `service:${id}`); ok(value.label.length > 0, `service-label:${id}`);
  ok(value.actions.length > 0, `service-actions:${id}`); ok(value.prompt.length > 0, `service-prompt:${id}`);
}
for (const id of listSettlementItems()) {
  const value = getSettlementItem(id);
  ok(value.id === id, `item:${id}`); ok(value.buy >= value.sell, `economy-margin:${id}`);
  ok(value.weight > 0, `weight:${id}`); ok(value.tags.length > 0, `tags:${id}`);
}
for (const id of listSettlementRecipes()) {
  const value = getSettlementRecipe(id);
  ok(value.id === id, `recipe:${id}`); ok(Object.keys(value.ingredients).length > 0, `ingredients:${id}`);
  ok(value.xp > 0, `recipe-xp:${id}`); ok(value.minutes > 0, `recipe-time:${id}`);
  ok(value.qualityBase > 0 && value.qualityBase <= 1, `recipe-quality:${id}`);
}
for (const id of listSettlementRoutes()) {
  const value = getSettlementRoute(id);
  ok(value.id === id, `route:${id}`); ok(value.cost >= 0, `route-cost:${id}`);
  ok(value.fatigue >= 0, `route-fatigue:${id}`); ok(value.destination.length > 0, `route-destination:${id}`);
}
for (const id of listSettlementPerks()) {
  const value = getSettlementPerk(id);
  ok(value.id === id, `perk:${id}`); ok(value.skill.length > 0, `perk-skill:${id}`); ok(Object.keys(value.effect).length > 0, `perk-effect:${id}`);
}
for (const id of listSettlementDialogueConditions()) {
  const value = getSettlementDialogueCondition(id);
  ok(value.id === id, `condition:${id}`);
  ok(['flag', 'reputation', 'quest', 'item', 'skill'].includes(value.type), `condition-type:${id}`);
  ok(value.success.length > 0, `condition-success:${id}`); ok(value.failure.length > 0, `condition-failure:${id}`);
}
for (const id of listSettlementQuestObjectives()) {
  const value = getSettlementQuestObjective(id);
  ok(value.id === id, `objective:${id}`);
  ok(['talk', 'collect', 'deliver', 'craft', 'travel', 'trade', 'equip', 'rest'].includes(value.type), `objective-type:${id}`);
  ok(value.rewardXp > 0, `objective-xp:${id}`);
}
for (const id of listSettlementUxMessages()) {
  const value = getSettlementUxMessage(id);
  ok(value.id === id, `message:${id}`);
  ok(['ready', 'blocked', 'success', 'warning', 'error'].includes(value.status), `message-status:${id}`);
  ok(['enter', 'exit', 'talk', 'trade', 'craft', 'travel', 'save', 'rest'].includes(value.action), `message-action:${id}`);
}
for (const id of listSettlementSaveMigrations()) {
  const value = getSettlementSaveMigration(id);
  equal(value.id, `settlement-save-${value.from}-${value.to}`, `migration-id:${id}`);
  equal(value.to, value.from + 1, `migration-chain:${id}`); equal(value.lossless, true, `migration-lossless:${id}`);
}

const state = {
  version: 1, copper: 120, fatigue: 18, health: 84, maxHealth: 100,
  carryWeight: 8, maxCarryWeight: 28, reputation: 5, locationId: 'settlement', settlementId: 'north-settlement',
  flags: { 'settlement.flag.0': true },
  inventory: { iron_ore: 8, coal: 5, leather: 3, linen: 2, bread: 4, stew: 2, herb: 2, travel_rations: 2 },
  equipment: { weapon: 'iron_sword' }, quests: {},
  skills: { smithing: 4, commerce: 3, travel: 2, survival: 2, dialogue: 3 },
  perks: ['merchant_road', 'market_eye', 'roadwise'],
  survival: { hunger: 20, exposure: 5, morale: 10 },
};
const events = []; const calls = [];
const graph = [
  { id: 'settlement', kind: 'settlement', label: 'Kuzey Yerleşimi', actions: ['enter', 'back'], capabilities: { door: true } },
  { id: 'gate', kind: 'door', label: 'Kuzey Kapısı', actions: ['enter', 'exit', 'travel', 'back'], capabilities: { door: true, travel: true } },
  { id: 'blacksmith', kind: 'crafting', label: 'Demirci', actions: ['talk', 'trade', 'craft', 'back'], capabilities: { dialogue: true, trade: true, crafting: true } },
  { id: 'tavern', kind: 'npc', label: 'Han Sahibi', actions: ['talk', 'acceptQuest', 'advanceQuest', 'rest', 'back'], capabilities: { dialogue: true, quest: true } },
  { id: 'market', kind: 'vendor', label: 'Pazar', actions: ['talk', 'trade', 'back'], capabilities: { dialogue: true, trade: true } },
];
const handlers = {
  enterSettlement: async payload => { calls.push(['enterSettlement', payload.node.id]); return { ok: true, action: payload.action, nodeId: payload.node.id, message: 'Yerleşime girildi.' }; },
  talk: async payload => { calls.push(['talk', payload.serviceId, payload.node.id]); return { ok: true, action: 'talk', nodeId: payload.node.id, message: 'Konuşma başlatıldı.' }; },
  trade: async payload => { calls.push(['trade', payload.quote?.itemId, payload.quote?.total]); return payload.quote?.ok ? { ok: true, action: 'trade', nodeId: payload.node.id, data: { quote: payload.quote }, message: 'Takas tamamlandı.' } : { ok: false, action: 'trade', nodeId: payload.node.id, reason: 'quote-invalid' }; },
  craft: async payload => { calls.push(['craft', payload.recipe?.id]); return payload.craftCheck?.ok ? { ok: true, action: 'craft', nodeId: payload.node.id, data: { xp: payload.recipe.xp }, message: 'Üretim tamamlandı.' } : { ok: false, action: 'craft', nodeId: payload.node.id, reason: 'missing-material' }; },
  acceptQuest: async payload => { calls.push(['acceptQuest', payload.node.id]); return { ok: true, action: 'acceptQuest', nodeId: payload.node.id, message: 'Görev kabul edildi.' }; },
  advanceQuest: async payload => { calls.push(['advanceQuest', payload.node.id]); return { ok: true, action: 'advanceQuest', nodeId: payload.node.id, message: 'Görev ilerletildi.' }; },
  travel: async payload => { calls.push(['travel', payload.travel?.routeId]); return payload.travel?.ok ? { ok: true, action: 'travel', nodeId: payload.node.id, message: 'Yola çıkıldı.' } : { ok: false, action: 'travel', nodeId: payload.node.id, reason: 'travel-invalid' }; },
  save: async payload => { calls.push(['save', payload.node.id]); return { ok: true, action: 'save', nodeId: payload.node.id, message: 'Kayıt tamamlandı.' }; },
};
const runtime = createSettlementCampaignRuntime({
  definition: { id: 'north-slice', settlementId: 'north-settlement', entryNodeId: 'settlement', nodes: graph },
  readState: () => state, handlers, now: () => 1000 + events.length,
  onEvent: event => events.push(event),
});

equal(runtime.version, 1, 'runtime-version'); ok(runtime.validateContent().ok, 'runtime-content-validation');
equal(runtime.getService('blacksmith').label, 'Demirci', 'runtime-service');
equal(runtime.getItem('iron_sword').category, 'weapon', 'runtime-item');
equal(runtime.getRecipe('iron_sword').station, 'blacksmith', 'runtime-recipe');
ok(runtime.getRoute('north_gate').cost > 0, 'runtime-route'); equal(runtime.getPerk('roadwise').skill, 'travel', 'runtime-perk');
equal(runtime.getUxMessage('ux-01').status, 'ready', 'runtime-message'); ok(runtime.getSaveMigration('settlement-save-0-1').lossless, 'runtime-migration');

let view = runtime.open('blacksmith', 'craft');
equal(view.activeService.id, 'blacksmith', 'open-blacksmith'); equal(view.panel, 'craft', 'craft-panel');
ok(view.panels.craft.some(recipe => recipe.id === 'iron_sword' && recipe.ready), 'craft-ready'); ok(view.panels.trade.some(item => item.id === 'iron_ore'), 'trade-panel-inventory');
const craft = await runtime.execute('craft', { recipeId: 'iron_sword', requestId: 'craft-1' });
equal(craft.ok, true, 'craft-action'); equal(craft.data.xp, 40, 'craft-xp'); ok(calls.some(call => call[0] === 'craft' && call[1] === 'iron_sword'), 'craft-handler');
const trade = await runtime.execute('trade', { itemId: 'iron_ore', quantity: 2, direction: 'sell', requestId: 'trade-1' });
equal(trade.ok, true, 'trade-action'); equal(trade.data.quote.total, 7, 'trade-quote');
const duplicate = await runtime.execute('trade', { itemId: 'iron_ore', quantity: 2, direction: 'sell', requestId: 'trade-1' });
equal(duplicate.code, 'duplicate-request', 'duplicate-request-rejected');

runtime.open('tavern');
const dialogue = runtime.evaluateDialogue(['flag_01']); ok(dialogue.checks.length === 1, 'dialogue-check-count'); ok(typeof dialogue.checks[0].reason === 'string', 'dialogue-reason');
const objective = runtime.getObjective('settlement-objective-02'); ok(objective && Number.isFinite(objective.progress), 'quest-objective-progress');
const accept = await runtime.execute('acceptQuest', { questId: 'settlement-supply', requestId: 'quest-1' }); equal(accept.ok, true, 'accept-quest');
const advance = await runtime.execute('advanceQuest', { questId: 'settlement-supply', requestId: 'quest-2' }); equal(advance.ok, true, 'advance-quest');

runtime.open('market', 'trade');
const buy = await runtime.execute('buy', { itemId: 'bread', quantity: 3, requestId: 'buy-1' }); equal(buy.code, 'handler-unavailable', 'buy-handler-unavailable-fails-closed');
runtime.open('gate', 'travel');
const travel = await runtime.execute('travel', { routeId: 'north_gate', requestId: 'travel-1' });
equal(travel.ok, true, 'travel-action'); equal(travel.travel.routeId, 'north_gate', 'travel-route'); ok(travel.travel.cost < getSettlementRoute('north_gate').cost, 'roadwise-travel-discount');
const save = await runtime.save({ requestId: 'save-1', slot: 'settlement-slot-1' }); equal(save.ok, true, 'save-action');
const exported = runtime.exportState(); equal(exported.version, 1, 'runtime-state-version');
const manifestA = runtime.manifest(); const manifestB = runtime.manifest(); equal(manifestA.digest, manifestB.digest, 'manifest-deterministic');
const restored = runtime.importState({ ...exported, panel: 'quests', activeService: 'tavern', route: ['tavern'] });
equal(restored.ok, true, 'restore-state'); equal(restored.state.activeService, 'tavern', 'restore-service'); equal(restored.state.panel, 'quests', 'restore-panel');
equal(runtime.importState({ version: 99 }).ok, false, 'bad-state-rejected');
runtime.setPanel('travel'); view = runtime.getViewModel(); equal(view.panel, 'travel', 'travel-panel'); equal(view.panels.travel.length, 6, 'travel-panel-routes');
ok(view.panels.travel.some(route => route.quote.cost < route.cost), 'travel-perk-quote');
runtime.close(); equal(runtime.getViewModel().activeService, null, 'close-service'); runtime.reset(); equal(runtime.getViewModel().route.length, 0, 'reset-route');
runtime.dispose(); const disposed = await runtime.execute('talk', { requestId: 'after-dispose' }); equal(disposed.code, 'disposed', 'dispose-fail-closed'); ok(runtime.isDisposed(), 'disposed-state');

const materialGate = evaluateSettlementGate({ type: 'item', itemId: 'iron_ore', quantity: 3, reason: 'need-ore' }, { items: { iron_ore: 4 } });
equal(materialGate.ok, true, 'existing-slice-item-gate');
const questGate = evaluateSettlementGate({ type: 'quest', questId: 'settlement-supply', states: ['completed'] }, { questProgress: { 'settlement-supply': { completed: true, state: 'completed' } } });
equal(questGate.ok, true, 'existing-slice-quest-gate');
const repGate = evaluateSettlementGate({ type: 'reputation', factionId: 'local-faction', minimum: 4, reason: 'need-trust' }, { reputation: { 'local-faction': 5 } });
equal(repGate.ok, true, 'existing-slice-reputation-gate');
const capGate = evaluateSettlementGate({ type: 'capability', capability: 'crafting', reason: 'need-forge' }, { capabilities: { crafting: true } });
equal(capGate.ok, true, 'existing-slice-capability-gate');
const proximityGate = evaluateSettlementGate({ type: 'proximity', distance: 4, reason: 'too-far' }, { distance: 3.5 }); equal(proximityGate.ok, true, 'existing-slice-proximity-gate');

const badCraft = resolveCraftingRecipe('iron_sword', { inventory: { iron_ore: 1, coal: 1 } }); equal(badCraft.ok, false, 'crafting-material-gate');
const goodCraft = resolveCraftingRecipe('iron_sword', { inventory: { iron_ore: 3, coal: 1 } }); equal(goodCraft.ok, true, 'crafting-material-ready');
const buyQuote = resolveTradeQuote('bread', 4, 'buy', {}); equal(buyQuote.total, 12, 'buy-quote');
const sellQuote = resolveTradeQuote('bread', 4, 'sell', {}); equal(sellQuote.total, 4, 'sell-quote');
const travelQuote = resolveTravelCost('winter_pass', {}); equal(travelQuote.cost, 34, 'travel-cost'); ok(travelQuote.fatigue > 0, 'travel-fatigue');

const slice = createSettlementVerticalSlice({ definition: { id: 'slice-probe', settlementId: 'north-settlement', entryNodeId: 'settlement', nodes: graph.map(node => ({ ...node, gates: node.id === 'blacksmith' ? [{ type: 'capability', capability: 'crafting' }] : [] })) }, handlers: { craft: () => ({ ok: true, action: 'craft', nodeId: 'blacksmith' }), enterSettlement: () => ({ ok: true, action: 'enter', nodeId: 'settlement' }) } });
equal(slice.getState().nodeId, 'settlement', 'slice-current-node'); ok(slice.availableActions({ capabilities: { door: true } }).includes('enter'), 'slice-enter-action');
ok(runtime.manifest().content.services.includes('blacksmith'), 'runtime-content-source');
for (const event of events) { ok(event && typeof event.name === 'string', 'event-name'); ok(Number.isFinite(event.at), 'event-time'); ok(Number.isInteger(event.revision), 'event-revision'); }
console.log(`SETTLEMENT_CAMPAIGN_RUNTIME_OK checks=${checks} events=${events.length} calls=${calls.length} digest=${manifestA.digest}`);
