import { describe, expect, it } from 'vitest';
import {
  createSettlementServiceSaveEnvelope,
  normalizeSettlementServiceSave,
  restoreSettlementServiceSaveEnvelope,
  SETTLEMENT_SERVICE_SAVE_SCHEMA,
} from '../../src/3d/modern/settlementServiceSaveBoundary.ts';

describe('settlement service save boundary', () => {
  it('normalizes service state deterministically and fail-closed', () => {
    const snapshot = normalizeSettlementServiceSave({
      settlementId: '  dragonstone-watch ',
      activeServiceId: 'market',
      copper: '17.9',
      inventoryItemIds: ['whetstone', 'whetstone', '', null],
      completedQuestIds: ['quest-b', 'quest-a', 'quest-b'],
      services: {
        market: {
          open: false,
          questIds: ['quest-b', 'quest-a'],
          completedQuestIds: ['quest-a'],
          availableActions: ['trade', 'unknown', 'trade', 'craft'],
          visitCount: '4.8',
          lastInteractionSequence: 9,
        },
      },
      interactionSequence: '12.7',
    });

    expect(snapshot).toEqual(expect.objectContaining({
      schema: SETTLEMENT_SERVICE_SAVE_SCHEMA,
      settlementId: 'dragonstone-watch',
      copper: 17,
      inventoryItemIds: ['whetstone'],
      completedQuestIds: ['quest-a', 'quest-b'],
      interactionSequence: 12,
    }));
    expect(snapshot.services.market).toEqual({
      open: false,
      questIds: ['quest-a', 'quest-b'],
      completedQuestIds: ['quest-a'],
      availableActions: ['craft', 'trade'],
      visitCount: 4,
      lastInteractionSequence: 9,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.services.market)).toBe(true);
  });

  it('round-trips with a deterministic checksum and rejects tampering', () => {
    const envelope = createSettlementServiceSaveEnvelope({
      settlementId: 'dragonstone-watch',
      copper: 21,
      completedQuestIds: ['quest-a'],
      services: { blacksmith: { availableActions: ['repair'] } },
    });
    const restored = restoreSettlementServiceSaveEnvelope(envelope);
    expect(restored.ok).toBe(true);
    expect(restored.envelope.checksum).toBe(envelope.checksum);

    const tampered = restoreSettlementServiceSaveEnvelope({
      ...envelope,
      checksum: envelope.checksum + 1,
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.reason).toBe('checksum-mismatch');
  });

  it('does not mutate caller input', () => {
    const input = { settlementId: 'watch', services: { stable: { availableActions: ['travel'] } } };
    const before = JSON.stringify(input);
    normalizeSettlementServiceSave(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
