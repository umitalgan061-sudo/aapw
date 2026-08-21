/**
 * FAZ 5 interaction controller — proximity dialogue plus a compact RPG quest/reputation/progression lifecycle
 * that reuses the already-shipped NPC choices. State stays inside the existing interaction owner
 * instead of introducing parallel dialogue, quest, inventory, economy, faction, or skill frameworks.
 * @module gameplay/interaction
 */

import {
	WATCH_POLICY,
	buildInventoryText,
	createInteractionInventoryState,
	createInteractionJourneyState,
} from './interactionConfig.js';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	buildQuartermasterText,
	createInteractionEconomyState,
} from './interactionEconomy.js';
import {
	REST_KIND,
	buildJourneyRestText,
	evaluateJourneyWithRestStops,
} from './interactionFieldReadiness.js';

const DIALOGUE_CHOICE_KEY_CODES = ['Digit1', 'Digit2', 'Digit3'];
const QUEST_STATUS = Object.freeze({
	LOCKED: 'locked', AVAILABLE: 'available', ACTIVE: 'active', READY: 'ready', COMPLETED: 'completed',
});

export const INTERACTION_FACTIONS = Object.freeze({ DRAGONSTONE: 'dragonstone' });
const DEFAULT_REPUTATION = Object.freeze({ [INTERACTION_FACTIONS.DRAGONSTONE]: 0 });
export const INTERACTION_PROGRESSION = Object.freeze({ START_LEVEL: 1, XP_PER_LEVEL: 100, MAX_LEVEL: 20 });

function createWatchWorldState() {
	const values = { dragonstoneWatchPolicy: null, dragonstoneExpeditionRoutes: [], dragonstoneExpeditionMasteryClaimed: false };
	function set(key, value) {
		if (key === 'dragonstoneWatchPolicy') {
			if (![null, WATCH_POLICY.DISCIPLINE, WATCH_POLICY.MERCY].includes(value)) return false;
			values[key] = value;
			return true;
		}
		if (key === 'dragonstoneExpeditionRoutes') {
			if (!Array.isArray(value)) return false;
			const authoredRouteIds = new Set(EXPEDITION_BOARD_ROUTES.map((route) => route.id));
			values[key] = [...new Set(value.map((routeId) => String(routeId ?? '').trim()).filter((routeId) => routeId && authoredRouteIds.has(routeId)))].slice(0, EXPEDITION_BOARD_ROUTES.length);
			return true;
		}
		if (key === 'dragonstoneExpeditionMasteryClaimed') {
			values[key] = value === true && values.dragonstoneExpeditionRoutes.length === EXPEDITION_BOARD_ROUTES.length;
			return true;
		}
		return false;
	}
	function get(key) { return Array.isArray(values[key]) ? [...values[key]] : values[key] ?? null; }
	function hasCompletedExpedition(routeId) { return values.dragonstoneExpeditionRoutes.includes(routeId); }
	function completeExpedition(routeId) {
		const id = String(routeId ?? '').trim();
		if (!id || hasCompletedExpedition(id) || !EXPEDITION_BOARD_ROUTES.some((route) => route.id === id)) return false;
		values.dragonstoneExpeditionRoutes = [...values.dragonstoneExpeditionRoutes, id];
		return true;
	}
	function claimExpeditionMastery() {
		if (values.dragonstoneExpeditionMasteryClaimed || values.dragonstoneExpeditionRoutes.length !== EXPEDITION_BOARD_ROUTES.length) return false;
		values.dragonstoneExpeditionMasteryClaimed = true;
		return true;
	}
	function snapshot() {
		const result = { dragonstoneWatchPolicy: values.dragonstoneWatchPolicy };
		if (values.dragonstoneExpeditionRoutes.length > 0) result.dragonstoneExpeditionRoutes = [...values.dragonstoneExpeditionRoutes];
		if (values.dragonstoneExpeditionMasteryClaimed) result.dragonstoneExpeditionMasteryClaimed = true;
		return result;
	}
	function restore(saved) {
		values.dragonstoneWatchPolicy = null;
		values.dragonstoneExpeditionRoutes = [];
		values.dragonstoneExpeditionMasteryClaimed = false;
		if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
		set('dragonstoneWatchPolicy', saved.dragonstoneWatchPolicy ?? null);
		set('dragonstoneExpeditionRoutes', saved.dragonstoneExpeditionRoutes ?? []);
		set('dragonstoneExpeditionMasteryClaimed', saved.dragonstoneExpeditionMasteryClaimed === true);
	}
	return { get, set, snapshot, restore, hasCompletedExpedition, completeExpedition, claimExpeditionMastery };
}
function watchPolicyLabel(policy) { if (policy === WATCH_POLICY.MERCY) return 'İkinci şans'; if (policy === WATCH_POLICY.DISCIPLINE) return 'Sıkı disiplin'; return null; }

export const EXPEDITION_BOARD_ROUTES = Object.freeze([
	Object.freeze({
		id: 'dragonstone-watch-circuit', label: 'Nöbet Yolu Devriyesi', summary: 'Dragonstone nöbet yollarını tek seferde dolaş.',
		reward: Object.freeze({ experience: 20, reputation: 1, copper: 8 }),
		steps: Object.freeze([
			Object.freeze({ type: 'travel', originId: 'dragonstone', destinationId: 'dragonstone-watch-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 10 }),
			Object.freeze({ type: 'travel', originId: 'dragonstone-watch-road', destinationId: 'dragonstone-harbor-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 25 }),
			Object.freeze({ type: 'travel', originId: 'dragonstone-harbor-road', destinationId: 'dragonstone', discovered: true, routeOpen: true, inCombat: false, distanceKm: 20 }),
		]),
	}),
	Object.freeze({
		id: 'dragonstone-harbor-tavern-run', label: 'Liman Taverna Seferi', summary: 'Nöbet yolundan liman tavernasına git, dinlen ve dönüş hattını tamamla.',
		reward: Object.freeze({ experience: 30, reputation: 2, copper: 12 }),
		steps: Object.freeze([
			Object.freeze({ type: 'travel', originId: 'dragonstone', destinationId: 'dragonstone-watch-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 28 }),
			Object.freeze({ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'dragonstone-harbor-tavern', discovered: true, open: true, inCombat: false }),
			Object.freeze({ type: 'travel', originId: 'dragonstone-harbor-tavern', destinationId: 'dragonstone-harbor-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 30 }),
		]),
	}),
	Object.freeze({
		id: 'dragonstone-ridge-camp', label: 'Sırt Kampı Seferi', summary: 'Sırt hattına çık, mevcut kamp erzağıyla toparlan ve liman yoluna in.',
		reward: Object.freeze({ experience: 25, reputation: 2, copper: 10 }),
		steps: Object.freeze([
			Object.freeze({ type: 'travel', originId: 'dragonstone', destinationId: 'dragonstone-ridge', discovered: true, routeOpen: true, inCombat: false, distanceKm: 30 }),
			Object.freeze({ type: 'rest', kind: REST_KIND.CAMP, siteId: 'dragonstone-ridge-camp', open: true, inCombat: false }),
			Object.freeze({ type: 'travel', originId: 'dragonstone-ridge-camp', destinationId: 'dragonstone-harbor-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 24 }),
		]),
	}),
]);

export const EXPEDITION_MASTERY_REWARD = Object.freeze({ experience: 50, reputation: 3, copper: 20 });

function readinessFromInventory(inventory = {}) { return inventory?.fieldReadiness?.tier ? inventory.fieldReadiness : inventory; }
export function evaluateExpeditionBoard(inventory = {}, journey = {}, worldState = {}, routes = EXPEDITION_BOARD_ROUTES) {
	const startingFatigueKm = Math.max(0, Number(journey?.fatigueKm) || 0);
	const completedRouteIds = new Set(Array.isArray(worldState?.dragonstoneExpeditionRoutes) ? worldState.dragonstoneExpeditionRoutes : []);
	const entries = (Array.isArray(routes) ? routes : []).map((route, index) => {
		const plan = evaluateJourneyWithRestStops(readinessFromInventory(inventory), route.steps, { startingFatigueKm });
		const blockedStep = plan.steps?.find((step) => step.index === plan.blockedAtStepIndex) ?? null;
		const reasons = blockedStep?.type === 'rest' ? blockedStep?.decision?.reasons : blockedStep?.reasons;
		const completed = completedRouteIds.has(route.id);
		return Object.freeze({ id: route.id, label: route.label, summary: route.summary, reward: route.reward, index, steps: route.steps, ready: plan.complete, status: plan.complete ? 'ready' : 'blocked', completed, firstRewardAvailable: !completed, plan, reasons: Object.freeze([...(reasons ?? [])]) });
	});
	const completedRouteCount = entries.filter((entry) => entry.completed).length;
	const masteryClaimed = worldState?.dragonstoneExpeditionMasteryClaimed === true;
	return Object.freeze({ startingFatigueKm, completedRouteCount, masteryClaimed, masteryReady: completedRouteCount === entries.length && entries.length > 0 && !masteryClaimed, masteryReward: EXPEDITION_MASTERY_REWARD, entries: Object.freeze(entries), readyRouteCount: entries.filter((entry) => entry.ready).length });
}
export function buildExpeditionBoardText(board = evaluateExpeditionBoard()) {
	const lines = ['Dragonstone Sefer Panosu', `Mevcut yorgunluk: ${board.startingFatigueKm} km`, `Tamamlanan kontrat: ${board.completedRouteCount ?? 0}/${board.entries?.length ?? 0}`];
	if (board.masteryClaimed) lines.push('Sefer ustalığı: TAMAMLANDI');
	else if (board.masteryReady) lines.push(`Sefer ustalığı: HAZIR · ${board.masteryReward?.experience ?? 0} XP + ${board.masteryReward?.reputation ?? 0} itibar + ${board.masteryReward?.copper ?? 0} bakır`);
	else lines.push(`Sefer ustalığı: İLERLEME ${board.completedRouteCount ?? 0}/${board.entries?.length ?? 0}`);
	if (!board.entries?.length) return [...lines, 'Açık sefer bulunmuyor.'].join('\n');
	lines.push('Bir sefer seç:');
	for (const [index, entry] of board.entries.entries()) {
		const requirement = entry.ready ? 'HAZIR' : `KİLİTLİ · ${entry.reasons?.join(', ') || 'rota uygun değil'}`;
		const reward = entry.completed ? 'ÖDÜL ALINDI' : `İLK ÖDÜL: ${entry.reward?.experience ?? 0} XP + ${entry.reward?.reputation ?? 0} itibar + ${entry.reward?.copper ?? 0} bakır`;
		lines.push(`${index + 1}. ${entry.label} · ${requirement} · ${entry.plan.totalDistanceKm} km · ${entry.plan.totalRequiredTravelPacks} azık · ${reward}`);
	}
	return lines.join('\n');
}
export function buildExpeditionBoardResultText(entry, result = {}) {
	if (!entry) return 'Sefer seçilemedi.';
	if (result.ok === true) {
		const rewardText = result.firstCompletion === true
			? `\nKontrat ödülü: ${result.rewardExperience} XP + ${result.rewardReputation} Dragonstone itibarı + ${result.rewardCopper} bakır · kese ${result.balanceCopper}`
			: '\nKontrat daha önce tamamlandı · tekrar ödülü yok';
		const masteryText = result.masteryClaimed === true
			? `\nSEFER USTALIĞI KAZANILDI: ${result.masteryExperience} XP + ${result.masteryReputation} Dragonstone itibarı + ${result.masteryCopper} bakır · kese ${result.balanceCopper}`
			: '';
		return `${entry.label}\nSEFER TAMAMLANDI\nTüketilen yol azığı: ${result.consumedQuantity}${rewardText}${masteryText}\n${buildJourneyRestText(result.plan)}`;
	}
	return `${entry.label}\nSEFER BAŞLATILAMADI\n${buildJourneyRestText(result.plan ?? entry.plan)}`;
}

export const INTERACTION_QUESTS = Object.freeze([
	Object.freeze({
		id: 'law-of-the-watch',
		title: 'Nöbetin Kanunu',
		description: 'Stannis’in iki nöbetçisinin görev düzenini öğren.',
		prerequisite: null,
		reputationRequirement: null,
		accept: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 0 }),
		objectives: Object.freeze([Object.freeze({ id: 'hill-watch', label: 'Tepedeki nöbetçiyle konuş', npcId: 'stannis-guard-2', choiceIndex: 0 })]),
		turnIn: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1 }),
		reward: Object.freeze({
			label: 'Dragonstone nöbetçilerinin güveni',
			reputation: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, amount: 10 }),
			experience: 60,
			item: Object.freeze({ id: 'dragonstone-watch-seal', quantity: 1 }),
		}),
	}),
	Object.freeze({
		id: 'watch-under-pressure',
		title: 'Nöbetçinin Şüphesi',
		description: 'İki nöbetçinin birbirine dair tanıklığını tamamla ve nöbet düzeninin sonucuna karar ver.',
		prerequisite: 'law-of-the-watch',
		reputationRequirement: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, minimum: 10 }),
		accept: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 2 }),
		objectives: Object.freeze([
			Object.freeze({ id: 'partner', label: 'Nöbet arkadaşlığı hakkında konuş', npcId: 'stannis-guard-2', choiceIndex: 1, progressExperience: 20 }),
			Object.freeze({ id: 'solitude', label: 'Yalnız nöbet hakkında konuş', npcId: 'stannis-guard-2', choiceIndex: 2, progressExperience: 20 }),
		]),
		turnIns: Object.freeze([
			Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1, outcome: WATCH_POLICY.DISCIPLINE }),
			Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 3, outcome: WATCH_POLICY.MERCY, requirement: Object.freeze({ minimumLevel: 2, reputation: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, minimum: 10 }) }) }),
		]),
		reward: Object.freeze({
			label: 'Dragonstone nöbetçilerinin itimadı',
			reputation: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, amount: 5 }),
			experience: 90,
			item: Object.freeze({ id: 'watch-captains-writ', quantity: 1 }),
		}),
	}),
]);

function sameTrigger(trigger, npcId, choiceIndex) { return trigger?.npcId === npcId && trigger?.choiceIndex === choiceIndex; }

function createReputationState(initial = DEFAULT_REPUTATION) {
	const values = new Map(Object.entries(initial));
	function get(faction) { const value = Number(values.get(faction)); return Number.isFinite(value) ? value : 0; }
	function grant(faction, amount) { if (!faction || !Number.isFinite(amount) || amount === 0) return false; values.set(faction, Math.max(0, get(faction) + amount)); return true; }
	function snapshot() { return Object.fromEntries([...values.entries()].sort(([a], [b]) => a.localeCompare(b))); }
	function restore(saved) { values.clear(); for (const [faction, baseValue] of Object.entries(DEFAULT_REPUTATION)) values.set(faction, baseValue); if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return; for (const [faction, rawValue] of Object.entries(saved)) { const value = Number(rawValue); if (Number.isFinite(value) && value >= 0) values.set(faction, value); } }
	return { get, grant, snapshot, restore };
}

function createProgressionState() {
	let totalExperience = 0;
	function levelForExperience(experience) { return Math.min(INTERACTION_PROGRESSION.MAX_LEVEL, INTERACTION_PROGRESSION.START_LEVEL + Math.floor(experience / INTERACTION_PROGRESSION.XP_PER_LEVEL)); }
	function snapshot() { const level = levelForExperience(totalExperience); const atMaxLevel = level >= INTERACTION_PROGRESSION.MAX_LEVEL; const levelFloor = (level - INTERACTION_PROGRESSION.START_LEVEL) * INTERACTION_PROGRESSION.XP_PER_LEVEL; return { level, totalExperience, experienceIntoLevel: atMaxLevel ? 0 : totalExperience - levelFloor, experienceToNextLevel: atMaxLevel ? 0 : INTERACTION_PROGRESSION.XP_PER_LEVEL }; }
	function grant(amount) { if (!Number.isFinite(amount) || amount <= 0) return false; const cap = (INTERACTION_PROGRESSION.MAX_LEVEL - INTERACTION_PROGRESSION.START_LEVEL) * INTERACTION_PROGRESSION.XP_PER_LEVEL; totalExperience = Math.min(cap, totalExperience + amount); return true; }
	function restore(saved) { totalExperience = 0; if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return; const raw = Number(saved.totalExperience); if (!Number.isFinite(raw) || raw < 0) return; const cap = (INTERACTION_PROGRESSION.MAX_LEVEL - INTERACTION_PROGRESSION.START_LEVEL) * INTERACTION_PROGRESSION.XP_PER_LEVEL; totalExperience = Math.min(cap, raw); }
	return { grant, snapshot, restore };
}

function createQuestTracker({ definitions = INTERACTION_QUESTS, reputation, progression, onReward = () => {}, onObjectiveReward = () => {}, onOutcome = () => {} }) {
	const byId = new Map(definitions.map((quest) => [quest.id, quest]));
	const state = new Map(definitions.map((quest) => [quest.id, { status: quest.prerequisite || quest.reputationRequirement ? QUEST_STATUS.LOCKED : QUEST_STATUS.AVAILABLE, completedObjectives: new Set(), rewardGranted: false, outcome: null }]));
	function requirementsMet(quest) { if (quest.prerequisite && state.get(quest.prerequisite)?.status !== QUEST_STATUS.COMPLETED) return false; const requirement = quest.reputationRequirement; return !requirement || reputation.get(requirement.faction) >= requirement.minimum; }
	function turnInRequirementMet(turnIn) { const requirement = turnIn?.requirement; if (!requirement) return true; if (Number.isFinite(requirement.minimumLevel) && progression.snapshot().level < requirement.minimumLevel) return false; const rep = requirement.reputation; return !rep || reputation.get(rep.faction) >= rep.minimum; }
	function unlockEligible() { for (const quest of definitions) { const current = state.get(quest.id); if (current.status === QUEST_STATUS.LOCKED && requirementsMet(quest)) current.status = QUEST_STATUS.AVAILABLE; } }
	function snapshot() { return definitions.map((quest) => { const current = state.get(quest.id); return { id: quest.id, title: quest.title, description: quest.description, status: current.status, objectives: quest.objectives.map((objective) => ({ id: objective.id, label: objective.label, completed: current.completedObjectives.has(objective.id) })), reward: quest.reward.label, rewardGranted: current.rewardGranted, outcome: current.outcome }; }); }
	function restore(savedSnapshot) { if (!Array.isArray(savedSnapshot)) return; for (const saved of savedSnapshot) { const quest = byId.get(saved?.id); const current = state.get(saved?.id); if (!quest || !current) continue; if (Object.values(QUEST_STATUS).includes(saved.status)) current.status = saved.status; current.completedObjectives.clear(); const validIds = new Set(quest.objectives.map((objective) => objective.id)); for (const objective of saved.objectives ?? []) if (objective?.completed && validIds.has(objective.id)) current.completedObjectives.add(objective.id); current.rewardGranted = current.status === QUEST_STATUS.COMPLETED && saved.rewardGranted === true; const validOutcomes = new Set((quest.turnIns ?? []).map((turnIn) => turnIn.outcome).filter(Boolean)); current.outcome = validOutcomes.has(saved.outcome) ? saved.outcome : null; } unlockEligible(); }
	function matchingTurnIn(quest, npcId, choiceIndex) { if (Array.isArray(quest.turnIns)) return quest.turnIns.find((turnIn) => sameTrigger(turnIn, npcId, choiceIndex)) ?? null; return sameTrigger(quest.turnIn, npcId, choiceIndex) ? quest.turnIn : null; }
	function consume(npcId, choiceIndex) { let changed = false; for (const quest of definitions) { const current = state.get(quest.id); if (current.status === QUEST_STATUS.LOCKED || current.status === QUEST_STATUS.COMPLETED) continue; if (current.status === QUEST_STATUS.AVAILABLE && sameTrigger(quest.accept, npcId, choiceIndex)) { current.status = QUEST_STATUS.ACTIVE; changed = true; continue; } if (current.status === QUEST_STATUS.ACTIVE) { for (const objective of quest.objectives) if (!current.completedObjectives.has(objective.id) && objective.npcId === npcId && objective.choiceIndex === choiceIndex) { current.completedObjectives.add(objective.id); onObjectiveReward(objective); changed = true; } if (quest.objectives.every((objective) => current.completedObjectives.has(objective.id))) current.status = QUEST_STATUS.READY; continue; } if (current.status === QUEST_STATUS.READY) { const turnIn = matchingTurnIn(quest, npcId, choiceIndex); if (!turnIn || !turnInRequirementMet(turnIn)) continue; current.status = QUEST_STATUS.COMPLETED; current.outcome = turnIn.outcome ?? null; if (!current.rewardGranted) { current.rewardGranted = true; onReward(quest.reward, quest); } if (current.outcome) onOutcome({ questId: quest.id, outcome: current.outcome }); changed = true; unlockEligible(); } } return changed; }
	return { consume, snapshot, restore, unlockEligible };
}

export function buildQuestJournalText(snapshot, reputationSnapshot = {}, progressionSnapshot = {}, worldStateSnapshot = {}) {
	const visible = (Array.isArray(snapshot) ? snapshot : []).filter((quest) => ['active', 'ready', 'completed'].includes(quest.status));
	const dragonstoneReputation = Number(reputationSnapshot[INTERACTION_FACTIONS.DRAGONSTONE]) || 0;
	const level = Number(progressionSnapshot.level) || INTERACTION_PROGRESSION.START_LEVEL;
	const xp = Number(progressionSnapshot.experienceIntoLevel) || 0;
	const xpToNext = Number(progressionSnapshot.experienceToNextLevel) || INTERACTION_PROGRESSION.XP_PER_LEVEL;
	const policyLabel = watchPolicyLabel(worldStateSnapshot.dragonstoneWatchPolicy);
	const completedExpeditions = Array.isArray(worldStateSnapshot.dragonstoneExpeditionRoutes) ? worldStateSnapshot.dragonstoneExpeditionRoutes.length : 0;
	const masteryClaimed = worldStateSnapshot.dragonstoneExpeditionMasteryClaimed === true;
	const lines = ['Görev Günlüğü', `Seviye: ${level} · XP: ${xp}/${xpToNext}`, `Dragonstone itibarı: ${dragonstoneReputation}`, `Sefer kontratları: ${completedExpeditions}/${EXPEDITION_BOARD_ROUTES.length}`, `Sefer ustalığı: ${masteryClaimed ? 'TAMAMLANDI' : completedExpeditions === EXPEDITION_BOARD_ROUTES.length ? 'HAZIR' : 'DEVAM EDİYOR'}`];
	if (policyLabel) lines.push(`Nöbet kararı: ${policyLabel}`);
	if (visible.length === 0) return [...lines, 'Henüz kabul edilmiş bir görev yok.'].join('\n');
	for (const quest of visible) { const status = quest.status === 'ready' ? 'TESLİME HAZIR' : quest.status === 'completed' ? 'TAMAMLANDI' : 'AKTİF'; lines.push(`\n${quest.title} — ${status}`); for (const objective of quest.objectives) lines.push(`${objective.completed ? '✓' : '○'} ${objective.label}`); if (quest.outcome) lines.push(`Sonuç: ${watchPolicyLabel(quest.outcome) ?? quest.outcome}`); if (quest.rewardGranted) lines.push(`Ödül: ${quest.reward}`); }
	return lines.join('\n');
}

export function createInteractionController({ interactionPrompt, dialogueBox, greetingTemplate, greetingsByNpcId = {}, choicesByNpcId = {}, radiusMeters, isPaused = () => false, onQuestChanged = () => {}, onReputationChanged = () => {}, onProgressionChanged = () => {}, onWorldStateChanged = () => {}, onInventoryChanged = () => {}, onEconomyChanged = () => {}, onJourneyChanged = () => {} }) {
	let activeNpc = null; let nearestNpc = null; let activeChoices = null; let activeNpcName = null; let journalOpen = false; let shopOpen = false; let expeditionBoardOpen = false; let activeExpeditionBoard = null;
	const reputation = createReputationState(); const progression = createProgressionState(); const worldState = createWatchWorldState(); const inventory = createInteractionInventoryState(); const economy = createInteractionEconomyState(); const journey = createInteractionJourneyState();
	const quests = createQuestTracker({ reputation, progression, onObjectiveReward(objective) { if (progression.grant(Number(objective?.progressExperience))) onProgressionChanged(progression.snapshot()); }, onReward(reward, quest) { const reputationReward = reward?.reputation; if (reputationReward && reputation.grant(reputationReward.faction, reputationReward.amount)) onReputationChanged(reputation.snapshot()); if (progression.grant(Number(reward?.experience))) onProgressionChanged(progression.snapshot()); if (reward?.item && inventory.grant(reward.item.id, reward.item.quantity, { sourceType: 'quest', sourceId: quest.id })) onInventoryChanged(inventory.snapshot()); }, onOutcome({ questId, outcome }) { if (questId === 'watch-under-pressure' && worldState.set('dragonstoneWatchPolicy', outcome)) onWorldStateChanged(worldState.snapshot()); } });
	function questById(id) { return quests.snapshot().find((quest) => quest.id === id); }
	function isChoiceAvailable(npcId, originalIndex) { if (npcId === 'stannis-guard-1' && originalIndex === 2) return questById('watch-under-pressure')?.status === QUEST_STATUS.AVAILABLE; return true; }
	function resolutionChoices() { const secondQuest = questById('watch-under-pressure'); if (secondQuest?.status !== QUEST_STATUS.READY) return null; const choices = [{ label: 'Nöbet düzenini sıkılaştır.', response: '{name}: Öyleyse gevşekliğe yer yok. Nöbet çizgisini bugün sıkılaştırırım.', originalIndex: 1 }]; if (progression.snapshot().level >= 2 && reputation.get(INTERACTION_FACTIONS.DRAGONSTONE) >= 10) choices.push({ label: 'Nöbetçiye ikinci bir şans ver.', response: '{name}: Seviyeni ve sözünün ağırlığını gördüm. Bir kez daha kendini kanıtlamasına izin vereceğim.', originalIndex: 3 }); return choices; }
	function getAvailableChoices(npcId) { if (npcId === 'stannis-guard-1') { const resolutions = resolutionChoices(); if (resolutions) return resolutions; } const choices = choicesByNpcId[npcId]; if (!choices || choices.length === 0) return null; const available = choices.map((choice, originalIndex) => ({ ...choice, originalIndex })).filter((choice) => isChoiceAvailable(npcId, choice.originalIndex)); return available.length > 0 ? available : null; }
	function outcomeGreeting(npcId, fallbackTemplate) { if (npcId !== 'stannis-guard-2') return fallbackTemplate; const policy = worldState.get('dragonstoneWatchPolicy'); if (policy === WATCH_POLICY.MERCY) return '{name}: Bana verdiğin ikinci şans boşa gitmeyecek. Tepedeki nöbet artık yalnız bir görev değil, borç bildiğim bir söz.'; if (policy === WATCH_POLICY.DISCIPLINE) return '{name}: Kararın duyuldu. Nöbet çizgisi sıkılaştı; artık hiçbir gevşeklik gözden kaçmayacak.'; return fallbackTemplate; }
	function openDialogue(npc) { journalOpen = false; shopOpen = false; expeditionBoardOpen = false; activeExpeditionBoard = null; activeNpc = npc; interactionPrompt.setVisible(false); activeNpcName = npc.displayName ?? 'Yabancı'; const npcId = npc.object3D.name; const baseTemplate = greetingsByNpcId[npcId] ?? greetingTemplate; activeChoices = getAvailableChoices(npcId); dialogueBox.show(outcomeGreeting(npcId, baseTemplate).replace('{name}', activeNpcName), activeChoices?.map((choice) => choice.label) ?? []); }
	function closeDialogue() { activeNpc = null; activeChoices = null; activeNpcName = null; journalOpen = false; shopOpen = false; expeditionBoardOpen = false; activeExpeditionBoard = null; dialogueBox.hide(); }
	function showJournal() { activeNpc = null; activeChoices = null; activeNpcName = null; journalOpen = true; shopOpen = false; expeditionBoardOpen = false; activeExpeditionBoard = null; interactionPrompt.setVisible(false); dialogueBox.show(buildQuestJournalText(quests.snapshot(), reputation.snapshot(), progression.snapshot(), worldState.snapshot())); }
	function showInventory() { activeNpc = null; activeChoices = null; activeNpcName = null; journalOpen = true; shopOpen = false; expeditionBoardOpen = false; activeExpeditionBoard = null; interactionPrompt.setVisible(false); dialogueBox.show(buildInventoryText(inventory.snapshot(), journey.snapshot())); }
	function showQuartermaster(feedback = '') { if (nearestNpc?.object3D?.name !== QUARTERMASTER_NPC_ID) return false; activeNpc = null; activeChoices = null; activeNpcName = null; journalOpen = true; shopOpen = true; expeditionBoardOpen = false; activeExpeditionBoard = null; interactionPrompt.setVisible(false); dialogueBox.show(buildQuartermasterText(economy.snapshot(), QUARTERMASTER_OFFERS, feedback), QUARTERMASTER_OFFERS.map((offer) => `${offer.label} — ${offer.priceCopper} bakır`)); return true; }
	function showExpeditionBoard() { if (nearestNpc?.object3D?.name !== QUARTERMASTER_NPC_ID) return false; activeNpc = null; activeChoices = null; activeNpcName = null; journalOpen = true; shopOpen = false; expeditionBoardOpen = true; activeExpeditionBoard = evaluateExpeditionBoard(inventory.snapshot(), journey.snapshot(), worldState.snapshot()); interactionPrompt.setVisible(false); dialogueBox.show(buildExpeditionBoardText(activeExpeditionBoard), activeExpeditionBoard.entries.map((entry) => `${entry.label} — ${entry.ready ? 'HAZIR' : 'KİLİTLİ'}${entry.completed ? ' · ÖDÜL ALINDI' : ''}`)); return true; }
	function selectShopOffer(index) { const offer = QUARTERMASTER_OFFERS[index]; if (!offer) return; const result = economy.purchase(offer, (...args) => inventory.grant(...args)); let feedback = 'Satın alma başarısız.'; if (result.ok) { feedback = `${offer.label} çantana eklendi. ${result.spentCopper} bakır ödendi.`; onInventoryChanged(inventory.snapshot()); onEconomyChanged(economy.snapshot()); } else if (result.reason === 'insufficient-funds') feedback = 'Kesende yeterli bakır yok.'; else if (result.reason === 'inventory-full') feedback = 'Bu eşyadan daha fazlasını taşıyamazsın.'; showQuartermaster(feedback); }
	function selectChoice(index) { const choice = activeChoices[index]; const npcId = activeNpc?.object3D?.name ?? ''; activeChoices = null; dialogueBox.show(choice.response.replace('{name}', activeNpcName)); if (quests.consume(npcId, choice.originalIndex)) onQuestChanged(quests.snapshot()); }
	function commitJourneyWithRestStops(steps = []) { const journeyBefore = journey.snapshot(); const result = inventory.commitJourneyWithRestStops(steps, { startingFatigueKm: journeyBefore.fatigueKm }); if (!result.ok) return { ...result, journey: journeyBefore }; if (!journey.applyCommit(result)) return { ...result, ok: false, reason: 'journey-state-commit-failed', journey: journeyBefore }; const journeySnapshot = journey.snapshot(); if (result.consumedQuantity > 0) onInventoryChanged(result.inventory); onJourneyChanged(journeySnapshot); return { ...result, journey: journeySnapshot }; }
	function selectExpeditionRoute(index) {
		const entry = activeExpeditionBoard?.entries?.[index];
		if (!entry) return;
		let result = commitJourneyWithRestStops(entry.steps);
		if (result.ok === true) {
			const firstCompletion = worldState.completeExpedition(entry.id);
			let rewardExperience = 0;
			let rewardReputation = 0;
			let rewardCopper = 0;
			let masteryExperience = 0;
			let masteryReputation = 0;
			let masteryCopper = 0;
			let balanceCopper = economy.snapshot().copper;
			if (firstCompletion) {
				rewardExperience = Math.max(0, Math.floor(Number(entry.reward?.experience) || 0));
				rewardReputation = Math.max(0, Math.floor(Number(entry.reward?.reputation) || 0));
				rewardCopper = Math.max(0, Math.floor(Number(entry.reward?.copper) || 0));
				if (progression.grant(rewardExperience)) onProgressionChanged(progression.snapshot());
				if (reputation.grant(INTERACTION_FACTIONS.DRAGONSTONE, rewardReputation)) onReputationChanged(reputation.snapshot());
				const credit = economy.credit(rewardCopper);
				if (credit.ok) { balanceCopper = credit.balanceCopper; onEconomyChanged(economy.snapshot()); }
			}
			const masteryClaimed = worldState.claimExpeditionMastery();
			if (masteryClaimed) {
				masteryExperience = EXPEDITION_MASTERY_REWARD.experience;
				masteryReputation = EXPEDITION_MASTERY_REWARD.reputation;
				masteryCopper = EXPEDITION_MASTERY_REWARD.copper;
				if (progression.grant(masteryExperience)) onProgressionChanged(progression.snapshot());
				if (reputation.grant(INTERACTION_FACTIONS.DRAGONSTONE, masteryReputation)) onReputationChanged(reputation.snapshot());
				const masteryCredit = economy.credit(masteryCopper, { sourceId: 'expedition-mastery', label: 'Sefer ustalığı' });
				if (masteryCredit.ok) { balanceCopper = masteryCredit.balanceCopper; onEconomyChanged(economy.snapshot()); }
			}
			if (firstCompletion || masteryClaimed) onWorldStateChanged(worldState.snapshot());
			result = { ...result, firstCompletion, rewardExperience, rewardReputation, rewardCopper, masteryClaimed, masteryExperience, masteryReputation, masteryCopper, balanceCopper };
		}
		expeditionBoardOpen = false; activeExpeditionBoard = null; activeChoices = null;
		dialogueBox.show(buildExpeditionBoardResultText(entry, result));
	}
	function rebuildRewardStateFromQuestRewards(savedQuestSnapshot, { includeObjectiveExperience = true } = {}) { reputation.restore(DEFAULT_REPUTATION); progression.restore(null); inventory.restore(null); for (const savedQuest of Array.isArray(savedQuestSnapshot) ? savedQuestSnapshot : []) { const definition = INTERACTION_QUESTS.find((quest) => quest.id === savedQuest?.id); if (!definition) continue; if (includeObjectiveExperience) for (const savedObjective of savedQuest.objectives ?? []) { if (!savedObjective?.completed) continue; const objective = definition.objectives.find((candidate) => candidate.id === savedObjective.id); progression.grant(Number(objective?.progressExperience)); } if (savedQuest.status !== QUEST_STATUS.COMPLETED || savedQuest.rewardGranted !== true) continue; const reward = definition.reward; if (reward?.reputation) reputation.grant(reward.reputation.faction, reward.reputation.amount); progression.grant(Number(reward?.experience)); if (reward?.item) inventory.grant(reward.item.id, reward.item.quantity, { sourceType: 'quest', sourceId: definition.id }); } quests.unlockEligible(); }
	function inferWorldStateFromQuestSnapshot(savedQuestSnapshot) { worldState.restore(null); const secondQuest = (Array.isArray(savedQuestSnapshot) ? savedQuestSnapshot : []).find((quest) => quest?.id === 'watch-under-pressure'); if (secondQuest?.status !== QUEST_STATUS.COMPLETED) return; const inferred = [WATCH_POLICY.DISCIPLINE, WATCH_POLICY.MERCY].includes(secondQuest.outcome) ? secondQuest.outcome : WATCH_POLICY.DISCIPLINE; worldState.set('dragonstoneWatchPolicy', inferred); }
	function restoreRpgSnapshot(saved) { if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return; const schemaVersion = Number(saved.schemaVersion) || 1; reputation.restore(saved.reputation); progression.restore(saved.progression); inventory.restore(saved.inventory); economy.restore(saved.economy); worldState.restore(saved.worldState); journey.restore(saved.journey); quests.restore(saved.quests); if (!saved.reputation || !saved.progression || !saved.inventory) { const explicitReputation = saved.reputation; const explicitProgression = saved.progression; const explicitInventory = saved.inventory; rebuildRewardStateFromQuestRewards(saved.quests, { includeObjectiveExperience: schemaVersion >= 3 }); if (explicitReputation) reputation.restore(explicitReputation); if (explicitProgression) progression.restore(explicitProgression); if (explicitInventory) inventory.restore(explicitInventory); } if (!saved.worldState) inferWorldStateFromQuestSnapshot(saved.quests); onReputationChanged(reputation.snapshot()); onProgressionChanged(progression.snapshot()); onInventoryChanged(inventory.snapshot()); onEconomyChanged(economy.snapshot()); onWorldStateChanged(worldState.snapshot()); onJourneyChanged(journey.snapshot()); onQuestChanged(quests.snapshot()); }
	return {
		handleChoice(index) { if (isPaused() || !Number.isInteger(index)) return; if (shopOpen) { selectShopOffer(index); return; } if (expeditionBoardOpen) { selectExpeditionRoute(index); return; } if (!activeChoices || index < 0 || index >= activeChoices.length) return; selectChoice(index); },
		update(npcs, playerPos) { nearestNpc = null; let nearestDistance = Infinity; for (const npc of npcs) { const distance = Math.hypot(npc.object3D.position.x - playerPos.x, npc.object3D.position.z - playerPos.z); if (distance < radiusMeters && distance < nearestDistance) { nearestNpc = npc; nearestDistance = distance; } } if (activeNpc && activeNpc !== nearestNpc) closeDialogue(); if ((shopOpen || expeditionBoardOpen) && nearestNpc?.object3D?.name !== QUARTERMASTER_NPC_ID) closeDialogue(); interactionPrompt.setVisible(!activeNpc && !journalOpen && nearestNpc !== null); },
		handleKeyDown(event) { if (isPaused() || event.repeat) return; if (shopOpen) { const shopIndex = DIALOGUE_CHOICE_KEY_CODES.indexOf(event.code); if (shopIndex !== -1 && shopIndex < QUARTERMASTER_OFFERS.length) { selectShopOffer(shopIndex); return; } } if (expeditionBoardOpen) { const routeIndex = DIALOGUE_CHOICE_KEY_CODES.indexOf(event.code); if (routeIndex !== -1 && routeIndex < (activeExpeditionBoard?.entries?.length ?? 0)) { selectExpeditionRoute(routeIndex); return; } } if (event.code === 'KeyB') { if (shopOpen) closeDialogue(); else showQuartermaster(); return; } if (event.code === 'KeyT') { if (expeditionBoardOpen) closeDialogue(); else showExpeditionBoard(); return; } if (event.code === 'KeyJ') { if (journalOpen) closeDialogue(); else showJournal(); return; } if (event.code === 'KeyI') { if (journalOpen) closeDialogue(); else showInventory(); return; } if (event.code === 'Escape') { if (activeNpc || journalOpen) closeDialogue(); return; } if (activeChoices) { const index = DIALOGUE_CHOICE_KEY_CODES.indexOf(event.code); if (index !== -1 && index < activeChoices.length) { selectChoice(index); return; } } if (event.code !== 'KeyE') return; if (activeNpc) closeDialogue(); else if (nearestNpc) openDialogue(nearestNpc); },
		showQuestJournal: showJournal, showInventory, showQuartermaster, showExpeditionBoard, commitJourneyWithRestStops,
		getQuestSnapshot: quests.snapshot, getReputationSnapshot: reputation.snapshot, getProgressionSnapshot: progression.snapshot, getInventorySnapshot: inventory.snapshot, getEconomySnapshot: economy.snapshot, getWorldStateSnapshot: worldState.snapshot, getJourneySnapshot: journey.snapshot,
		getRpgSnapshot() { const journeySnapshot = journey.snapshot(); const hasJourneyState = journeySnapshot.commitCount > 0 || journeySnapshot.fatigueKm > 0 || journeySnapshot.lastDestinationId !== null || journeySnapshot.recentReceipts.length > 0; const result = { schemaVersion: hasJourneyState ? 6 : 5, quests: quests.snapshot(), reputation: reputation.snapshot(), progression: progression.snapshot(), inventory: inventory.snapshot(), economy: economy.snapshot(), worldState: worldState.snapshot() }; if (hasJourneyState) result.journey = journeySnapshot; return result; },
		restoreQuestSnapshot(snapshot) { quests.restore(snapshot); rebuildRewardStateFromQuestRewards(snapshot, { includeObjectiveExperience: true }); inferWorldStateFromQuestSnapshot(snapshot); economy.restore(null); journey.restore(null); onReputationChanged(reputation.snapshot()); onProgressionChanged(progression.snapshot()); onInventoryChanged(inventory.snapshot()); onEconomyChanged(economy.snapshot()); onWorldStateChanged(worldState.snapshot()); onJourneyChanged(journey.snapshot()); onQuestChanged(quests.snapshot()); },
		restoreRpgSnapshot,
	};
}
