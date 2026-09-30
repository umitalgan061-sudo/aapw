export type ContractDomain = 'player' | 'combat' | 'ai' | 'world' | 'render' | 'network' | 'persistence' | 'streaming' | 'security';

export interface ContractCase {
  readonly id: string;
  readonly domain: ContractDomain;
  readonly invariant: string;
  readonly priority: 1 | 2 | 3 | 4;
  readonly check: (value: unknown) => boolean;
}

export interface ContractResult {
  readonly id: string;
  readonly domain: ContractDomain;
  readonly passed: boolean;
  readonly priority: 1 | 2 | 3 | 4;
  readonly reason: string;
}

export const runContractMatrix = (cases: readonly ContractCase[], valueFactory: (test: ContractCase) => unknown): readonly ContractResult[] => {
  const results: ContractResult[] = [];
  for (const test of cases.slice(0, 512)) {
    let passed = false;
    let reason = 'contract satisfied';
    try {
      passed = test.check(valueFactory(test));
      if (!passed) reason = test.invariant;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    results.push(Object.freeze({ id: test.id, domain: test.domain, passed, priority: test.priority, reason }));
  }
  return Object.freeze(results);
};

export const summarizeContractMatrix = (results: readonly ContractResult[]) => {
  const failures = results.filter((result) => !result.passed);
  const criticalFailures = failures.filter((result) => result.priority >= 3);
  return Object.freeze({
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    criticalFailures: criticalFailures.length,
    passRate: results.length ? Number(((results.length - failures.length) / results.length).toFixed(4)) : 1,
    domains: Object.freeze([...new Set(results.map((result) => result.domain))].sort()),
  });
};

export const defaultContractCases: readonly ContractCase[] = Object.freeze([
  Object.freeze({ id: 'player-health-bounds', domain: 'player', invariant: 'player health must stay between 0 and 100', priority: 4 as const, check: (value) => typeof value === 'number' && value >= 0 && value <= 100 }),
  Object.freeze({ id: 'combat-phase', domain: 'combat', invariant: 'combat phase must be a known lifecycle phase', priority: 4 as const, check: (value) => typeof value === 'string' && ['idle', 'startup', 'active', 'recovery', 'stunned', 'dead'].includes(value) }),
  Object.freeze({ id: 'ai-budget', domain: 'ai', invariant: 'AI thinker count must not exceed frame budget', priority: 3 as const, check: (value) => typeof value === 'number' && value >= 0 && value <= 4096 }),
  Object.freeze({ id: 'world-entities', domain: 'world', invariant: 'entity count must remain bounded', priority: 4 as const, check: (value) => typeof value === 'number' && value >= 0 && value <= 250_000 }),
  Object.freeze({ id: 'render-visible', domain: 'render', invariant: 'visible render set must stay bounded', priority: 3 as const, check: (value) => Array.isArray(value) && value.length <= 20_000 }),
  Object.freeze({ id: 'network-payload', domain: 'network', invariant: 'network payload size must remain bounded', priority: 4 as const, check: (value) => typeof value === 'number' && value >= 0 && value <= 256 * 1024 }),
  Object.freeze({ id: 'save-schema', domain: 'persistence', invariant: 'save schema must be a positive integer', priority: 4 as const, check: (value) => Number.isSafeInteger(value) && Number(value) > 0 }),
  Object.freeze({ id: 'stream-memory', domain: 'streaming', invariant: 'streaming memory must not exceed budget', priority: 4 as const, check: (value) => typeof value === 'object' && value !== null && Number((value as { used?: number }).used ?? 0) <= Number((value as { budget?: number }).budget ?? 0) }),
  Object.freeze({ id: 'security-command-rate', domain: 'security', invariant: 'commands per tick must remain bounded', priority: 4 as const, check: (value) => typeof value === 'number' && value >= 0 && value <= 128 }),
]);

export const assertContractMatrix = (results: readonly ContractResult[]): void => {
  const summary = summarizeContractMatrix(results);
  if (summary.criticalFailures > 0) throw new Error(`Critical runtime contract failures: ${summary.criticalFailures}`);
};
