import { EVENTS } from '../config.js';
import { gameEvents } from '../eventBus.js';
import { createQuestSystem } from './questSystem.js';

/**
 * FAZ 5 interaction controller — owns the proximity-prompt/dialogue-box open/close state machine
 * so `game3d.js` only forwards frame updates and input. Dialogue remains UI/state focused: higher
 * level systems observe consumed choices through `onChoiceSelected`; the default adapter feeds the
 * shared quest lifecycle without requiring `game3d.js` to know quest content.
 * @module gameplay/interaction
 */

/** Digit-key `event.code` values mapped to choice array indices, in order. */
const DIALOGUE_CHOICE_KEY_CODES = ['Digit1', 'Digit2', 'Digit3'];

// One shared in-memory quest journal for the shipped 3D scene. SaveSystem does not exist yet, so
// this module deliberately keeps persistence out of the integration; `questSystem.getSnapshot()` /
// `restoreSnapshot()` are already serializable seams for that future owner.
const defaultQuestSystem = createQuestSystem({
	eventsBus: gameEvents,
	worldEventName: EVENTS.WORLD_EVENT_TRIGGERED,
});

/**
 * @param {object} options
 * @param {{setVisible: (visible: boolean) => void}} options.interactionPrompt
 * @param {{show: (text: string, choiceLabels?: string[]) => void, hide: () => void}} options.dialogueBox
 * @param {string} options.greetingTemplate Contains a literal `{name}` placeholder. Fallback only.
 * @param {Object<string, string>} [options.greetingsByNpcId] Keyed by NPC id (`object3D.name`).
 * @param {Object<string, {label: string, response: string}[]>} [options.choicesByNpcId]
 * @param {number} options.radiusMeters
 * @param {() => boolean} [options.isPaused] While true input is ignored.
 * @param {(selection: {npcId: string, npcName: string, choiceIndex: number, choice: {label: string, response: string}}) => void}
 *   [options.onChoiceSelected] Called exactly once after a visible choice is consumed. Defaults to
 *   the shared quest adapter; tests/alternate hosts may inject another consumer without coupling.
 * @returns {{update: Function, handleKeyDown: Function, handleChoice: Function, getQuestSnapshot: Function}}
 */
export function createInteractionController({
	interactionPrompt,
	dialogueBox,
	greetingTemplate,
	greetingsByNpcId = {},
	choicesByNpcId = {},
	radiusMeters,
	isPaused = () => false,
	onChoiceSelected = defaultQuestSystem.handleDialogueChoice,
}) {
	let activeNpc = null;
	let nearestNpc = null;
	let activeChoices = null;
	let activeNpcName = null;

	function openDialogue(npc) {
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
		dialogueBox.hide();
	}

	/** @param {number} index Into `activeChoices` — caller already validated it's in range. */
	function selectChoice(index) {
		const choice = activeChoices[index];
		const npcId = activeNpc?.object3D?.name ?? '';
		const npcName = activeNpcName;
		activeChoices = null; // consumed — a further key press cannot trigger a second choice
		dialogueBox.show(choice.response.replace('{name}', npcName));
		if (typeof onChoiceSelected === 'function') {
			onChoiceSelected({ npcId, npcName, choiceIndex: index, choice });
		}
	}

	return {
		/** Selects a visible dialogue choice by zero-based index (mobile/PWA pointer path). */
		handleChoice(index) {
			if (isPaused()) return;
			if (!Number.isInteger(index) || !activeChoices || index < 0 || index >= activeChoices.length) return;
			selectChoice(index);
		},

		/** Call once per frame with the current NPC list and player world position. */
		update(npcs, playerPos) {
			nearestNpc = null;
			let nearestDistance = Infinity;
			for (const npc of npcs) {
				const dx = npc.object3D.position.x - playerPos.x;
				const dz = npc.object3D.position.z - playerPos.z;
				const distance = Math.hypot(dx, dz);
				if (distance < radiusMeters && distance < nearestDistance) {
					nearestNpc = npc;
					nearestDistance = distance;
				}
			}
			if (activeNpc && activeNpc !== nearestNpc) closeDialogue();
			interactionPrompt.setVisible(!activeNpc && nearestNpc !== null);
		},

		/** Pass a `keydown` event straight through from the caller's own listener. */
		handleKeyDown(event) {
			if (isPaused()) return;
			if (event.repeat) return;
			if (event.code === 'Escape') {
				if (activeNpc) closeDialogue();
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

		/** Read-only serializable quest state for debug/UI/save adapters. */
		getQuestSnapshot() {
			return defaultQuestSystem.getSnapshot();
		},
	};
}
