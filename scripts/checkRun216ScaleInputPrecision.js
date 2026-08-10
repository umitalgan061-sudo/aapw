import fs from 'node:fs';

const controller = fs.readFileSync('src/3d/editor/EditorScaleInputController.js', 'utf8');
const editorHtml = fs.readFileSync('editor.html', 'utf8');

const minimumPolicy = 'const MIN_EDITOR_SCALE = 0.001;';
const minOverride = 'input.min = String(MIN_EDITOR_SCALE);';
const stepOverride = 'input.step = String(MIN_EDITOR_SCALE);';
const decimalHint = "input.setAttribute('inputmode', 'decimal');";
const listener = "input.addEventListener('change', onScaleChange, true);";
const scaleInputIds = ['we-scale-x', 'we-scale-y', 'we-scale-z'];

if (!controller.includes(minimumPolicy)) throw new Error('0.001 minimum scale policy missing');
if (!controller.includes(minOverride)) throw new Error('Inspector minimum override missing');
if (!controller.includes(stepOverride)) throw new Error('Inspector precision step override missing');
if (!controller.includes(decimalHint)) throw new Error('decimal input hint missing');
if (controller.indexOf(minOverride) > controller.indexOf(listener)) {
  throw new Error('Inspector precision override must be installed before scale change listener');
}

for (const id of scaleInputIds) {
  if (!controller.includes(`'${id}'`)) throw new Error(`scale axis controller mapping missing: ${id}`);
  if (!editorHtml.includes(`id="${id}"`)) throw new Error(`scale inspector input missing from editor shell: ${id}`);
}

console.log('PASS Run216 scale input precision: X/Y/Z inspector controls expose the 0.001 runtime scale policy.');
