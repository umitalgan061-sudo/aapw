/** Production TypeScript owner for the player jump arc; legacy world physics remains the ground/collider owner. */

export interface PlayerJumpArcSnapshot {
  readonly heightAboveGroundMeters: number;
  readonly velocityYMps: number;
  readonly isGrounded: boolean;
}

/**
 * Pure ballistic step for the playable character. Ground sampling/collision remain external.
 */
export function integratePlayerJumpArc(
  heightAboveGroundMeters: number,
  velocityYMps: number,
  delta: number,
  gravityMps2: number,
): PlayerJumpArcSnapshot {
  const nextVelocityYMps = velocityYMps + gravityMps2 * delta;
  const nextHeightAboveGroundMeters = heightAboveGroundMeters + nextVelocityYMps * delta;
  if (nextHeightAboveGroundMeters <= 0) {
    return { heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true };
  }
  return {
    heightAboveGroundMeters: nextHeightAboveGroundMeters,
    velocityYMps: nextVelocityYMps,
    isGrounded: false,
  };
}
