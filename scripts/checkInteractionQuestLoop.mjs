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
assert.match(buildQuestJournalText(snapshot, controller.getReputationSnapshot()), /Dragonstone itibarı: 0/);
assert.match(buildQuestJournalText(snapshot), /Henüz kabul edilmiş bir görev yok/);

// Reputation-gated dialogue is not merely disabled: it is absent until the first quest reward lands.
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
assert.equal(reputationChanges.length, 1);

// First quest completion makes the original third Stannis choice visible; its original index stays 2.
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
assert.equal(reputationChanges.length, 2);
assert.equal(questChanges.length, 7);

controller.showQuestJournal();
const visibleJournal = dialogueHistory.at(-1)?.text ?? '';
assert.match(visibleJournal, /Dragonstone itibarı: 15/);
assert.match(visibleJournal, /Nöbetin Kanunu — TAMAMLANDI/);
assert.match(visibleJournal, /Nöbetçinin Şüphesi — TAMAMLANDI/);
assert.match(visibleJournal, /Ödül: Dragonstone nöbetçilerinin güveni/);

// Versioned RPG snapshot preserves both quest and reputation state without replaying rewards.
const rpgSnapshot = controller.getRpgSnapshot();
assert.equal(rpgSnapshot.schemaVersion, 1);
assert.deepEqual(rpgSnapshot.reputation, { dragonstone: 15 });
const restoredChanges = [];
const restoredReputationChanges = [];
const restoredController = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: 'Selam {name}',
	choicesByNpcId,
	radiusMeters: 4,
	onQuestChanged: (next) => restoredChanges.push(structuredClone(next)),
	onReputationChanged: (next) => restoredReputationChanges.push(structuredClone(next)),
});
restoredController.restoreRpgSnapshot(rpgSnapshot);
assert.deepEqual(restoredController.getRpgSnapshot(), rpgSnapshot);
assert.equal(restoredChanges.length, 1);
assert.equal(restoredReputationChanges.length, 1);

// Backward compatibility: old quest-only saves reconstruct earned reputation exactly once.
const migratedController = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: 'Selam {name}',
	choicesByNpcId,
	radiusMeters: 4,
});
migratedController.restoreQuestSnapshot(snapshot);
assert.deepEqual(migratedController.getReputationSnapshot(), { dragonstone: 15 });
assert.deepEqual(migratedController.getQuestSnapshot(), snapshot);

const tampered = structuredClone(rpgSnapshot);
tampered.quests[0].objectives.push({ id: 'future-unknown-objective', completed: true });
restoredController.restoreRpgSnapshot(tampered);
assert.equal(restoredController.getQuestSnapshot()[0].objectives.length, 1);
assert.deepEqual(restoredController.getReputationSnapshot(), { dragonstone: 15 });

assert.ok(promptHistory.includes(true));
assert.ok(dialogueHistory.some((entry) => Array.isArray(entry.choices) && entry.choices.length === 3));
console.log('[checkInteractionQuestLoop] PASS: gated dialogue -> quest progress -> reputation reward -> unlock -> journal -> versioned restore -> legacy migration');
