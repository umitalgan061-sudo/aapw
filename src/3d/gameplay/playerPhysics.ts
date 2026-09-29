/** Production TypeScript owner for the player jump arc; no world/terrain dependency. */
export interface JumpArcResult {
	readonly heightAboveGroundMeters: number;
	readonly velocityYMps: number;
	readonly isGrounded: boolean;
}

export function integrateJumpArc(heightAboveGroundMeters: number, velocityYMps: number, deltaSeconds: number, gravityMps2: number): JumpArcResult {
	const nextVelocityYMps = velocityYMps + gravityMps2 * deltaSeconds;
	const nextHeightAboveGroundMeters = heightAboveGroundMeters + nextVelocityYMps * deltaSeconds;
	if (nextHeightAboveGroundMeters <= 0) return { heightAboveGroundMeters: 0, velocityYMps: 0, isGrounded: true };
	return { heightAboveGroundMeters: nextHeightAboveGroundMeters, velocityYMps: nextVelocityYMps, isGrounded: false };
}
