#!/usr/bin/env node
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const targets = [
  'src/3d/modern/combatAuthority.ts',
  'src/3d/gameplay/playerCombatDecisionV6.ts',
  'tests/modern/combatAuthorityRegression.test.ts',
];
const failures = [];

for (const path of targets) {
  try {
    await readFile(join(root, path), 'utf8');
  } catch {
    failures.push(`Missing combat modernization file: ${path}`);
  }
}

for (const path of targets.filter((value) => value.endsWith('.ts'))) {
  const source = await readFile(join(root, path), 'utf8');
  if (/\bMath\.random\s*\(/.test(source)) failures.push(`${path}: Math.random is forbidden in deterministic combat code.`);
  if (/\bDate\.now\s*\(/.test(source)) failures.push(`${path}: Date.now is forbidden in deterministic combat code.`);
}

const combat = await readFile(join(root, 'src/3d/modern/combatAuthority.ts'), 'utf8');
for (const required of [
  'attackInstanceId',
  'currentAttackId',
  'while (remainingDelta > 0',
  'const key = `${attackInstanceId}:${target.id}`',
]) {
  if (!combat.includes(required)) failures.push(`combatAuthority.ts: required deterministic guard missing: ${required}`);
}

console.log(JSON.stringify({ ok: failures.length === 0, checked: targets.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
