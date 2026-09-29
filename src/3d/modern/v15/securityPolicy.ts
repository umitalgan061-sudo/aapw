import { clampV15, type InputIntentV15 } from "./types.ts";

export type SecurityOriginV15 = "local" | "remote" | "replay" | "worker" | "save";

export interface SecurityPolicyOptionsV15 {
  readonly maxStringLength?: number;
  readonly maxArrayLength?: number;
  readonly maxObjectKeys?: number;
  readonly maxDepth?: number;
  readonly maxActions?: number;
  readonly maxSequenceGap?: number;
}

export interface SecurityIssueV15 {
  readonly code: "depth" | "string" | "array" | "object-keys" | "non-finite" | "action-count" | "sequence-gap" | "unsafe-key";
  readonly path: string;
  readonly origin: SecurityOriginV15;
  readonly message: string;
}

export interface SecurityReportV15 {
  readonly accepted: boolean;
  readonly issues: readonly SecurityIssueV15[];
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class RuntimeSecurityPolicyV15 {
  readonly #maxStringLength: number;
  readonly #maxArrayLength: number;
  readonly #maxObjectKeys: number;
  readonly #maxDepth: number;
  readonly #maxActions: number;
  readonly #maxSequenceGap: number;

  constructor(options: SecurityPolicyOptionsV15 = {}) {
    this.#maxStringLength = Math.max(16, Math.floor(options.maxStringLength ?? 512));
    this.#maxArrayLength = Math.max(8, Math.floor(options.maxArrayLength ?? 128));
    this.#maxObjectKeys = Math.max(8, Math.floor(options.maxObjectKeys ?? 64));
    this.#maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 6));
    this.#maxActions = Math.max(1, Math.floor(options.maxActions ?? 16));
    this.#maxSequenceGap = Math.max(1, Math.floor(options.maxSequenceGap ?? 120));
  }

  inspect(value: unknown, origin: SecurityOriginV15, path = "$"): SecurityReportV15 {
    const issues: SecurityIssueV15[] = [];
    this.#inspect(value, origin, path, 0, issues);
    return Object.freeze({ accepted: issues.length === 0, issues: Object.freeze(issues) });
  }

  inspectInput(input: InputIntentV15, previousSequence: number, origin: SecurityOriginV15 = input.source === "replay" ? "replay" : "local"): SecurityReportV15 {
    const issues = [...this.#inspect(input, origin).issues];
    if (input.actions.length > this.#maxActions) {
      issues.push({ code: "action-count", path: "$.actions", origin, message: "input action count exceeds policy" });
    }
    const sequence = Number(input.sequence);
    if (!Number.isInteger(sequence) || sequence < 0 || sequence - previousSequence > this.#maxSequenceGap) {
      issues.push({ code: "sequence-gap", path: "$.sequence", origin, message: "input sequence is outside the accepted gap" });
    }
    return Object.freeze({ accepted: issues.length === 0, issues: Object.freeze(issues) });
  }

  sanitizeString(value: string): string {
    let output = value.normalize("NFKC").replace(/[\\u0000-\\u001F\\u007F]/g, "");
    output = output.replace(/[<>]/g, "");
    return output.slice(0, this.#maxStringLength);
  }

  limits(): Readonly<Record<string, number>> {
    return Object.freeze({
      maxStringLength: this.#maxStringLength,
      maxArrayLength: this.#maxArrayLength,
      maxObjectKeys: this.#maxObjectKeys,
      maxDepth: this.#maxDepth,
      maxActions: this.#maxActions,
      maxSequenceGap: this.#maxSequenceGap,
    });
  }

  #inspect(value: unknown, origin: SecurityOriginV15, path: string, depth: number, issues: SecurityIssueV15[]): void {
    if (depth > this.#maxDepth) {
      issues.push({ code: "depth", path, origin, message: "value nesting exceeds policy" });
      return;
    }
    if (typeof value === "string") {
      if (value.length > this.#maxStringLength) issues.push({ code: "string", path, origin, message: "string exceeds policy" });
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) issues.push({ code: "non-finite", path, origin, message: "non-finite numeric value rejected" });
      return;
    }
    if (value === null || typeof value === "boolean" || value === "undefined") return;
    if (Array.isArray(value)) {
      if (value.length > this.#maxArrayLength) issues.push({ code: "array", path, origin, message: "array exceeds policy" });
      for (let index = 0; index < Math.min(value.length, this.#maxArrayLength); index += 1) {
        this.#inspect(value[index], origin, path + "[" + index + "]", depth + 1, issues);
      }
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length > this.#maxObjectKeys) issues.push({ code: "object-keys", path, origin, message: "object key count exceeds policy" });
      for (const key of keys.slice(0, this.#maxObjectKeys)) {
        if (FORBIDDEN_KEYS.has(key)) {
          issues.push({ code: "unsafe-key", path: path + "." + key, origin, message: "prototype-pollution key rejected" });
          continue;
        }
        this.#inspect(record[key], origin, path + "." + key, depth + 1, issues);
      }
    }
  }
}

export function sanitizeActionsV15(actions: readonly string[], policy = new RuntimeSecurityPolicyV15()): readonly string[] {
  const values = actions
    .map(action => policy.sanitizeString(String(action)))
    .filter(action => /^[a-zA-Z0-9._:-]{1,64}$/.test(action));
  return Object.freeze([...new Set(values)].slice(0, clampV15(policy.limits().maxActions, 1, 128)));
}
