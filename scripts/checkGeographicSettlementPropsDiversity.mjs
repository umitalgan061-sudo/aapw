import assert from 'node:assert/strict';
import { GEOGRAPHIC_SETTLEMENT_PROP_ASSETS, GEOGRAPHIC_SETTLEMENT_PROP_ROLES } from '../src/3d/world/geographicSettlementProps.js';

const families = Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS);
assert.equal(new Set(families).size, families.length, 'asset families must be unique');
for (const [roleId, role] of Object.entries(GEOGRAPHIC_SETTLEMENT_PROP_ROLES)) {
  assert.ok(role.max <= 12, `${roleId}: per-seat cap drift`);
  assert.ok(role.families.length > 1, `${roleId}: uniform clone risk`);
  assert.ok(role.families.every((family) => GEOGRAPHIC_SETTLEMENT_PROP_ASSETS[family]), `${roleId}: missing authored family`);
}
console.log(JSON.stringify({ ok: true, familyCount: families.length, roleCount: Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ROLES).length }));
