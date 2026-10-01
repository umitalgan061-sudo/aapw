import assert from 'node:assert/strict';
import {
  buildSettlementActivityFeed,
  acknowledgeSettlementActivityFeed,
  summarizeSettlementActivityFeed,
  serializeSettlementActivityFeed,
} from '../src/3d/gameplay/settlementCampaignActivityFeed.js';

const view = {
  player: { settlementId: 'north-settlement' },
  activeService: 'blacksmith',
  panel: 'craft',
  revision: 7,
  history: [
    { sequence: 1, at: 1, type: 'open', serviceId: 'blacksmith' },
    { sequence: 2, at: 2, type: 'panel', panel: 'craft' },
    { sequence: 3, at: 3, action: 'craft', status: 'success', message: 'Kılıç üretildi.', requestId: 'req-3' },
  ],
  feedback: { status: 'blocked', code: 'missing-material', message: 'Demir eksik.', action: 'craft' },
};

const first = buildSettlementActivityFeed(view, { limit: 4, readThroughSequence: 2 });
const second = buildSettlementActivityFeed(view, { limit: 4, readThroughSequence: 2 });
assert.equal(first.digest, second.digest, 'deterministic-digest');
assert.equal(first.settlementId, 'north-settlement', 'settlement-id');
assert.equal(first.activeService, 'blacksmith', 'active-service');
assert.equal(first.panel, 'craft', 'panel');
assert.equal(first.entries.length, 4, 'bounded-entry-count');
assert.equal(first.latest.status, 'blocked', 'latest-feedback');
assert.equal(first.latest.label, 'Üretim', 'action-label');
assert.equal(first.statusCounts.blocked, 1, 'blocked-count');
assert.equal(first.statusCounts.success, 1, 'success-count');
assert.equal(first.unread, 2, 'derived-unread');
assert.equal(first.readThroughSequence, 2, 'read-through');
assert(Object.isFrozen(first), 'feed-frozen');
assert(Object.isFrozen(first.entries[0]), 'entry-frozen');
assert.equal(serializeSettlementActivityFeed(first), serializeSettlementActivityFeed(second), 'stable-serialization');

const acknowledged = acknowledgeSettlementActivityFeed(first, 4);
assert.equal(acknowledged.unread, 0, 'acknowledge-all');
assert.equal(acknowledged.readThroughSequence, 4, 'acknowledge-sequence');
assert(Object.isFrozen(acknowledged), 'acknowledged-frozen');

const summary = summarizeSettlementActivityFeed(acknowledged);
assert.deepEqual(summary, {
  digest: acknowledged.digest,
  count: 4,
  unread: 0,
  readThroughSequence: 4,
  latestAction: 'craft',
  latestStatus: 'blocked',
  latestMessage: 'Demir eksik.',
}, 'summary-contract');

const malformed = buildSettlementActivityFeed(null, { limit: 99, unread: 99 });
assert.equal(malformed.entries.length, 0, 'malformed-empty');
assert.equal(malformed.panel, 'overview', 'malformed-panel');
assert.equal(malformed.unread, 0, 'malformed-unread');
console.log(`Settlement activity feed checks passed: ${[first.entries.length, first.digest, summary.count].join(' | ')}`);
