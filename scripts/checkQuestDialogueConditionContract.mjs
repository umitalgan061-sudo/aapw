import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/3d/gameplay/interaction.js', 'utf8');
const markers = [
  "const QUEST_STATUS = Object.freeze({",
  "function createQuestTracker",
  "function sameTrigger",
  "function turnInRequirementMet",
  "function unlockEligible",
  "function isChoiceAvailable",
  "function resolutionChoices",
  "if (progression.snapshot().level >= 2 && reputation.get(INTERACTION_FACTIONS.DRAGONSTONE) >= 10)",
  "if (quest.objectives.every((objective) => current.completedObjectives.has(objective.id))) current.status = QUEST_STATUS.READY;",
  "if (!turnIn || !turnInRequirementMet(turnIn)) continue;",
  "if (!current.rewardGranted) { current.rewardGranted = true; onReward(quest.reward, quest); }",
];
for (const marker of markers) assert.ok(source.includes(marker), `missing quest/dialogue boundary: ${marker}`);

const statusOrder = ['LOCKED', 'AVAILABLE', 'ACTIVE', 'READY', 'COMPLETED'];
const statusBody = source.match(/const QUEST_STATUS = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] ?? '';
for (const [index, status] of statusOrder.entries()) {
  assert.ok(statusBody.includes(status), `missing status ${status}`);
  if (index > 0) assert.ok(statusBody.indexOf(status) > statusBody.indexOf(statusOrder[index - 1]), `status order drift before ${status}`);
}

assert.match(source, /if \(current\.status === QUEST_STATUS\.LOCKED \|\| current\.status === QUEST_STATUS\.COMPLETED\) continue;/);
assert.match(source, /if \(!current\.rewardGranted\) \{ current\.rewardGranted = true; onReward\(quest\.reward, quest\); \}/);
assert.match(source, /progression\.snapshot\(\)\.level >= 2 && reputation\.get\(INTERACTION_FACTIONS\.DRAGONSTONE\) >= 10/);

console.log('QUEST_DIALOGUE_CONDITION_CONTRACT_OK');
