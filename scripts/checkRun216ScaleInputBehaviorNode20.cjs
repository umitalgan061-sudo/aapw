#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

class FakeInput {
  constructor(id) {
    this.id = id;
    this.value = '1';
    this.min = '0.01';
    this.step = '0.1';
    this.attributes = new Map();
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, handler, options) {
    this.listeners.set(type, { handler, options });
  }

  removeEventListener(type, handler) {
    const current = this.listeners.get(type);
    if (current?.handler === handler) this.listeners.delete(type);
  }

  change(value) {
    this.value = value;
    let stopped = false;
    this.listeners.get('change')?.handler({
      currentTarget: this,
      stopImmediatePropagation() {
        stopped = true;
      }
    });
    return stopped;
  }
}

async function loadController() {
  const sourcePath = path.resolve(__dirname, '../src/3d/editor/EditorScaleInputController.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  return import(url);
}

async function main() {
  const inputs = Object.fromEntries(
    ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => [id, new FakeInput(id)])
  );
  const windowListeners = new Map();

  global.window = {
    addEventListener(type, handler, options) {
      windowListeners.set(type, { handler, options });
    },
    removeEventListener(type, handler) {
      const current = windowListeners.get(type);
      if (current?.handler === handler) windowListeners.delete(type);
    }
  };
  global.document = {
    getElementById(id) {
      return inputs[id] || null;
    }
  };

  const { installEditorScaleInputController } = await loadController();
  const selected = { isInstancedMesh: false, scale: { x: 1, y: 1, z: 1 } };
  let inspectorWrites = 0;
  let hierarchyRefreshes = 0;
  const api = {
    getSelectedObject: () => selected,
    writeInspector: () => { inspectorWrites += 1; },
    refreshHierarchy: () => { hierarchyRefreshes += 1; }
  };

  const surface = installEditorScaleInputController(api);
  if (surface.minimumScale !== 0.001) throw new Error(`minimum scale mismatch: ${surface.minimumScale}`);

  for (const input of Object.values(inputs)) {
    if (input.min !== '0.001') throw new Error(`${input.id} min mismatch: ${input.min}`);
    if (input.step !== '0.001') throw new Error(`${input.id} step mismatch: ${input.step}`);
    if (input.attributes.get('inputmode') !== 'decimal') throw new Error(`${input.id} decimal inputmode missing`);
  }

  if (!inputs['we-scale-x'].change('0.0002')) throw new Error('legacy scale listener was not intercepted');
  if (selected.scale.x !== 0.001) throw new Error(`minimum clamp mismatch: ${selected.scale.x}`);
  inputs['we-scale-y'].change('0.007');
  if (selected.scale.y !== 0.007) throw new Error(`sub-0.01 precision lost: ${selected.scale.y}`);

  inputs['we-scale-z'].change('');
  if (selected.scale.z !== 1) throw new Error('blank scale input mutated selection');
  if (inspectorWrites !== 3 || hierarchyRefreshes !== 2) {
    throw new Error(`unexpected update counts: inspector=${inspectorWrites}, hierarchy=${hierarchyRefreshes}`);
  }

  surface.dispose();
  for (const input of Object.values(inputs)) {
    if (input.listeners.has('change')) throw new Error(`${input.id} change listener leaked`);
  }
  if (windowListeners.has('pagehide')) throw new Error('pagehide listener leaked');

  console.log('PASS Run216 Node20 scale behavior: 0.001 UI precision, clamp, blank-input safety and cleanup verified.');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
