/**
 * FAZ 5 interaction controller (run 33) — owns the proximity-prompt/dialogue-box open/close state
 * machine (nearest-NPC tracking, keypress handling, distance-based auto-close) so `game3d.js`'s
 * tick loop only calls one `update()` per frame and one `handleKeyDown()` per keydown event.
 * Extracted into its own module to stay under the project's 600-line-per-file cap — the same
 * reasoning ADR-0028 already used for the FAZ 5/6 spawn-resolution loops. Still deliberately
 * minimal: one generic greeting line per NPC, no per-NPC content/branching/replies yet — see
 * DECISIONS.md ADR-0033.
 * @module gameplay/interaction
 */

/**
 * @param {object} options
 * @param {{setVisible: (visible: boolean) => void}} options.interactionPrompt
 * @param {{show: (text: string) => void, hide: () => void}} options.dialogueBox
 * @param {string} options.greetingTemplate Contains a literal `{name}` placeholder.
 * @param {number} options.radiusMeters
 * @returns {{update: (npcs: Array<{object3D: import('three').Object3D, displayName: (string|null)}>, playerPos: {x: number, z: number}) => void, handleKeyDown: (event: KeyboardEvent) => void}}
 */
export function createInteractionController({ interactionPrompt, dialogueBox, greetingTemplate, radiusMeters }) {
	let activeNpc = null;
	let nearestNpc = null;

	function openDialogue(npc) {
		activeNpc = npc;
		interactionPrompt.setVisible(false);
		const name = npc.displayName ?? 'Yabancı';
		dialogueBox.show(greetingTemplate.replace('{name}', name));
	}

	function closeDialogue() {
		activeNpc = null;
		dialogueBox.hide();
	}

	return {
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
			if (event.code !== 'KeyE') return;
			if (activeNpc) closeDialogue();
			else if (nearestNpc) openDialogue(nearestNpc);
		},
	};
}
