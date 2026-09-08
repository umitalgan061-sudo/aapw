import {
  appendSettlementContentBeat,
  buildSettlementContentBeat,
  buildSettlementContentCheckpoint,
  buildSettlementContentJourney,
  buildSettlementQuestHook,
  buildSettlementTravelHook,
  getSettlementContentHooks,
  getSettlementRolePurpose,
  getSettlementServiceOrder,
  isSettlementRole,
  listSettlementContentRoles,
  roleIsUsefulForChapter,
  settlementContentChapterNames,
  summarizeSettlementContent,
  validateSettlementContentJourney,
} from '../src/3d/gameplay/settlementVerticalSliceContent.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function same(a, b, message) {
  assert(JSON.stringify(a) === JSON.stringify(b), message);
}

const roles = listSettlementContentRoles();
assert(roles.length === 8, 'content role catalog has eight service roles');
assert(new Set(roles).size === 8, 'content role catalog has unique service roles');
for (const role of roles) {
  assert(isSettlementRole(role), `${role} remains a valid settlement role`);
  assert(getSettlementRolePurpose(role), `${role} has a service purpose`);
  assert(getSettlementContentHooks(role).length > 0, `${role} has interaction hooks`);
  const beat = buildSettlementContentBeat(role, { targetId: `${role}-canonical` });
  assert(beat.version === 1, `${role} beat has explicit version`);
  assert(beat.targetId === `${role}-canonical`, `${role} beat preserves canonical target id`);
  assert(beat.role === role, `${role} beat preserves role identity`);
}

for (const chapter of settlementContentChapterNames()) {
  const order = getSettlementServiceOrder(chapter);
  assert(Array.isArray(order) && order.length > 0, `${chapter} has a non-empty service order`);
  assert(new Set(order).size === order.length, `${chapter} service order has no duplicates`);
  for (const role of order) assert(roles.includes(role), `${chapter} references known role ${role}`);
}

const arrival = buildSettlementContentJourney({
  settlementId: 'canonical-settlement',
  chapter: 'arrival',
  targets: { gate: 'gate-west', market: 'market-main', tavern: 'tavern-main' },
  requiredRoles: ['gate', 'market'],
  questHooks: { tavern: 'arrival-quest' },
});
const validation = validateSettlementContentJourney(arrival);
assert(validation.ok, 'arrival journey validates');
assert(arrival.firstRole === 'gate', 'arrival begins at gate');
assert(arrival.lastRole === 'tavern', 'arrival ends at tavern');
assert(arrival.beatCount === 3, 'arrival has three beats');
assert(arrival.beats[0].targetId === 'gate-west', 'arrival preserves gate target');
assert(arrival.beats[1].required === true, 'arrival marks market required');
assert(arrival.beats[2].questHook === 'arrival-quest', 'arrival keeps tavern quest hook');

const arrivalCheckpoint0 = buildSettlementContentCheckpoint(arrival, []);
assert(arrivalCheckpoint0.complete === false, 'empty completion is not complete');
assert(arrivalCheckpoint0.remainingCount === 3, 'arrival starts with three remaining beats');
assert(arrivalCheckpoint0.next.role === 'gate', 'arrival next beat is gate');
const arrivalCheckpoint1 = buildSettlementContentCheckpoint(arrival, ['gate']);
assert(arrivalCheckpoint1.completedCount === 1, 'gate completion is tracked');
assert(arrivalCheckpoint1.next.role === 'market', 'market becomes next after gate');
const arrivalCheckpoint2 = buildSettlementContentCheckpoint(arrival, ['gate', 'market']);
assert(arrivalCheckpoint2.next.role === 'tavern', 'tavern becomes next after market');
const arrivalCheckpoint3 = buildSettlementContentCheckpoint(arrival, ['gate', 'market', 'tavern']);
assert(arrivalCheckpoint3.complete === true, 'arrival completes after all roles');
assert(arrivalCheckpoint3.next === null, 'completed arrival has no next role');

const summary = summarizeSettlementContent(arrival);
assert(summary.ok, 'arrival summary is valid');
assert(summary.requiredCount === 2, 'arrival summary counts required roles');
assert(summary.roles.join(',') === 'gate,market,tavern', 'arrival summary preserves beat order');

// Duplicate and invalid roles are filtered rather than becoming new geography.
const commerce = buildSettlementContentJourney({ settlementId: 'canonical-settlement', roles: ['market', 'market', 'blacksmith', 'unknown', 'farm'] });
assert(commerce.beatCount === 3, 'custom content removes duplicate and unknown roles');
assert(commerce.beats[0].role === 'market', 'custom content keeps first requested role');
assert(commerce.beats[1].role === 'blacksmith', 'custom content keeps second known role');
assert(commerce.beats[2].role === 'farm', 'custom content keeps third known role');
assert(validateSettlementContentJourney(commerce).ok, 'custom content validates after normalization');

// Append is bounded and idempotent.
const appended = appendSettlementContentBeat(arrival, 'blacksmith', { targetId: 'forge-main', required: true, questHook: 'forge-quest' });
assert(appended.beatCount === 4, 'append adds one new service beat');
assert(appended.beats[3].role === 'blacksmith', 'append places new beat at end');
assert(appended.beats[3].required === true, 'append preserves required flag');
assert(appended.beats[3].questHook === 'forge-quest', 'append preserves quest hook');
assert(appendSettlementContentBeat(appended, 'blacksmith') === null, 'append rejects duplicate role');
assert(appendSettlementContentBeat(arrival, 'not-a-role') === null, 'append rejects unknown role');

// Role usefulness follows authored chapter order instead of inventing a route.
assert(roleIsUsefulForChapter('gate', 'arrival'), 'gate is useful on arrival chapter');
assert(roleIsUsefulForChapter('blacksmith', 'commerce'), 'blacksmith is useful on commerce chapter');
assert(roleIsUsefulForChapter('stable', 'departure'), 'stable is useful on departure chapter');
assert(!roleIsUsefulForChapter('stable', 'arrival'), 'stable is not forced into arrival');
assert(!roleIsUsefulForChapter('unknown', 'commerce'), 'unknown role is never useful');

// Quest/travel hooks are serializable and deterministic.
const questHookA = buildSettlementQuestHook('tavern', 'missing-caravan', { trigger: 'acceptQuest', objective: 'Kervancı ile konuş', requiresRoleVisited: true });
const questHookB = buildSettlementQuestHook('tavern', 'missing-caravan', { requiresRoleVisited: true, objective: 'Kervancı ile konuş', trigger: 'acceptQuest' });
same(questHookA, questHookB, 'quest hook remains deterministic for reordered options');
assert(questHookA.fingerprint, 'quest hook carries evidence fingerprint');
assert(buildSettlementQuestHook('unknown', 'quest') === null, 'unknown role cannot create quest hook');
assert(buildSettlementQuestHook('tavern', '') === null, 'missing quest id cannot create quest hook');

const travelHook = buildSettlementTravelHook('market', 'blacksmith', { travelMode: 'street', requiresRoadOpen: true, requiresDiscovery: false });
assert(travelHook.originRole === 'market', 'travel hook preserves origin role');
assert(travelHook.destinationRole === 'blacksmith', 'travel hook preserves destination role');
assert(travelHook.requiresRoadOpen === true, 'travel hook retains road gate');
assert(travelHook.requiresDiscovery === false, 'travel hook retains discovery override');
assert(travelHook.travelMode === 'street', 'travel hook retains authored mode');
assert(buildSettlementTravelHook('market', 'market') === null, 'travel hook rejects same endpoint');
assert(buildSettlementTravelHook('unknown', 'market') === null, 'travel hook rejects unknown origin');

// Required role progress is independent from completion of optional roles.
const progression = buildSettlementContentJourney({ settlementId: 'canonical-settlement', roles: ['tavern', 'blacksmith', 'market'], requiredRoles: ['tavern'] });
let checkpoint = buildSettlementContentCheckpoint(progression, ['market']);
assert(checkpoint.completedCount === 1, 'optional market can be completed first');
assert(checkpoint.next.role === 'tavern', 'next selection remains deterministic by content order');
checkpoint = buildSettlementContentCheckpoint(progression, ['market', 'tavern']);
assert(checkpoint.next.role === 'blacksmith', 'blacksmith becomes next after tavern');
checkpoint = buildSettlementContentCheckpoint(progression, ['market', 'tavern', 'blacksmith']);
assert(checkpoint.complete, 'full progression completes');

// Validation catches malformed version, missing ids, empty beats and duplicate role entries.
assert(!validateSettlementContentJourney({ version: 9, settlementId: 's', beats: [] }).ok, 'unsupported content version is rejected');
assert(!validateSettlementContentJourney({ version: 1, settlementId: '', beats: [{ role: 'market', targetId: 'm', hooks: ['trade'] }] }).ok, 'missing settlement id is rejected');
assert(!validateSettlementContentJourney({ version: 1, settlementId: 's', beats: [] }).ok, 'empty content beats are rejected');
assert(!validateSettlementContentJourney({ version: 1, settlementId: 's', beats: [{ role: 'market', targetId: '', hooks: ['trade'] }] }).ok, 'missing target is rejected');
assert(!validateSettlementContentJourney({ version: 1, settlementId: 's', beats: [{ role: 'market', targetId: 'm', hooks: [] }] }).ok, 'missing hooks are rejected');
assert(!validateSettlementContentJourney({ version: 1, settlementId: 's', beats: [{ role: 'market', targetId: 'a', hooks: ['trade'] }, { role: 'market', targetId: 'b', hooks: ['trade'] }] }).ok, 'duplicate role is rejected');
assert(!validateSettlementContentJourney({ version: 1, settlementId: 's', beats: [{ role: 'unknown', targetId: 'a', hooks: ['trade'] }] }).ok, 'unknown role is rejected');

// Journey fingerprints react to actual content differences.
const a = buildSettlementContentJourney({ settlementId: 's', chapter: 'arrival', roles: ['gate', 'market'] });
const b = buildSettlementContentJourney({ settlementId: 's', chapter: 'arrival', roles: ['gate', 'tavern'] });
assert(a.fingerprint !== b.fingerprint, 'content fingerprint reflects authored role change');
const c = buildSettlementContentJourney({ settlementId: 'other', chapter: 'arrival', roles: ['gate', 'market'] });
assert(a.fingerprint !== c.fingerprint, 'content fingerprint reflects settlement identity');

// Beat options are scalar and bounded; large lists cannot explode a UI payload.
const noisy = buildSettlementContentBeat('market', {
  targetId: 'x'.repeat(200),
  questHook: 'q'.repeat(200),
  rewardHook: 'r'.repeat(200),
  hint: 'h'.repeat(200),
});
assert(noisy.targetId.length <= 96, 'content target id is bounded');
assert(noisy.questHook.length <= 96, 'content quest hook is bounded');
assert(noisy.rewardHook.length <= 96, 'content reward hook is bounded');
assert(noisy.hint.length <= 96, 'content hint is bounded');

if (failures.length) {
  console.error(`[settlement-vertical-slice-content] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[settlement-vertical-slice-content] PASS: ${passed} settlement content assertions.`);
