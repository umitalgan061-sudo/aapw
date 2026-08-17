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
const worldStateChanges = [];

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

function createController(overrides = {}) {
	return createInteractionController({
		interactionPrompt: { setVisible: (visible) => promptHistory.push(visible) },
		dialogueBox: {
			show: (text, choices = []) => dialogueHistory.push({ text, choices }),
			hide: () => dialogueHistory.push({ hidden: true }),
		},
		greetingTemplate: 'Selam {name}',
		greetingsByNpcId: {},
		choicesByNpcId,
		radiusMeters: 4,
		...overrides,
	});
}

const controller = createController({
	onQuestChanged: (snapshot) => questChanges.push(structuredClone(snapshot)),
	onReputationChanged: (snapshot) => reputationChanges.push(structuredClone(snapshot)),
	onProgressionChanged: (snapshot) => progressionChanges.push(structuredClone(snapshot)),
	onWorldStateChanged: (snapshot) => worldStateChanges.push(structuredClone(snapshot)),
});

function key(code, target = controller) {
	target.handleKeyDown({ code, repeat: false });
}

function openNpc(npc, target = controller) {
	target.update([npc], { x: 0, z: 0 });
	key('KeyE', target);
	return dialogueHistory.at(-1);
}

function talkTo(npc, visibleChoiceIndex, target = controller) {
	openNpc(npc, target);
	target.handleChoice(visibleChoiceIndex);
	key('KeyE', target);
}

let snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[0].status, 'available');
assert.equal(snapshot[1].status, 'locked');
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 0 });
assert.deepEqual(controller.getWorldStateSnapshot(), { dragonstoneWatchPolicy: null });
assert.deepEqual(controller.getProgressionSnapshot(), {
	level: 1,
	totalExperience: 0,
	experienceIntoLevel: 0,
	experienceToNextLevel: 100,
});
assert.match(buildQuestJournalText(
	snapshot,
	controller.getReputationSnapshot(),
	controller.getProgressionSnapshot(),
	controller.getWorldStateSnapshot(),
), /Seviye: 1 · XP: 0\/100/);
assert.match(buildQuestJournalText(snapshot), /Henüz kabul edilmiş bir görev yok/);

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
assert.equal(controller.getProgressionSnapshot().totalExperience, 80);
assert.equal(controller.getProgressionSnapshot().level, 1);

talkTo(guard2, 2);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[1].status, 'ready');
assert.equal(controller.getProgressionSnapshot().totalExperience, 100);
assert.equal(controller.getProgressionSnapshot().level, 2);

opened = openNpc(guard1);
assert.deepEqual(opened.choices, ['Nöbet düzenini sıkılaştır.', 'Nöbetçiye ikinci bir şans ver.']);
key('KeyE');
const readyRpgSnapshot = controller.getRpgSnapshot();
assert.equal(readyRpgSnapshot.schemaVersion, 4);
assert.equal(readyRpgSnapshot.quests[1].status, 'ready');

talkTo(guard1, 1);
snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[1].status, 'completed');
assert.equal(snapshot[1].rewardGranted, true);
assert.equal(snapshot[1].outcome, 'mercy');
assert.deepEqual(controller.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'mercy' });
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 15 });
assert.deepEqual(controller.getProgressionSnapshot(), {
	level: 2,
	totalExperience: 190,
	experienceIntoLevel: 90,
	experienceToNextLevel: 100,
});
assert.equal(reputationChanges.length, 2);
assert.equal(progressionChanges.length, 4);
assert.equal(worldStateChanges.length, 1);
assert.equal(questChanges.length, 7);

opened = openNpc(guard2);
assert.match(opened.text, /ikinci şans boşa gitmeyecek/i);
key('KeyE');

talkTo(guard1, 1);
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(controller.getProgressionSnapshot().totalExperience, 190);
assert.equal(reputationChanges.length, 2);
assert.equal(progressionChanges.length, 4);
assert.equal(worldStateChanges.length, 1);

controller.showQuestJournal();
const visibleJournal = dialogueHistory.at(-1)?.text ?? '';
assert.match(visibleJournal, /Seviye: 2 · XP: 90\/100/);
assert.match(visibleJournal, /Dragonstone itibarı: 15/);
assert.match(visibleJournal, /Nöbet kararı: İkinci şans/);
assert.match(visibleJournal, /Nöbetin Kanunu — TAMAMLANDI/);
assert.match(visibleJournal, /Nöbetçinin Şüphesi — TAMAMLANDI/);
assert.match(visibleJournal, /Sonuç: İkinci şans/);
assert.match(visibleJournal, /Ödül: Dragonstone nöbetçilerinin güveni/);

const rpgSnapshot = controller.getRpgSnapshot();
assert.equal(rpgSnapshot.schemaVersion, 4);
assert.deepEqual(rpgSnapshot.reputation, { dragonstone: 15 });
assert.equal(rpgSnapshot.progression.level, 2);
assert.equal(rpgSnapshot.progression.totalExperience, 190);
assert.deepEqual(rpgSnapshot.worldState, { dragonstoneWatchPolicy: 'mercy' });
const restoredChanges = [];
const restoredReputationChanges = [];
const restoredProgressionChanges = [];
const restoredWorldChanges = [];
const restoredController = createController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	onQuestChanged: (next) => restoredChanges.push(structuredClone(next)),
	onReputationChanged: (next) => restoredReputationChanges.push(structuredClone(next)),
	onProgressionChanged: (next) => restoredProgressionChanges.push(structuredClone(next)),
	onWorldStateChanged: (next) => restoredWorldChanges.push(structuredClone(next)),
});
restoredController.restoreRpgSnapshot(rpgSnapshot);
assert.deepEqual(restoredController.getRpgSnapshot(), rpgSnapshot);
assert.equal(restoredChanges.length, 1);
assert.equal(restoredReputationChanges.length, 1);
assert.equal(restoredProgressionChanges.length, 1);
assert.equal(restoredWorldChanges.length, 1);

const strictDialogue = [];
const strictController = createController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: {
		show: (text, choices = []) => strictDialogue.push({ text, choices }),
		hide() {},
	},
});
strictController.restoreRpgSnapshot(readyRpgSnapshot);
strictController.update([guard1], { x: 0, z: 0 });
strictController.handleKeyDown({ code: 'KeyE', repeat: false });
assert.deepEqual(strictDialogue.at(-1).choices, ['Nöbet düzenini sıkılaştır.', 'Nöbetçiye ikinci bir şans ver.']);
strictController.handleChoice(0);
strictController.handleKeyDown({ code: 'KeyE', repeat: false });
assert.equal(strictController.getQuestSnapshot()[1].outcome, 'discipline');
assert.deepEqual(strictController.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'discipline' });
strictController.update([guard2], { x: 0, z: 0 });
strictController.handleKeyDown({ code: 'KeyE', repeat: false });
assert.match(strictDialogue.at(-1).text, /nöbet çizgisi sıkılaştı/i);

const schemaV2 = structuredClone(rpgSnapshot);
schemaV2.schemaVersion = 2;
delete schemaV2.worldState;
schemaV2.progression = { totalExperience: 150 };
for (const quest of schemaV2.quests) delete quest.outcome;
const v2Controller = createController({ interactionPrompt: { setVisible() {} }, dialogueBox: { show() {}, hide() {} } });
v2Controller.restoreRpgSnapshot(schemaV2);
assert.deepEqual(v2Controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(v2Controller.getProgressionSnapshot().totalExperience, 150);
assert.deepEqual(v2Controller.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'discipline' });

const schemaV1 = structuredClone(schemaV2);
schemaV1.schemaVersion = 1;
delete schemaV1.progression;
const v1Controller = createController({ interactionPrompt: { setVisible() {} }, dialogueBox: { show() {}, hide() {} } });
v1Controller.restoreRpgSnapshot(schemaV1);
assert.deepEqual(v1Controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(v1Controller.getProgressionSnapshot().totalExperience, 150);
assert.equal(v1Controller.getProgressionSnapshot().level, 2);
assert.deepEqual(v1Controller.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'discipline' });

const migratedController = createController({ interactionPrompt: { setVisible() {} }, dialogueBox: { show() {}, hide() {} } });
migratedController.restoreQuestSnapshot(snapshot);
assert.deepEqual(migratedController.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(migratedController.getProgressionSnapshot().totalExperience, 190);
assert.deepEqual(migratedController.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'mercy' });
assert.deepEqual(migratedController.getQuestSnapshot(), snapshot);

const tampered = structuredClone(rpgSnapshot);
tampered.quests[0].objectives.push({ id: 'future-unknown-objective', completed: true });
restoredController.restoreRpgSnapshot(tampered);
assert.equal(restoredController.getQuestSnapshot()[0].objectives.length, 1);
assert.deepEqual(restoredController.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(restoredController.getProgressionSnapshot().totalExperience, 190);
assert.deepEqual(restoredController.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'mercy' });

assert.ok(promptHistory.includes(true));
assert.ok(dialogueHistory.some((entry) => Array.isArray(entry.choices) && entry.choices.length === 3));
assert.ok(dialogueHistory.some((entry) => Array.isArray(entry.choices) && entry.choices.length === 2));
console.log('[checkInteractionQuestLoop] PASS: quest objectives -> level gate -> branching outcome -> world consequence -> schema v4/v2/v1 migration');
