/** Production TypeScript physics boundary for ground and analytic obstacle collision. */
import { createHeightSampler } from './world/terrain.js';

export interface GroundCollider {
  readonly getGroundHeight: (worldX: number, worldZ: number) => number;
}

export interface SettlementSeat { readonly x: number; readonly z: number; }

export interface SettlementColliderConfig {
  readonly KEEP_WIDTH_METERS: number;
  readonly KEEP_DEPTH_METERS: number;
  readonly TOWER_RADIUS_BOTTOM_METERS: number;
  readonly TOWER_CORNER_OFFSET_METERS: number;
}

export interface CircleObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface XZCollider {
  readonly resolveXZ: (worldX: number, worldZ: number) => XZPoint;
}

export interface ComposedCollider extends XZCollider {
  readonly registerDynamicCollider: (collider: XZCollider) => void;
}

export interface XZPoint { readonly x: number; readonly z: number; }

export interface JumpArcResult {
  readonly heightAboveGroundMeters: number;
  readonly velocityYMps: number;
  readonly isGrounded: boolean;
}

export interface HeightSamplerOptions {
  readonly octaves?: number;
  readonly lacunarity?: number;
  readonly gain?: number;
}

export function createGroundCollider(
  seed: number,
  fbmOptions?: HeightSamplerOptions,
  flattenPads?: readonly {
    readonly x: number;
    readonly z: number;
    readonly innerRadiusMeters: number;
    readonly outerRadiusMeters: number;
    readonly anchorHeightMeters: number;
  }[],
): GroundCollider {
  const sampleHeightMeters = createHeightSampler(seed, fbmOptions, flattenPads);
  return Object.freeze({
    getGroundHeight: (worldX: number, worldZ: number): number => sampleHeightMeters(worldX, worldZ),
  });
}

function towerOffsets(cornerOffsetMeters: number): readonly [number, number][] {
  return [
    [cornerOffsetMeters, cornerOffsetMeters],
    [cornerOffsetMeters, -cornerOffsetMeters],
    [-cornerOffsetMeters, cornerOffsetMeters],
    [-cornerOffsetMeters, -cornerOffsetMeters],
  ];
}

export function createSettlementCollider(
  seats: readonly SettlementSeat[],
  settlementConfig: SettlementColliderConfig,
  playerRadiusMeters = 0.4,
): XZCollider {
  const halfWidth = settlementConfig.KEEP_WIDTH_METERS / 2 + playerRadiusMeters;
  const halfDepth = settlementConfig.KEEP_DEPTH_METERS / 2 + playerRadiusMeters;
  const towerRadius = settlementConfig.TOWER_RADIUS_BOTTOM_METERS + playerRadiusMeters;
  const offsets = towerOffsets(settlementConfig.TOWER_CORNER_OFFSET_METERS);

  return Object.freeze({
    resolveXZ(worldX: number, worldZ: number): XZPoint {
      let x = worldX;
      let z = worldZ;
      for (const seat of seats) {
        const localX = x - seat.x;
        const localZ = z - seat.z;
        if (Math.abs(localX) < halfWidth && Math.abs(localZ) < halfDepth) {
          const penetrationX = halfWidth - Math.abs(localX);
          const penetrationZ = halfDepth - Math.abs(localZ);
          if (penetrationX < penetrationZ) x = seat.x + Math.sign(localX || 1) * halfWidth;
          else z = seat.z + Math.sign(localZ || 1) * halfDepth;
        }
        for (const [dx, dz] of offsets) {
          const towerX = seat.x + dx;
          const towerZ = seat.z + dz;
          const diffX = x - towerX;
          const diffZ = z - towerZ;
          const distance = Math.hypot(diffX, diffZ);
          if (distance >= towerRadius) continue;
          if (distance < 1e-6) {
            x = towerX + towerRadius;
            z = towerZ;
          } else {
            const scale = towerRadius / distance;
            x = towerX + diffX * scale;
            z = towerZ + diffZ * scale;
          }
        }
      }
      return { x, z };
    },
  });
}

function pushOutOfCircles(
  circles: readonly CircleObstacle[],
  playerRadiusMeters: number,
  worldX: number,
  worldZ: number,
): XZPoint {
  let x = worldX;
  let z = worldZ;
  for (const circle of circles) {
    const totalRadius = circle.radius + playerRadiusMeters;
    const diffX = x - circle.x;
    const diffZ = z - circle.z;
    const distance = Math.hypot(diffX, diffZ);
    if (distance >= totalRadius) continue;
    if (distance < 1e-6) {
      x = circle.x + totalRadius;
      z = circle.z;
    } else {
      const scale = totalRadius / distance;
      x = circle.x + diffX * scale;
      z = circle.z + diffZ * scale;
    }
  }
  return { x, z };
}

export function createCircleCollider(
  circles: readonly CircleObstacle[],
  playerRadiusMeters = 0.4,
): XZCollider {
  return Object.freeze({
    resolveXZ: (worldX: number, worldZ: number): XZPoint =>
      pushOutOfCircles(circles, playerRadiusMeters, worldX, worldZ),
  });
}

export function createDynamicCircleCollider(
  getCircles: () => readonly CircleObstacle[],
  playerRadiusMeters = 0.4,
): XZCollider {
  return Object.freeze({
    resolveXZ: (worldX: number, worldZ: number): XZPoint =>
      pushOutOfCircles(getCircles(), playerRadiusMeters, worldX, worldZ),
  });
}

export function createComposedCollider(initialColliders: readonly XZCollider[] = []): ComposedCollider {
  const colliders = [...initialColliders];
  return {
    resolveXZ(worldX: number, worldZ: number): XZPoint {
      let x = worldX;
      let z = worldZ;
      for (const collider of colliders) ({ x, z } = collider.resolveXZ(x, z));
      return { x, z };
    },
    registerDynamicCollider(collider: XZCollider): void {
      if (!collider || typeof collider.resolveXZ !== 'function') {
        throw new TypeError('A composed collider can only register a valid XZ collider');
      }
      colliders.push(collider);
    },
  };
}

export function integrateJumpArc(
  heightAboveGroundMeters: number,
  velocityYMps: number,
  delta: number,
  gravityMps2: number,
): JumpArcResult {
  if (![heightAboveGroundMeters, velocityYMps, delta, gravityMps2].every(Number.isFinite)) {
    throw new RangeError('Jump arc inputs must be finite numbers');
  }
  const safeDelta = Math.max(0, delta);
  const nextVelocityYMps = velocityYMps + gravityMps2 * safeDelta;
  const nextHeightAboveGroundMeters = heightAboveGroundMeters + nextVelocityYMps * safeDelta;
  if (nextHeightAboveGroundMeters <= 0) {
    return Object.freeze({ heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true });
  }
  return Object.freeze({
    heightAboveGroundMeters: nextHeightAboveGroundMeters,
    velocityYMps: nextVelocityYMps,
    isGrounded: false,
  });
}
