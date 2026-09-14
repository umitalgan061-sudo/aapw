import { strict as assert } from 'node:assert';
import { createSettlementActivityFeedProjection, validateSettlementActivityFeedSnapshot } from '../src/3d/gameplay/settlementActivityFeedProjection.js';

const feed = createSettlementActivityFeedProjection({ settlementId: 'river-market', historyLimit: 4 });
let view = feed.ingestMany([
  { name: 'service-opened', at: 10, service: { id: 'market' }, panel: 'trade' },
  { name: 'trade-completed', at: 11, message: 'Bakır satıldı.', requestId: 'r-1' },
  { name: 'feedback', at: 12, feedback: { status: 'blocked', message: 'Altın yetersiz.' } },
  { name: 'quest-advanced', at: 13, message: 'Görev ilerledi.' },
  { name: 'save-completed', at: 14 },
]);
assert.equal(view.total, 4);
assert.equal(view.events[0].name, 'trade-completed');
assert.equal(view.unread, 1);
assert.equal(view.events.at(-1).tone, 'save');
assert.equal(validateSettlementActivityFeedSnapshot(view).ok, true);
assert.equal(Object.isFrozen(view), true);
assert.equal(Object.isFrozen(view.events[0]), true);
const repeat = createSettlementActivityFeedProjection({ settlementId: 'river-market', historyLimit: 4 });
const view2 = repeat.ingestMany([
  { name: 'service-opened', at: 10, service: { id: 'market' }, panel: 'trade' },
  { name: 'trade-completed', at: 11, message: 'Bakır satıldı.', requestId: 'r-1' },
  { name: 'feedback', at: 12, feedback: { status: 'blocked', message: 'Altın yetersiz.' } },
  { name: 'quest-advanced', at: 13, message: 'Görev ilerledi.' },
  { name: 'save-completed', at: 14 },
]);
assert.equal(view.fingerprint, view2.fingerprint);
feed.dispose();
assert.equal(feed.read().disposed, true);
assert.equal(feed.read().total, 0);
console.log(JSON.stringify({ ok: true, fingerprint: view.fingerprint, total: view.total }));
