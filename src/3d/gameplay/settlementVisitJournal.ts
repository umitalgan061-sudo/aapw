export type SettlementVisitJournalReason =
  | "ready"
  | "service-closed"
  | "condition-blocked"
  | "action-unavailable"
  | "invalid-input";

export type SettlementVisitJournalInput = {
  settlementId: string;
  serviceId: string;
  stage: string;
  requestedAction: string;
  availableActions: readonly string[];
  conditionIds?: readonly string[];
  completedConditionIds?: readonly string[];
  visitCount?: number;
  interactionCount?: number;
  revision?: number;
};

export type SettlementVisitJournalEntry = Readonly<{
  settlementId: string;
  serviceId: string;
  stage: string;
  requestedAction: string;
  availableActions: readonly string[];
  pendingConditionIds: readonly string[];
  visitCount: number;
  interactionCount: number;
  revision: number;
  reason: SettlementVisitJournalReason;
  journalKey: string;
}>;

const SERVICES = new Set([
  "blacksmith",
  "tavern",
  "market",
  "farm",
  "barracks",
  "stable",
  "house",
  "gate",
]);

const ACTIONS = new Set([
  "enter",
  "talk",
  "craft",
  "trade",
  "rest",
  "travel",
  "inspect",
  "exit",
]);

const STAGES = new Set(["approach", "inside", "service", "departure", "resume"]);

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const sortedUnique = (values: readonly string[] | undefined) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean))].sort();

const boundedCount = (value: unknown) =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 999 ? Number(value) : 0;

const canonicalKey = (entry: Omit<SettlementVisitJournalEntry, "journalKey">) =>
  [
    entry.settlementId,
    entry.serviceId,
    entry.stage,
    entry.requestedAction,
    entry.availableActions.join(","),
    entry.pendingConditionIds.join(","),
    entry.visitCount,
    entry.interactionCount,
    entry.revision,
    entry.reason,
  ].join("|");

export function projectSettlementVisitJournal(input: SettlementVisitJournalInput): SettlementVisitJournalEntry {
  const settlementId = text(input?.settlementId);
  const serviceId = text(input?.serviceId);
  const stage = text(input?.stage);
  const requestedAction = text(input?.requestedAction);
  const availableActions = sortedUnique(input?.availableActions);
  const conditionIds = sortedUnique(input?.conditionIds);
  const completedConditionIds = new Set(sortedUnique(input?.completedConditionIds));
  const pendingConditionIds = conditionIds.filter((id) => !completedConditionIds.has(id));
  const visitCount = boundedCount(input?.visitCount);
  const interactionCount = boundedCount(input?.interactionCount);
  const revision = boundedCount(input?.revision);

  let reason: SettlementVisitJournalReason = "ready";
  if (!settlementId || !SERVICES.has(serviceId) || !STAGES.has(stage) || !ACTIONS.has(requestedAction)) {
    reason = "invalid-input";
  } else if (pendingConditionIds.length > 0) {
    reason = "condition-blocked";
  } else if (availableActions.length === 0 || !availableActions.includes(requestedAction)) {
    reason = "action-unavailable";
  } else if (stage === "departure" || stage === "resume") {
    reason = "service-closed";
  }

  const partial = Object.freeze({
    settlementId,
    serviceId,
    stage,
    requestedAction,
    availableActions: Object.freeze(availableActions),
    pendingConditionIds: Object.freeze(pendingConditionIds),
    visitCount,
    interactionCount,
    revision,
    reason,
  });

  return Object.freeze({ ...partial, journalKey: canonicalKey(partial) });
}

export function isSettlementVisitJournalEntry(value: unknown): value is SettlementVisitJournalEntry {
  try {
    if (!value || typeof value !== "object") return false;
    const candidate = value as SettlementVisitJournalEntry;
    if (candidate.journalKey !== canonicalKey({
      settlementId: candidate.settlementId,
      serviceId: candidate.serviceId,
      stage: candidate.stage,
      requestedAction: candidate.requestedAction,
      availableActions: candidate.availableActions,
      pendingConditionIds: candidate.pendingConditionIds,
      visitCount: candidate.visitCount,
      interactionCount: candidate.interactionCount,
      revision: candidate.revision,
      reason: candidate.reason,
    })) return false;
    return candidate.availableActions.every((action) => ACTIONS.has(action))
      && candidate.pendingConditionIds.every((id) => typeof id === "string" && id.length > 0)
      && Object.isFrozen(candidate)
      && Object.isFrozen(candidate.availableActions)
      && Object.isFrozen(candidate.pendingConditionIds);
  } catch {
    return false;
  }
}
