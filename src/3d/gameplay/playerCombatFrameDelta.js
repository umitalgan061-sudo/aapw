/** Deterministic observation-only combat frame delta adapter. */
export const PLAYER_COMBAT_FRAME_DELTA_VERSION = '2026-09-26-r11';
const text = (value) => String(value ?? '').trim();
const stable = (value) => JSON.stringify(value ?? null);
const revision = (value) => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; };
export function createPlayerCombatFrameDelta(previous = {}, next = {}) {
  const fromRevision = revision(previous.revision);
  const toRevision = revision(next.revision);
  const phaseChanged = text(previous.phase) !== text(next.phase);
  const attackChanged = stable(previous.attack) !== stable(next.attack);
  const defenseChanged = stable(previous.defense) !== stable(next.defense);
  const movementChanged = stable(previous.movement) !== stable(next.movement);
  const equipmentChanged = stable(previous.equipment) !== stable(next.equipment);
  const outcomeChanged = stable(previous.outcome) !== stable(next.outcome);
  return Object.freeze({ version: PLAYER_COMBAT_FRAME_DELTA_VERSION, fromRevision, toRevision, phaseChanged, attackChanged, defenseChanged, movementChanged, equipmentChanged, outcomeChanged, transitionKey: [fromRevision,toRevision,phaseChanged?1:0,attackChanged?1:0,defenseChanged?1:0,movementChanged?1:0,equipmentChanged?1:0,outcomeChanged?1:0].join('|') });
}
export function isPlayerCombatFrameDelta(value) { return Boolean(value) && Number.isInteger(value.fromRevision) && Number.isInteger(value.toRevision) && value.toRevision >= value.fromRevision && typeof value.transitionKey === 'string' && value.transitionKey.length > 0; }
