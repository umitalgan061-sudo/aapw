import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function importSource(relativeUrl) {
	const source = await readFile(new URL(relativeUrl, import.meta.url), 'utf8');
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
	return import(moduleUrl);
}

const { createQuestSystem, QUEST_EVENTS } = await importSource('../src/3d/gameplay/questSystem.js');
const { buildQuestJournalModel } = await importSource('../src/3d/ui/questJournal.js');

const emitted = [];
const eventsBus = {
	emit(eventName, payload) {
		emitted.push({ eventName, payload });
	},
};

const system = createQuestSystem({ eventsBus, worldEventName: 'world:test' });
const quest = (id) => system.getSnapshot().find((entry) => entry.id === id);
const eventCount = (eventName, questId = null) => emitted.filter((entry) => (
	entry.eventName === eventName && (questId === null || entry.payload?.id === questId || entry.payload?.questId === questId)
)).length;

assert.equal(system.getSnapshot().length, 2);
assert.equal(quest('law-of-the-watch').status, 'available');
assert.equal(quest('watch-under-pressure').status, 'locked');

// Prerequisite gating: the second quest's accept dialogue does nothing before quest one completes.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 2 });
assert.equal(quest('watch-under-pressure').status, 'locked');
assert.equal(eventCount(QUEST_EVENTS.ACCEPTED, 'watch-under-pressure'), 0);

system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(quest('law-of-the-watch').status, 'active');
assert.equal(eventCount(QUEST_EVENTS.ACCEPTED, 'law-of-the-watch'), 1);

// A repeated accept choice must not reset/progress the active quest.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(quest('law-of-the-watch').status, 'active');
assert.equal(eventCount(QUEST_EVENTS.ACCEPTED, 'law-of-the-watch'), 1);

system.handleDialogueChoice({ npcId: 'stannis-guard-2', choiceIndex: 0 });
let snapshot = quest('law-of-the-watch');
assert.equal(snapshot.status, 'ready');
assert.equal(snapshot.objectives[0].completed, true);
assert.equal(eventCount(QUEST_EVENTS.READY_TO_TURN_IN, 'law-of-the-watch'), 1);

// Wrong turn-in choice must be ignored.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(quest('law-of-the-watch').status, 'ready');

system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
snapshot = quest('law-of-the-watch');
assert.equal(snapshot.status, 'completed');
assert.equal(snapshot.rewardGranted, true);
assert.equal(eventCount(QUEST_EVENTS.COMPLETED, 'law-of-the-watch'), 1);
assert.equal(eventCount(QUEST_EVENTS.REWARD_GRANTED, 'law-of-the-watch'), 1);

// Completing the prerequisite unlocks, but does not auto-accept, the second quest exactly once.
assert.equal(quest('watch-under-pressure').status, 'available');
assert.equal(eventCount(QUEST_EVENTS.UNLOCKED, 'watch-under-pressure'), 1);
assert.equal(eventCount(QUEST_EVENTS.ACCEPTED, 'watch-under-pressure'), 0);

// Completed quests are edge-triggered and cannot grant the reward twice.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
assert.equal(eventCount(QUEST_EVENTS.REWARD_GRANTED, 'law-of-the-watch'), 1);
assert.equal(eventCount(QUEST_EVENTS.UNLOCKED, 'watch-under-pressure'), 1);

// Quest two proves the state machine is not accidentally limited to one objective.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 2 });
assert.equal(quest('watch-under-pressure').status, 'active');
assert.equal(eventCount(QUEST_EVENTS.ACCEPTED, 'watch-under-pressure'), 1);

// Turn-in trigger before objectives are ready must not complete the quest.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
assert.equal(quest('watch-under-pressure').status, 'active');

system.handleDialogueChoice({ npcId: 'stannis-guard-2', choiceIndex: 1 });
snapshot = quest('watch-under-pressure');
assert.equal(snapshot.status, 'active');
assert.deepEqual(snapshot.objectives.map((objective) => objective.completed), [true, false]);
const updatesAfterFirstObjective = eventCount(QUEST_EVENTS.UPDATED, 'watch-under-pressure');

// Replaying the same objective cannot emit another progress edge.
system.handleDialogueChoice({ npcId: 'stannis-guard-2', choiceIndex: 1 });
assert.equal(eventCount(QUEST_EVENTS.UPDATED, 'watch-under-pressure'), updatesAfterFirstObjective);
assert.deepEqual(quest('watch-under-pressure').objectives.map((objective) => objective.completed), [true, false]);

system.handleDialogueChoice({ npcId: 'stannis-guard-2', choiceIndex: 2 });
snapshot = quest('watch-under-pressure');
assert.equal(snapshot.status, 'ready');
assert.deepEqual(snapshot.objectives.map((objective) => objective.completed), [true, true]);
assert.equal(eventCount(QUEST_EVENTS.READY_TO_TURN_IN, 'watch-under-pressure'), 1);

const activeJournal = buildQuestJournalModel(system.getSnapshot());
assert.equal(activeJournal.activeCount, 1);
assert.equal(activeJournal.readyCount, 1);
assert.equal(activeJournal.completedCount, 1);
assert.deepEqual(activeJournal.quests.map((entry) => entry.id), ['law-of-the-watch', 'watch-under-pressure']);
assert.equal(activeJournal.quests[1].completedObjectiveCount, 2);

system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(quest('watch-under-pressure').status, 'ready');
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
assert.equal(quest('watch-under-pressure').status, 'completed');
assert.equal(quest('watch-under-pressure').rewardGranted, true);
assert.equal(eventCount(QUEST_EVENTS.REWARD_GRANTED, 'watch-under-pressure'), 1);

system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
assert.equal(eventCount(QUEST_EVENTS.REWARD_GRANTED, 'watch-under-pressure'), 1);
assert.equal(eventCount(QUEST_EVENTS.REWARD_GRANTED), 2);

const completedJournal = buildQuestJournalModel(system.getSnapshot());
assert.equal(completedJournal.activeCount, 0);
assert.equal(completedJournal.readyCount, 0);
assert.equal(completedJournal.completedCount, 2);
assert.equal(completedJournal.visibleCount, 2);

// Full current snapshot round-trips without gameplay events.
const restored = createQuestSystem({ eventsBus: { emit() {} } });
restored.restoreSnapshot(system.getSnapshot());
assert.deepEqual(restored.getSnapshot(), system.getSnapshot());

// Forward compatibility: an old save containing only completed quest one silently unlocks the
// newly-added dependent quest instead of leaving it permanently locked.
const oldSnapshot = system.getSnapshot().filter((entry) => entry.id === 'law-of-the-watch');
const forwardRestored = createQuestSystem({ eventsBus: { emit() {} } });
forwardRestored.restoreSnapshot(oldSnapshot);
const forwardState = forwardRestored.getSnapshot();
assert.equal(forwardState.find((entry) => entry.id === 'law-of-the-watch').status, 'completed');
assert.equal(forwardState.find((entry) => entry.id === 'watch-under-pressure').status, 'available');

// Journal projection must never expose locked/available quest spoilers.
const hiddenModel = buildQuestJournalModel([
	{ id: 'locked', status: 'locked', title: 'Gizli' },
	{ id: 'available', status: 'available', title: 'Henüz kabul edilmedi' },
]);
assert.equal(hiddenModel.visibleCount, 0);

console.log('PASS checkQuestDialogueLoop: chained accept -> objectives -> unlock -> turn-in -> rewards + journal + restore');