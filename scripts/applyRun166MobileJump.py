from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding='utf-8')


def insert_after(path: str, anchor: str, addition: str) -> None:
    content = read(path)
    if addition.strip() in content:
        return
    if anchor not in content:
        raise RuntimeError(f'Anchor not found in {path}: {anchor!r}')
    write(path, content.replace(anchor, anchor + addition, 1))


def insert_before(path: str, anchor: str, addition: str) -> None:
    content = read(path)
    if addition.strip() in content:
        return
    if anchor not in content:
        raise RuntimeError(f'Anchor not found in {path}: {anchor!r}')
    write(path, content.replace(anchor, addition + anchor, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if marker in content:
        return
    write(path, content.rstrip('\n') + '\n\n' + addition.lstrip('\n'))


insert_after(
    'src/3d/ui/touchJoystick.js',
    '\t\tthis._pointerId = null;\n',
    '\t\tthis._jumpRequested = false;\n',
)

insert_after(
    'src/3d/ui/touchJoystick.js',
    '\t\tcontainer.appendChild(this._base);\n',
    "\n\t\tthis._jumpButton = document.createElement('button');\n"
    "\t\tthis._jumpButton.type = 'button';\n"
    "\t\tthis._jumpButton.className = 'g3d-touch-jump-button';\n"
    "\t\tthis._jumpButton.textContent = 'Zıpla';\n"
    "\t\tthis._jumpButton.setAttribute('aria-label', 'Zıpla');\n"
    "\t\tthis._onJumpClick = () => { this._jumpRequested = true; };\n"
    "\t\tthis._jumpButton.addEventListener('click', this._onJumpClick);\n"
    "\t\tcontainer.appendChild(this._jumpButton);\n",
)

insert_before(
    'src/3d/ui/touchJoystick.js',
    "\t/** Removes DOM elements and listeners. Call on teardown (memory-leak checklist). */\n",
    "\t/** Returns one edge-triggered mobile jump request and clears it immediately. */\n"
    "\tconsumeJumpRequested() {\n"
    "\t\tconst requested = this._jumpRequested;\n"
    "\t\tthis._jumpRequested = false;\n"
    "\t\treturn requested;\n"
    "\t}\n\n",
)

insert_after(
    'src/3d/ui/touchJoystick.js',
    "\t\tthis._base.removeEventListener('pointercancel', this._onPointerUp);\n",
    "\t\tthis._jumpButton.removeEventListener('click', this._onJumpClick);\n"
    "\t\tthis._jumpRequested = false;\n"
    "\t\tthis._jumpButton.remove();\n",
)

insert_after(
    'src/3d/game3d.js',
    "\t\t\t// 3D_GAME_PROGRESS.md Known Issues) — read straight off `keyboardAxes`, not the merged `axes`.\n",
    "\t\t\t// Run 166 supersedes the legacy keyboard-only note above: the mobile button feeds the same edge-trigger flag.\n"
    "\t\t\tif (state.touchJoystick?.consumeJumpRequested()) keyboardAxes.jumpRequested = true;\n",
)

insert_after(
    'src/3d/ui/controlsHelp.js',
    "\t['Sol çubuk', 'Yürü; dış halkaya iterek koş'],\n",
    "\t['Zıpla', 'Sağdaki Zıpla düğmesine dokun'],\n",
)

append_once(
    'game3d.css',
    '.g3d-touch-jump-button {',
    "/* Run 166 / ADR-0188 — touch-primary FAZ 4 jump control. Kept clear of the bottom-left\n"
    "   movement joystick and bottom-right controls-help affordance; 64px exceeds the 44px touch target. */\n"
    ".g3d-touch-jump-button {\n"
    "  position: fixed;\n"
    "  right: max(72px, calc(env(safe-area-inset-right, 0px) + 72px));\n"
    "  bottom: max(22px, calc(env(safe-area-inset-bottom, 0px) + 22px));\n"
    "  z-index: 23;\n"
    "  width: 64px;\n"
    "  height: 64px;\n"
    "  border: 1px solid rgba(200, 150, 10, 0.72);\n"
    "  border-radius: 50%;\n"
    "  background: rgba(10, 6, 2, 0.72);\n"
    "  color: #e8d4a0;\n"
    "  font: 700 13px/1 Georgia, 'Times New Roman', serif;\n"
    "  cursor: pointer;\n"
    "  user-select: none;\n"
    "  touch-action: manipulation;\n"
    "  backdrop-filter: blur(4px);\n"
    "}\n\n"
    ".g3d-touch-jump-button:active {\n"
    "  background: rgba(200, 150, 10, 0.28);\n"
    "  border-color: rgba(232, 212, 160, 0.9);\n"
    "}\n\n"
    ".g3d-touch-jump-button:focus-visible {\n"
    "  outline: 2px solid #e8d4a0;\n"
    "  outline-offset: 2px;\n"
    "}\n",
)

insert_after(
    'scripts/checkTouchJoystickInputContract.js',
    "\t\tthis.style = {};\n",
    "\t\tthis.attributes = new Map();\n"
    "\t\tthis.textContent = '';\n"
    "\t\tthis.type = '';\n",
)

insert_after(
    'scripts/checkTouchJoystickInputContract.js',
    "\taddEventListener(type, handler) { this._listeners.set(type, handler); }\n",
    "\tsetAttribute(name, value) { this.attributes.set(name, String(value)); }\n"
    "\tgetAttribute(name) { return this.attributes.get(name) ?? null; }\n",
)

insert_after(
    'scripts/checkTouchJoystickInputContract.js',
    "assert.equal(joystick._base.children[0], joystick._knob);\n",
    "assert.equal(body.children[1], joystick._jumpButton);\n"
    "assert.equal(joystick._jumpButton.type, 'button');\n"
    "assert.equal(joystick._jumpButton.textContent, 'Zıpla');\n"
    "assert.equal(joystick._jumpButton.getAttribute('aria-label'), 'Zıpla');\n"
    "assert.equal(joystick.consumeJumpRequested(), false, 'jump starts unrequested');\n"
    "joystick._jumpButton.dispatch('click', {});\n"
    "assert.equal(joystick.consumeJumpRequested(), true, 'one tap produces one jump edge');\n"
    "assert.equal(joystick.consumeJumpRequested(), false, 'reading the jump edge consumes it');\n",
)

insert_after(
    'scripts/checkTouchJoystickInputContract.js',
    "assert.equal(joystick._base.removed, true);\n",
    "assert.equal(joystick._jumpButton.removed, true);\n"
    "assert.equal(joystick._jumpButton._listeners.has('click'), false, 'jump click listener removed on dispose');\n"
    "assert.equal(joystick.consumeJumpRequested(), false, 'dispose clears pending jump state');\n",
)

print('Run166 additive mobile jump changes applied.')
