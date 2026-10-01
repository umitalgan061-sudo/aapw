import assert from 'node:assert/strict';
import {
  buildSettlementNotificationPolicy,
  serializeSettlementNotificationPolicy,
} from '../src/3d/gameplay/settlementCampaignNotificationPolicy.js';

let checks = 0;
const check = (condition, message) => { assert.equal(Boolean(condition), true, message); checks += 1; };

const input = {
  readThroughSequence: 1,
  activity: [
    { sequence: 1, action: 'open', status: 'info', serviceId: 'market', message: 'opened' },
    { sequence: 2, action: 'buy', ok: true, status: 'success', requestId: 'req-2' },
  ],
  actions: [
    { sequence: 3, action: 'craft', ok: false, reason: 'missing-materials', status: 'blocked', serviceId: 'blacksmith' },
    { sequence: 4, action: 'travel', ok: false, status: 'error', message: 'route failed' },
  ],
};

const first = buildSettlementNotificationPolicy(input);
const second = buildSettlementNotificationPolicy(input);
check(first.digest === second.digest, 'policy must be deterministic');
check(first.unreadCount === 3, 'read-through should hide acknowledged sequence');
check(first.latest.action === 'travel', 'latest visible action should be travel');
check(first.counts.success === 1 && first.counts.blocked === 1 && first.counts.error === 1, 'status counts should aggregate');
check(first.hasBlockingFeedback === true, 'blocked/error feedback should be surfaced');
check(Object.isFrozen(first) && Object.isFrozen(first.notifications[0]) && Object.isFrozen(first.counts), 'output must be frozen');
check(serializeSettlementNotificationPolicy(first) === serializeSettlementNotificationPolicy(second), 'serialization must be stable');

const malformed = buildSettlementNotificationPolicy({ actions: [null, { action: 'sell', status: 'wat' }] });
check(malformed.notifications.length === 2, 'malformed entries should normalize');
check(malformed.notifications[1].status === 'info', 'unknown status should fail closed to info');
check(malformed.notifications[0].label.length > 0, 'normalized notification should have a label');

console.log(`PASS settlement campaign notification policy (${checks} checks)`);
