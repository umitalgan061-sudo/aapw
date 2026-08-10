import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.type = '';
    this.textContent = '';
    this.title = '';
    this.disabled = false;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.removed = false;
    this.classList = { add() {}, remove() {} };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'title') this.title = ''; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  removeEventListener(type, handler) { const list = this.listeners.get(type) || []; const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); }
  append(...nodes) { this.children.push(...nodes); }
  insertBefore(node, before) { const index = this.children.indexOf(before); if (index >= 0) this.children.splice(index, 0, node); else this.children.push(node); }
  remove() { this.removed = true; }
  click() { for (const handler of this.listeners.get('click') || []) handler({ currentTarget: this, target: this }); }
}

function vector(x, y, z) {
  return {
    x, y, z,
    toArray() { return [this.x, this.y, this.z]; },
    fromArray(values) { [this.x, this.y, this.z] = values; return this; }
  };
}

function rotation(x, y, z) {
  return { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
}

function makeObject(assetId, name, position = [2, 3, 4], rot = [0.1, 0.2, 0.3], scaleValues = [0.5, 0.6, 0.7]) {
  return {
    isInstancedMesh: false,
    name,
    userData: { editorAssetId: assetId, editorId: `${assetId}-0001` },
    position: vector(...position),
    rotation: rotation(...rot),
    scale: vector(...scaleValues)
  };
}

const duplicateButton = new FakeElement('button');
duplicateButton.id = 'we-duplicate';
duplicateButton.textContent = 'Kopyala';
const toolbar = new FakeElement('div');
toolbar.children.push(duplicateButton);
const selectionStatus = new FakeElement('span');
const toast = new FakeElement('div');
const head = new FakeElement('head');
const created = [];
const elements = new Map([
  ['we-duplicate', duplicateButton],
  ['we-selection-status', selectionStatus],
  ['we-toast', toast]
]);

const document = {
  head,
  querySelector(selector) { return selector === '.we-toolbar-actions' ? toolbar : null; },
  querySelectorAll() { return []; },
  getElementById(id) { return elements.get(id) || created.find((element) => element.id === id) || null; },
  createElement(tag) { const element = new FakeElement(tag); created.push(element); return element; }
};

const windowListeners = new Map();
const fakeWindow = {
  __WESTEROS_WORLD_EDITOR__: null,
  addEventListener(type, handler) { if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(handler); },
  removeEventListener(type, handler) { const list = windowListeners.get(type) || []; const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); },
  setTimeout(handler) { return setTimeout(handler, 0); },
  clearTimeout(id) { clearTimeout(id); }
};

class FakeMutationObserver {
  constructor(handler) { this.handler = handler; this.disconnected = false; }
  observe() {}
  disconnect() { this.disconnected = true; }
}

const sceneAdds = [];
let selected = makeObject('black-dragon', 'Siyah Ejderha');
const editableObjects = [selected];
const api = {
  scene: { add(object) { sceneAdds.push(object); } },
  editableObjects,
  getSelectedObject: () => selected,
  getEditorState: () => ({ snapEnabled: true, snapSize: 1 }),
  refreshHierarchy() {}
};

const assets = new Map([
  ['black-dragon', { id: 'black-dragon', name: 'Siyah Ejderha', format: 'fbx' }],
  ['paladin', { id: 'paladin', name: 'Paladin', format: 'fbx' }]
]);

class FakeAssetManager {
  async createObject(asset) {
    return makeObject(asset.id, asset.name, [0, 0, 0], [0, 0, 0], [1, 1, 1]);
  }
}

const context = vm.createContext({
  console,
  document,
  window: fakeWindow,
  MutationObserver: FakeMutationObserver,
  HTMLInputElement: class {},
  HTMLTextAreaElement: class {},
  setTimeout,
  clearTimeout
});

const source = fs.readFileSync('src/3d/editor/EditorClipboardController.js', 'utf8');
const module = new vm.SourceTextModule(source, { context, identifier: 'EditorClipboardController.js' });
await module.link(async (specifier) => {
  if (specifier.endsWith('EditorAssetManager.js')) {
    const mock = new vm.SyntheticModule(['EditorAssetManager'], function () { this.setExport('EditorAssetManager', FakeAssetManager); }, { context });
    await mock.link(() => {});
    await mock.evaluate();
    return mock;
  }
  if (specifier.endsWith('editorAssetLibrary.js')) {
    const mock = new vm.SyntheticModule(['findEditorAsset'], function () { this.setExport('findEditorAsset', (id) => assets.get(id) || null); }, { context });
    await mock.link(() => {});
    await mock.evaluate();
    return mock;
  }
  throw new Error(`Unexpected import: ${specifier}`);
});
await module.evaluate();

const { installEditorClipboardController } = module.namespace;
const surface = installEditorClipboardController(api);
assert.equal(duplicateButton.textContent, 'Çoğalt');
const copyButton = created.find((element) => element.id === 'we-copy');
const pasteButton = created.find((element) => element.id === 'we-paste');
assert.ok(copyButton && pasteButton, 'copy/paste buttons were not created');
assert.equal(copyButton.disabled, false);
assert.equal(pasteButton.disabled, true);

assert.equal(surface.copySelected(), true);
assert.equal(pasteButton.disabled, false);
const copied = surface.getClipboard();
assert.deepEqual([...copied.position], [2, 3, 4]);
assert.deepEqual([...copied.scale], [0.5, 0.6, 0.7]);

selected.position.x = 99;
selected.scale.x = 9;
selected = makeObject('paladin', 'Paladin', [50, 0, 0]);

const first = await surface.pasteClipboard();
assert.equal(first.userData.editorId, 'black-dragon-paste-0001');
assert.deepEqual(first.position.toArray(), [3, 3, 4]);
assert.deepEqual([first.rotation.x, first.rotation.y, first.rotation.z], [0.1, 0.2, 0.3]);
assert.deepEqual(first.scale.toArray(), [0.5, 0.6, 0.7]);
assert.equal(first.name, 'Siyah Ejderha Kopya 1');
assert.equal(editableObjects.at(-1), first);
assert.equal(sceneAdds.at(-1), first);

const second = await surface.pasteClipboard();
assert.equal(second.userData.editorId, 'black-dragon-paste-0002');
assert.deepEqual(second.position.toArray(), [4, 3, 4]);
assert.equal(second.name, 'Siyah Ejderha Kopya 2');

selected = { isInstancedMesh: true, userData: {}, position: vector(0, 0, 0), rotation: rotation(0, 0, 0), scale: vector(1, 1, 1) };
assert.equal(surface.copySelected(), false);
assert.equal(surface.getClipboard(), copied, 'unsupported copy should not destroy existing clipboard');

surface.dispose();
assert.equal(duplicateButton.textContent, 'Kopyala');
assert.equal(fakeWindow.__WESTEROS_EDITOR_CLIPBOARD__, undefined);
assert.equal(created.find((element) => element.id === 'we-clipboard-tools')?.removed, true);

console.log('PASS Run216 editor clipboard behavior: snapshot isolation, fresh asset paste, deterministic IDs/offsets, transform preservation, unsupported-selection safety, cleanup.');
