import {
  buildSettlementServicePanel,
  buildSettlementServiceRuntimeEvidence,
  getSettlementServiceAction,
} from './settlementServiceRuntime.js';

describe('settlement service runtime bridge', () => {
  const interactionState = {
    settlementId: 'dragonstone',
    inCombat: false,
    settlements: {
      tavern: { discovered: true, open: true },
      market: { discovered: true, open: true },
      blacksmith: { discovered: true, open: false },
      stable: { discovered: false, open: true },
      farm: { discovered: true, open: true },
      barracks: { discovered: true, open: true },
    },
  };

  it('projects existing interaction state into a stable panel', () => {
    const panel = buildSettlementServicePanel(interactionState);
    expect(panel.settlementId).toBe('dragonstone');
    expect(panel.availableServiceIds).toEqual(['tavern', 'market', 'farm', 'barracks']);
    expect(panel.blockedServiceIds).toEqual(['blacksmith', 'stable']);
    expect(panel.primaryAction).toBe('tavern');
    expect(panel.services.find((entry) => entry.serviceId === 'blacksmith')).toMatchObject({ enabled: false, reason: 'closed' });
  });

  it('returns fail-closed actions without mutating interaction state', () => {
    const panel = buildSettlementServicePanel(interactionState);
    expect(getSettlementServiceAction(panel, 'market')).toMatchObject({ ok: true, action: 'trade', role: 'trade' });
    expect(getSettlementServiceAction(panel, 'blacksmith')).toMatchObject({ ok: false, reason: 'closed' });
    expect(getSettlementServiceAction(panel, 'missing')).toMatchObject({ ok: false, reason: 'unknown-service' });
    expect(interactionState.settlements.blacksmith.open).toBe(false);
  });

  it('emits deterministic evidence suitable for shipped runtime QA', () => {
    const first = buildSettlementServiceRuntimeEvidence(interactionState);
    const second = buildSettlementServiceRuntimeEvidence(JSON.parse(JSON.stringify(interactionState)));
    expect(first.noDuplicateServiceIds).toBe(true);
    expect(first.catalogSize).toBe(6);
    expect(first.availableCount).toBe(4);
    expect(first.blockedCount).toBe(2);
    expect(first.deterministicKey).toBe(second.deterministicKey);
  });
});
