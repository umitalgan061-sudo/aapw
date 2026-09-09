const finiteOr = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp01 = (value) => Math.max(0, Math.min(1, finiteOr(value, 0)));
const clamp = (value, min, max) => Math.max(min, Math.min(max, finiteOr(value, min)));

const normalizeKind = (kind) => {
  const value = String(kind ?? '').trim().toLowerCase();
  return value === 'hurtbox' ? 'hurtbox' : 'hitbox';
};

const normalizeShape = (shape) => {
  const value = String(shape ?? '').trim().toLowerCase();
  return ['sphere', 'capsule', 'box'].includes(value) ? value : 'sphere';
};

const normalizeEntry = (entry, index) => ({
  id: String(entry?.id ?? `${normalizeKind(entry?.kind)}-${index + 1}`),
  kind: normalizeKind(entry?.kind),
  shape: normalizeShape(entry?.shape),
  radius: clamp(entry?.radius, 0, 4),
  height: clamp(entry?.height, 0, 8),
  active: entry?.active !== false,
  enabled: entry?.enabled !== false,
  priority: Math.round(clamp(entry?.priority, 0, 100)),
  tag: String(entry?.tag ?? '').trim().slice(0, 64),
});

const stableSort = (entries) => [...entries].sort((a, b) =>
  a.kind.localeCompare(b.kind) || b.priority - a.priority || a.id.localeCompare(b.id));

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
};

export const resolvePlayerHitboxHurtbox = (input = {}) => {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const normalized = stableSort(entries.map(normalizeEntry));
  const hitboxes = normalized.filter((entry) => entry.kind === 'hitbox');
  const hurtboxes = normalized.filter((entry) => entry.kind === 'hurtbox');
  const activeHitboxes = hitboxes.filter((entry) => entry.active && entry.enabled);
  const activeHurtboxes = hurtboxes.filter((entry) => entry.active && entry.enabled);
  const invulnerable = input.invulnerable === true;
  const contactPolicy = invulnerable ? 'suppress-damage' : 'resolve-damage';
  const overlapBudget = Math.round(clamp(input.overlapBudget, 0, 64));
  const resolvedPairs = [];
  if (!invulnerable) {
    for (const hitbox of activeHitboxes) {
      for (const hurtbox of activeHurtboxes) {
        if (resolvedPairs.length >= overlapBudget) break;
        resolvedPairs.push({
          hitboxId: hitbox.id,
          hurtboxId: hurtbox.id,
          damageMultiplier: clamp(input.damageMultiplier, 0, 4) || 1,
          blocked: hurtbox.tag === 'blocked' || hitbox.tag === 'blocked',
        });
      }
      if (resolvedPairs.length >= overlapBudget) break;
    }
  }
  return freezeDeep({
    schema: 'player-hitbox-hurtbox-resolution/v1',
    contactPolicy,
    invulnerable,
    entries: normalized,
    counts: {
      hitboxes: hitboxes.length,
      hurtboxes: hurtboxes.length,
      activeHitboxes: activeHitboxes.length,
      activeHurtboxes: activeHurtboxes.length,
      resolvedPairs: resolvedPairs.length,
    },
    resolvedPairs,
    overlapBudget,
    readiness: {
      finite: true,
      hasHitbox: hitboxes.length > 0,
      hasHurtbox: hurtboxes.length > 0,
      contactReady: !invulnerable && resolvedPairs.length > 0,
    },
  });
};

export const serializePlayerHitboxHurtboxResolution = (value) => JSON.stringify(value);
