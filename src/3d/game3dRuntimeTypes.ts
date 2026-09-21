/** Typed contracts for the live 3D application runtime. Kept separate from lifecycle code to preserve the 600-line module cap. */
import type * as THREE_TYPES from 'three';
import type { createScene } from './sceneManager.ts';
import type { KeyboardInput } from './input.ts';
import type { MovementAxes } from './gameLoopHelpers.ts';

type THREEObject3D = THREE_TYPES.Object3D;
type THREEVector3 = THREE_TYPES.Vector3;
type THREEPerspectiveCamera = THREE_TYPES.PerspectiveCamera;

/** Typed runtime state layered over the scene bootstrap's static state. */
export interface RuntimeEntity {
  readonly object3D: THREEObject3D;
  readonly model?: THREEObject3D;
  readonly group?: THREEObject3D;
  readonly isFleeing?: boolean;
  readonly update: (...args: unknown[]) => void;
  readonly dispose: () => void;
}

export interface PlayerRuntime extends RuntimeEntity {
  readonly update: (
    deltaSeconds: number,
    moveDirection: { readonly x: number; readonly z: number; readonly guarding: boolean },
    running: boolean,
    jumpRequested: boolean,
  ) => void;
}

export interface TouchJoystickRuntime {
  readonly getAxes: () => MovementAxes;
  readonly consumeJumpRequested?: () => boolean;
  readonly dispose: () => void;
}

export interface InteractionRuntime {
  readonly handleKeyDown: (event: { readonly code: string; readonly repeat?: boolean }) => void;
  readonly handleChoice: (index: number) => void;
  readonly update: (entities: readonly RuntimeEntity[], playerPosition: THREEVector3) => void;
}

export interface InteractionPromptRuntime {
  readonly setActivateHandler: (handler: () => void) => void;
  readonly dispose: () => void;
}

export interface DialogueRuntime {
  readonly setChoiceHandler: (handler: (index: number) => void) => void;
  readonly setCloseHandler: (handler: () => void) => void;
  readonly dispose: () => void;
}

export interface WeatherRuntime {
  readonly group: THREEObject3D;
  readonly trigger: (durationSeconds: number) => void;
  readonly update: (deltaSeconds: number, cameraPosition: THREEVector3) => void;
  readonly dispose: () => void;
}

export interface WorldEventRuntime {
  readonly update: (deltaSeconds: number, nightFactor: number) => void;
  readonly dispose: () => void;
}

export interface HealthRuntime {
  readonly reset: () => void;
  readonly dispose: () => void;
}

export interface UIObjectRuntime { readonly dispose: () => void; }

export interface PerfRuntime extends UIObjectRuntime {
  readonly update: (deltaSeconds: number) => void;
}

export interface AudioRuntime extends UIObjectRuntime {
  readonly playClick: () => void;
  readonly setMuted: (muted: boolean) => void;
  readonly playDiscoveryChime: () => void;
}

export interface SettlementCompassRuntime extends UIObjectRuntime {
  readonly setSeatFilter: (filter: (seat: { readonly id: string }) => boolean) => void;
  readonly update: (position: THREEVector3, rotationY: number) => void;
}

export interface SettlementDiscoveryRuntime extends UIObjectRuntime {
  readonly isDiscovered: (seatId: string) => boolean;
  readonly update: (position: THREEVector3) => void;
}

export interface DayNightClockRuntime extends UIObjectRuntime {
  readonly update: (timeRatio: number, nightFactor: number) => void;
}

export interface FreeCameraRuntime extends UIObjectRuntime {
  readonly active: boolean;
  readonly camera: THREEPerspectiveCamera;
  readonly update: (deltaSeconds: number) => void;
}

export interface PauseMenuRuntime extends UIObjectRuntime {}

export interface Game3DState extends ReturnType<typeof createScene> {
  player: PlayerRuntime;
  keyboardInput: KeyboardInput;
  touchJoystick: TouchJoystickRuntime | null;
  interactionPrompt: InteractionPromptRuntime;
  interaction: InteractionRuntime;
  dialogueBox: DialogueRuntime;
  healthBar: UIObjectRuntime;
  playerHealth: HealthRuntime;
  npcs: RuntimeEntity[];
  animals: RuntimeEntity[];
  creatures: RuntimeEntity[];
  carts: RuntimeEntity[];
  dragons: RuntimeEntity[];
  mobileSpawnVegetation: THREEObject3D | null;
  realCastles: THREEObject3D;
  weather: WeatherRuntime;
  worldEvents: WorldEventRuntime;
  worldEventToast: UIObjectRuntime;
  controlsHelp: UIObjectRuntime;
  pauseMenu: PauseMenuRuntime;
  audioManager: AudioRuntime;
  settlementCompass: SettlementCompassRuntime;
  settlementDiscovery: SettlementDiscoveryRuntime;
  dayNightClock: DayNightClockRuntime;
  perfPanel: PerfRuntime;
  freeCamera: FreeCameraRuntime;
  paused: boolean;
  interactionDisabledDueToError: boolean;
  weatherDisabledDueToError: boolean;
  worldEventsDisabledDueToError: boolean;
}
