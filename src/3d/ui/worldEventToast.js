/**
 * Toast card shown when `gameplay/worldEvents.js` fires `EVENTS.WORLD_EVENT_TRIGGERED`. Same
 * DOM-ownership pattern as every other `ui/` widget (`interactionPrompt.js`/`dialogueBox.js`): owns
 * its own DOM, no render-budget cost. Unlike those two, this one is self-subscribing — it listens to
 * the `EventBus` directly instead of `game3d.js` calling `show()`/`hide()` every frame, since the
 * whole point of this system (see `gameplay/worldEvents.js`'s header) was to route through the
 * EventBus rather than a direct call. Visually mirrors `script.js`'s 2D event card (icon + title +
 * description, left-border colored per event) at a much smaller, non-blocking scale — top-of-screen,
 * auto-dismissing, never pauses or blocks gameplay input the way the 2D modal overlay does.
 * @module ui/worldEventToast
 */

/** How long a toast stays visible before auto-hiding, in seconds. */
const VISIBLE_SECONDS = 6;

export class WorldEventToast {
	/**
	 * @param {object} options
	 * @param {import('../eventBus.js').EventBus} options.eventsBus
	 * @param {string} options.eventName `EVENTS.WORLD_EVENT_TRIGGERED`, passed in rather than
	 *   imported from `config.js` — same options-over-import precedent `gameplay/worldEvents.js`
	 *   itself uses.
	 * @param {HTMLElement} [options.container] Defaults to `document.body`.
	 */
	constructor({ eventsBus, eventName, container = document.body }) {
		this._el = document.createElement('div');
		this._el.className = 'g3d-event-toast';
		this._el.hidden = true;

		this._iconEl = document.createElement('span');
		this._iconEl.className = 'g3d-event-toast-icon';
		this._el.appendChild(this._iconEl);

		const textWrap = document.createElement('div');
		this._titleEl = document.createElement('p');
		this._titleEl.className = 'g3d-event-toast-title';
		textWrap.appendChild(this._titleEl);
		this._descEl = document.createElement('p');
		this._descEl.className = 'g3d-event-toast-desc';
		textWrap.appendChild(this._descEl);
		this._el.appendChild(textWrap);

		container.appendChild(this._el);

		this._hideTimeoutId = null;
		this._onEvent = (event) => this._show(event);
		eventsBus.on(eventName, this._onEvent);
		this._eventsBus = eventsBus;
		this._eventName = eventName;
	}

	/**
	 * @param {{icon: string, title: string, desc: string, color: string}} event
	 */
	_show(event) {
		this._iconEl.textContent = event.icon;
		this._titleEl.textContent = event.title;
		this._descEl.textContent = event.desc;
		this._el.style.setProperty('--g3d-event-color', event.color);
		this._el.hidden = false;
		if (this._hideTimeoutId !== null) clearTimeout(this._hideTimeoutId);
		this._hideTimeoutId = setTimeout(() => {
			this._el.hidden = true;
			this._hideTimeoutId = null;
		}, VISIBLE_SECONDS * 1000);
	}

	/** Removes the DOM node, the EventBus subscription, and cancels any pending auto-hide timer —
	 * memory-leak checklist. */
	dispose() {
		this._eventsBus.off(this._eventName, this._onEvent);
		if (this._hideTimeoutId !== null) clearTimeout(this._hideTimeoutId);
		this._el.remove();
	}
}
