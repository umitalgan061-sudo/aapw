import { describe, expect, it } from 'vitest';

import {
  deterministicNpcPhaseSeconds,
  evaluateNpcGuardAwareness,
} from '../../src/3d/gameplay/npc.ts';
import {
  EXPEDITION_BOARD_ROUTES,
  INTERACTION_FACTIONS,
  INTERACTION_PROGRESSION,
  evaluateExpeditionBoard,
} from '../../src/3d/gameplay/interaction.ts';

describe('R6 typed gameplay runtime', () => {
  it('keeps NPC perception deterministic and bounded', () => {
    const first = evaluateNpcGuardAwareness({
      observer: { x: 0, z: 0 },
      target: { x: 3, z: 4 },
      yawRadians: Math.atan2(3, 4),
      rangeMeters: 10,
      lineOfSight: true,
    });
    const second = evaluateNpcGuardAwareness({
      observer: { x: 0, z: 0 },
      target: { x: 3, z: 4 },
      yawRadians: Math.atan2(3, 4),
      rangeMeters: 10,
      lineOfSight: true,
    });

    expect(first.visible).toBe(true);
    expect(first.distanceMeters).toBe(5);
    expect(second).toEqual(first);
    expect(deterministicNpcPhaseSeconds('guard-alpha', 1)).toBe(deterministicNpcPhaseSeconds('guard-alpha', 1));
    expect(deterministicNpcPhaseSeconds('guard-alpha', 1)).not.toBe(deterministicNpcPhaseSeconds('guard-beta', 1));
  });

  it('keeps the interaction progression and expedition contracts stable', () => {
    expect(INTERACTION_FACTIONS.DRAGONSTONE).toBe('dragonstone');
    expect(INTERACTION_PROGRESSION.START_LEVEL).toBe(1);
    expect(INTERACTION_PROGRESSION.MAX_LEVEL).toBeGreaterThan(INTERACTION_PROGRESSION.START_LEVEL);
    expect(EXPEDITION_BOARD_ROUTES.length).toBeGreaterThanOrEqual(3);

    const board = evaluateExpeditionBoard();
    expect(board.entries).toHaveLength(EXPEDITION_BOARD_ROUTES.length);
    expect(board.entries.every((entry) => typeof entry.id === 'string')).toBe(true);
  });
});
