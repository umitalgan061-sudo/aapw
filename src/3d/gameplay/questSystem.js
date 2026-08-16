/**
 * Minimal event-driven quest lifecycle for the 3D RPG.
 *
 * This module deliberately owns quest state only. It does not create a second inventory,
 * economy, dialogue, or save framework. Dialogue selections are fed in by `interaction.js`,
 * rewards are published as serializable events for the existing/future progression adapters,
 * and callers may persist/restore the plain snapshot when a SaveSystem exists.
 * @module gameplay/questSystem
 */

export const QUEST_EVENTS = Object.freeze({
	ACCEPTED: 'quest:accepted',
	UPDATED: 'quest:updated',
	READY_TO_TURN_IN: 'quest:ready-to-turn-in',
	COMPLETED: 'quest:completed',
	REWARD_GRANTED: 'quest:reward-granted',
});

const STATUS = Object.freeze({
	AVAILABLE: 'available',
	ACTIVE: 'active',
	READY: 'ready',
	COMPLETED: 'completed',
});

/**
 * First playable quest chain. It reuses two NPCs that already exist at Stannis's seat and three
 * existing dialogue choices, so the slice adds state/meaning without inventing a settlement,
 * character, or parallel dialogue tree.
 */
export const QUEST_DEFINITIONS = Object.freeze([
	Object.freeze({
		id: 'law-of-the-watch',
		title: 'Nöbetin Kanunu',
		description: 'Stannis’in nöbetçilerinden iki farklı görevin nasıl yürütüldüğünü öğren.',
		acceptTrigger: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 0 }),
		objectives: Object.freeze([
			Object.freeze({
				id: 'speak-to-hill-watch',
				label: 'Tepedeki nöbetçiyle konuş',
				trigger: Object.freeze({ npcId: 'stannis-guard-2', choiceIndex: 0 }),
			}),
		]),
		turnInTrigger: Object.freeze({ npcId: 'stannis-guard-1', choiceIndex: 1 }),
		reward: Object.freeze({
			id: 'stannis-watch-trust',
			label: 'Dragonstone nöbetçilerinin güveni',
			kind: 'reputation-token',
			amount: 1,
		}),
	}),
]);

function sameTrigger(trigger, selection) {
	return trigger?.npcId === selection?.npcId && trigger?.choiceIndex === selection?.choiceIndex;
}

function makeInitialState(definition) {
	return {
		id: definition.id,
		status: STATUS.AVAILABLE,
		completedObjectiveIds: new Set(),
		rewardGranted: false,
	};
}

function serializeState(state, definition) {
	return {
		id: state.id,
		title: definition.title,
		description: definition.description,
		status: state.status,
		objectives: definition.objectives.map((objective) => ({
			id: objective.id,
			label: objective.label,
			completed: state.completedObjectiveIds.has(objective.id),
		})),
		reward: { ...definition.reward },
		rewardGranted: state.rewardGranted,
	};
}

/**
 * @param {object} options
 * @param {{emit: (eventName: string, payload?: any) => void}} options.eventsBus Shared game EventBus.
 * @param {string} [options.worldEventName] Existing toast event name; omitted in headless tests.
 * @param {ReadonlyArray<object>} [options.definitions] Injectable for deterministic tests/content.
 * @returns {{handleDialogueChoice: Function, getSnapshot: Function, restoreSnapshot: Function}}
 */
export function createQuestSystem({ eventsBus, worldEventName = null, definitions = QUEST_DEFINITIONS }) {
	if (!eventsBus || typeof eventsBus.emit !== 'function') {
		throw new TypeError('createQuestSystem requires an eventsBus with emit(eventName, payload).');
	}

	const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
	const stateById = new Map(definitions.map((definition) => [definition.id, makeInitialState(definition)]));

	function emitToast({ id, icon, title, desc, color }) {
		if (!worldEventName) return;
		eventsBus.emit(worldEventName, { id, icon, title, desc, color });
	}

	function emitState(eventName, state, definition) {
		eventsBus.emit(eventName, serializeState(state, definition));
	}

	function accept(state, definition) {
		state.status = STATUS.ACTIVE;
		emitState(QUEST_EVENTS.ACCEPTED, state, definition);
		emitToast({
			id: `quest-accepted:${definition.id}`,
			icon: '📜',
			title: `Görev: ${definition.title}`,
			desc: definition.objectives[0]?.label ?? definition.description,
			color: '#d9b76e',
		});
	}

	function progress(state, definition, selection) {
		let changed = false;
		for (const objective of definition.objectives) {
			if (state.completedObjectiveIds.has(objective.id)) continue;
			if (!sameTrigger(objective.trigger, selection)) continue;
			state.completedObjectiveIds.add(objective.id);
			changed = true;
		}
		if (!changed) return false;

		const allComplete = definition.objectives.every((objective) => state.completedObjectiveIds.has(objective.id));
		state.status = allComplete ? STATUS.READY : STATUS.ACTIVE;
		emitState(QUEST_EVENTS.UPDATED, state, definition);
		if (allComplete) {
			emitState(QUEST_EVENTS.READY_TO_TURN_IN, state, definition);
			emitToast({
				id: `quest-ready:${definition.id}`,
				icon: '✓',
				title: `${definition.title} — tamamlanmaya hazır`,
				desc: 'Görevi teslim etmek için ilk nöbetçiye dön.',
				color: '#9fcf8a',
			});
		}
		return true;
	}

	function complete(state, definition) {
		state.status = STATUS.COMPLETED;
		state.rewardGranted = true;
		const snapshot = serializeState(state, definition);
		eventsBus.emit(QUEST_EVENTS.REWARD_GRANTED, {
			questId: definition.id,
			reward: { ...definition.reward },
		});
		eventsBus.emit(QUEST_EVENTS.COMPLETED, snapshot);
		emitToast({
			id: `quest-completed:${definition.id}`,
			icon: '🏆',
			title: `${definition.title} tamamlandı`,
			desc: `Ödül: ${definition.reward.label}`,
			color: '#e4c66a',
		});
	}

	return {
		/**
		 * Feed one consumed dialogue choice into the quest state machine.
		 * @param {{npcId: string, choiceIndex: number}} selection
		 */
		handleDialogueChoice(selection) {
			if (!selection || typeof selection.npcId !== 'string' || !Number.isInteger(selection.choiceIndex)) return;
			for (const definition of definitions) {
				const state = stateById.get(definition.id);
				if (state.status === STATUS.COMPLETED) continue;
				if (state.status === STATUS.AVAILABLE) {
					if (sameTrigger(definition.acceptTrigger, selection)) accept(state, definition);
					continue;
				}
				if (state.status === STATUS.ACTIVE) {
					progress(state, definition, selection);
					continue;
				}
				if (state.status === STATUS.READY && sameTrigger(definition.turnInTrigger, selection)) {
					complete(state, definition);
				}
			}
		},

		/** Plain serializable state for UI/save adapters. */
		getSnapshot() {
			return definitions.map((definition) => serializeState(stateById.get(definition.id), definition));
		},

		/**
		 * Restore a previous snapshot without firing gameplay events. Unknown quest/objective ids are
		 * ignored so future content additions remain backward-compatible.
		 */
		restoreSnapshot(snapshot) {
			if (!Array.isArray(snapshot)) return;
			for (const saved of snapshot) {
				const definition = definitionById.get(saved?.id);
				const state = stateById.get(saved?.id);
				if (!definition || !state) continue;
				const validStatuses = new Set(Object.values(STATUS));
				if (validStatuses.has(saved.status)) state.status = saved.status;
				state.completedObjectiveIds.clear();
				const knownObjectiveIds = new Set(definition.objectives.map((objective) => objective.id));
				for (const objective of saved.objectives ?? []) {
					if (objective?.completed && knownObjectiveIds.has(objective.id)) state.completedObjectiveIds.add(objective.id);
				}
				state.rewardGranted = state.status === STATUS.COMPLETED && saved.rewardGranted === true;
			}
		},
	};
}
