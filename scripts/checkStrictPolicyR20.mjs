import { readFile } from 'node:fs/promises';

const files = [
  'src/3d/world/WorldSurfacePolicySchema.ts',
  'src/3d/world/roadSurfaceProfile.ts',
];

const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8').catch(() => '');
  if (!source) failures.push(`${file}: missing`);
  if (source.includes('@ts-nocheck')) failures.push(`${file}: @ts-nocheck remains`);
  if (source.includes('@ts-ignore')) failures.push(`${file}: @ts-ignore remains`);
  if (!source.includes('Production TypeScript owner')) failures.push(`${file}: production owner marker missing`);
}

const schema = await readFile(files[0], 'utf8');
if (!schema.includes('WorldSurfacePolicyInput') || !schema.includes('WorldSurfacePolicyValidationResult')) {
  failures.push('WorldSurfacePolicySchema.ts: public policy contracts missing');
}

const road = await readFile(files[1], 'utf8');
if (!road.includes('TerrainSampler') || !road.includes('RoadProfile') || !road.includes('TerrainSegmentProfile')) {
  failures.push('roadSurfaceProfile.ts: strict public road contracts missing');
}
if (!road.includes("heightAuthority: 'world/terrain.ts'")) {
  failures.push('roadSurfaceProfile.ts: height authority is not updated to typed terrain owner');
}

if (failures.length) {
  console.error(`Strict policy R20 gate failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  suite: 'strict-policy-r20',
  strictOwners: files.length,
  escapeHatches: 0,
  typedContracts: true,
}));
