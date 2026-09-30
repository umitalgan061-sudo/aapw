import type { InputFrame, RuntimeEvent } from './contracts.ts';

export interface SecurityLimits {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxAnalogKeys: number;
  readonly maxButtons: number;
  readonly maxEventsPerFrame: number;
  readonly maxPayloadBytes: number;
}

export interface SecurityVerdict {
  readonly accepted: boolean;
  readonly violations: readonly string[];
  readonly sanitizedInput?: InputFrame;
}

export interface EventBudgetResult {
  readonly accepted: readonly RuntimeEvent[];
  readonly dropped: number;
}

const DEFAULT_LIMITS: SecurityLimits = {
  maxStringLength: 64,
  maxArrayLength: 256,
  maxAnalogKeys: 64,
  maxButtons: 32,
  maxEventsPerFrame: 512,
  maxPayloadBytes: 64 * 1024,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class RuntimeSecurityBoundary {
  readonly limits: SecurityLimits;
  #windowStartTick = 0;
  #commandsInWindow = 0;
  #commandWindowTicks = 60;
  #commandLimit = 120;

  constructor(limits: Partial<SecurityLimits> = {}) {
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
  }

  validateInput(input: InputFrame): SecurityVerdict {
    const violations: string[] = [];
    if (!Number.isInteger(input.tick) || input.tick < 0) violations.push('invalid-tick');
    if (!Number.isFinite(input.move.x) || !Number.isFinite(input.move.y)) violations.push('non-finite-move');
    if (!Number.isFinite(input.look.x) || !Number.isFinite(input.look.y)) violations.push('non-finite-look');
    if (input.buttons.length > this.limits.maxButtons) violations.push('button-overflow');
    if (Object.keys(input.analog).length > this.limits.maxAnalogKeys) violations.push('analog-overflow');

    const buttons = [...new Set(input.buttons)]
      .filter((button) => typeof button === 'string' && button.length <= this.limits.maxStringLength)
      .slice(0, this.limits.maxButtons)
      .sort();
    const analog = Object.fromEntries(
      Object.entries(input.analog)
        .filter(([key, value]) => key.length <= this.limits.maxStringLength && Number.isFinite(value))
        .slice(0, this.limits.maxAnalogKeys)
        .map(([key, value]) => [key, clamp(value, -1, 1)]),
    );

    const sanitizedInput: InputFrame = {
      tick: Math.max(0, Math.floor(input.tick)),
      move: {
        x: clamp(Number.isFinite(input.move.x) ? input.move.x : 0, -1, 1),
        y: clamp(Number.isFinite(input.move.y) ? input.move.y : 0, -1, 1),
      },
      look: {
        x: clamp(Number.isFinite(input.look.x) ? input.look.x : 0, -1, 1),
        y: clamp(Number.isFinite(input.look.y) ? input.look.y : 0, -1, 1),
      },
      buttons,
      analog,
    };

    const bytes = new TextEncoder().encode(JSON.stringify(sanitizedInput)).byteLength;
    if (bytes > this.limits.maxPayloadBytes) violations.push('payload-too-large');

    return {
      accepted: violations.length === 0,
      violations: [...new Set(violations)].sort(),
      sanitizedInput,
    };
  }

  consumeCommandBudget(tick: number, commands = 1): boolean {
    if (tick - this.#windowStartTick >= this.#commandWindowTicks) {
      this.#windowStartTick = tick;
      this.#commandsInWindow = 0;
    }
    const amount = Math.max(0, Math.floor(commands));
    if (this.#commandsInWindow + amount > this.#commandLimit) return false;
    this.#commandsInWindow += amount;
    return true;
  }

  budgetEvents(events: readonly RuntimeEvent[]): EventBudgetResult {
    const accepted = events.slice(0, this.limits.maxEventsPerFrame);
    return { accepted, dropped: Math.max(0, events.length - accepted.length) };
  }

  sanitizeIdentifier(value: string): string {
    return value
      .slice(0, this.limits.maxStringLength)
      .replace(/[^a-zA-Z0-9._:-]/g, '_');
  }

  auditPayload(value: unknown): { readonly accepted: boolean; readonly bytes: number } {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    return { accepted: Number.isFinite(bytes) && bytes <= this.limits.maxPayloadBytes, bytes };
  }
}
