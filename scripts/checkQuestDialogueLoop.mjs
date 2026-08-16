import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/questSystem.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { createQuestSystem, QUEST_EVENTS } = await import(moduleUrl);

const emitted = [];
const eventsBus = {
	emit(eventName, payload) {
		emitted.push({ eventName, payload });
	},
};

const system = createQuestSystem({ eventsBus, worldEventName: 'world:test' });

assert.equal(system.getSnapshot()[0].status, 'available');

system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(system.getSnapshot()[0].status, 'active');
assert.equal(emitted.filter((entry) => entry.eventName === QUEST_EVENTS.ACCEPTED).length, 1);

// A repeated accept choice must not reset/progress the active quest.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(system.getSnapshot()[0].status, 'active');
assert.equal(emitted.filter((entry) => entry.eventName === QUEST_EVENTS.ACCEPTED).length, 1);

system.handleDialogueChoice({ npcId: 'stannis-guard-2', choiceIndex: 0 });
let snapshot = system.getSnapshot()[0];
assert.equal(snapshot.status, 'ready');
assert.equal(snapshot.objectives[0].completed, true);
assert.equal(emitted.filter((entry) => entry.eventName === QUEST_EVENTS.READY_TO_TURN_IN).length, 1);

// Wrong turn-in choice must be ignored.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 0 });
assert.equal(system.getSnapshot()[0].status, 'ready');

system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
snapshot = system.getSnapshot()[0];
assert.equal(snapshot.status, 'completed');
assert.equal(snapshot.rewardGranted, true);
assert.equal(emitted.filter((entry) => entry.eventName === QUEST_EVENTS.COMPLETED).length, 1);
assert.equal(emitted.filter((entry) => entry.eventName === QUEST_EVENTS.REWARD_GRANTED).length, 1);

// Completed quests are edge-triggered and cannot grant the reward twice.
system.handleDialogueChoice({ npcId: 'stannis-guard-1', choiceIndex: 1 });
assert.equal(emitted.filter((entry) => entry.eventName === QUEST_EVENTS.REWARD_GRANTED).length, 1);

const restored = createQuestSystem({ eventsBus: { emit() {} } });
restored.restoreSnapshot(system.getSnapshot());
assert.deepEqual(restored.getSnapshot(), system.getSnapshot());

console.log('PASS checkQuestDialogueLoop: accept -> objective -> ready -> turn-in -> reward + restore');
