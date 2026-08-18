import assert from 'node:assert/strict';
import { createInteractionController, buildQuestJournalText } from '../src/3d/gameplay/interaction.js';

const guard1 = { object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } }, displayName: 'Kapı Nöbetçisi' };
const guard2 = { object3D: { name: 'stannis-guard-2', position: { x: 0, z: 0 } }, displayName: 'Tepe Nöbetçisi' };
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
const EMPTY_LEDGER = {
	transactionCount: 0,
	lifetimeSpentCopper: 0,
	purchasesByOffer: {
		'dragonstone-field-ration': 0,
		'dragonstone-whetstone': 0,
		'dragonstone-watch-ration-allotment': 0,
	},
};
const FULL_QUARTERMASTER_ECONOMY = {
	copper: 40,
	stockByOffer: {
		'dragonstone-field-ration': 4,
		'dragonstone-whetstone': 2,
		'dragonstone-watch-ration-allotment': 1,
	},
	ledger: EMPTY_LEDGER,
};

function createController(overrides = {}) {
	return createInteractionController({
		interactionPrompt: { setVisible() {} },
		dialogueBox: { show() {}, hide() {} },
		greetingTemplate: 'Selam {name}',
		greetingsByNpcId: {},
		choicesByNpcId,
		radiusMeters: 4,
		...overrides,
	});
}

function key(controller, code) { controller.handleKeyDown({ code, repeat: false }); }
function talk(controller, npc, visibleChoiceIndex) {
	controller.update([npc], { x: 0, z: 0 });
	key(controller, 'KeyE');
	controller.handleChoice(visibleChoiceIndex);
	key(controller, 'KeyE');
}

const changes = { quest: 0, reputation: 0, progression: 0, world: 0 };
const controller = createController({
	onQuestChanged: () => changes.quest += 1,
	onReputationChanged: () => changes.reputation += 1,
	onProgressionChanged: () => changes.progression += 1,
	onWorldStateChanged: () => changes.world += 1,
});

assert.equal(controller.getQuestSnapshot()[0].status, 'available');
assert.equal(controller.getQuestSnapshot()[1].status, 'locked');
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 0 });
assert.equal(controller.getProgressionSnapshot().level, 1);
assert.match(buildQuestJournalText(controller.getQuestSnapshot()), /Henüz kabul edilmiş bir görev yok/);

talk(controller, guard1, 0);
talk(controller, guard2, 0);
talk(controller, guard1, 1);
assert.equal(controller.getQuestSnapshot()[0].status, 'completed');
assert.equal(controller.getQuestSnapshot()[1].status, 'available');
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 10 });
assert.equal(controller.getProgressionSnapshot().totalExperience, 60);

talk(controller, guard1, 2);
talk(controller, guard2, 1);
assert.equal(controller.getProgressionSnapshot().totalExperience, 80);
talk(controller, guard2, 2);
assert.equal(controller.getQuestSnapshot()[1].status, 'ready');
assert.equal(controller.getProgressionSnapshot().level, 2);
assert.equal(controller.getProgressionSnapshot().totalExperience, 100);
talk(controller, guard1, 1);
assert.equal(controller.getQuestSnapshot()[1].status, 'completed');
assert.equal(controller.getQuestSnapshot()[1].outcome, 'mercy');
assert.deepEqual(controller.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'mercy' });
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(controller.getProgressionSnapshot().totalExperience, 190);

talk(controller, guard1, 1);
assert.deepEqual(controller.getReputationSnapshot(), { dragonstone: 15 });
assert.equal(controller.getProgressionSnapshot().totalExperience, 190);
assert.equal(changes.reputation, 2);
assert.equal(changes.world, 1);

const journal = buildQuestJournalText(controller.getQuestSnapshot(),controller.getReputationSnapshot(),controller.getProgressionSnapshot(),controller.getWorldStateSnapshot());
assert.match(journal, /Seviye: 2 · XP: 90\/100/);
assert.match(journal, /Dragonstone itibarı: 15/);
assert.match(journal, /Nöbet kararı: İkinci şans/);
assert.match(journal, /Nöbetçinin Şüphesi — TAMAMLANDI/);

const saved = controller.getRpgSnapshot();
assert.equal(saved.schemaVersion, 5);
assert.deepEqual(saved.economy, FULL_QUARTERMASTER_ECONOMY);
const restored = createController();
restored.restoreRpgSnapshot(saved);
assert.deepEqual(restored.getRpgSnapshot(), saved);

const legacyV2 = structuredClone(saved);
legacyV2.schemaVersion = 2;
delete legacyV2.worldState;
delete legacyV2.economy;
for (const quest of legacyV2.quests) delete quest.outcome;
legacyV2.progression = { totalExperience: 150 };
const migrated = createController();
migrated.restoreRpgSnapshot(legacyV2);
assert.deepEqual(migrated.getWorldStateSnapshot(), { dragonstoneWatchPolicy: 'discipline' });
assert.equal(migrated.getProgressionSnapshot().totalExperience, 150);
assert.deepEqual(migrated.getEconomySnapshot(), FULL_QUARTERMASTER_ECONOMY);

const tampered = structuredClone(saved);
tampered.quests[0].objectives.push({ id: 'future-objective', completed: true });
restored.restoreRpgSnapshot(tampered);
assert.equal(restored.getQuestSnapshot()[0].objectives.length, 1);

console.log('[checkInteractionQuestLoop] PASS: quest chain -> objective XP -> level/reputation gate -> world outcome -> schema v5 ledger-aware migration');
