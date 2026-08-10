#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

async function loadModule(target) {
  const source = fs.readFileSync(target, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function assert(value, message) { if (!value) throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function main() {
  const target = path.resolve(process.argv[2] || 'src/3d/editor/EditorInstanceEditSession.js');
  const api = await loadModule(target);
  const groups = [{ id: 'formation-a', instances: [{ id: 'formation-a-0', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }] }];
  const THREE = {};
  const renderCalls = [];
  const operations = {
    createProxy(_THREE, selection) { return { transform: clone(selection.transform) }; },
    snapshotProxy(proxy) { return clone(proxy.transform); },
    updateSelection(_groups, instanceId, patch) {
      const instance = _groups[0].instances.find((item) => item.id === instanceId);
      if (!instance) return null;
      instance.position = [...patch.position]; instance.rotation = [...patch.rotation]; instance.scale = [...patch.scale];
      return { record: _groups[0], instanceIndex: 0, selection: { groupId: 'formation-a', instanceId, instanceIndex: 0, transform: clone(patch) } };
    },
    applyRender(_THREE, update) { renderCalls.push(clone(update.selection.transform)); }
  };
  const initial = { groupId: 'formation-a', instanceId: 'formation-a-0', instanceIndex: 0, transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } };
  const session = api.beginInstanceEditSession(THREE, initial, operations);
  session.proxy.transform = { position: [4,0,-2], rotation: [0,1,0], scale: [1.5,1.5,1.5] };
  const committed = api.commitInstanceEditSession(THREE, groups, session, operations);
  assert(JSON.stringify(committed.transform.position) === '[4,0,-2]', 'successful commit position drift');
  assert(JSON.stringify(groups[0].instances[0].scale) === '[1.5,1.5,1.5]', 'successful commit did not update serialized state');
  assert(renderCalls.length === 1, 'successful commit did not render exactly once');

  const beforeFailure = clone(groups[0].instances[0]);
  session.proxy.transform = { position: [9,0,9], rotation: [0,2,0], scale: [2,2,2] };
  let failNext = true;
  operations.applyRender = (_THREE, update) => {
    renderCalls.push(clone(update.selection.transform));
    if (failNext) { failNext = false; throw new Error('synthetic render failure'); }
  };
  let rejected = false;
  try { api.commitInstanceEditSession(THREE, groups, session, operations); } catch { rejected = true; }
  assert(rejected, 'render failure was swallowed');
  assert(JSON.stringify(groups[0].instances[0]) === JSON.stringify(beforeFailure), 'render failure did not rollback serialized state');
  assert(JSON.stringify(session.selection.transform) === JSON.stringify({ position: [4,0,-2], rotation: [0,1,0], scale: [1.5,1.5,1.5] }), 'failed commit mutated session selection');

  const proxy = api.endInstanceEditSession(session);
  assert(proxy && session.active === false && session.proxy === null, 'session cleanup failed');
  assert(api.endInstanceEditSession(null) === null, 'null session cleanup should be a no-op');

  console.log('[checkEditorInstanceEditSession] PASS: proxy commit, render application, rollback and cleanup transaction verified');
}

main().catch((error) => {
  console.error(`[checkEditorInstanceEditSession] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
