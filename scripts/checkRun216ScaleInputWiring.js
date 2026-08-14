import fs from 'node:fs';

const transformController = fs.readFileSync('src/3d/editor/EditorTransformControls.js', 'utf8');
const scaleController = fs.readFileSync('src/3d/editor/EditorScaleInputController.js', 'utf8');

const importLine = "import { installEditorScaleInputController } from './EditorScaleInputController.js';";
const installLine = 'installEditorScaleInputController(api);';
const transformSingletonGuard = 'if (window.__WESTEROS_EDITOR_TRANSFORM__) return window.__WESTEROS_EDITOR_TRANSFORM__;';
const captureRegistration = "input.addEventListener('change', onScaleChange, true);";
const preciseMinimum = 'const MIN_EDITOR_SCALE = 0.001;';

if (!transformController.includes(importLine)) throw new Error('scale input controller import missing');
if (!transformController.includes(installLine)) throw new Error('scale input controller install missing');
if (!transformController.includes(transformSingletonGuard)) throw new Error('TransformControls singleton guard missing');
if (transformController.indexOf(installLine) > transformController.indexOf(transformSingletonGuard)) throw new Error('scale input controller must install before TransformControls singleton early-return');
if (!scaleController.includes(captureRegistration)) throw new Error('scale input capture ownership missing');
if (!scaleController.includes(preciseMinimum)) throw new Error('precise minimum scale contract missing');

console.log('PASS Run216 scale input wiring: precise Inspector controller installs before TransformControls singleton return and owns scale changes in capture phase.');
