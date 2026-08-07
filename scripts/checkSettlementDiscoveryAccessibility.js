import assert from 'node:assert/strict';

class FakeClassList {
	constructor() { this._values = new Set(); }
	add(value) { this._values.add(value); }
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
	}
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	append(...children) { this.children.push(...children); }
	appendChild(child) { this.children.push(child); return child; }
	remove() { this.removed = true; }
}

const body = new FakeElement('body');
globalThis.document = {
	body,
	createElement(tagName) { return new FakeElement(tagName); },
};

const memory = new Map();
const storage = {
	getItem(key) { return memory.has(key) ? memory.get(key) : null; },
	setItem(key, value) { memory.set(key, String(value)); },
};

const { SettlementDiscovery } = await import('../src/3d/ui/settlementDiscovery.js');
const seats = [
	{ id: 'winterfell', name: 'Kışyarı', x: 0, z: 0 },
	{ id: 'riverrun', name: 'Nehirrun', x: 500, z: 500 },
];
const widget = new SettlementDiscovery({
	seats,
	container: body,
	storage,
	radiusMeters: 60,
	visibleMilliseconds: 25,
});

assert.equal(widget._root.getAttribute('role'), 'status');
assert.equal(widget._root.getAttribute('aria-live'), 'polite');
assert.equal(widget._root.getAttribute('aria-atomic'), null, 'atomic semantics are applied on a real discovery update');

widget.update({ x: 1, z: 1 });
assert.equal(widget.isDiscovered('winterfell'), true);
assert.equal(widget._root.hidden, false);
assert.equal(widget._root.getAttribute('aria-atomic'), 'true');
assert.equal(widget._name.textContent, 'Kışyarı');
assert.equal(widget._progress.textContent, '1 / 2 yerleşim keşfedildi');
assert.equal(widget._progress.getAttribute('aria-label'), 'Keşif ilerlemesi');

const persisted = JSON.parse(storage.getItem('westeros-pwa:settlement-discoveries:v1'));
assert.deepEqual(persisted, ['winterfell']);

widget.dispose();
assert.equal(widget._root.removed, true);

console.log('Settlement discovery accessibility guard PASS: polite + atomic Turkish announcement, persistence and disposal preserved.');
