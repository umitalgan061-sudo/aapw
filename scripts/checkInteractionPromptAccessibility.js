import assert from 'node:assert/strict';

class FakeClassList {
	constructor() { this._values = new Set(); }
	add(value) { this._values.add(value); }
	toggle(value, force) {
		const on = force === undefined ? !this._values.has(value) : Boolean(force);
		if (on) this._values.add(value); else this._values.delete(value);
	}
	contains(value) { return this._values.has(value); }
}

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.classList = new FakeClassList();
		this.className = '';
		this.hidden = false;
		this.textContent = '';
		this.removed = false;
		this._listeners = new Map();
	}
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	appendChild(child) { this.children.push(child); return child; }
	addEventListener(type, handler) { this._listeners.set(type, handler); }
	removeEventListener(type, handler) { if (this._listeners.get(type) === handler) this._listeners.delete(type); }
	dispatchPointerUp(event) { this._listeners.get('pointerup')?.(event); }
	dispatchKeyDown(event) { this._listeners.get('keydown')?.(event); }
	remove() { this.removed = true; }
}

const body = new FakeElement('body');
globalThis.document = {
	createElement(tagName) { return new FakeElement(tagName); },
};

const { InteractionPrompt } = await import('../src/3d/ui/interactionPrompt.js');
const prompt = new InteractionPrompt(body);

// Static role=status/aria-live=polite/aria-atomic=true — set once in the constructor since the
// prompt's text never changes, only its hidden/visible state does (unlike worldEventToast/
// settlementDiscovery/dialogueBox, which update aria-atomic per real content update).
assert.equal(prompt._el.getAttribute('role'), 'status');
assert.equal(prompt._el.getAttribute('aria-live'), 'polite');
assert.equal(prompt._el.getAttribute('aria-atomic'), 'true');
assert.equal(prompt._el.textContent, 'E - Selamla');
assert.equal(prompt._el.hidden, true, 'hidden by default, matching a11y tree exclusion for hidden elements');
assert.equal(body.children[0], prompt._el);

prompt.setVisible(true);
assert.equal(prompt._el.hidden, false);
// role/aria-live/aria-atomic survive the visibility toggle unchanged.
assert.equal(prompt._el.getAttribute('role'), 'status');
assert.equal(prompt._el.getAttribute('aria-atomic'), 'true');

prompt.setVisible(false);
assert.equal(prompt._el.hidden, true);

// Existing tap-activation behavior (pre-existing, run-independent) must stay untouched.
let activated = 0;
prompt.setActivateHandler(() => { activated += 1; });
prompt.setVisible(true);
prompt._el.dispatchPointerUp({ preventDefault() {} });
assert.equal(activated, 1);

prompt.dispose();
assert.equal(prompt._el.removed, true);

console.log('Interaction prompt accessibility guard PASS: static status/live/atomic Turkish hint, tap-activation and disposal preserved.');

// Run160 additive keyboard parity: an actionable visible prompt is a focusable button and Enter/
// Space invoke exactly the same activation callback; unrelated keys, hidden state and disabled state
// stay inert. Listener cleanup is also explicit so retained prompt instances cannot react post-dispose.
const keyboardPrompt = new InteractionPrompt(body);
let keyboardActivations = 0;
keyboardPrompt.setActivateHandler(() => { keyboardActivations += 1; });
assert.equal(keyboardPrompt._el.getAttribute('role'), 'button');
assert.equal(keyboardPrompt._el.getAttribute('tabindex'), '0');
assert.equal(keyboardPrompt._el.getAttribute('aria-label'), 'Selamla');
keyboardPrompt.setVisible(true);
let prevented = 0;
keyboardPrompt._el.dispatchKeyDown({ key: 'Enter', preventDefault() { prevented += 1; } });
keyboardPrompt._el.dispatchKeyDown({ key: ' ', preventDefault() { prevented += 1; } });
keyboardPrompt._el.dispatchKeyDown({ key: 'Escape', preventDefault() { prevented += 1; } });
assert.equal(keyboardActivations, 2, 'Enter and Space activate; unrelated keys do not');
assert.equal(prevented, 2, 'only handled activation keys prevent default');
keyboardPrompt.setVisible(false);
keyboardPrompt._el.dispatchKeyDown({ key: 'Enter', preventDefault() { prevented += 1; } });
assert.equal(keyboardActivations, 2, 'hidden prompt is keyboard-inert');
keyboardPrompt.setActivateHandler(null);
assert.equal(keyboardPrompt._el.getAttribute('role'), 'status');
assert.equal(keyboardPrompt._el.getAttribute('tabindex'), '-1');
assert.equal(keyboardPrompt._el.getAttribute('aria-label'), 'E - Selamla');
keyboardPrompt.setVisible(true);
keyboardPrompt._el.dispatchKeyDown({ key: 'Enter', preventDefault() { prevented += 1; } });
assert.equal(keyboardActivations, 2, 'prompt without handler is keyboard-inert');
keyboardPrompt.dispose();
assert.equal(keyboardPrompt._el._listeners.has('pointerup'), false);
assert.equal(keyboardPrompt._el._listeners.has('keydown'), false);

console.log('Interaction prompt keyboard accessibility guard PASS: button semantics, Enter/Space parity, inert states and listener cleanup preserved.');
