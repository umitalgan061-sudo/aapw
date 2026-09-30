import type { RuntimeCommandR31, RuntimeFrameR31, Vec2R31, Vec3R31 } from './applicationTypesR31.ts';

export interface GameplayInputR31 {
  readonly move: Vec2R31;
  readonly look: Vec2R31;
  readonly sprint: boolean;
  readonly jump: boolean;
  readonly dodge: boolean;
  readonly guard: boolean;
  readonly lightAttack: boolean;
  readonly heavyAttack: boolean;
}

export interface GameplaySnapshotR31 {
  readonly playerPosition: Vec3R31;
  readonly playerVelocity: Vec3R31;
  readonly health: number;
  readonly stamina: number;
  readonly combatState: string;
  readonly activeQuestCount: number;
}

export interface GameplayRuntimePortR31 {
  readonly applyInput: (input: GameplayInputR31) => void;
  readonly executeCommand: (command: RuntimeCommandR31) => void;
  readonly snapshot: () => GameplaySnapshotR31;
}

export interface GameplayBridgeDiagnosticsR31 {
  readonly frames: number;
  readonly inputs: number;
  readonly commands: number;
  readonly invalidInputs: number;
}

function finiteAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function normalizeGameplayInputR31(input: Partial<GameplayInputR31>): GameplayInputR31 {
  const move = input.move ?? { x: 0, y: 0 };
  const look = input.look ?? { x: 0, y: 0 };
  return Object.freeze({
    move: Object.freeze({ x: finiteAxis(move.x), y: finiteAxis(move.y) }),
    look: Object.freeze({ x: finiteAxis(look.x), y: finiteAxis(look.y) }),
    sprint: Boolean(input.sprint),
    jump: Boolean(input.jump),
    dodge: Boolean(input.dodge),
    guard: Boolean(input.guard),
    lightAttack: Boolean(input.lightAttack),
    heavyAttack: Boolean(input.heavyAttack),
  });
}

export class GameplayRuntimeBridgeR31 {
  readonly #port: GameplayRuntimePortR31;
  #frames = 0;
  #inputs = 0;
  #commands = 0;
  #invalidInputs = 0;

  constructor(port: GameplayRuntimePortR31) {
    this.#port = port;
  }

  applyInput(input: Partial<GameplayInputR31>): void {
    const normalized = normalizeGameplayInputR31(input);
    if (Object.values(normalized).some((value) => value === undefined)) {
      this.#invalidInputs++;
      return;
    }
    this.#port.applyInput(normalized);
    this.#inputs++;
  }

  command(command: RuntimeCommandR31): void {
    try {
      this.#port.executeCommand(command);
      this.#commands++;
    } catch {
      this.#invalidInputs++;
    }
  }

  update(frame: RuntimeFrameR31): GameplaySnapshotR31 {
    this.#frames++;
    void frame;
    return Object.freeze(this.#port.snapshot());
  }

  diagnostics(): GameplayBridgeDiagnosticsR31 {
    return Object.freeze({
      frames: this.#frames,
      inputs: this.#inputs,
      commands: this.#commands,
      invalidInputs: this.#invalidInputs,
    });
  }
}
