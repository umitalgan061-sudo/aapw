import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = [
  { legacy: 'src/3d/auroraRealism.js', modern: 'src/3d/auroraRealism.ts' },
  { legacy: 'src/3d/gameplay/animalConfig.js', modern: 'src/3d/gameplay/animalConfig.ts' },
  { legacy: 'src/3d/gameplay/interactionFieldReadiness.js', modern: 'src/3d/gameplay/interactionFieldReadiness.ts' },
  { legacy: 'src/3d/gameplay/livingWorldStimulusAdapter.js', modern: 'src/3d/gameplay/livingWorldStimulusAdapter.ts' },
  { legacy: 'src/3d/gameplay/livingWorldStimulusAudit.js', modern: 'src/3d/gameplay/livingWorldStimulusAudit.ts' },
  { legacy: 'src/3d/gameplay/livingWorldStimulusRolePolicy.js', modern: 'src/3d/gameplay/livingWorldStimulusRolePolicy.ts' },
  { legacy: 'src/3d/gameplay/settlementCampaignSaveSlots.js', modern: 'src/3d/gameplay/settlementCampaignSaveSlots.ts' },
  { legacy: 'src/3d/gameplay/settlementCampaignTelemetry.js', modern: 'src/3d/gameplay/settlementCampaignTelemetry.ts' },
  { legacy: 'src/3d/gameplay/worldOpportunityEvidence.js', modern: 'src/3d/gameplay/worldOpportunityEvidence.ts' },
  { legacy: 'src/3d/gameplay/worldShelterContext.js', modern: 'src/3d/gameplay/worldShelterContext.ts' },
  { legacy: 'src/3d/gameplay/livingWorldEcologyPolicy.js', modern: 'src/3d/gameplay/livingWorldEcologyPolicy.ts' },
  { legacy: 'src/3d/gameplay/livingWorldEventDirectorAdapter.js', modern: 'src/3d/gameplay/livingWorldEventDirectorAdapter.ts' },
  { legacy: 'src/3d/gameplay/livingWorldFaunaActivityBudget.js', modern: 'src/3d/gameplay/livingWorldFaunaActivityBudget.ts' },
  { legacy: 'src/3d/gameplay/livingWorldFaunaHabitatBalancer.js', modern: 'src/3d/gameplay/livingWorldFaunaHabitatBalancer.ts' },
  { legacy: 'src/3d/gameplay/livingWorldFaunaSignalRouter.js', modern: 'src/3d/gameplay/livingWorldFaunaSignalRouter.ts' },
  { legacy: 'src/3d/gameplay/livingWorldGroupAiPolicy.js', modern: 'src/3d/gameplay/livingWorldGroupAiPolicy.ts' },
  { legacy: 'src/3d/gameplay/livingWorldGroupDirectorAdapter.js', modern: 'src/3d/gameplay/livingWorldGroupDirectorAdapter.ts' },
];

const failures = [];
const report = { modules: 0, barrels: 0, safety: 0, blockers: 0 };

function read(path) {
  try { return readFileSync(resolve(ROOT, path), 'utf8'); }
  catch (error) {
    failures.push(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

for (const entry of MIGRATIONS) {
  if (!existsSync(resolve(ROOT, entry.modern))) {
    failures.push(`missing TypeScript implementation: ${entry.modern}`);
    continue;
  }
  report.modules += 1;
  const modern = read(entry.modern);
  if (!modern.startsWith('// @ts-nocheck\n')) failures.push(`migration bridge marker missing: ${entry.modern}`);
  if (modern.includes('eval(') || modern.includes('new Function(') || modern.includes('document.write(')) {
    report.safety += 1;
    failures.push(`unsafe dynamic primitive found in migrated module: ${entry.modern}`);
  }
  if (modern.split(/\r?\n/).length > 900) failures.push(`migrated module exceeds maintainability cap: ${entry.modern}`);
  const legacy = read(entry.legacy);
  if (!legacy.includes(`export * from './${entry.legacy.split('/').pop().replace(/\.js$/,'.ts')}';`)) {
    failures.push(`legacy compatibility barrel does not target TypeScript: ${entry.legacy}`);
  }
  const legacyLines = legacy.trimEnd().split(/\r?\n/);
  if (legacyLines.length > 4) failures.push(`legacy path is not a minimal compatibility barrel: ${entry.legacy}`);
  report.barrels += 1;
}

const interest = read('src/3d/modern/production-v7/interestManager.ts');
if (interest.includes('typeof this.#distances')) failures.push('production-v7 interest manager still contains an invalid private-field type query');
else report.blockers += 1;

const combat = read('src/3d/modern/combatAuthority.ts');
if (!combat.includes('const dt = clamp(deltaMs, 0, 5000);')) failures.push('combat authority still clamps frame deltas below the supported long-frame budget');
else report.blockers += 1;

const pkg = JSON.parse(read('package.json'));
for (const name of ['verify:ts-production-wave7','test:ts-production-wave7','check:ts-production-wave7']) {
  if (typeof pkg.scripts?.[name] !== 'string') failures.push(`missing package script: ${name}`);
}

console.log('AAPW TypeScript Production Migration Wave 7');
console.log(`modules: ${report.modules}/${MIGRATIONS.length}`);
console.log(`compatibility barrels: ${report.barrels}/${MIGRATIONS.length}`);
console.log(`safety findings: ${report.safety}`);
console.log(`global blockers: ${report.blockers}/2`);

if (failures.length) {
  console.error(`FAIL — ${failures.length} issue(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PASS — migration, compatibility, safety and global blocker gates are satisfied');
}
