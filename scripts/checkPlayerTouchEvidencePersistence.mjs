#!/usr/bin/env node
import fs from 'node:fs';

const source = fs.readFileSync('scripts/checkPlayerTouchCombatRuntime.mjs', 'utf8');
const need = (ok, message) => {
  if (!ok) throw new Error(`[player-touch-evidence-persistence] ${message}`);
};

const metricsWrite = source.indexOf("fs.writeFileSync(path.join(outDir, 'touch-combat-runtime.json')");
const zeroErrorGate = source.indexOf("need(errors.length === 0");
const browserErrorsField = source.indexOf('browserErrors: errors');
const failureWrite = source.indexOf("fs.writeFileSync(path.join(outDir, 'failure.json')");

need(metricsWrite >= 0, 'touch runtime must persist metrics');
need(browserErrorsField >= 0, 'touch metrics must preserve browser/page errors');
need(zeroErrorGate >= 0, 'touch runtime must keep the zero-error hard gate');
need(failureWrite >= 0, 'touch runtime must persist failure diagnostics');
need(metricsWrite < zeroErrorGate, 'gameplay evidence must be written before the zero-error hard gate');
need(browserErrorsField < zeroErrorGate, 'browser errors must be included in persisted evidence before failure');
need(zeroErrorGate < failureWrite, 'zero-error failure must flow through the diagnostic catch path');

console.log('PLAYER_TOUCH_EVIDENCE_PERSISTENCE_OK');
