export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO_VEC3: Vec3 =
  Object.freeze({
    x: 0,
    y: 0,
    z: 0,
  });

export function addVec3(
  a: Vec3,
  b: Vec3,
): Vec3 {
  return Object.freeze({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  });
}

export function subVec3(
  a: Vec3,
  b: Vec3,
): Vec3 {
  return Object.freeze({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  });
}

export function scaleVec3(
  value: Vec3,
  scale: number,
): Vec3 {
  const safeScale =
    Number.isFinite(scale)
      ? scale
      : 0;

  return Object.freeze({
    x: value.x * safeScale,
    y: value.y * safeScale,
    z: value.z * safeScale,
  });
}

export function dotVec3(
  a: Vec3,
  b: Vec3,
): number {
  return (
    a.x * b.x
    + a.y * b.y
    + a.z * b.z
  );
}

export function lengthVec3(
  value: Vec3,
): number {
  return Math.sqrt(
    dotVec3(value, value),
  );
}

export function normalizeVec3(
  value: Vec3,
): Vec3 {
  const length =
    lengthVec3(value);

  return length <= Number.EPSILON
    ? ZERO_VEC3
    : scaleVec3(
      value,
      1 / length,
    );
}

export function distanceSquaredVec3(
  a: Vec3,
  b: Vec3,
): number {
  return (
    (a.x - b.x) ** 2
    + (a.y - b.y) ** 2
    + (a.z - b.z) ** 2
  );
}

export function lerpVec3(
  a: Vec3,
  b: Vec3,
  alpha: number,
): Vec3 {
  const t = Math.max(
    0,
    Math.min(1, alpha),
  );

  return Object.freeze({
    x:
      a.x + (b.x - a.x) * t,
    y:
      a.y + (b.y - a.y) * t,
    z:
      a.z + (b.z - a.z) * t,
  });
}

export function clampMagnitude(
  value: Vec3,
  maximum: number,
): Vec3 {
  const limit =
    Math.max(0, maximum);
  const length =
    lengthVec3(value);

  return (
    length <= limit
    || length <= Number.EPSILON
  )
    ? value
    : scaleVec3(
      value,
      limit / length,
    );
}
