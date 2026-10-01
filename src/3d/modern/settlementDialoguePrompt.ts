export type SettlementDialogueService =
  | 'blacksmith'
  | 'tavern'
  | 'market'
  | 'farm'
  | 'barracks'
  | 'stable';

export type SettlementDialogueTone = 'welcome' | 'blocked' | 'action' | 'quest';

export interface SettlementDialogueReceipt {
  settlementId: string;
  service: SettlementDialogueService;
  serviceOpen: boolean;
  accessGranted: boolean;
  availableActions?: readonly string[];
  missingQuestIds?: readonly string[];
  primaryAction?: string;
}

export interface SettlementDialoguePrompt {
  key: string;
  tone: SettlementDialogueTone;
  title: string;
  body: string;
  action: string | null;
  missingQuestIds: readonly string[];
}

const LABELS: Record<SettlementDialogueService, string> = {
  blacksmith: 'Demirci',
  tavern: 'Meyhane',
  market: 'Pazar',
  farm: 'Çiftlik',
  barracks: 'Kışla',
  stable: 'Ahır',
};

const DEFAULT_ACTIONS: Record<SettlementDialogueService, string> = {
  blacksmith: 'craft',
  tavern: 'rest',
  market: 'trade',
  farm: 'gather',
  barracks: 'train',
  stable: 'travel',
};

function normalizeIds(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze(
    [...new Set((values ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0))].sort(),
  );
}

function freezePrompt(prompt: SettlementDialoguePrompt): SettlementDialoguePrompt {
  return Object.freeze({ ...prompt, missingQuestIds: Object.freeze([...prompt.missingQuestIds]) });
}

export function createSettlementDialoguePrompt(
  receipt: SettlementDialogueReceipt,
): SettlementDialoguePrompt {
  const label = LABELS[receipt.service];
  const missingQuestIds = normalizeIds(receipt.missingQuestIds);
  const defaultAction = DEFAULT_ACTIONS[receipt.service];
  const action = typeof receipt.primaryAction === 'string' && receipt.primaryAction.length > 0
    ? receipt.primaryAction
    : (receipt.availableActions ?? []).includes(defaultAction) ? defaultAction : null;

  if (!receipt.accessGranted) {
    return freezePrompt({
      key: `${receipt.settlementId}:${receipt.service}:blocked:access`,
      tone: 'blocked',
      title: `${label} kapalı`,
      body: 'Bu hizmete erişimin yok.',
      action: null,
      missingQuestIds,
    });
  }

  if (!receipt.serviceOpen) {
    return freezePrompt({
      key: `${receipt.settlementId}:${receipt.service}:blocked:closed`,
      tone: 'blocked',
      title: `${label} şu an kapalı`,
      body: 'Daha sonra tekrar gel.',
      action: null,
      missingQuestIds,
    });
  }

  if (missingQuestIds.length > 0) {
    return freezePrompt({
      key: `${receipt.settlementId}:${receipt.service}:quest:${missingQuestIds.join(',')}`,
      tone: 'quest',
      title: `${label} senden bir iyilik istiyor`,
      body: `Önce şu görevleri tamamla: ${missingQuestIds.join(', ')}.`,
      action: null,
      missingQuestIds,
    });
  }

  if (action === null) {
    return freezePrompt({
      key: `${receipt.settlementId}:${receipt.service}:welcome`,
      tone: 'welcome',
      title: `${label} seni bekliyor`,
      body: 'Şimdilik konuşacak başka bir şey yok.',
      action: null,
      missingQuestIds,
    });
  }

  return freezePrompt({
    key: `${receipt.settlementId}:${receipt.service}:action:${action}`,
    tone: 'action',
    title: `${label} hazır`,
    body: 'Ne yapmak istersin?',
    action,
    missingQuestIds,
  });
}
