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

	dispose() {
		this._el.remove();
	}
}
