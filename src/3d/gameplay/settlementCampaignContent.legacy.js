/**
 * Authored settlement campaign content; immutable data only.
 *
 * This registry extends the existing settlement vertical slice without owning
 * inventory, quest, economy, crafting, travel, dialogue or persistence state.
 * Runtime systems consume these definitions through injected authoritative
 * handlers and snapshots.
 */
export const SETTLEMENT_CONTENT_VERSION = 2;
export const SETTLEMENT_CONTENT_LIMITS = Object.freeze({
  services: 8,
  items: 16,
  recipes: 6,
  routes: 6,
  perks: 24,
  dialogueConditions: 40,
  questObjectives: 32,
  uxMessages: 80,
  saveMigrations: 20,
});

const SERVICES = Object.freeze({
  blacksmith: Object.freeze({
    id: 'blacksmith', label: 'Demirci', kind: 'crafting', domain: 'smithing',
    actions: Object.freeze(['talk', 'trade', 'craft', 'equip']),
    prompt: 'Silah ve ekipmanını üret, onar ve kuşan.',
  }),
  tavern: Object.freeze({
    id: 'tavern', label: 'Han', kind: 'interior', domain: 'rest-dialogue',
    actions: Object.freeze(['talk', 'rest', 'acceptQuest', 'advanceQuest']),
    prompt: 'Dinlen, konuş ve yerel görev zincirini ilerlet.',
  }),
  market: Object.freeze({
    id: 'market', label: 'Pazar', kind: 'vendor', domain: 'trade',
    actions: Object.freeze(['talk', 'trade', 'buy', 'sell']),
    prompt: 'Yerel stokları incele ve ihtiyaç fazlasını sat.',
  }),
  farm: Object.freeze({
    id: 'farm', label: 'Çiftlik', kind: 'interior', domain: 'survival',
    actions: Object.freeze(['interact', 'trade', 'rest', 'travel']),
    prompt: 'Yiyecek ve dinlenme kaynaklarını yenile.',
  }),
  barracks: Object.freeze({
    id: 'barracks', label: 'Kışla', kind: 'interior', domain: 'training',
    actions: Object.freeze(['talk', 'train', 'acceptQuest', 'equip']),
    prompt: 'Muhafızlarla konuş ve savunma becerilerini geliştir.',
  }),
  stable: Object.freeze({
    id: 'stable', label: 'Ahır', kind: 'interior', domain: 'mount-travel',
    actions: Object.freeze(['talk', 'trade', 'travel', 'rest']),
    prompt: 'Binek durumunu ve yol hazırlığını yönet.',
  }),
  house: Object.freeze({
    id: 'house', label: 'Ev', kind: 'interior', domain: 'persistence',
    actions: Object.freeze(['interact', 'talk', 'save', 'rest']),
    prompt: 'Güvenli bölgede dinlen ve ilerlemeni kaydet.',
  }),
  gate: Object.freeze({
    id: 'gate', label: 'Kale Kapısı', kind: 'door', domain: 'travel',
    actions: Object.freeze(['enter', 'exit', 'travel']),
    prompt: 'Seyahat hedefini seç ve yol maliyetini onayla.',
  }),
});

const ITEMS = Object.freeze({
  iron_ore: Object.freeze({ id: 'iron_ore', label: 'Demir Cevheri', category: 'material', buy: 6, sell: 3, weight: 1.6, tags: ['ore', 'smithing'] }),
  coal: Object.freeze({ id: 'coal', label: 'Kömür', category: 'material', buy: 4, sell: 2, weight: 1.2, tags: ['fuel', 'smithing'] }),
  herb: Object.freeze({ id: 'herb', label: 'Şifalı Ot', category: 'material', buy: 5, sell: 2, weight: 0.2, tags: ['herb', 'survival'] }),
  bread: Object.freeze({ id: 'bread', label: 'Ekmek', category: 'food', buy: 3, sell: 1, weight: 0.3, tags: ['food', 'basic'] }),
  stew: Object.freeze({ id: 'stew', label: 'Güveç', category: 'food', buy: 8, sell: 4, weight: 0.7, tags: ['food', 'rest'] }),
  linen: Object.freeze({ id: 'linen', label: 'Keten', category: 'material', buy: 7, sell: 3, weight: 0.4, tags: ['cloth', 'tailoring'] }),
  leather: Object.freeze({ id: 'leather', label: 'Deri', category: 'material', buy: 9, sell: 4, weight: 0.8, tags: ['leather', 'equipment'] }),
  horse_feed: Object.freeze({ id: 'horse_feed', label: 'At Yemi', category: 'mount', buy: 6, sell: 3, weight: 0.6, tags: ['mount', 'travel'] }),
  iron_sword: Object.freeze({ id: 'iron_sword', label: 'Demir Kılıç', category: 'weapon', buy: 48, sell: 24, weight: 3.1, tags: ['weapon', 'one-hand'] }),
  iron_dagger: Object.freeze({ id: 'iron_dagger', label: 'Demir Hançer', category: 'weapon', buy: 24, sell: 12, weight: 1.1, tags: ['weapon', 'light'] }),
  steel_buckle: Object.freeze({ id: 'steel_buckle', label: 'Çelik Toka', category: 'component', buy: 20, sell: 10, weight: 0.3, tags: ['component', 'armour'] }),
  linen_tunic: Object.freeze({ id: 'linen_tunic', label: 'Keten Tunik', category: 'armour', buy: 36, sell: 18, weight: 1.3, tags: ['armour', 'cloth'] }),
  leather_gloves: Object.freeze({ id: 'leather_gloves', label: 'Deri Eldiven', category: 'armour', buy: 28, sell: 14, weight: 0.6, tags: ['armour', 'leather'] }),
  travel_rations: Object.freeze({ id: 'travel_rations', label: 'Yol Azığı', category: 'food', buy: 12, sell: 6, weight: 0.9, tags: ['food', 'travel'] }),
  bandage: Object.freeze({ id: 'bandage', label: 'Sargı Bezi', category: 'consumable', buy: 10, sell: 5, weight: 0.15, tags: ['healing', 'survival'] }),
  torch: Object.freeze({ id: 'torch', label: 'Meşale', category: 'utility', buy: 5, sell: 2, weight: 0.5, tags: ['light', 'interior'] }),
});

const RECIPES = Object.freeze({
  iron_sword: Object.freeze({ id: 'iron_sword', label: 'Demir Kılıç', station: 'blacksmith', ingredients: Object.freeze({ iron_ore: 3, coal: 1 }), xp: 40, minutes: 12, qualityBase: 0.72 }),
  iron_dagger: Object.freeze({ id: 'iron_dagger', label: 'Demir Hançer', station: 'blacksmith', ingredients: Object.freeze({ iron_ore: 2, coal: 1 }), xp: 28, minutes: 8, qualityBase: 0.76 }),
  steel_buckle: Object.freeze({ id: 'steel_buckle', label: 'Çelik Toka', station: 'blacksmith', ingredients: Object.freeze({ iron_ore: 2, coal: 2 }), xp: 34, minutes: 10, qualityBase: 0.7 }),
  linen_tunic: Object.freeze({ id: 'linen_tunic', label: 'Keten Tunik', station: 'market', ingredients: Object.freeze({ linen: 4, leather: 1 }), xp: 26, minutes: 15, qualityBase: 0.74 }),
  leather_gloves: Object.freeze({ id: 'leather_gloves', label: 'Deri Eldiven', station: 'blacksmith', ingredients: Object.freeze({ leather: 2, linen: 1 }), xp: 30, minutes: 9, qualityBase: 0.79 }),
  travel_rations: Object.freeze({ id: 'travel_rations', label: 'Yol Azığı', station: 'farm', ingredients: Object.freeze({ bread: 2, stew: 1, herb: 1 }), xp: 18, minutes: 4, qualityBase: 0.82 }),
});

const TRAVEL_ROUTES = Object.freeze({
  north_gate: Object.freeze({ id: 'north_gate', label: 'Kuzey Geçidi', destination: 'north-road', cost: 18, fatigue: 12, risk: 'low', checkpoint: 'north-watch' }),
  river_market: Object.freeze({ id: 'river_market', label: 'Nehir Pazarı', destination: 'river-market', cost: 14, fatigue: 9, risk: 'low', checkpoint: 'ferry-road' }),
  hill_fort: Object.freeze({ id: 'hill_fort', label: 'Tepe Karakolu', destination: 'hill-fort', cost: 26, fatigue: 17, risk: 'medium', checkpoint: 'hill-road' }),
  old_mill: Object.freeze({ id: 'old_mill', label: 'Eski Değirmen', destination: 'old-mill', cost: 11, fatigue: 8, risk: 'low', checkpoint: 'farm-track' }),
  east_road: Object.freeze({ id: 'east_road', label: 'Doğu Yolu', destination: 'east-road', cost: 22, fatigue: 15, risk: 'medium', checkpoint: 'east-watch' }),
  winter_pass: Object.freeze({ id: 'winter_pass', label: 'Kış Geçidi', destination: 'winter-pass', cost: 34, fatigue: 24, risk: 'high', checkpoint: 'ice-road' }),
});

const PERKS = Object.freeze({
  merchant_road: Object.freeze({ id: 'merchant_road', label: 'Tüccar Yolu', description: 'Alışveriş fiyatlarında küçük iyileşme sağlar.', skill: 'commerce', effect: { buyRate: -0.04 } }),
  iron_hand: Object.freeze({ id: 'iron_hand', label: 'Demir El', description: 'Demir üretiminde kalite tabanını artırır.', skill: 'smithing', effect: { quality: 0.05 } }),
  market_eye: Object.freeze({ id: 'market_eye', label: 'Pazar Gözü', description: 'Satış değerini hafifçe artırır.', skill: 'commerce', effect: { sellRate: 0.05 } }),
  steady_rest: Object.freeze({ id: 'steady_rest', label: 'Düzenli Dinlenme', description: 'Dinlenmede daha fazla yorgunluk giderir.', skill: 'survival', effect: { fatigueRecovery: 0.08 } }),
  roadwise: Object.freeze({ id: 'roadwise', label: 'Yol Bilgisi', description: 'Seyahat yorgunluğunu azaltır.', skill: 'travel', effect: { fatigue: -0.07 } }),
  field_hand: Object.freeze({ id: 'field_hand', label: 'Tarla Eli', description: 'Çiftlik etkileşimlerinde verimi artırır.', skill: 'survival', effect: { foodYield: 0.1 } }),
  kind_word: Object.freeze({ id: 'kind_word', label: 'Tatlı Dil', description: 'Bazı diyalog koşullarında itibar eşiğini düşürür.', skill: 'dialogue', effect: { reputationGate: -2 } }),
  quartermaster: Object.freeze({ id: 'quartermaster', label: 'İkmal Subayı', description: 'Yol erzağı kapasitesini genişletir.', skill: 'logistics', effect: { rationCapacity: 2 } }),
  quick_smith: Object.freeze({ id: 'quick_smith', label: 'Çabuk Dövüş', description: 'Smithing iş süresini azaltır.', skill: 'smithing', effect: { craftMinutes: -0.1 } }),
  careful_pack: Object.freeze({ id: 'careful_pack', label: 'Düzenli Kese', description: 'Ağırlık kapasitesini verimli kullanır.', skill: 'logistics', effect: { weightCapacity: 4 } }),
  local_favor: Object.freeze({ id: 'local_favor', label: 'Yerel İyilik', description: 'Yerleşim halkıyla başlangıç itibarını yükseltir.', skill: 'dialogue', effect: { reputation: 3 } }),
  night_rest: Object.freeze({ id: 'night_rest', label: 'Gece Sükûneti', description: 'Han ve evde dinlenmeyi güçlendirir.', skill: 'survival', effect: { restBonus: 0.06 } }),
  stable_hand: Object.freeze({ id: 'stable_hand', label: 'Ahır Eli', description: 'Binek seyahatinde maliyeti azaltır.', skill: 'travel', effect: { mountCost: -0.08 } }),
  tinkerer: Object.freeze({ id: 'tinkerer', label: 'Usta Eli', description: 'Bileşen üretiminde kritik kalite şansını artırır.', skill: 'smithing', effect: { qualityVariance: 0.08 } }),
  forgemaster: Object.freeze({ id: 'forgemaster', label: 'Dövmehane Ustası', description: 'İleri smithing tariflerini açar.', skill: 'smithing', effect: { unlockTier: 1 } }),
  ledger: Object.freeze({ id: 'ledger', label: 'Defter Tutan', description: 'Ekonomi işlemlerinin kayıt izini güçlendirir.', skill: 'commerce', effect: { ledger: 1 } }),
  watchful: Object.freeze({ id: 'watchful', label: 'Uyanık', description: 'Bazı seyahat risklerini bir kademe düşürür.', skill: 'travel', effect: { risk: -1 } }),
  good_host: Object.freeze({ id: 'good_host', label: 'İyi Ev Sahibi', description: 'Tavern dialogue ödüllerini iyileştirir.', skill: 'dialogue', effect: { dialogueReward: 0.08 } }),
  herbalist: Object.freeze({ id: 'herbalist', label: 'Otacı', description: 'Şifalı eşya kullanımını verimli hale getirir.', skill: 'survival', effect: { healing: 0.1 } }),
  caravaner: Object.freeze({ id: 'caravaner', label: 'Kervancı', description: 'Uzun rotalarda ekonomik avantaj sağlar.', skill: 'travel', effect: { longRouteCost: -0.06 } }),
  field_cook: Object.freeze({ id: 'field_cook', label: 'Sefer Aşçısı', description: 'Yol azığının verdiği dayanıklılığı artırır.', skill: 'survival', effect: { rationFatigue: -0.08 } }),
  scribe: Object.freeze({ id: 'scribe', label: 'Kâtip', description: 'Görev ilerlemesinde kayıt güvenini artırır.', skill: 'questing', effect: { questHistory: 1 } }),
  keepsake: Object.freeze({ id: 'keepsake', label: 'Hatıra', description: 'Evde saklanan küçük eşyaları kalıcılaştırır.', skill: 'persistence', effect: { itemRetention: 1 } }),
  smithing_ledger: Object.freeze({ id: 'smithing_ledger', label: 'Dövme Defteri', description: 'Üretim XP kazanımını artırır.', skill: 'smithing', effect: { xp: 0.05 } }),
});

const CONDITION_TYPES = Object.freeze(['flag', 'reputation', 'quest', 'item', 'skill']);
const DIALOGUE_CONDITIONS = Object.freeze(Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
  const types = CONDITION_TYPES[index % CONDITION_TYPES.length];
  const key = `${types}_${String(index + 1).padStart(2, '0')}`;
  const threshold = types === 'reputation' ? (index % 4) * 2 - 2 : types === 'item' ? (index % 3) + 1 : types === 'skill' ? (index % 5) + 1 : 1;
  return [key, Object.freeze({ id: key, type: types, threshold, target: types === 'flag' ? `settlement.flag.${index % 6}` : types === 'quest' ? `settlement.quest.${index % 8}` : types === 'item' ? Object.keys(ITEMS)[index % Object.keys(ITEMS).length] : types === 'skill' ? ['smithing', 'commerce', 'travel', 'survival', 'dialogue'][index % 5] : 'local-faction', success: 'Koşul sağlandı.', failure: 'Bu konuşma seçeneği için koşul henüz sağlanmıyor.' })];
})));

const OBJECTIVE_TYPES = Object.freeze(['talk', 'collect', 'deliver', 'craft', 'travel', 'trade', 'equip', 'rest']);
const QUEST_OBJECTIVES = Object.freeze(Object.fromEntries(Array.from({ length: 32 }, (_, index) => {
  const type = OBJECTIVE_TYPES[index % OBJECTIVE_TYPES.length];
  const id = `settlement-objective-${String(index + 1).padStart(2, '0')}`;
  const item = Object.keys(ITEMS)[index % Object.keys(ITEMS).length];
  return [id, Object.freeze({ id, type, target: type === 'talk' ? ['tavern', 'market', 'blacksmith', 'barracks'][index % 4] : type === 'travel' ? Object.keys(TRAVEL_ROUTES)[index % Object.keys(TRAVEL_ROUTES).length] : item, quantity: ['collect', 'deliver', 'trade', 'craft'][type] ? (index % 3) + 1 : 1, label: `${type} hedefi ${index + 1}`, rewardXp: 12 + (index % 6) * 4 })];
})));

const MESSAGE_STATUSES = Object.freeze(['ready', 'blocked', 'success', 'warning', 'error']);
const MESSAGE_ACTIONS = Object.freeze(['enter', 'exit', 'talk', 'trade', 'craft', 'travel', 'save', 'rest']);
const UX_MESSAGES = Object.freeze(Object.fromEntries(Array.from({ length: 80 }, (_, index) => {
  const status = MESSAGE_STATUSES[index % MESSAGE_STATUSES.length];
  const action = MESSAGE_ACTIONS[index % MESSAGE_ACTIONS.length];
  const id = `ux-${String(index + 1).padStart(2, '0')}`;
  const templates = {
    ready: `${action} işlemi için hazırsın.`,
    blocked: `${action} işlemi için gerekli koşul sağlanmıyor.`,
    success: `${action} işlemi başarıyla tamamlandı.`,
    warning: `${action} işlemi kaynak veya risk kontrolü gerektiriyor.`,
    error: `${action} işlemi güvenli biçimde tamamlanamadı.`,
  };
  return [id, Object.freeze({ id, status, action, message: templates[status], priority: (index % 3) + 1 })];
})));

const SAVE_MIGRATIONS = Object.freeze(Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
  const from = index;
  const to = index + 1;
  return [`${from}->${to}`, Object.freeze({ from, to, id: `settlement-save-${from}-${to}`, lossless: true, description: `Yerleşim kaydındaki alanları ${from} sürümünden ${to} sürümüne deterministik biçimde taşır.` })];
})));

const cloneList = (value) => [...value];
const freezeMapCopy = (value) => Object.freeze({ ...value });

export function listSettlementServices() { return cloneList(Object.keys(SERVICES)); }
export function getSettlementService(id) { const value = SERVICES[id]; return value ? { ...value, actions: cloneList(value.actions) } : null; }
export function listSettlementItems() { return cloneList(Object.keys(ITEMS)); }
export function getSettlementItem(id) { const value = ITEMS[id]; return value ? { ...value, tags: cloneList(value.tags) } : null; }
export function listSettlementRecipes() { return cloneList(Object.keys(RECIPES)); }
export function getSettlementRecipe(id) { const value = RECIPES[id]; return value ? { ...value, ingredients: freezeMapCopy(value.ingredients) } : null; }
export function listSettlementRoutes() { return cloneList(Object.keys(TRAVEL_ROUTES)); }
export function getSettlementRoute(id) { const value = TRAVEL_ROUTES[id]; return value ? { ...value } : null; }
export function listSettlementPerks() { return cloneList(Object.keys(PERKS)); }
export function getSettlementPerk(id) { const value = PERKS[id]; return value ? { ...value, effect: freezeMapCopy(value.effect) } : null; }
export function listSettlementDialogueConditions() { return cloneList(Object.keys(DIALOGUE_CONDITIONS)); }
export function getSettlementDialogueCondition(id) { const value = DIALOGUE_CONDITIONS[id]; return value ? { ...value } : null; }
export function listSettlementQuestObjectives() { return cloneList(Object.keys(QUEST_OBJECTIVES)); }
export function getSettlementQuestObjective(id) { const value = QUEST_OBJECTIVES[id]; return value ? { ...value } : null; }
export function listSettlementUxMessages() { return cloneList(Object.keys(UX_MESSAGES)); }
export function getSettlementUxMessage(id) { const value = UX_MESSAGES[id]; return value ? { ...value } : null; }
export function listSettlementSaveMigrations() { return cloneList(Object.keys(SAVE_MIGRATIONS)); }
export function getSettlementSaveMigration(id) { const value = SAVE_MIGRATIONS[id]; return value ? { ...value } : null; }

export function createSettlementContentManifest() {
  return {
    version: SETTLEMENT_CONTENT_VERSION,
    limits: { ...SETTLEMENT_CONTENT_LIMITS },
    services: listSettlementServices(),
    items: listSettlementItems(),
    recipes: listSettlementRecipes(),
    routes: listSettlementRoutes(),
    perks: listSettlementPerks(),
    dialogueConditions: listSettlementDialogueConditions(),
    questObjectives: listSettlementQuestObjectives(),
    uxMessages: listSettlementUxMessages(),
    saveMigrations: listSettlementSaveMigrations(),
  };
}

export function validateSettlementContent() {
  const errors = [];
  for (const [id, service] of Object.entries(SERVICES)) if (id !== service.id || !service.actions.length) errors.push(`service:${id}`);
  for (const [id, item] of Object.entries(ITEMS)) if (id !== item.id || item.buy < item.sell || item.weight <= 0) errors.push(`item:${id}`);
  for (const [id, recipe] of Object.entries(RECIPES)) if (id !== recipe.id || !recipe.station || !Object.keys(recipe.ingredients).length) errors.push(`recipe:${id}`);
  for (const [id, route] of Object.entries(TRAVEL_ROUTES)) if (id !== route.id || route.cost < 0 || route.fatigue < 0) errors.push(`route:${id}`);
  for (const [id, perk] of Object.entries(PERKS)) if (id !== perk.id || !perk.skill) errors.push(`perk:${id}`);
  for (const [id, condition] of Object.entries(DIALOGUE_CONDITIONS)) if (id !== condition.id || !CONDITION_TYPES.includes(condition.type)) errors.push(`condition:${id}`);
  for (const [id, objective] of Object.entries(QUEST_OBJECTIVES)) if (id !== objective.id || !OBJECTIVE_TYPES.includes(objective.type)) errors.push(`objective:${id}`);
  for (const [id, message] of Object.entries(UX_MESSAGES)) if (id !== message.id || !MESSAGE_STATUSES.includes(message.status) || !MESSAGE_ACTIONS.includes(message.action)) errors.push(`message:${id}`);
  for (const [id, migration] of Object.entries(SAVE_MIGRATIONS)) if (id !== `${migration.from}->${migration.to}` || migration.to !== migration.from + 1 || migration.lossless !== true) errors.push(`migration:${id}`);
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function resolveCraftingRecipe(recipeId, snapshot = {}) {
  const recipe = RECIPES[recipeId];
  if (!recipe) return { ok: false, reason: 'unknown-recipe' };
  const inventory = snapshot.inventory && typeof snapshot.inventory === 'object' ? snapshot.inventory : {};
  const missing = [];
  for (const [itemId, quantity] of Object.entries(recipe.ingredients)) if ((Number(inventory[itemId]) || 0) < quantity) missing.push({ itemId, quantity, available: Number(inventory[itemId]) || 0 });
  return missing.length ? { ok: false, reason: 'missing-material', missing } : { ok: true, recipe: { ...recipe, ingredients: freezeMapCopy(recipe.ingredients) } };
}

export function resolveTradeQuote(itemId, quantity = 1, direction = 'buy', modifiers = {}) {
  const item = ITEMS[itemId];
  const count = Math.max(1, Math.min(999, Math.trunc(Number(quantity) || 1)));
  if (!item) return { ok: false, reason: 'unknown-item' };
  const rate = direction === 'sell' ? 1 + Math.max(-0.5, Math.min(0.5, Number(modifiers.sellRate) || 0)) : 1 + Math.max(-0.5, Math.min(0.5, Number(modifiers.buyRate) || 0));
  const unit = Math.max(1, Math.round((direction === 'sell' ? item.sell : item.buy) * rate));
  return { ok: true, itemId, quantity: count, direction, unitPrice: unit, total: unit * count };
}

export function resolveTravelCost(routeId, modifiers = {}) {
  const route = TRAVEL_ROUTES[routeId];
  if (!route) return { ok: false, reason: 'unknown-route' };
  const costRate = Math.max(0.5, Math.min(1.5, 1 + (Number(modifiers.costRate) || 0)));
  const fatigueRate = Math.max(0.5, Math.min(1.5, 1 + (Number(modifiers.fatigueRate) || 0)));
  return { ok: true, routeId, cost: Math.max(0, Math.round(route.cost * costRate)), fatigue: Math.max(0, Math.round(route.fatigue * fatigueRate)), risk: route.risk, checkpoint: route.checkpoint };
}
