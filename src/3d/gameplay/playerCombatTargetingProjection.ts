export type PlayerCombatTargetKind = 'enemy' | 'training' | 'objective';

export type PlayerCombatTargetObservation = Readonly<{
  id: string;
  kind: PlayerCombatTargetKind;
  distance: number;
  angle: number;
  visible: boolean;
  alive: boolean;
  hostile: boolean;
  lockable: boolean;
}>;

export type PlayerCombatTargetingProjection = Readonly<{
  selectedId: string | null;
  candidates: readonly string[];
  reason: 'selected' | 'no-candidates' | 'invalid-input';
  signature: string;
}>;

const TARGET_KINDS: readonly PlayerCombatTargetKind[] = ['enemy', 'training', 'objective'];

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isKind = (value: unknown): value is PlayerCombatTargetKind =>
  typeof value === 'string' && TARGET_KINDS.includes(value as PlayerCombatTargetKind);

const normalizeCandidate = (candidate: PlayerCombatTargetObservation): PlayerCombatTargetObservation | null => {
  const id = normalizeId(candidate?.id);
  if (!id || !isKind(candidate?.kind)) return null;

  const distance = clamp(finite(candidate.distance, Number.POSITIVE_INFINITY), 0, 9999);
  const angle = clamp(finite(candidate.angle, Number.POSITIVE_INFINITY), -Math.PI, Math.PI);
  if (!Number.isFinite(distance) || !Number.isFinite(angle)) return null;

  return Object.freeze({
    id,
    kind: candidate.kind,
    distance,
    angle,
    visible: candidate.visible === true,
    alive: candidate.alive === true,
    hostile: candidate.hostile === true,
    lockable: candidate.lockable === true,
  });
};

const sortCandidates = (left: PlayerCombatTargetObservation, right: PlayerCombatTargetObservation): number =>
  Number(right.visible) - Number(left.visible) ||
  Number(right.alive) - Number(left.alive) ||
  Number(right.hostile) - Number(left.hostile) ||
  Math.abs(left.angle) - Math.abs(right.angle) ||
  left.distance - right.distance ||
  left.id.localeCompare(right.id);

const signatureFor = (selectedId: string | null, candidates: readonly PlayerCombatTargetObservation[]): string =>
  JSON.stringify({
    selectedId,
    candidates: candidates.map(({ id, kind, distance, angle, visible, alive, hostile, lockable }) => ({
      id,
      kind,
      distance: Number(distance.toFixed(4)),
      angle: Number(angle.toFixed(4)),
      visible,
      alive,
      hostile,
      lockable,
    })),
  });

export const projectPlayerCombatTargeting = (
  observations: readonly PlayerCombatTargetObservation[],
  preferredId?: string | null,
): PlayerCombatTargetingProjection => {
  if (!Array.isArray(observations)) {
    return Object.freeze({
      selectedId: null,
      candidates: Object.freeze([]),
      reason: 'invalid-input',
      signature: '{"selectedId":null,"candidates":[]}',
    });
  }

  const normalized = observations
    .map(normalizeCandidate)
    .filter((candidate): candidate is PlayerCombatTargetObservation => candidate !== null)
    .filter((candidate) => candidate.visible && candidate.alive && candidate.lockable)
    .sort(sortCandidates);

  const deduped = normalized.filter((candidate, index, list) => index === 0 || candidate.id !== list[index - 1]?.id);
  const candidates = Object.freeze(deduped);
  const preferred = normalizeId(preferredId);
  const selected = candidates.find((candidate) => candidate.id === preferred) ?? candidates[0] ?? null;
  const reason = selected ? 'selected' : candidates.length === 0 ? 'no-candidates' : 'invalid-input';

  return Object.freeze({
    selectedId: selected?.id ?? null,
    candidates: Object.freeze(candidates.map((candidate) => candidate.id)),
    reason,
    signature: signatureFor(selected?.id ?? null, candidates),
  });
};

export const isPlayerCombatTargetingProjection = (
  value: unknown,
): value is PlayerCombatTargetingProjection => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlayerCombatTargetingProjection>;
  return (
    (typeof candidate.selectedId === 'string' || candidate.selectedId === null) &&
    Array.isArray(candidate.candidates) &&
    candidate.candidates.every((id) => typeof id === 'string') &&
    (candidate.reason === 'selected' ||
      candidate.reason === 'no-candidates' ||
      candidate.reason === 'invalid-input') &&
    typeof candidate.signature === 'string'
  );
};
