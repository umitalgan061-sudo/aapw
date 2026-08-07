/**
 * Fixed-position DOM prompt shown when the player is near an interactable (FAZ 5, first pass — an
 * affordance only, no dialogue content/logic yet). Same pattern as `ui/touchJoystick.js`: renders
 * its own DOM element rather than a canvas draw, so it costs nothing from the render budget and
 * composes with the rest of the page via plain CSS (`game3d.css`). `game3d.js` owns the actual
 * proximity check and calls `setVisible()` once per frame; this class only owns the DOM.
 * @module ui/interactionPrompt
 */

export class InteractionPrompt {
	/**
	 * @param {HTMLElement} [container] Parent element the prompt's DOM is appended to. Defaults to
	 *   `document.body`.
	 */
	constructor(container = document.body) {
		this._el = document.createElement('div');
		this._el.className = 'g3d-interaction-prompt';
		this._el.textContent = 'E - Selamla';
		this._el.hidden = true;
		// Additive-only accessibility (run156, same pattern as worldEventToast/settlementDiscovery/
		// dialogueBox): the prompt's text never changes, only its visibility toggles, so a static
		// role=status + aria-live=polite + aria-atomic=true (set once here, not per-setVisible call)
		// is enough for a screen reader to announce "E - Selamla" whenever it becomes available near
		// an interactable, without altering the existing hidden-attribute visibility mechanics.
		this._el.setAttribute('role', 'status');
		this._el.setAttribute('aria-live', 'polite');
		this._el.setAttribute('aria-atomic', 'true');
		this._activateHandler = null;
		this._onPointerUp = (event) => {
			if (!this._activateHandler || !this._visible) return;
			event.preventDefault();
			this._activateHandler();
		};
		this._el.addEventListener('pointerup', this._onPointerUp);
		container.appendChild(this._el);
		this._visible = false;
	}

	/**
	 * @param {boolean} visible
	 */
	setVisible(visible) {
		if (visible === this._visible) return; // avoid a redundant DOM write every frame
		this._visible = visible;
		this._el.hidden = !visible;
	}


	/**
	 * Optional touch/click activation hook (FAZ 5 mobile/PWA follow-up): desktop users can still use
	 * the keyboard prompt text, while touch-primary users can tap the same visible prompt to trigger
	 * the interaction without needing a physical E key.
	 * @param {(() => void) | null} handler
	 */
	setActivateHandler(handler) {
		this._activateHandler = handler;
		this._el.classList.toggle('g3d-interaction-prompt-action', Boolean(handler));
	}

	dispose() {
		this._el.remove();
	}
}
