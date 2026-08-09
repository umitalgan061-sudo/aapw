#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TARGET = path.resolve(process.cwd(), 'scripts', 'checkRun216TransformControlsPointerDrag.js');

function fail(message) {
  throw new Error(message);
}

function requireFragment(source, fragment, label) {
  if (!source.includes(fragment)) fail(`Missing ${label}: ${fragment}`);
}

function forbidFragment(source, fragment, label) {
  if (source.includes(fragment)) fail(`Forbidden ${label}: ${fragment}`);
}

function main() {
  const target = path.resolve(process.argv[2] || DEFAULT_TARGET);
  if (!fs.existsSync(target)) fail(`Pointer-drag proof is missing: ${target}`);
  const source = fs.readFileSync(target, 'utf8');

  const required = [
    ["await page.mouse.move(plan.start.x, plan.start.y);", 'pointer hover before drag'],
    ["await page.mouse.down();", 'real pointer down'],
    ["await page.mouse.move(plan.end.x, plan.end.y, { steps: 12 });", 'stepped real pointer move'],
    ["await page.mouse.up();", 'real pointer up'],
    ["during.dragging === true", 'dragging=true during physical drag'],
    ["during.orbitEnabled === false", 'OrbitControls lock during drag'],
    ["after.dragging === false", 'dragging=false after pointerup'],
    ["after.orbitEnabled === true", 'OrbitControls restore after pointerup'],
    ["after.objectPosition[0] - Math.round(after.objectPosition[0])", '1m translation snap assertion'],
    ["await page.inputValue('#we-pos-x')", 'Inspector synchronization assertion'],
    ["errors.length === 0", 'zero browser error assertion'],
    ["desktop-transform-pointer-drag.png", 'visual evidence artifact'],
    ["transform._gizmo?.picker?.translate", 'real TransformControls picker targeting']
  ];

  for (const [fragment, label] of required) requireFragment(source, fragment, label);

  const forbidden = [
    ["transform.dragging = true", 'synthetic dragging-state substitution'],
    ["transform.dragging = false", 'synthetic dragging-state reset'],
    ["transform.pointerMove(", 'direct pointerMove API substitution'],
    ["transform.pointerDown(", 'direct pointerDown API substitution'],
    ["transform.pointerUp(", 'direct pointerUp API substitution']
  ];

  for (const [fragment, label] of forbidden) forbidFragment(source, fragment, label);

  const mouseDownCount = (source.match(/page\.mouse\.down\(/g) || []).length;
  const mouseUpCount = (source.match(/page\.mouse\.up\(/g) || []).length;
  if (mouseDownCount !== 1 || mouseUpCount !== 1) {
    fail(`Pointer lifecycle drift: mouse.down=${mouseDownCount}, mouse.up=${mouseUpCount}`);
  }

  console.log('[checkRun216PointerDragProofContract] PASS: real mouse lifecycle, snap, Inspector, Orbit and visual-proof contract preserved');
}

try {
  main();
} catch (error) {
  console.error(`[checkRun216PointerDragProofContract] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
