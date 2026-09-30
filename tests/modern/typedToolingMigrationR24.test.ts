import { describe, expect, it } from 'vitest';
import { parseAddedSourceLines, stripQuotedLiterals } from '../../scripts/checkTechnicalDebt.ts';
import { parseIconSize } from '../../scripts/checkPwaInstallability.ts';

describe('R24 TypeScript tooling migration', () => {
  it('keeps diff parsing deterministic and quote-safe', () => {
    const diff = '+++ b/src/example.ts\n@@ -0,0 +1,2 @@\n+const x = "TODO";\n+const y = TODO;';
    expect(parseAddedSourceLines(diff)).toHaveLength(2);
    expect(stripQuotedLiterals('const x = "TODO"; const y = TODO;')).toContain('TODO');
    expect(stripQuotedLiterals('const x = "TODO"; const y = TODO;')).not.toMatch(/"TODO"/);
  });

  it('keeps PWA icon parsing bounded and explicit', () => {
    expect(parseIconSize('192x192')).toBe(192);
    expect(parseIconSize('1024x512')).toBe(1024);
    expect(Number.isNaN(parseIconSize('not-a-size'))).toBe(true);
  });
});
