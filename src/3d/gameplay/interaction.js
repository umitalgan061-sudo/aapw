/**
 * FAZ 5 interaction controller — proximity dialogue plus a small RPG quest lifecycle that reuses
 * the already-shipped Stannis guard choices. Quest state stays inside the existing interaction
 * owner instead of introducing a parallel dialogue/inventory/economy framework.
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

export const INTERACTION_QUESTS = Object.freeze([
	Object.freeze({
		id: 'law-of-the-watch',
		title: 'Nöbetin Kanunu',
		description: 'Stannis’in iki nöbetçisinin görev düzenini öğren.',
		prerequisite: null,
		accept: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 0 }),
		objectives: Object.freeze([
			Object.freeze({ id: 'hill-watch', label: 'Tepedeki nöbetçiyle konuş', npcId: 'stannis-guard-2', choiceIndex: 0 }),
		]),
		turnIn: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1 }),
		reward: 'Dragonstone nöbetçilerinin güveni',
	}),
	Object.freeze({
		id: 'watch-under-pressure',
		title: 'Nöbetçinin Şüphesi',
		description: 'İki nöbetçinin birbirine dair tanıklığını tamamla.',
		prerequisite: 'law-of-the-watch',
		accept: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 2 }),
		objectives: Object.freeze([
			Object.freeze({ id: 'partner', label: 'Nöbet arkadaşlığı hakkında konuş', npcId: 'stannis-guard-2', choiceIndex: 1 }),
			Object.freeze({ id: 'solitude', label: 'Yalnız nöbet hakkında konuş', npcId: 'stannis-guard-2', choiceIndex: 2 }),
		]),
		turnIn: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1 }),
		reward: 'Dragonstone nöbetçilerinin itimadı',
	}),
]);

function sameTrigger(trigger, npcId, choiceIndex) {
	return trigger?.npcId === npcId && trigger?.choiceIndex === choiceIndex;
}

function createQuestTracker(definitions = INTERACTION_QUESTS) {
	const byId = new Map(definitions.map((quest) => [quest.id, quest]));
	const state = new Map(definitions.map((quest) => [quest.id, {
		status: quest.prerequisite ? QUEST_STATUS.LOCKED : QUEST_STATUS.AVAILABLE,
		completedObjectives: new Set(),
		rewardGranted: false,
	}]));

	function unlockEligible() {
		for (const quest of definitions) {
			const current = state.get(quest.id);
			if (current.status !== QUEST_STATUS.LOCKED) continue;
			if (state.get(quest.prerequisite)?.status === QUEST_STATUS.COMPLETED) current.status = QUEST_STATUS.AVAILABLE;
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
				reward: quest.reward,
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
				current.rewardGranted = true;
				changed = true;
				unlockEligible();
			}
		}
		return changed;
	}

	return { consume, snapshot, restore };
}

export function buildQuestJournalText(snapshot) {
	const visible = (Array.isArray(snapshot) ? snapshot : []).filter((quest) => ['active', 'ready', 'completed'].includes(quest.status));
	if (visible.length === 0) return 'Görev Günlüğü\nHenüz kabul edilmiş bir görev yok.';
	const lines = ['Görev Günlüğü'];
	for (const quest of visible) {
		const status = quest.status === 'ready' ? 'TESLİME HAZIR' : quest.status === 'completed' ? 'TAMAMLANDI' : 'AKTİF';
		lines.push(`\n${quest.title} — ${status}`);
		for (const objective of quest.objectives) lines.push(`${objective.completed ? '✓' : '○'} ${objective.label}`);
		if (quest.rewardGranted) lines.push(`Ödül: ${quest.reward}`);
	}
	return lines.join('\n');
}

/** Existing proximity dialogue controller with quest/journal projection layered into its choice seam. */
export function createInteractionController({
	interactionPrompt,
	dialogueBox,
	greetingTemplate,
	greetingsByNpcId = {},
	choicesByNpcId = {},
	radiusMeters,
	isPaused = () => false,
	onQuestChanged = () => {},
}) {
	let activeNpc = null;
	let nearestNpc = null;
	let activeChoices = null;
	let activeNpcName = null;
	let journalOpen = false;
	const quests = createQuestTracker();

	function openDialogue(npc) {
		journalOpen = false;
		activeNpc = npc;
		interactionPrompt.setVisible(false);
		activeNpcName = npc.displayName ?? 'Yabancı';
		const template = greetingsByNpcId[npc.object3D.name] ?? greetingTemplate;
		const choices = choicesByNpcId[npc.object3D.name];
		activeChoices = choices && choices.length > 0 ? choices : null;
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
		dialogueBox.show(buildQuestJournalText(quests.snapshot()));
	}

	function selectChoice(index) {
		const choice = activeChoices[index];
		const npcId = activeNpc?.object3D?.name ?? '';
		activeChoices = null;
		dialogueBox.show(choice.response.replace('{name}', activeNpcName));
		if (quests.consume(npcId, index)) onQuestChanged(quests.snapshot());
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
		restoreQuestSnapshot(snapshot) {
			quests.restore(snapshot);
			onQuestChanged(quests.snapshot());
		},
	};
}
