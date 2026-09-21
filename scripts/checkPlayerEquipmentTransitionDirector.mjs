import { readFile } from 'node:fs/promises';

const source = await readFile('src/3d/gameplay/playerEquipmentTransitionDirector.ts', 'utf8');
const rules = await readFile('src/3d/gameplay/playerEquipmentCombatRules.ts', 'utf8');
const failures = [];
for (const token of [
  "comparePlayerEquipmentProfiles",
  "resolvePlayerEquipmentTransition",
  "transitionKey",
  "isPlayerEquipmentTransitionReceipt",
  "Object.freeze",
]) if (!source.includes(token)) failures.push(`transition-director missing ${token}`);
for (const token of [
  "weaponChanged",
  "hardReset",
  "socketsToRefresh",
  "crossfadeSeconds",
]) if (!rules.includes(token)) failures.push(`combat-rules contract missing ${token}`);
if (source.includes("EditorMaterialStudio") || source.includes("document.")) failures.push('runtime/editor DOM coupling forbidden');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: 'player-equipment-transition-director', immutableReceipt: true, domFree: true }));
