declare module 'three' {
	export class Object3D {
		readonly position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
		readonly rotation: { x: number; y: number; z: number };
		readonly scale: { setScalar(value: number): void };
		userData: Record<string, unknown>;
		name: string;
	}
	export class Group extends Object3D { animations: AnimationClip[]; }
	export class Bone extends Object3D {}
	export class AnimationClip {}
	export class AnimationAction {
		timeScale: number;
		setEffectiveTimeScale(value: number): this;
		reset(): this;
		fadeIn(seconds: number): this;
		fadeOut(seconds: number): this;
		play(): this;
	}
	export class AnimationMixer {
		constructor(root: Object3D);
		clipAction(clip: AnimationClip): AnimationAction;
		update(deltaSeconds: number): void;
		stopAllAction(): void;
	}
	export const AnimationClip: {
		findByName(clips: readonly AnimationClip[] | undefined, name: string): AnimationClip | null;
	};
	export const MathUtils: {
		lerp(x: number, y: number, t: number): number;
		euclideanModulo(n: number, m: number): number;
	};
}
