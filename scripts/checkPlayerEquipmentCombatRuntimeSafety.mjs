import assert from 'node:assert/strict';
import { createPlayerEquipmentCombatRuntimeSafety } from '../src/3d/gameplay/playerEquipmentCombatRuntimeSafety.js';

const calls = [];
const runtime = {
  read: () => ({ version: 1, phase: 'active', equipment: { mainHandId: 'sword' } }),
  update: () => { calls.push('update'); throw new Error('transient'); },
  refreshEquipment: () => { calls.push('refresh'); return { version: 1, phase: 'idle' }; },
  readHistory: () => [{ revision: 1 }],
  materialAudit: () => ({ status: 'ready', missing: [] }),
  dispose: () => calls.push('dispose'),
};
const safety = createPlayerEquipmentCombatRuntimeSafety({ runtime });
assert.equal(safety.update(0.016, 1).phase, 'active');
assert.equal(safety.diagnostics().errors.length, 1);
assert.deepEqual(safety.refreshEquipment(2), { version: 1, phase: 'idle' });
assert.deepEqual(safety.readHistory(), [{ revision: 1 }]);
assert.deepEqual(safety.materialAudit(), { status: 'ready', missing: [] });
safety.dispose();
assert.deepEqual(calls, ['update', 'refresh', 'dispose']);
assert.equal(safety.update(0.016, 3).phase, 'active');
assert.equal(safety.diagnostics().disposed, true);
console.log('player equipment combat runtime safety: ok');
