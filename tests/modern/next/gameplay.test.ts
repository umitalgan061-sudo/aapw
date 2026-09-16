import { describe, expect, it } from 'vitest';
import { CombatController, HEAVY_ATTACK, LIGHT_ATTACK } from '../../../src/3d/modern/next/combat.ts';
import { makeUtilityActions, ThreatModel, UtilityPlanner } from '../../../src/3d/modern/next/ai.ts';
import { GridNavBuilder } from '../../../src/3d/modern/next/navigation.ts';

describe('next gameplay', () => {
  it('runs combat phases without negative resources', () => {
    const combat = new CombatController({ maxHealth: 100, maxStamina: 50, maxPoise: 40 });
    combat.registerAttack(LIGHT_ATTACK);
    combat.registerAttack(HEAVY_ATTACK);
    expect(combat.startAttack('heavy', 0)).toBe(true);
    expect(combat.state.stamina).toBeLessThan(50);
    for (let tick = 1; tick < 40; tick += 1) combat.advance(tick);
    expect(combat.state.stamina).toBeGreaterThanOrEqual(0);
    expect(combat.state.health).toBeGreaterThanOrEqual(0);
  });

  it('resolves only targets inside attack cone', () => {
    const combat = new CombatController();
    combat.registerAttack(LIGHT_ATTACK);
    expect(combat.startAttack('light', 0)).toBe(true);
    for (let tick = 0; tick < LIGHT_ATTACK.windupTicks; tick += 1) combat.advance(tick);
    const hits = combat.resolveHits({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [
      { id: 1, position: { x: 0, y: 0, z: 1 }, radius: 0.25 },
      { id: 2, position: { x: 5, y: 0, z: 0 }, radius: 0.25 },
    ], 10);
    expect(hits.some((hit) => hit.targetId === 1)).toBe(true);
    expect(hits.some((hit) => hit.targetId === 2)).toBe(false);
  });

  it('stuns at zero poise and eventually recovers', () => {
    const combat = new CombatController({ maxPoise: 10 });
    combat.applyHit(1, 20, 1);
    expect(combat.state.phase).toBe('stunned');
    for (let tick = 2; tick < 30; tick += 1) combat.advance(tick);
    expect(combat.state.phase).toBe('idle');
  });

  it('selects utility actions based on context', () => {
    const planner = new UtilityPlanner(123);
    for (const action of makeUtilityActions()) planner.register(action);
    const decision = planner.decide({ selfPosition: { x: 0, y: 0, z: 0 }, targetPosition: { x: 0, y: 0, z: 2 }, health01: 0.2, stamina01: 0.9, threat01: 0.9, distanceToTarget: 2, timeSinceDamageSeconds: 0, hasLineOfSight: true, isNight: false }, 0);
    expect(decision).toBeDefined();
    expect(decision?.alternatives.length).toBeGreaterThan(0);
  });

  it('decays threats over time', () => {
    const model = new ThreatModel();
    model.observe({ sourceId: 9, position: { x: 2, y: 0, z: 0 }, strength: 1, visible: true }, 0);
    expect(model.score({ x: 0, y: 0, z: 0 }, 0)).toBeGreaterThan(model.score({ x: 0, y: 0, z: 0 }, 600));
  });

  it('builds a walkable grid path', () => {
    const graph = GridNavBuilder.build(12, 12, 1, (x, z) => !(x === 5 && z < 9));
    const path = graph.findPath(0, 143);
    expect(path.found).toBe(true);
    expect(path.nodes[0]).toBe(0);
    expect(path.nodes.at(-1)).toBe(143);
    expect(path.explored).toBeGreaterThan(0);
  });

  it('fails gracefully when endpoints are blocked', () => {
    const graph = GridNavBuilder.build(4, 4, 1, (x, z) => !(x === 0 && z === 0));
    expect(graph.findPath(0, 15).found).toBe(false);
  });
});
