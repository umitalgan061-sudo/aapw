import { strict as assert } from 'node:assert';
import {
  buildContractManifest, validateContractManifest, validateInjectedOwners, validateRequestContract,
  validateResponseContract, validateRuntimeEvent, validateRuntimeOwnershipSource, validateRuntimeViewModel,
  validateSaveBoundary, validatePlacementBoundary, assertSettlementContract, freezeContractSnapshot,
} from '../src/3d/gameplay/settlementCampaignContracts.js';
import { listSettlementInteriors, buildSettlementInteriorManifest, validateSettlementInteriorContract, buildPlacementEvidence, validatePlacementEvidence, resolveSettlementInteriorAction, resolveSettlementTransition } from '../src/3d/gameplay/settlementCampaignInterior.js';
import { calculateActionXp, calculateSettlementLevel, projectSettlementSkillAward, buildSettlementProgressionEnvelope, validateSettlementProgressionEnvelope } from '../src/3d/gameplay/settlementCampaignProgression.js';
import { evaluateJourneyStep, listSettlementJourneyStages } from '../src/3d/gameplay/settlementCampaignJourney.js';
import { buildSettlementDialogueGraph, listSettlementDialogueBranches } from '../src/3d/gameplay/settlementCampaignDialogue.js';
import { buildSettlementShopCatalog, quoteSettlementPurchase, quoteSettlementSale, evaluateTransactionEnvelope } from '../src/3d/gameplay/settlementCampaignShop.js';
import { createTradeReceipt, createCraftReceipt, validateReceipt, appendSettlementReceipt, summarizeSettlementReceipts } from '../src/3d/gameplay/settlementCampaignReceiptLedger.js';
import { buildQuestStepPlan, getNextIncompleteObjective } from '../src/3d/gameplay/settlementCampaignQuestFlow.js';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const contract = buildContractManifest();
equal(contract.version, 1, 'contract-version');
ok(validateContractManifest(contract).ok, 'contract-valid');
for (const owner of ['SettlementVerticalSlice', 'QuestSystem', 'Inventory', 'Economy', 'Crafting', 'Travel', 'SaveLoad']) ok(contract.owners.includes(owner), `owner:${owner}`);
const owners = validateInjectedOwners({ enterSettlement() {}, talk() {}, craft() {} });
ok(owners.ok, 'owners-open-world'); ok(owners.provided.includes('craft'), 'craft-owner-injected'); ok(owners.missing.includes('save'), 'save-owner-revealed');
ok(validateRuntimeOwnershipSource(`import { createSettlementVerticalSlice } from './settlementVerticalSlice.js';`).ok, 'clean-ownership-source');
ok(!validateRuntimeOwnershipSource(`import EditorMaterialStudio from './EditorMaterialStudio.js';`).ok, 'editor-import-rejected');
ok(!validateRuntimeOwnershipSource('class SettlementManager {}').ok, 'second-manager-rejected');

ok(validateRuntimeViewModel({ version: 1, contentVersion: 2, revision: 1, availableActions: [], history: [], route: [] }).ok, 'view-valid');
ok(!validateRuntimeViewModel({ revision: -1, availableActions: 'trade' }).ok, 'view-invalid');
ok(validateRequestContract({ version: 1, requestId: 'r1', type: 'execute', input: {} }).ok, 'request-valid');
ok(!validateRequestContract({ version: 2, requestId: '', type: '' }).ok, 'request-invalid');
ok(validateResponseContract({ version: 1, requestId: 'r1', type: 'execute', ok: true }).ok, 'response-valid');
ok(!validateResponseContract({ version: 2, requestId: '', type: '', ok: 'true' }).ok, 'response-invalid');
ok(validateRuntimeEvent({ name: 'action-succeeded', at: 100, revision: 3 }).ok, 'event-valid');
ok(!validateRuntimeEvent({ name: '', at: 'bad', revision: -1 }).ok, 'event-invalid');
ok(validateSaveBoundary({ schema: 1, runtimeVersion: 1, contentVersion: 2, session: {} }).ok, 'save-valid');
ok(!validateSaveBoundary({ schema: 1, runtimeVersion: 9, contentVersion: 2 }).ok, 'save-invalid');
ok(validatePlacementBoundary({ sourceAsset: 'house.glb', material: { validated: true, manifestId: 'mat-1' }, placement: { groundAligned: true }, evidence: { manifestProduced: true } }).ok, 'placement-valid');
ok(!validatePlacementBoundary({ sourceAsset: 'house.glb' }).ok, 'placement-invalid');
const frozen = freezeContractSnapshot({ runtimeVersion: 1, contentVersion: 2, activeService: 'house', revision: 2, healthy: true });
ok(Object.isFrozen(frozen), 'frozen-contract'); ok(Object.isFrozen(frozen.data), 'frozen-contract-data');

const interiors = listSettlementInteriors();
equal(interiors.length, 8, 'interior-count');
const interiorManifest = buildSettlementInteriorManifest();
ok(validateSettlementInteriorContract(interiorManifest).ok, 'interior-contract');
for (const role of interiors) { const action = resolveSettlementInteriorAction(role, role === 'blacksmith' ? 'craft' : role === 'gate' ? 'travel' : 'talk'); ok(action.ok, `interior-action:${role}`); }
ok(resolveSettlementTransition('enter', { sourceKind: 'settlement', targetKind: 'interior' }).ok, 'enter-transition');
ok(!resolveSettlementTransition('travel', { sourceKind: 'settlement', targetKind: 'travel' }).ok, 'bad-travel-transition');
const placement = buildPlacementEvidence('blacksmith', { sourceAsset: 'assets/models/settlements/workshop.glb', materialValidated: true, materialManifestId: 'mat-blacksmith', groundAligned: true, manifestProduced: true, sceneAttached: true });
ok(validatePlacementEvidence(placement).ok, 'placement-evidence');

const snapshot = { copper: 120, reputation: 5, fatigue: 10, health: 90, maxCarryWeight: 30, carryWeight: 8, inventory: { iron_ore: 8, coal: 4, bread: 4, leather: 2, linen: 2 }, equipment: {}, skills: { smithing: 4, commerce: 3, travel: 3, dialogue: 3 }, flags: { 'settlement.flag.0': true }, quests: {}, perks: ['roadwise', 'market_eye'] };
equal(calculateActionXp('craft'), 40, 'craft-xp'); equal(calculateSettlementLevel(240), 2, 'level-curve'); ok(projectSettlementSkillAward('smithing', 90, 20).levelsGained >= 1, 'level-up-projection');
const progression = buildSettlementProgressionEnvelope({ action: 'craft', snapshot, skillXp: { smithing: 90 } }); ok(validateSettlementProgressionEnvelope(progression).ok, 'progression-envelope');
const journeyStep = evaluateJourneyStep('crafting', { snapshot }); ok(journeyStep.stage === 'crafting', 'journey-stage'); equal(listSettlementJourneyStages().length, 8, 'journey-stage-count');
const dialogue = buildSettlementDialogueGraph(snapshot); ok(dialogue.nodes.length > 0, 'dialogue-graph'); ok(listSettlementDialogueBranches().length >= 8, 'dialogue-branches');
const shop = buildSettlementShopCatalog(snapshot, { direction: 'sell', items: ['iron_ore', 'bread'] }); equal(shop.entries.length, 2, 'shop-catalog');
const purchase = quoteSettlementPurchase('bread', 2, snapshot); ok(purchase.ok, 'purchase-quote');
const sale = quoteSettlementSale('iron_ore', 2, snapshot); ok(sale.ok, 'sale-quote');
const envelope = { schema: 1, direction: 'sell', itemId: 'iron_ore', quantity: 2, unitPrice: sale.quote.unitPrice, total: sale.quote.total };
ok(evaluateTransactionEnvelope(envelope, snapshot).ok, 'transaction-envelope');
ok(!evaluateTransactionEnvelope({ ...envelope, total: envelope.total + 1 }, snapshot).ok, 'stale-quote-rejected');
const receiptTrade = createTradeReceipt({ itemId: 'iron_ore', quantity: 2, direction: 'sell', requestId: 'r1', sequence: 1 }); ok(receiptTrade.ok, 'trade-receipt');
const receiptCraft = createCraftReceipt({ recipeId: 'iron_sword', requestId: 'r2', sequence: 2, snapshot }); ok(receiptCraft.ok, 'craft-receipt');
ok(validateReceipt(receiptTrade.receipt).ok, 'receipt-valid');
const receiptHistory = appendSettlementReceipt([], receiptTrade.receipt); ok(receiptHistory.ok, 'receipt-append');
const secondHistory = appendSettlementReceipt(receiptHistory.history, receiptCraft.receipt); ok(secondHistory.ok, 'receipt-append-craft');
ok(summarizeSettlementReceipts(secondHistory.history).crafted === 1, 'receipt-summary');
const questPlan = buildQuestStepPlan(['settlement-objective-01', 'settlement-objective-02'], snapshot, { activeIndex: 0 }); equal(questPlan.plan.length, 2, 'quest-plan');
ok(getNextIncompleteObjective(['settlement-objective-01'], snapshot).ok, 'quest-next');

const composed = assertSettlementContract({
  view: { version: 1, contentVersion: 2, revision: 1, availableActions: [], history: [], route: [] },
  save: { schema: 1, runtimeVersion: 1, contentVersion: 2, session: {} },
  placement: { sourceAsset: 'house.glb', material: { validated: true, manifestId: 'mat' }, placement: { groundAligned: true }, evidence: { manifestProduced: true } },
  contract,
});
ok(composed.ok, 'composed-contract');
console.log(`SETTLEMENT_CAMPAIGN_CONTRACTS_OK checks=${checks}`);
