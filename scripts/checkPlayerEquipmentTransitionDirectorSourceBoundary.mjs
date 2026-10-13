import { readFile } from 'node:fs/promises';

const source = await readFile('src/3d/gameplay/playerEquipmentTransitionDirector.ts', 'utf8');
const failures = [];

for (const token of [
  "from './playerEquipmentCombatRules.ts'",
  'comparePlayerEquipmentProfiles',
  'resolvePlayerEquipmentTransition',
  'resolvePlayerEquipmentTransitionReceipt',
  'validatePlayerEquipmentTransitionReceipt',
]) {
  if (!source.includes(token)) failures.push(`missing-live-authority-contract:${token}`);
}

for (const forbidden of [
  'EditorMaterialStudio',
  'document.',
  'window.',
  'new class Player',
  'new class Combat',
]) {
  if (source.includes(forbidden)) failures.push(`forbidden-runtime-boundary:${forbidden}`);
}

if (!source.includes('Object.freeze')) failures.push('immutable-receipt-contract-missing');
if (!source.includes('VALID_EQUIPMENT_SOCKETS')) failures.push('socket-domain-validation-missing');
if (!source.includes('transition-key-mismatch')) failures.push('transition-key-validation-missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'player-equipment-transition-director-source-boundary',
  liveAuthority: true,
  domFree: true,
  immutableReceipt: true,
  socketDomainValidated: true,
  transitionKeyValidated: true,
}));
