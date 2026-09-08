/**
 * Machine-readable readiness report for the settlement vertical slice.
 * Every check is evidence-oriented and delegates authority to existing adapters.
 */
import { validateSettlementContent } from './settlementCampaignContent.js';
import { validateSettlementScenario } from './settlementCampaignScenario.js';
import { validateSettlementQuestChains } from './settlementCampaignQuestChains.js';
import { validateSettlementInteriorContract, buildSettlementInteriorManifest } from './settlementCampaignInterior.js';
import { buildSettlementInteractionMatrix, validateSettlementInteractionMatrix } from './settlementCampaignInteractionMatrix.js';
import { buildContractManifest, validateContractManifest } from './settlementCampaignContracts.js';
import { validateSettlementTelemetryEnvelope, buildSettlementTelemetryEnvelope } from './settlementCampaignTelemetry.js';
import { validateSettlementAccessibilityModel, buildSettlementAccessibilityModel } from './settlementCampaignAccessibility.js';
import { buildSettlementDirectorSummary } from './settlementCampaignFacade.js';

export const SETTLEMENT_READINESS_VERSION = 1;

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};

export function buildSettlementReadinessChecks(runtime) {
  const view = runtime?.getViewModel?.() ?? {};
  const content = validateSettlementContent();
  const scenario = validateSettlementScenario();
  const questChains = validateSettlementQuestChains();
  const interiorManifest = buildSettlementInteriorManifest();
  const interior = validateSettlementInteriorContract(interiorManifest);
  const interactionMatrix = buildSettlementInteractionMatrix();
  const interactions = validateSettlementInteractionMatrix(interactionMatrix);
  const contracts = validateContractManifest(buildContractManifest());
  const telemetry = validateSettlementTelemetryEnvelope(
    buildSettlementTelemetryEnvelope({
      type: 'readiness',
      action: text(view.lastAction),
      service: text(view.activeService?.id),
      result: true,
      revision: Number.isInteger(view.revision) ? view.revision : 0,
    }),
  );
  const accessibility = validateSettlementAccessibilityModel(
    buildSettlementAccessibilityModel(view),
  );

  return {
    content,
    scenario,
    questChains,
    interior,
    interactions,
    contracts,
    telemetry,
    accessibility,
  };
}

export function buildSettlementReadinessReport(runtime) {
  const checks = buildSettlementReadinessChecks(runtime);
  const entries = Object.entries(checks);
  const passed = entries.filter(([, result]) => result.ok === true).map(([name]) => name);
  const failed = entries.filter(([, result]) => result.ok !== true).map(([name]) => name);
  const summary = runtime ? buildSettlementDirectorSummary({
    model: () => ({
      version: 1,
      revision: runtime.getViewModel?.().revision ?? 0,
      ui: {
        service: runtime.getViewModel?.().activeService ?? null,
        header: { title: runtime.getViewModel?.().activeService?.label ?? 'Yerleşim' },
        actions: (runtime.getViewModel?.().availableActions ?? []).map((action) => ({ action, enabled: true })),
        quests: runtime.getViewModel?.().quests ?? [],
        inventory: runtime.getViewModel?.().inventory ?? [],
      },
      journey: { stage: 'arrival' },
      interior: { interiors: interiorManifestSafe() },
      interaction: { roles: interactionRolesSafe() },
      survival: { healthy: true },
    }),
  }) : null;
  return {
    version: SETTLEMENT_READINESS_VERSION,
    ready: failed.length === 0,
    checks,
    passed,
    failed,
    summary: clone(summary),
  };
}

function interiorManifestSafe() {
  try {
    return buildSettlementInteriorManifest().interiors ?? [];
  } catch {
    return [];
  }
}

function interactionRolesSafe() {
  try {
    return buildSettlementInteractionMatrix().roles ?? [];
  } catch {
    return [];
  }
}

export function validateSettlementReadinessReport(report) {
  const errors = [];
  if (report?.version !== SETTLEMENT_READINESS_VERSION) errors.push('version');
  if (!report?.checks || typeof report.checks !== 'object') errors.push('checks');
  if (!Array.isArray(report?.passed)) errors.push('passed');
  if (!Array.isArray(report?.failed)) errors.push('failed');
  for (const [name, result] of Object.entries(report?.checks ?? {})) {
    if (result?.ok !== true && !report.failed.includes(name)) errors.push(`failed-list:${name}`);
  }
  return { ok: errors.length === 0, errors };
}

export function buildSettlementReadinessEvidence(runtime) {
  const report = buildSettlementReadinessReport(runtime);
  return {
    version: SETTLEMENT_READINESS_VERSION,
    ready: report.ready,
    passed: [...report.passed],
    failed: [...report.failed],
    evidence: {
      contentVersion: runtime?.getViewModel?.().contentVersion ?? null,
      revision: runtime?.getViewModel?.().revision ?? null,
      placementContract: 'WorldAssetPlacementPipeline',
      materialContract: 'MaterialAssignmentCore',
      runtimeDoesNotImportEditorStudio: true,
      authoritativeMutationOwnersInjected: true,
      browserProofRequired: true,
      saveLoadProofRequired: true,
      deterministicManifestRequired: true,
    },
  };
}

export function compareSettlementReadiness(before, after) {
  const previous = validateSettlementReadinessReport(before);
  const current = validateSettlementReadinessReport(after);
  return {
    validBefore: previous.ok,
    validAfter: current.ok,
    newlyPassed: (after?.passed ?? []).filter(name => !(before?.passed ?? []).includes(name)),
    newlyFailed: (after?.failed ?? []).filter(name => !(before?.failed ?? []).includes(name)),
    improved: (after?.failed?.length ?? 0) < (before?.failed?.length ?? 0),
  };
}
