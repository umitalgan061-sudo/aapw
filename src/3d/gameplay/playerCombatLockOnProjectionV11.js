/** Read-only lock-on projection over existing targeting observations. */
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
export function projectPlayerCombatLockOn({ player = {}, targets = [], lockedTargetId = null, maxDistanceMeters = 24, minFacingCosine = 0.1 } = {}) {
  const px = finite(player.position?.x), pz = finite(player.position?.z), fx = finite(player.forward?.x), fz = finite(player.forward?.z), fl = Math.hypot(fx, fz) || 1;
  const maxDistance = Math.max(0, finite(maxDistanceMeters, 24));
  const minFacing = clamp(finite(minFacingCosine, 0.1), -1, 1);
  const rows = (Array.isArray(targets) ? targets : []).map((target, index) => { const tx = finite(target?.position?.x), tz = finite(target?.position?.z), dx = tx - px, dz = tz - pz, distance = Math.hypot(dx, dz), dl = distance || 1, facing = clamp((dx * fx + dz * fz) / (dl * fl), -1, 1), id = String(target?.id ?? `target-${index}`); const eligible = target?.isTargetable !== false && target?.isAlive !== false && target?.visible !== false && distance <= maxDistance && facing >= minFacing; return { id, distanceMeters: Number(distance.toFixed(4)), facingCosine: Number(facing.toFixed(4)), eligible, retained: eligible && id === String(lockedTargetId ?? '') }; }).sort((a, b) => (a.retained !== b.retained ? (a.retained ? -1 : 1) : a.distanceMeters - b.distanceMeters || b.facingCosine - a.facingCosine || a.id.localeCompare(b.id)));
  const selected = rows.find((row) => row.eligible)?.id ?? null;
  const result = { selectedTargetId: selected, retainedLock: rows.some((row) => row.retained), candidates: rows };
  return Object.freeze({ ...result, candidates: Object.freeze(rows.map((row) => Object.freeze(row))), digest: stable(result) });
}
