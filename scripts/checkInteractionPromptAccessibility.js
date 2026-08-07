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
	dispatchPointerUp(event) { this._listeners.get('pointerup')?.(event); }
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
