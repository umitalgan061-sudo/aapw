import assert from 'node:assert/strict';

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this.attributes = new Map();
		this.className = '';
		this.hidden = false;
		this.textContent = '';
		this.id = '';
		this.parentNode = null;
		this.listeners = new Map();
	}

	setAttribute(name, value) {
		this.attributes.set(name, String(value));
		if (name === 'id') this.id = String(value);
	}

	getAttribute(name) {
		if (name === 'id' && this.id) return this.id;
		return this.attributes.get(name) ?? null;
	}

	append(...nodes) {
		for (const node of nodes) this.appendChild(node);
	}

	appendChild(node) {
		node.parentNode = this;
		this.children.push(node);
		return node;
	}

	addEventListener(type, listener) {
		this.listeners.set(type, listener);
	}

	removeEventListener(type, listener) {
		if (this.listeners.get(type) === listener) this.listeners.delete(type);
	}

	remove() {
		if (!this.parentNode) return;
		this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
		this.parentNode = null;
	}
}

const windowListeners = new Map();
const fakeWindow = {
	addEventListener(type, listener) {
		windowListeners.set(type, listener);
	},
	removeEventListener(type, listener) {
		if (windowListeners.get(type) === listener) windowListeners.delete(type);
	},
};
const fakeBody = new FakeElement('body');
const fakeDocument = {
	body: fakeBody,
	createElement(tagName) {
		return new FakeElement(tagName);
	},
};

globalThis.window = fakeWindow;
globalThis.document = fakeDocument;

const { ControlsHelp } = await import('../src/3d/ui/controlsHelp.js');

const firstContainer = new FakeElement('div');
const first = new ControlsHelp({ container: firstContainer, isMobileClass: false });
const firstRoot = firstContainer.children[0];
const firstPanel = firstRoot.children[0];
const firstButton = firstRoot.children[1];

assert.ok(firstPanel.id.startsWith('g3d-controls-help-panel-'), 'panel should expose a deterministic controls-help id prefix');
assert.equal(firstButton.getAttribute('aria-controls'), firstPanel.id, 'help trigger must reference its controlled panel');
assert.equal(firstButton.getAttribute('aria-expanded'), 'false', 'help trigger should start collapsed');
assert.equal(firstPanel.hidden, true, 'help panel should start hidden');

first.setOpen(true);
assert.equal(firstButton.getAttribute('aria-expanded'), 'true', 'aria-expanded must track the open panel');
assert.equal(firstButton.getAttribute('aria-label'), 'Kontrolleri gizle', 'open button label must remain Turkish');
assert.equal(firstPanel.hidden, false, 'panel should become visible when opened');

const secondContainer = new FakeElement('div');
const second = new ControlsHelp({ container: secondContainer, isMobileClass: true });
const secondRoot = secondContainer.children[0];
const secondPanel = secondRoot.children[0];
const secondButton = secondRoot.children[1];
assert.notEqual(secondPanel.id, firstPanel.id, 'multiple controls-help instances must not reuse the same panel id');
assert.equal(secondButton.getAttribute('aria-controls'), secondPanel.id, 'each trigger must control its own panel');

first.dispose();
second.dispose();
assert.equal(firstContainer.children.length, 0, 'dispose should still remove the first controls-help DOM');
assert.equal(secondContainer.children.length, 0, 'dispose should still remove the second controls-help DOM');
assert.equal(windowListeners.size, 0, 'dispose should still remove global key listeners');

console.log('[checkControlsHelpAccessibility] PASS: trigger/panel relationship, expanded state, unique ids, Turkish label and disposal are valid.');
