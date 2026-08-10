#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const sourcePath = path.join(ROOT, 'src', '3d', 'editor', 'EditorInstanceInteractionBootstrap.js');
const ownershipPath = path.join(ROOT, 'src', '3d', 'editor', 'EditorInstancePointerOwnership.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-instance-bootstrap-'));
let source = fs.readFileSync(sourcePath, 'utf8');
source = source
  .replace("'./EditorInstanceRaycastSource.js'", "'./raycast.mjs'")
  .replace("'./EditorInstanceInteractionSingleton.js'", "'./singleton.mjs'")
  .replace("'./EditorInstancePointerOwnership.js'", "'./ownership.mjs'");
fs.writeFileSync(path.join(dir, 'bootstrap.mjs'), source);
fs.writeFileSync(path.join(dir, 'raycast.mjs'), `export function createEditorInstanceRaycastSource(options){ return { getHits: () => options.getObjects().length ? [{ object: options.getObjects()[0], instanceId: 0 }] : [], getPointerSnapshot: () => ({ x: 0, y: 0 }) }; }\n`);
fs.copyFileSync(ownershipPath, path.join(dir, 'ownership.mjs'));
fs.writeFileSync(path.join(dir, 'singleton.mjs'), `let installs=0; export function getInstalls(){return installs;} export function installEditorInstanceInteractionOnce(){ installs++; let disposed=false; let active=false; return { begin(){active=true;}, commit(){}, end(){active=false;}, dispose(){disposed=true;}, getSnapshot(){return {disposed,pipeline:{runtime:{transform:{active}}}};} }; }\n`);

const module = await import(`${pathToFileURL(path.join(dir, 'bootstrap.mjs')).href}?v=${Date.now()}`);
const singleton = await import(pathToFileURL(path.join(dir, 'singleton.mjs')).href);
class Raycaster {}
const canvas = {};
const instance = { isInstancedMesh: true };
const api = { canvas, camera: {}, scene: {}, instanceManager: { groups: [{ object: instance }] } };
const transformSurface = { transform: { dragging: false } };
const globalTarget = {};
const options = { api, THREE: { Raycaster }, transformSurface, globalTarget };
const first = module.installEditorInstanceInteractionBootstrap(options);
assert.equal(singleton.getInstalls(), 1);
assert.equal(globalTarget.__WESTEROS_EDITOR_INSTANCE_INTERACTION__, first);
assert.equal(globalTarget.__WESTEROS_EDITOR_INSTANCE_POINTER__.ownsPointer({ button: 0, ctrlKey: false, metaKey: false, altKey: false }), true);
const duplicate = module.installEditorInstanceInteractionBootstrap(options);
assert.equal(duplicate, first);
assert.equal(singleton.getInstalls(), 1, 'duplicate bootstrap must reuse active surface');
first.begin();
assert.equal(first.ownsPointer({ button: 0, ctrlKey: false, metaKey: false, altKey: false }), true);
first.dispose();
assert.equal(first.getSnapshot().disposed, true);
assert.equal(globalTarget.__WESTEROS_EDITOR_INSTANCE_INTERACTION__, undefined);
assert.equal(globalTarget.__WESTEROS_EDITOR_INSTANCE_POINTER__, undefined);
const second = module.installEditorInstanceInteractionBootstrap(options);
assert.notEqual(second, first);
assert.equal(singleton.getInstalls(), 2, 'post-dispose bootstrap must reinstall');
assert.throws(() => module.installEditorInstanceInteractionBootstrap({}), /World Editor api/);
console.log('[checkRun216InstanceInteractionBootstrap] PASS');
