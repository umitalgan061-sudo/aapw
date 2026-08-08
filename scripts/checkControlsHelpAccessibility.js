import fs from 'node:fs';

const path = 'src/3d/ui/controlsHelp.js';
const source = fs.readFileSync(path, 'utf8');

const requiredSnippets = [
	"this._button.setAttribute('aria-label', 'Kontrolleri göster');",
	"this._button.setAttribute('aria-expanded', 'false');",
	"this._panel.setAttribute('aria-label', 'Oyun kontrolleri');",
	"this._panel.id = 'g3d-controls-help-panel';",
	"this._button.setAttribute('aria-controls', this._panel.id);",
	"this._button.setAttribute('aria-expanded', String(open));",
	"this._button.setAttribute('aria-label', open ? 'Kontrolleri gizle' : 'Kontrolleri göster');",
	"if (event.code === 'Escape' && this._open) this.setOpen(false);",
	"this._button.removeEventListener('click', this._onButtonClick);",
	"window.removeEventListener('keydown', this._onKeyDown);",
];

for (const snippet of requiredSnippets) {
	if (!source.includes(snippet)) {
		throw new Error(`ControlsHelp accessibility regression: missing ${snippet}`);
	}
}

const panelIdMatch = source.match(/this\._panel\.id\s*=\s*'([^']+)'/);
if (!panelIdMatch?.[1]) {
	throw new Error('ControlsHelp accessibility regression: panel id is not a stable non-empty string.');
}

if (!source.includes("this._button.setAttribute('aria-controls', this._panel.id);")) {
	throw new Error('ControlsHelp accessibility regression: trigger does not reference the controlled panel.');
}

console.log(`[checkControlsHelpAccessibility] PASS: trigger aria-controls resolves to ${panelIdMatch[1]}, with expanded/label/Escape/dispose contracts preserved.`);
