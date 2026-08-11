/**
 * FAZ 5 interaction controller (run 33) — owns the proximity-prompt/dialogue-box open/close state
 * machine (nearest-NPC tracking, keypress handling, distance-based auto-close) so `game3d.js`'s
 * tick loop only calls one `update()` per frame and one `handleKeyDown()` per keydown event.
 * Extracted into its own module to stay under the project's 600-line-per-file cap — the same
 * reasoning ADR-0028 already used for the FAZ 5/6 spawn-resolution loops. Real per-NPC greeting
 * content landed run 40 (`INTERACTION_CONFIG.GREETINGS_BY_NPC_ID`, DECISIONS.md ADR-0051) —
 * `openDialogue` looks its speaker up by `object3D.name` (already carried as each NPC's spawn `id`
 * — see `gameplay/npc.js`'s `createNPC`), falling back to the old generic template for any id with
 * no entry. Run 44 (DECISIONS.md ADR-0058) adds an optional single-level choice branch on top of
 * the greeting for a small pilot subset of NPCs (`INTERACTION_CONFIG.CHOICES_BY_NPC_ID`) — picking
 * a numbered choice (Digit1/Digit2/Digit3) shows that choice's own response line; still no further
 * branching/quest hooks, and every NPC with no `CHOICES_BY_NPC_ID` entry keeps the old
 * greeting-then-close-on-E behavior unchanged.
 * @module gameplay/interaction
 */

/** Digit-key `event.code` values mapped to choice array indices, in order. Caps the pilot at 3
 * simultaneous choices — plenty for a first branching pass; extend if a future NPC needs more. */
const DIALOGUE_CHOICE_KEY_CODES = ['Digit1', 'Digit2', 'Digit3'];

/**
 * @param {object} options
 * @param {{setVisible: (visible: boolean) => void}} options.interactionPrompt
 * @param {{show: (text: string, choiceLabels?: string[]) => void, hide: () => void}} options.dialogueBox
 * @param {string} options.greetingTemplate Contains a literal `{name}` placeholder. Fallback only.
 * @param {Object<string, string>} [options.greetingsByNpcId] Keyed by NPC id (`object3D.name`),
 *   each containing a literal `{name}` placeholder — see `gameplayConfig.js`'s `GREETINGS_BY_NPC_ID`.
 * @param {Object<string, {label: string, response: string}[]>} [options.choicesByNpcId] Keyed by
 *   NPC id, each entry a small ordered list of `{label, response}` (`response` may also contain a
 *   literal `{name}` placeholder) — see `gameplayConfig.js`'s `CHOICES_BY_NPC_ID`. An id with no
 *   entry (or an empty array) never offers choices — same greeting-then-close-on-E as before.
 * @param {number} options.radiusMeters
 * @returns {{update: (npcs: Array<{object3D: import('three').Object3D, displayName: (string|null)}>, playerPos: {x: number, z: number}) => void, handleKeyDown: (event: KeyboardEvent) => void}}
 */
export function createInteractionController({ interactionPrompt, dialogueBox, greetingTemplate, greetingsByNpcId = {}, choicesByNpcId = {}, radiusMeters }) {
	let activeNpc = null;
	let nearestNpc = null;
	// Non-null only between opening a dialogue that has choices and one of them being picked (or the
	// dialogue closing) — cleared by `selectChoice`/`closeDialogue` so a second key press never
	// re-triggers a choice already consumed.
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
		const { response } = activeChoices[index];
		activeChoices = null; // consumed — a further key press can no longer pick a(nother) choice
		dialogueBox.show(response.replace('{name}', activeNpcName));
	}

	return {
		/** Selects a visible dialogue choice by zero-based index (mobile/PWA pointer path). */
		handleChoice(index) {
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
			// The player walked out of the active NPC's own radius (or it no longer resolves, e.g.
			// disposed) — auto-close rather than leaving a dialogue box open with no one nearby.
			if (activeNpc && activeNpc !== nearestNpc) closeDialogue();
			interactionPrompt.setVisible(!activeNpc && nearestNpc !== null);
		},

		/** Pass a `keydown` event straight through from the caller's own listener. */
		handleKeyDown(event) {
			// Guards against the browser's own key-repeat firing this multiple times per held key.
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
	};
}

// Run257 additive wrapper: guards who are hostile or temporarily defeated are combatants, not dialogue targets.
const createInteractionControllerBeforeSandboxCombatRun257 = createInteractionController;
createInteractionController = function createInteractionControllerWithSandboxCombatRun257(options) {
	const controller = createInteractionControllerBeforeSandboxCombatRun257(options);
	const baseUpdate = controller.update.bind(controller);
	controller.update = (npcs, playerPos) => baseUpdate(
		npcs.filter((npc) => !npc.object3D.userData.sandboxCombatHostile && !npc.object3D.userData.sandboxCombatDefeated),
		playerPos,
	);
	return controller;
};

// Run257 full-smoke compatibility extension. Legacy injected NPC fixtures predate `Object3D.userData`;
// rebuild from the untouched pre-combat factory and treat absent combat metadata as neutral instead
// of requiring every existing caller/test double to grow a Three.js-only field.
const createInteractionControllerBeforeSandboxCompatibilityRun257 = createInteractionControllerBeforeSandboxCombatRun257;
createInteractionController = function createInteractionControllerWithSandboxCompatibilityRun257(options) {
	const controller = createInteractionControllerBeforeSandboxCompatibilityRun257(options);
	const baseUpdate = controller.update.bind(controller);
	controller.update = (npcs, playerPos) => baseUpdate(
		npcs.filter((npc) => {
			const userData = npc?.object3D?.userData;
			return !userData?.sandboxCombatHostile && !userData?.sandboxCombatDefeated;
		}),
		playerPos,
	);
	return controller;
};