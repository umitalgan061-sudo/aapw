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
});

function key(code) {
	controller.handleKeyDown({ code, repeat: false });
}

function talkTo(npc, choiceIndex) {
	controller.update([npc], { x: 0, z: 0 });
	key('KeyE');
	controller.handleChoice(choiceIndex);
	key('KeyE');
}

let snapshot = controller.getQuestSnapshot();
assert.equal(snapshot[0].status, 'available');
assert.equal(snapshot[1].status, 'locked');
assert.match(buildQuestJournalText(snapshot), /Henüz kabul edilmiş bir görev yok/);

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

talkTo(guard1, 2);
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
assert.equal(questChanges.length, 7);

controller.showQuestJournal();
const visibleJournal = dialogueHistory.at(-1)?.text ?? '';
assert.match(visibleJournal, /Nöbetin Kanunu — TAMAMLANDI/);
assert.match(visibleJournal, /Nöbetçinin Şüphesi — TAMAMLANDI/);
assert.match(visibleJournal, /Ödül: Dragonstone nöbetçilerinin güveni/);

const restoredChanges = [];
const restoredController = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: 'Selam {name}',
	choicesByNpcId,
	radiusMeters: 4,
	onQuestChanged: (next) => restoredChanges.push(next),
});
restoredController.restoreQuestSnapshot(snapshot);
const restored = restoredController.getQuestSnapshot();
assert.deepEqual(restored, snapshot);
assert.equal(restoredChanges.length, 1);

const tampered = structuredClone(snapshot);
tampered[0].objectives.push({ id: 'future-unknown-objective', completed: true });
restoredController.restoreQuestSnapshot(tampered);
assert.equal(restoredController.getQuestSnapshot()[0].objectives.length, 1);

assert.ok(promptHistory.includes(true));
assert.ok(dialogueHistory.some((entry) => Array.isArray(entry.choices) && entry.choices.length === 3));
console.log('[checkInteractionQuestLoop] PASS: accept -> progress -> unlock -> multi-objective -> turn-in -> reward -> journal -> restore');
