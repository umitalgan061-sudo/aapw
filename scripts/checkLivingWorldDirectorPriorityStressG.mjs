import assert from 'node:assert/strict';
import { scoreDirectorRequest, rankDirectorRequests, resolveBudgetConflicts, buildDirectorPlan, decisionDigest } from '../src/3d/gameplay/livingWorldDirectorPriorityPolicy.js';

const roles = ['guard','watcher','merchant','caravan','farmer','hunter','herbalist','healer','blacksmith','miner','scout','courier','fisher','shepherd','forester','innkeeper','watchcaptain','quartermaster','ferryman','guide'];
const contexts = ['quiet','day','night','rain','storm','snow','festival','market','harvest','scarcity','fire','combat'];
const cases = [
  ['g01','guard','combat',0.99,0.99], ['g02','guard','fire',0.95,0.95], ['g03','guard','storm',0.90,0.90], ['g04','guard','night',0.60,0.70],
  ['g05','watcher','combat',0.98,0.98], ['g06','watcher','fire',0.94,0.94], ['g07','watcher','storm',0.88,0.92], ['g08','watcher','night',0.57,0.69],
  ['g09','merchant','market',0.72,0.30], ['g10','merchant','scarcity',0.84,0.72], ['g11','merchant','festival',0.61,0.22], ['g12','merchant','storm',0.91,0.93],
  ['g13','caravan','market',0.76,0.33], ['g14','caravan','scarcity',0.86,0.74], ['g15','caravan','snow',0.81,0.71], ['g16','caravan','combat',0.96,0.96],
  ['g17','farmer','harvest',0.80,0.33], ['g18','farmer','rain',0.68,0.42], ['g19','farmer','storm',0.89,0.91], ['g20','farmer','scarcity',0.93,0.83],
  ['g21','hunter','day',0.65,0.34], ['g22','hunter','night',0.73,0.66], ['g23','hunter','scarcity',0.88,0.79], ['g24','hunter','combat',0.97,0.97],
  ['g25','herbalist','day',0.58,0.24], ['g26','herbalist','rain',0.66,0.48], ['g27','herbalist','scarcity',0.91,0.77], ['g28','herbalist','fire',0.94,0.94],
  ['g29','healer','quiet',0.62,0.18], ['g30','healer','injury',0.98,0.74], ['g31','healer','combat',0.99,0.99], ['g32','healer','storm',0.95,0.90],
  ['g33','blacksmith','market',0.63,0.31], ['g34','blacksmith','scarcity',0.86,0.76], ['g35','blacksmith','fire',0.92,0.91], ['g36','blacksmith','combat',0.98,0.98],
  ['g37','miner','day',0.57,0.27], ['g38','miner','snow',0.74,0.70], ['g39','miner','scarcity',0.87,0.79], ['g40','miner','storm',0.96,0.93],
  ['g41','scout','quiet',0.49,0.21], ['g42','scout','night',0.71,0.68], ['g43','scout','storm',0.93,0.92], ['g44','scout','combat',0.99,0.99],
  ['g45','courier','day',0.67,0.25], ['g46','courier','market',0.78,0.37], ['g47','courier','storm',0.95,0.94], ['g48','courier','combat',0.99,0.99],
  ['g49','fisher','day',0.61,0.27], ['g50','fisher','rain',0.72,0.51], ['g51','fisher','storm',0.97,0.96], ['g52','fisher','scarcity',0.90,0.82],
  ['g53','shepherd','day',0.59,0.28], ['g54','shepherd','snow',0.82,0.73], ['g55','shepherd','storm',0.96,0.92], ['g56','shepherd','scarcity',0.93,0.84],
  ['g57','forester','day',0.60,0.22], ['g58','forester','rain',0.67,0.46], ['g59','forester','fire',0.99,0.98], ['g60','forester','storm',0.97,0.95],
  ['g61','innkeeper','festival',0.79,0.18], ['g62','innkeeper','market',0.83,0.22], ['g63','innkeeper','storm',0.91,0.82], ['g64','innkeeper','combat',0.97,0.96],
  ['g65','watchcaptain','quiet',0.55,0.30], ['g66','watchcaptain','night',0.76,0.71], ['g67','watchcaptain','fire',0.98,0.98], ['g68','watchcaptain','combat',0.99,0.99],
  ['g69','quartermaster','market',0.82,0.30], ['g70','quartermaster','scarcity',0.94,0.88], ['g71','quartermaster','storm',0.92,0.91], ['g72','quartermaster','combat',0.98,0.98],
  ['g73','ferryman','day',0.57,0.24], ['g74','ferryman','rain',0.69,0.54], ['g75','ferryman','storm',0.96,0.95], ['g76','ferryman','combat',0.98,0.98],
  ['g77','guide','day',0.64,0.29], ['g78','guide','snow',0.78,0.72], ['g79','guide','storm',0.95,0.94], ['g80','guide','combat',0.99,0.99],
];

for (let index = 0; index < cases.length; index += 1) {
  const [id, role, context, urgency, threat] = cases[index];
  const decision = scoreDirectorRequest({ id, requestId: id, role, context, urgency, threat, socialNeed: (index % 7) / 7, fatigue: (index % 5) / 5, scarcity: (index % 9) / 9, travelRisk: (index % 11) / 11, distanceMeters: index * 61 }, index);
  assert.equal(decision.accepted, true, id);
  assert.ok(decision.score >= 0 && decision.score <= 1, id);
  assert.ok(decision.reasons.length > 0, id);
}

const batchRequests = roles.flatMap((role, roleIndex) => contexts.map((context, contextIndex) => ({
  requestId: `stress-${roleIndex}-${contextIndex}`,
  role,
  context,
  urgency: ((roleIndex + contextIndex * 2) % 10) / 10,
  threat: ((roleIndex * 2 + contextIndex * 3) % 10) / 10,
  socialNeed: ((roleIndex * 3 + contextIndex) % 10) / 10,
  fatigue: ((roleIndex * 5 + contextIndex * 2) % 10) / 10,
  scarcity: ((roleIndex * 7 + contextIndex * 4) % 10) / 10,
  travelRisk: ((roleIndex * 11 + contextIndex * 5) % 10) / 10,
  distanceMeters: 100 + roleIndex * 23 + contextIndex * 41,
})));
const ranked = rankDirectorRequests(batchRequests, { budget: 31 });
assert.equal(ranked.considered, 240);
assert.equal(ranked.selected.length, 31);
assert.equal(ranked.deferred.length, 209);
const resolved = resolveBudgetConflicts(ranked.selected, { budget: 16, reservedProtected: 6 });
assert.equal(resolved.selected.length, 16);
assert.equal(new Set(resolved.selected.map((decision) => decision.request.requestId)).size, 16);
assert.equal(decisionDigest(resolved.selected), resolved.digest);

const plan = buildDirectorPlan(batchRequests, { budget: 19, reservedProtected: 5, nowSeconds: 900 });
assert.equal(plan.budget, 19);
assert.equal(plan.selected.length, 19);
assert.equal(new Set(plan.selected.map((decision) => decision.request.requestId)).size, 19);
assert.equal(plan.digest, decisionDigest(plan.selected));
console.log(JSON.stringify({ ok: true, atomicCases: cases.length, matrixCases: batchRequests.length, selected: plan.selected.length, digest: plan.digest }));
