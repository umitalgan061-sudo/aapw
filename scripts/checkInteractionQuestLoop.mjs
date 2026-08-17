import assert from 'node:assert/strict';
import { createInteractionController, buildQuestJournalText } from '../src/3d/gameplay/interaction.js';

function makeNpc(id, displayName) {
	return { object3D: { name: id, position: { x: 0, z: 0 } }, displayName };
}

const guard1 = makeNpc('stannis-guard-1', 'Kapı Nöbetçisi');
const guard2 = makeNpc('stannis-guard-2', 'Tepe Nöbetçisi');
const promptHistory = [];
const dialogueHistory = [];
const questChanges = [];
const reputationChanges = [];
const progressionChanges = [];

const choicesByNpcId = {
	'stannis-guard-1': [
		{ label: 'Görevin nedir?', response: 'Kapıyı tutarım.' },
		{ label: 'Neden Stannis?', response: 'Çünkü kanun böyle.' },
		{ label: 'Nöbetten şüphen var mı?', response: 'Şüphe nöbeti keskin tutar.' },
	],
	'stannis-guard-2': [
		{ label: 'Burada ne gözlüyorsun?', response: 'Yolu ve denizi.' },
		{ label: 'Arkadaşınla aran nasıl?', response: 'Sırtımı ona veririm.' },
		{ label: 'Yalnızlık zor mu?', response: 'Nöbet yalnızlığı öğretir.' },
	],
};

const controller = createInteractionController({
	interactionPrompt: { setVisible: (visible) => promptHistory.push(visible) },
	dialogueBox: {
		show: (text, choices = []) => dialogueHistory.push({ text, choices }),
		hide: () => dialogueHistory.push({ hidden: true }),
	},
	greetingTemplate: 'Selam {name}',
	greetingsByNpcId: {},
	choicesByNpcId,
	radiusMeters: 4,
	onQuestChanged: (snapshot) => questChanges.push(structuredClone(snapshot)),
	onReputationChanged: (snapshot) => reputationChanges.push(structuredClone(snapshot)),
	onProgressionChanged: (snapshot) => progressionChanges.push(structuredClone(snapshot)),
});

function key(code) {
	controller.handleKeyDown({ code, repeat: false });
}

function openNpc(npc) {
	controller.update([npc], { x: 0, z: 0 });
	key('KeyE');
	return dialogueHistory.at(-1);
}

function talkTo(npc, visibleChoiceIndex) {
	openNpc(npc);
	controller.handleChoice(visibleChoiceIndex);
	key('KeyE');
}

let snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[0].status, 'available');
assert.equal(snapshot[1].status, 'locked');
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 0 });
assert.deepEqual(controller.getProgressionSnapshot(), {
	level: 1,
	totalExperience: 0,
	experienceIntoLevel: 0,
	experienceToNextLevel: 100,
});
assert.match(buildQuestJournalText(snapshot, controller.getReputationSnapshot(), controller.getProgressionSnapshot()), /Seviye: 1 · XP: 0\/100/);
assert.match(buildQuestJournalText(snapshot), /Henüz kabul edilmiş bir görev yok/);

// Reputation-gated dialogue is absent until the first quest reward lands.
let opened = openNpc(guard1);
assert.deepEqual(opened.choices, ['Görevin nedir?', 'Neden Stannis?']);
key('KeyE');

talkTo(guard1, 0);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[0].status, 'active');
assert.equal(snapshot[0].objectives[0].completed, false);

talkTo(guard2, 0);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[0].status, 'ready');
assert.equal(snapshot[0].objectives[0].completed, true);

talkTo(guard1, 1);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[0].status, 'completed');
assert.equal(snapshot[0].rewardGranted, true);
assert.equal(snapshot[1].status, 'available');
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 10 });
assert.deepEqual(controller.getProgressionSnapshot(), {
	level: 1,
	totalExperience: 60,
	experienceIntoLevel: 60,
	experienceToNextLevel: 100,
});
assert.equal(reputationChanges.length, 1);
assert.equal(progressionChanges.length, 1);

// First completion unlocks the original third choice; its original index remains 2.
opened = openNpc(guard1);
assert.deepEqual(opened.choices, ['Görevin nedir?', 'Neden Stannis?', 'Nöbetten şüphen var mı?']);
controller.handleChoice(2);
key('KeyE');
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[1].status, 'active');

talkTo(guard2, 1);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[1].status, 'active');
assert.equal(snapshot[1].objectives.filter((objective) => objective.completed).length, 1);

talkTo(guard2, 2);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[1].status, 'ready');

talkTo(guard1, 1);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[1].status, 'completed');
assert.equal(snapshot[1].rewardGranted, true);
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 15 });
assert.deepEqual(controller.getProgressionSnapshot(), {
	level: 2,
	totalExperience: 150,
	experienceIntoLevel: 50,
	experienceToNextLevel: 100,
});
assert.equal(reputationChanges.length, 2);
assert.equal(progressionChanges.length, 2);
assert.equal(questChanges.length, 7);

// Repeating completed turn-in dialogue cannot farm either reputation or XP.
talkTo(guard1, 1);
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(controller.getProgressionSnapshot().totalExperience, 150);
assert.equal(reputationChanges.length, 2);
assert.equal(progressionChanges.length, 2);

controller.showQuestJournal();
const visibleJournal = dialogueHistory.at(-1)?.text ?? '';
assert.match(visibleJournal, /Seviye: 2 · XP: 50\/100/);
assert.match(visibleJournal, /Dragonstone itibarı: 15/);
assert.match(visibleJournal, /Nöbetin Kanunu — TAMAMLANDI/);
assert.match(visibleJournal, /Nöbetçinin Şüphesi — TAMAMLANDI/);
assert.match(visibleJournal, /Ödül: Dragonstone nöbetçilerinin güveni/);

// Schema v2 preserves quest + reputation + progression without replaying rewards.
const rpgSnapshot = controller.getRpgSnapshot();
assert.equal(rpgSnapshot.schemaVersion, 2);
assert.deepEqual(rpgSnapshot.reputation, { dragonstone: 15 });
assert.equal(rpgSnapshot.progression.level, 2);
assert.equal(rpgSnapshot.progression.totalExperience, 150);
const restoredChanges = [];
const restoredReputationChanges = [];
const restoredProgressionChanges = [];
const restoredController = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: 'Selam {name}',
	choicesByNpcId,
	radiusMeters: 4,
	onQuestChanged: (next) => restoredChanges.push(structuredClone(next)),
	onReputationChanged: (next) => restoredReputationChanges.push(structuredClone(next)),
	onProgressionChanged: (next) => restoredProgressionChanges.push(structuredClone(next)),
});
restoredController.restoreRpgSnapshot(rpgSnapshot);
assert.deepEqual(restoredController.getRpgSnapshot(), rpgSnapshot);
assert.equal(restoredChanges.length, 1);
assert.equal(restoredReputationChanges.length, 1);
assert.equal(restoredProgressionChanges.length, 1);

// Schema v1 migration: progression did not exist, so earned XP is rebuilt from granted quest rewards.
const schemaV1 = structuredClone(rpgSnapshot);
schemaV1.schemaVersion = 1;
delete schemaV1.progression;
const v1Controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: 'Selam {name}',
	choicesByNpcId,
	radiusMeters: 4,
});
v1Controller.restoreRpgSnapshot(schemaV1);
assert.deepEqual(v1Controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(v1Controller.getProgressionSnapshot().totalExperience, 150);
assert.equal(v1Controller.getProgressionSnapshot().level, 2);

// Older quest-only saves reconstruct both reputation and progression exactly once.
const migratedController = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: 'Selam {name}',
	choicesByNpcId,
	radiusMeters: 4,
});
migratedController.restoreQuestSnapshot(snapshot);
assert.deepEqual(migratedController.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(migratedController.getProgressionSnapshot().totalExperience, 150);
assert.deepEqual(migratedController.getQuestSnapshot(), snapshot);

const tampered = structuredClone(rpgSnapshot);
tampered.quests[0].objectives.push({ id: 'future-unknown-objective', completed: true });
restoredController.restoreRpgSnapshot(tampered);
assert.equal(restoredController.getQuestSnapshot()[0].objectives.length, 1);
assert.deepEqual(restoredController.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(restoredController.getProgressionSnapshot().totalExperience, 150);

assert.ok(promptHistory.includes(true));
assert.ok(dialogueHistory.some((entry) => Array.isArray(entry.choices) && entry.choices.length === 3));
console.log('[checkInteractionQuestLoop] PASS: gated dialogue -> quests -> reputation + XP/level -> journal -> schema v2 restore -> v1/legacy migration');
