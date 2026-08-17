/**
 * FAZ 5 interaction controller — proximity dialogue plus a compact RPG quest/reputation/progression lifecycle
 * that reuses the already-shipped NPC choices. State stays inside the existing interaction owner
 * instead of introducing parallel dialogue, quest, inventory, economy, faction, or skill frameworks.
 * @module gameplay/interaction
 */

const DIALOGUE_CHOICE_KEY_CODES = ['Digit1', 'Digit2', 'Digit3'];

const QUEST_STATUS = Object.freeze({
	LOCKED: 'locked',
	AVAILABLE: 'available',
	ACTIVE: 'active',
	READY: 'ready',
	COMPLETED: 'completed',
});

export const INTERACTION_FACTIONS = Object.freeze({
	DRAGONSTONE: 'dragonstone',
});

const DEFAULT_REPUTATION = Object.freeze({
	[INTERACTION_FACTIONS.DRAGONSTONE]: 0,
});

export const INTERACTION_PROGRESSION = Object.freeze({
	START_LEVEL: 1,
	XP_PER_LEVEL: 100,
	MAX_LEVEL: 20,
});

export const INTERACTION_QUESTS = Object.freeze([
	Object.freeze({
		id: 'law-of-the-watch',
		title: 'Nöbetin Kanunu',
		description: 'Stannis’in iki nöbetçisinin görev düzenini öğren.',
		prerequisite: null,
		reputationRequirement: null,
		accept: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 0 }),
		objectives: Object.freeze([
			Object.freeze({ id: 'hill-watch', label: 'Tepedeki nöbetçiyle konuş', npcId: 'stannis-guard-2', choiceIndex: 0 }),
		]),
		turnIn: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1 }),
		reward: Object.freeze({
			label: 'Dragonstone nöbetçilerinin güveni',
			reputation: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, amount: 10 }),
			experience: 60,
		}),
	}),
	Object.freeze({
		id: 'watch-under-pressure',
		title: 'Nöbetçinin Şüphesi',
		description: 'İki nöbetçinin birbirine dair tanıklığını tamamla.',
		prerequisite: 'law-of-the-watch',
		reputationRequirement: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, minimum: 10 }),
		accept: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 2 }),
		objectives: Object.freeze([
			Object.freeze({ id: 'partner', label: 'Nöbet arkadaşlığı hakkında konuş', npcId: 'stannis-guard-2', choiceIndex: 1 }),
			Object.freeze({ id: 'solitude', label: 'Yalnız nöbet hakkında konuş', npcId: 'stannis-guard-2', choiceIndex: 2 }),
		]),
		turnIn: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1 }),
		reward: Object.freeze({
			label: 'Dragonstone nöbetçilerinin itimadı',
			reputation: Object.freeze({ faction: INTERACTION_FACTIONS.DRAGONSTONE, amount: 5 }),
			experience: 90,
		}),
	}),
]);

function sameTrigger(trigger, npcId, choiceIndex) {
	return trigger?.npcId === npcId && trigger?.choiceIndex === choiceIndex;
}

function createReputationState(initial = DEFAULT_REPUTATION) {
	const values = new Map(Object.entries(initial));

	function get(faction) {
		const value = Number(values.get(faction));
		return Number.isFinite(value) ? value : 0;
	}

	function grant(faction, amount) {
		if (!faction || !Number.isFinite(amount) || amount === 0) return false;
		values.set(faction, Math.max(0, get(faction) + amount));
		return true;
	}

	function snapshot() {
		return Object.fromEntries([...values.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	function restore(saved) {
		values.clear();
		for (const [faction, baseValue] of Object.entries(DEFAULT_REPUTATION)) values.set(faction, baseValue);
		if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
		for (const [faction, rawValue] of Object.entries(saved)) {
			const value = Number(rawValue);
			if (Number.isFinite(value) && value >= 0) values.set(faction, value);
		}
	}

	return { get, grant, snapshot, restore };
}

function createProgressionState() {
	let totalExperience = 0;

	function levelForExperience(experience) {
		return Math.min(
			INTERACTION_PROGRESSION.MAX_LEVEL,
			INTERACTION_PROGRESSION.START_LEVEL + Math.floor(experience / INTERACTION_PROGRESSION.XP_PER_LEVEL),
		);
	}

	function snapshot() {
		const level = levelForExperience(totalExperience);
		const atMaxLevel = level >= INTERACTION_PROGRESSION.MAX_LEVEL;
		const levelFloor = (level - INTERACTION_PROGRESSION.START_LEVEL) * INTERACTION_PROGRESSION.XP_PER_LEVEL;
		return {
			level,
			totalExperience,
			experienceIntoLevel: atMaxLevel ? 0 : totalExperience - levelFloor,
			experienceToNextLevel: atMaxLevel ? 0 : INTERACTION_PROGRESSION.XP_PER_LEVEL,
		};
	}

	function grant(amount) {
		if (!Number.isFinite(amount) || amount <= 0) return false;
		const cap = (INTERACTION_PROGRESSION.MAX_LEVEL - INTERACTION_PROGRESSION.START_LEVEL) * INTERACTION_PROGRESSION.XP_PER_LEVEL;
		totalExperience = Math.min(cap, totalExperience + amount);
		return true;
	}

	function restore(saved) {
		totalExperience = 0;
		if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
		const raw = Number(saved.totalExperience);
		if (!Number.isFinite(raw) || raw < 0) return;
		const cap = (INTERACTION_PROGRESSION.MAX_LEVEL - INTERACTION_PROGRESSION.START_LEVEL) * INTERACTION_PROGRESSION.XP_PER_LEVEL;
		totalExperience = Math.min(cap, raw);
	}

	return { grant, snapshot, restore };
}

function createQuestTracker({ definitions = INTERACTION_QUESTS, reputation, onReward = () => {} }) {
	const byId = new Map(definitions.map((quest) => [quest.id, quest]));
	const state = new Map(definitions.map((quest) => [quest.id, {
		status: quest.prerequisite || quest.reputationRequirement ? QUEST_STATUS.LOCKED : QUEST_STATUS.AVAILABLE,
		completedObjectives: new Set(),
		rewardGranted: false,
	}]));

	function requirementsMet(quest) {
		if (quest.prerequisite && state.get(quest.prerequisite)?.status !== QUEST_STATUS.COMPLETED) return false;
		const requirement = quest.reputationRequirement;
		if (requirement && reputation.get(requirement.faction) < requirement.minimum) return false;
		return true;
	}

	function unlockEligible() {
		for (const quest of definitions) {
			const current = state.get(quest.id);
			if (current.status === QUEST_STATUS.LOCKED && requirementsMet(quest)) current.status = QUEST_STATUS.AVAILABLE;
		}
	}

	function snapshot() {
		return definitions.map((quest) => {
			const current = state.get(quest.id);
			return {
				id: quest.id,
				title: quest.title,
				description: quest.description,
				status: current.status,
				objectives: quest.objectives.map((objective) => ({
					id: objective.id,
					label: objective.label,
					completed: current.completedObjectives.has(objective.id),
				})),
				reward: quest.reward.label,
				rewardGranted: current.rewardGranted,
			};
		});
	}

	function restore(savedSnapshot) {
		if (!Array.isArray(savedSnapshot)) return;
		for (const saved of savedSnapshot) {
			const quest = byId.get(saved?.id);
			const current = state.get(saved?.id);
			if (!quest || !current) continue;
			if (Object.values(QUEST_STATUS).includes(saved.status)) current.status = saved.status;
			current.completedObjectives.clear();
			const validIds = new Set(quest.objectives.map((objective) => objective.id));
			for (const objective of saved.objectives ?? []) {
				if (objective?.completed && validIds.has(objective.id)) current.completedObjectives.add(objective.id);
			}
			current.rewardGranted = current.status === QUEST_STATUS.COMPLETED && saved.rewardGranted === true;
		}
		unlockEligible();
	}

	function consume(npcId, choiceIndex) {
		let changed = false;
		for (const quest of definitions) {
			const current = state.get(quest.id);
			if (current.status === QUEST_STATUS.LOCKED || current.status === QUEST_STATUS.COMPLETED) continue;
			if (current.status === QUEST_STATUS.AVAILABLE && sameTrigger(quest.accept, npcId, choiceIndex)) {
				current.status = QUEST_STATUS.ACTIVE;
				changed = true;
				continue;
			}
			if (current.status === QUEST_STATUS.ACTIVE) {
				for (const objective of quest.objectives) {
					if (current.completedObjectives.has(objective.id)) continue;
					if (objective.npcId === npcId && objective.choiceIndex === choiceIndex) {
						current.completedObjectives.add(objective.id);
						changed = true;
					}
				}
				if (quest.objectives.every((objective) => current.completedObjectives.has(objective.id))) current.status = QUEST_STATUS.READY;
				continue;
			}
			if (current.status === QUEST_STATUS.READY && sameTrigger(quest.turnIn, npcId, choiceIndex)) {
				current.status = QUEST_STATUS.COMPLETED;
				if (!current.rewardGranted) {
					current.rewardGranted = true;
					onReward(quest.reward);
				}
				changed = true;
				unlockEligible();
			}
		}
		return changed;
	}

	return { consume, snapshot, restore, unlockEligible };
}

export function buildQuestJournalText(snapshot, reputationSnapshot = {}, progressionSnapshot = {}) {
	const visible = (Array.isArray(snapshot) ? snapshot : []).filter((quest) => ['active', 'ready', 'completed'].includes(quest.status));
	const dragonstoneReputation = Number(reputationSnapshot[INTERACTION_FACTIONS.DRAGONSTONE]) || 0;
	const level = Number(progressionSnapshot.level) || INTERACTION_PROGRESSION.START_LEVEL;
	const xp = Number(progressionSnapshot.experienceIntoLevel) || 0;
	const xpToNext = Number(progressionSnapshot.experienceToNextLevel) || INTERACTION_PROGRESSION.XP_PER_LEVEL;
	const lines = ['Görev Günlüğü', `Seviye: ${level} · XP: ${xp}/${xpToNext}`, `Dragonstone itibarı: ${dragonstoneReputation}`];
	if (visible.length === 0) {
		lines.push('Henüz kabul edilmiş bir görev yok.');
		return lines.join('\n');
	}
	for (const quest of visible) {
		const status = quest.status === 'ready' ? 'TESLİME HAZIR' : quest.status === 'completed' ? 'TAMAMLANDI' : 'AKTİF';
		lines.push(`\n${quest.title} — ${status}`);
		for (const objective of quest.objectives) lines.push(`${objective.completed ? '✓' : '○'} ${objective.label}`);
		if (quest.rewardGranted) lines.push(`Ödül: ${quest.reward}`);
	}
	return lines.join('\n');
}

/** Existing proximity dialogue controller with quest/reputation/progression projected into its choice seam. */
export function createInteractionController({
	interactionPrompt,
	dialogueBox,
	greetingTemplate,
	greetingsByNpcId = {},
	choicesByNpcId = {},
	radiusMeters,
	isPaused = () => false,
	onQuestChanged = () => {},
	onReputationChanged = () => {},
	onProgressionChanged = () => {},
}) {
	let activeNpc = null;
	let nearestNpc = null;
	let activeChoices = null;
	let activeNpcName = null;
	let journalOpen = false;
	const reputation = createReputationState();
	const progression = createProgressionState();
	const quests = createQuestTracker({
		reputation,
		onReward(reward) {
			const reputationReward = reward?.reputation;
			if (reputationReward && reputation.grant(reputationReward.faction, reputationReward.amount)) {
				onReputationChanged(reputation.snapshot());
			}
			if (progression.grant(Number(reward?.experience))) onProgressionChanged(progression.snapshot());
		},
	});

	function questById(id) {
		return quests.snapshot().find((quest) => quest.id === id);
	}

	function isChoiceAvailable(npcId, originalIndex) {
		if (npcId === 'stannis-guard-1' && originalIndex === 2) {
			return questById('watch-under-pressure')?.status === QUEST_STATUS.AVAILABLE;
		}
		return true;
	}

	function getAvailableChoices(npcId) {
		const choices = choicesByNpcId[npcId];
		if (!choices || choices.length === 0) return null;
		const available = choices
			.map((choice, originalIndex) => ({ ...choice, originalIndex }))
			.filter((choice) => isChoiceAvailable(npcId, choice.originalIndex));
		return available.length > 0 ? available : null;
	}

	function openDialogue(npc) {
		journalOpen = false;
		activeNpc = npc;
		interactionPrompt.setVisible(false);
		activeNpcName = npc.displayName ?? 'Yabancı';
		const npcId = npc.object3D.name;
		const template = greetingsByNpcId[npcId] ?? greetingTemplate;
		activeChoices = getAvailableChoices(npcId);
		dialogueBox.show(template.replace('{name}', activeNpcName), activeChoices?.map((choice) => choice.label) ?? []);
	}

	function closeDialogue() {
		activeNpc = null;
		activeChoices = null;
		activeNpcName = null;
		journalOpen = false;
		dialogueBox.hide();
	}

	function showJournal() {
		activeNpc = null;
		activeChoices = null;
		activeNpcName = null;
		journalOpen = true;
		interactionPrompt.setVisible(false);
		dialogueBox.show(buildQuestJournalText(quests.snapshot(), reputation.snapshot(), progression.snapshot()));
	}

	function selectChoice(index) {
		const choice = activeChoices[index];
		const npcId = activeNpc?.object3D?.name ?? '';
		activeChoices = null;
		dialogueBox.show(choice.response.replace('{name}', activeNpcName));
		if (quests.consume(npcId, choice.originalIndex)) onQuestChanged(quests.snapshot());
	}

	function rebuildRewardStateFromQuestRewards(savedQuestSnapshot) {
		reputation.restore(DEFAULT_REPUTATION);
		progression.restore(null);
		for (const savedQuest of Array.isArray(savedQuestSnapshot) ? savedQuestSnapshot : []) {
			if (savedQuest?.status !== QUEST_STATUS.COMPLETED || savedQuest.rewardGranted !== true) continue;
			const definition = INTERACTION_QUESTS.find((quest) => quest.id === savedQuest.id);
			const reward = definition?.reward;
			if (reward?.reputation) reputation.grant(reward.reputation.faction, reward.reputation.amount);
			progression.grant(Number(reward?.experience));
		}
		quests.unlockEligible();
	}

	function restoreRpgSnapshot(saved) {
		if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
		reputation.restore(saved.reputation);
		progression.restore(saved.progression);
		quests.restore(saved.quests);
		if (!saved.reputation || !saved.progression) {
			const explicitReputation = saved.reputation;
			const explicitProgression = saved.progression;
			rebuildRewardStateFromQuestRewards(saved.quests);
			if (explicitReputation) reputation.restore(explicitReputation);
			if (explicitProgression) progression.restore(explicitProgression);
		}
		onReputationChanged(reputation.snapshot());
		onProgressionChanged(progression.snapshot());
		onQuestChanged(quests.snapshot());
	}

	return {
		handleChoice(index) {
			if (isPaused()) return;
			if (!Number.isInteger(index) || !activeChoices || index < 0 || index >= activeChoices.length) return;
			selectChoice(index);
		},

		update(npcs, playerPos) {
			nearestNpc = null;
			let nearestDistance = Infinity;
			for (const npc of npcs) {
				const distance = Math.hypot(npc.object3D.position.x - playerPos.x, npc.object3D.position.z - playerPos.z);
				if (distance < radiusMeters && distance < nearestDistance) {
					nearestNpc = npc;
					nearestDistance = distance;
				}
			}
			if (activeNpc && activeNpc !== nearestNpc) closeDialogue();
			interactionPrompt.setVisible(!activeNpc && !journalOpen && nearestNpc !== null);
		},

		handleKeyDown(event) {
			if (isPaused() || event.repeat) return;
			if (event.code === 'KeyJ') {
				if (journalOpen) closeDialogue();
				else showJournal();
				return;
			}
			if (event.code === 'Escape') {
				if (activeNpc || journalOpen) closeDialogue();
				return;
			}
			if (activeChoices) {
				const index = DIALOGUE_CHOICE_KEY_CODES.indexOf(event.code);
				if (index !== -1 && index < activeChoices.length) {
					selectChoice(index);
					return;
				}
			}
			if (event.code !== 'KeyE') return;
			if (activeNpc) closeDialogue();
			else if (nearestNpc) openDialogue(nearestNpc);
		},

		showQuestJournal: showJournal,
		getQuestSnapshot: quests.snapshot,
		getReputationSnapshot: reputation.snapshot,
		getProgressionSnapshot: progression.snapshot,
		getRpgSnapshot() {
			return {
				schemaVersion: 2,
				quests: quests.snapshot(),
				reputation: reputation.snapshot(),
				progression: progression.snapshot(),
			};
		},
		restoreQuestSnapshot(snapshot) {
			quests.restore(snapshot);
			rebuildRewardStateFromQuestRewards(snapshot);
			onReputationChanged(reputation.snapshot());
			onProgressionChanged(progression.snapshot());
			onQuestChanged(quests.snapshot());
		},
		restoreRpgSnapshot,
	};
}
