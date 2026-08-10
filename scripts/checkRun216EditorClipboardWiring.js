'use strict';

const fs = require('fs');

const html = fs.readFileSync('editor.html', 'utf8');
const controller = fs.readFileSync('src/3d/editor/EditorClipboardController.js', 'utf8');

const moduleScript = '<script type="module" src="./src/3d/editor/EditorClipboardController.js"></script>';
if ((html.split(moduleScript).length - 1) !== 1) throw new Error('EditorClipboardController module script must be wired exactly once');
if (!controller.includes("duplicateButton.textContent = 'Çoğalt';")) throw new Error('legacy duplicate button is not relabeled as Çoğalt');
if (!controller.includes("copyButton.id = 'we-copy';")) throw new Error('copy button contract missing');
if (!controller.includes("pasteButton.id = 'we-paste';")) throw new Error('paste button contract missing');
if (!controller.includes("key === 'c'")) throw new Error('Ctrl/Cmd+C keyboard contract missing');
if (!controller.includes("key === 'v'")) throw new Error('Ctrl/Cmd+V keyboard contract missing');
if (!controller.includes('new EditorAssetManager()')) throw new Error('paste must recreate assets through EditorAssetManager');
if (controller.includes('navigator.clipboard')) throw new Error('editor clipboard must not depend on system clipboard permissions');
if (!controller.includes("object.userData.editorId = nextPasteId(api, clipboard.assetId);")) throw new Error('fresh editorId contract missing');
if (!controller.includes('object.position.fromArray(clipboard.position);')) throw new Error('position preservation missing');
if (!controller.includes('object.rotation.set(...clipboard.rotation);')) throw new Error('rotation preservation missing');
if (!controller.includes('object.scale.fromArray(clipboard.scale);')) throw new Error('scale preservation missing');
if (!controller.includes('@media(max-width:900px)')) throw new Error('compact/mobile clipboard visibility guard missing');
if (!controller.includes('selectionObserver.disconnect();')) throw new Error('selection observer cleanup missing');
if (!controller.includes("listen(window, 'pagehide', dispose, { once: true });")) throw new Error('pagehide cleanup contract missing');

console.log('PASS Run216 editor clipboard wiring: toolbar, keyboard, fresh-asset paste, transform preservation, mobile visibility and lifecycle contracts present.');
