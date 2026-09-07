import {
  buildSettlementServicePrompt,
  buildSettlementServiceUxState,
  evaluateSettlementService,
  getSettlementServiceCatalog,
} from './settlementServiceUx.js';

describe('settlement service UX', () => {
  it('keeps the catalog deterministic and role-oriented', () => {
    const catalog = getSettlementServiceCatalog();
    expect(catalog.map((service) => service.id)).toEqual(['tavern', 'market', 'blacksmith', 'stable', 'farm', 'barracks']);
    expect(catalog.find((service) => service.id === 'blacksmith')).toMatchObject({ role: 'smithing', action: 'smith' });
  });

  it('gates services using the existing interaction state contract', () => {
    expect(evaluateSettlementService({ id: 'tavern', label: 'Taverna', role: 'rest', action: 'rest' }, { discovered: true, open: true, inCombat: false })).toMatchObject({ available: true, reason: 'available' });
    expect(evaluateSettlementService({ id: 'market', label: 'Pazar', role: 'trade', action: 'trade' }, { discovered: false, open: true, inCombat: false })).toMatchObject({ available: false, reason: 'undiscovered' });
    expect(evaluateSettlementService({ id: 'blacksmith', label: 'Demirci', role: 'smithing', action: 'smith' }, { discovered: true, open: false, inCombat: true })).toMatchObject({ available: false, reasons: ['closed', 'in-combat'] });
  });

  it('returns stable available/blocked IDs for runtime panels', () => {
    const state = buildSettlementServiceUxState({
      tavern: { discovered: true, open: true },
      market: { discovered: true, open: false },
      blacksmith: { discovered: true, open: true },
      stable: { discovered: false, open: true },
      farm: { discovered: true, open: true, inCombat: true },
      barracks: { discovered: true, open: true },
    });
    expect(state.availableServiceIds).toEqual(['tavern', 'blacksmith', 'barracks']);
    expect(state.blockedServiceIds).toEqual(['market', 'stable', 'farm']);
    expect(buildSettlementServicePrompt(state.services[1])).toBe('Pazar: kapalı.');
  });
});
