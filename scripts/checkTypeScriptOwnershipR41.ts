
#!/usr/bin/env node
import { scanTypeScriptOwnership } from '../src/3d/strict/r41/ownership.ts';

const report = await scanTypeScriptOwnership();
console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error('R41 TypeScript ownership gate failed.');
  for (const issue of report.missingOwners) console.error('missing-owner:', issue);
  for (const issue of report.invalidShims) console.error('invalid-compatibility-shim:', issue);
  for (const issue of report.unownedMjs) console.error('unowned-mjs:', issue);
  process.exit(1);
}
