#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const source = fs.readFileSync(path.join(ROOT, 'src/3d/editor/EditorLiveWorldVisualSync.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("const EDITOR_LOCKED_TIME_RATIO = 0.5;"), 'Editor authoring clock is not locked to noon.');
assert(source.includes("const EDITOR_AURORA_FACTOR = 1.35;"), 'Editor aurora factor contract drifted.');
assert(source.includes("new THREE.AmbientLight(0xffffff, 1.55)"), 'Editor ambient readability light missing.');
assert(source.includes("new THREE.HemisphereLight(0xdff7ff, 0x60734c, 2.0)"), 'Editor hemisphere readability light missing.');
assert(source.includes("new THREE.DirectionalLight(0xfff4d8, 2.8)"), 'Editor daylight key missing.');
assert(source.includes("new THREE.DirectionalLight(0x9bdfff, 1.4)"), 'Editor aurora fill missing.');
assert(source.includes("state.lights.sun.intensity = Math.max(state.lights.sun.intensity, 2.35);"), 'Canonical sun readability floor missing.');
assert(source.includes("state.lights.hemisphere.intensity = Math.max(state.lights.hemisphere.intensity, 1.65);"), 'Canonical hemisphere readability floor missing.');
assert(source.includes("mode: 'bright-authoring'"), 'Bright authoring runtime snapshot missing.');
assert(source.includes("window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__ = surface;"), 'Bright authoring runtime surface missing.');
assert(source.includes("window.__WESTEROS_EDITOR_LIVE_VISUALS__?.dispose?.();"), 'Dynamic editor day/night ownership is not released before bright takeover.');
assert(source.includes("api.scene.remove(authoringLights);"), 'Bright authoring light cleanup missing.');
assert(source.includes("window.cancelAnimationFrame(frame)"), 'Bright authoring RAF cleanup missing.');

const originalInstall = source.indexOf('installEditorLiveWorldVisualSync(api, liveSurface)');
const brightInstall = source.indexOf('installEditorBrightAuthoringVisualSync(brightAuthoringApi, brightAuthoringLiveSurface)');
assert(originalInstall >= 0 && brightInstall > originalInstall, 'Bright authoring takeover does not execute after the established live visual sync.');

console.log('[checkRun216EditorBrightAuthoring] PASS: editor time locked to bright noon, aurora remains strong, readability lights/floors and cleanup surface are present.');
