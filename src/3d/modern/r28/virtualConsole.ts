export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ConsoleEntry {
  readonly sequence: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly tick?: number;
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

export class RuntimeVirtualConsole {
  readonly maxEntries: number;
  #entries: ConsoleEntry[] = [];
  #sequence = 0;

  constructor(maxEntries = 512) {
    this.maxEntries = Math.max(16, Math.floor(maxEntries));
  }

  push(level: LogLevel, message: string, tick?: number, context: Readonly<Record<string, string | number | boolean>> = {}): ConsoleEntry {
    const entry: ConsoleEntry = {
      sequence: ++this.#sequence,
      level,
      message: message.slice(0, 1024),
      ...(tick !== undefined ? { tick } : {}),
      ...(Object.keys(context).length > 0 ? { context } : {}),
    };
    this.#entries.push(entry);
    while (this.#entries.length > this.maxEntries) this.#entries.shift();
    return entry;
  }

  debug(message: string, tick?: number): ConsoleEntry {
    return this.push('debug', message, tick);
  }

  info(message: string, tick?: number): ConsoleEntry {
    return this.push('info', message, tick);
  }

  warn(message: string, tick?: number): ConsoleEntry {
    return this.push('warn', message, tick);
  }

  error(message: string, tick?: number): ConsoleEntry {
    return this.push('error', message, tick);
  }

  recent(level?: LogLevel): readonly ConsoleEntry[] {
    return this.#entries.filter((entry) => !level || entry.level === level).map((entry) => structuredClone(entry));
  }

  clear(): void {
    this.#entries = [];
  }
}
