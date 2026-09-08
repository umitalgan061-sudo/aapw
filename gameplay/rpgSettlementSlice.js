const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const SETTLEMENT_SERVICES = Object.freeze({
  blacksmith: Object.freeze({ action: 'craft', restock: 0.82 }),
  tavern: Object.freeze({ action: 'rest', restock: 0.94 }),
  market: Object.freeze({ action: 'trade', restock: 0.88 }),
  farm: Object.freeze({ action: 'gather', restock: 0.76 }),
  barracks: Object.freeze({ action: 'train', restock: 0.68 }),
  stable: Object.freeze({ action: 'travel', restock: 0.9 })
});

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createRpgSettlementState(seed = 'aapw-settlement') {
  return {
    version: 1,
    seed,
    gold: 120,
    xp: 0,
    level: 1,
    skillPoints: 0,
    hunger: 0,
    fatigue: 0,
    location: 'winterfell',
    inventory: { ironOre: 3, wood: 5, bread: 2, healthPotion: 1 },
    equipment: { weapon: null, armor: null },
    services: { blacksmith: true, tavern: true, market: true, farm: true, barracks: true, stable: true },
    quests: {
      'settlement-supply': { state: 'active', progress: 0, target: 3, reward: { gold: 80, xp: 60 } },
      'road-to-market': { state: 'locked', progress: 0, target: 1, reward: { gold: 120, xp: 90 } }
    },
    discoveredPoi: ['winterfell'],
    log: []
  };
}

export function addLog(state, message) {
  state.log.push(String(message));
  if (state.log.length > 20) state.log.splice(0, state.log.length - 20);
  return state;
}

export function gainXp(state, amount) {
  state.xp += Math.max(0, Number(amount) || 0);
  while (state.xp >= state.level * 100) {
    state.xp -= state.level * 100;
    state.level += 1;
    state.skillPoints += 1;
    addLog(state, `Level ${state.level} reached`);
  }
  return state;
}

export function giveItem(state, itemId, quantity = 1) {
  const qty = Math.max(0, Math.floor(quantity));
  state.inventory[itemId] = (state.inventory[itemId] || 0) + qty;
  return state;
}

export function consumeItem(state, itemId, quantity = 1) {
  const qty = Math.max(0, Math.floor(quantity));
  if ((state.inventory[itemId] || 0) < qty) return false;
  state.inventory[itemId] -= qty;
  return true;
}

export function buyItem(state, itemId, price, quantity = 1) {
  const qty = Math.max(1, Math.floor(quantity));
  const total = Math.max(0, Number(price) || 0) * qty;
  if (state.gold < total) return { ok: false, reason: 'insufficient-gold' };
  state.gold -= total;
  giveItem(state, itemId, qty);
  addLog(state, `Bought ${qty} ${itemId}`);
  return { ok: true, total };
}

export function sellItem(state, itemId, price, quantity = 1) {
  const qty = Math.max(1, Math.floor(quantity));
  if (!consumeItem(state, itemId, qty)) return { ok: false, reason: 'missing-item' };
  const total = Math.max(0, Number(price) || 0) * qty;
  state.gold += total;
  addLog(state, `Sold ${qty} ${itemId}`);
  return { ok: true, total };
}

export function craftItem(state, recipeId) {
  const recipes = {
    ironSword: { input: { ironOre: 2, wood: 1 }, output: { itemId: 'ironSword', qty: 1 }, xp: 35 },
    bread: { input: { wheat: 2 }, output: { itemId: 'bread', qty: 1 }, xp: 8 }
  };
  const recipe = recipes[recipeId];
  if (!recipe) return { ok: false, reason: 'unknown-recipe' };
  for (const [itemId, qty] of Object.entries(recipe.input)) {
    if ((state.inventory[itemId] || 0) < qty) return { ok: false, reason: `missing-${itemId}` };
  }
  for (const [itemId, qty] of Object.entries(recipe.input)) consumeItem(state, itemId, qty);
  giveItem(state, recipe.output.itemId, recipe.output.qty);
  gainXp(state, recipe.xp);
  addLog(state, `Crafted ${recipeId}`);
  return { ok: true, itemId: recipe.output.itemId };
}

export function completeQuestObjective(state, questId, increment = 1) {
  const quest = state.quests[questId];
  if (!quest || quest.state !== 'active') return { ok: false, reason: 'quest-not-active' };
  quest.progress = clamp(quest.progress + Math.max(0, Math.floor(increment)), 0, quest.target);
  if (quest.progress >= quest.target) {
    quest.state = 'complete';
    state.gold += quest.reward.gold;
    gainXp(state, quest.reward.xp);
    if (questId === 'settlement-supply' && state.quests['road-to-market']) state.quests['road-to-market'].state = 'active';
    addLog(state, `Quest complete: ${questId}`);
  }
  return { ok: true, state: quest.state, progress: quest.progress };
}

export function travelTo(state, destination, distance = 1) {
  if (!state.discoveredPoi.includes(destination)) return { ok: false, reason: 'poi-undiscovered' };
  const cost = Math.max(0, Math.ceil(Number(distance) || 0) * 2);
  if (state.gold < cost) return { ok: false, reason: 'insufficient-gold' };
  state.gold -= cost;
  state.location = destination;
  state.fatigue = clamp(state.fatigue + cost, 0, 100);
  addLog(state, `Travelled to ${destination}`);
  return { ok: true, cost };
}

export function useService(state, serviceId) {
  const service = SETTLEMENT_SERVICES[serviceId];
  if (!service || !state.services[serviceId]) return { ok: false, reason: 'service-unavailable' };
  if (service.action === 'rest') {
    state.fatigue = 0;
    state.hunger = clamp(state.hunger + 5, 0, 100);
  } else if (service.action === 'train') {
    if (state.gold < 25) return { ok: false, reason: 'insufficient-gold' };
    state.gold -= 25;
    state.skillPoints += 1;
  } else if (service.action === 'gather') {
    giveItem(state, 'wheat', 2);
    completeQuestObjective(state, 'settlement-supply', 1);
  }
  addLog(state, `Used service: ${serviceId}`);
  return { ok: true, action: service.action };
}

export function saveRpgState(state) {
  return JSON.stringify(clone(state));
}

export function loadRpgState(serialized) {
  const parsed = JSON.parse(serialized);
  if (!parsed || parsed.version !== 1 || typeof parsed.inventory !== 'object') throw new Error('invalid-rpg-save');
  return parsed;
}
