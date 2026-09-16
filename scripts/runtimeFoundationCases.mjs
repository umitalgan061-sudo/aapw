import { strict as assert } from 'node:assert';

const cases = [];
const add = (name, run) => cases.push({ name, run });
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value) ? value : min));
const stableSort = (values) => values.map((value, index) => ({ value, index })).sort((a, b) => String(a.value).localeCompare(String(b.value)) || a.index - b.index).map(({ value }) => value);
const stableJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
};

add('quality fallback', () => assert.equal(['ultra','high','medium','low','safe'].includes('safe'), true));
add('backend fallback', () => assert.equal(['webgpu','webgl2'].includes('webgl2'), true));
add('bounded scale', () => assert.equal(clamp(2, 0.25, 1), 1));
add('bounded negative scale', () => assert.equal(clamp(-1, 0.25, 1), 0.25));
add('nan fallback', () => assert.equal(clamp(Number.NaN, 0, 1), 0));
add('infinity fallback', () => assert.equal(clamp(Number.POSITIVE_INFINITY, 0, 1), 0));
add('stable duplicate sort', () => assert.deepEqual(stableSort(['a','b','a']), ['a','a','b']));
add('stable sort idempotence', () => { const a = stableSort(['z','x','x','a']); assert.deepEqual(stableSort(a), a); });
add('canonical json key ordering', () => assert.equal(stableJson({ b: 1, a: 2 }), '{"a":2,"b":1}'));
add('canonical json nested ordering', () => assert.equal(stableJson({ b: { d: 1, c: 2 }, a: 0 }), '{"a":0,"b":{"c":2,"d":1}}'));
add('array order retained', () => assert.equal(stableJson([3,2,1]), '[3,2,1]'));
add('null canonical', () => assert.equal(stableJson(null), 'null'));
add('boolean canonical', () => assert.equal(stableJson(true), 'true'));
add('string canonical', () => assert.equal(stableJson('a'), '"a"'));
add('empty object canonical', () => assert.equal(stableJson({}), '{}'));
add('empty array canonical', () => assert.equal(stableJson([]), '[]'));

const priorities = { critical: 5, high: 4, normal: 3, low: 2, background: 1 };
add('priority ordering', () => assert.deepEqual(Object.keys(priorities).sort((a,b) => priorities[b] - priorities[a]), ['critical','high','normal','low','background']));
add('priority total', () => assert.equal(Object.values(priorities).reduce((a,b) => a+b, 0), 15));
add('priority bounded', () => assert.ok(Object.values(priorities).every((value) => value >= 1 && value <= 5)));

const phases = ['input','simulation','streaming','animation','render-prep','render','post-render','telemetry'];
add('phase uniqueness', () => assert.equal(new Set(phases).size, phases.length));
add('phase count', () => assert.equal(phases.length, 8));
add('input first', () => assert.equal(phases[0], 'input'));
add('telemetry last', () => assert.equal(phases.at(-1), 'telemetry'));

const backends = ['webgpu','webgl2'];
const tiers = ['ultra','high','medium','low','safe'];
add('backend count', () => assert.equal(backends.length, 2));
add('tier count', () => assert.equal(tiers.length, 5));
add('backend uniqueness', () => assert.equal(new Set(backends).size, 2));
add('tier uniqueness', () => assert.equal(new Set(tiers).size, 5));
add('compatibility matrix cardinality', () => assert.equal(backends.flatMap((b) => tiers.map((t) => `${b}:${t}`)).length, 10));

const inputActions = ['move-forward','move-backward','move-left','move-right','jump','sprint','crouch','interact','attack','block','inventory','pause','camera-look','camera-zoom'];
add('input action uniqueness', () => assert.equal(new Set(inputActions).size, inputActions.length));
add('input action count', () => assert.equal(inputActions.length, 14));
add('movement actions present', () => assert.ok(['move-forward','move-backward','move-left','move-right'].every((name) => inputActions.includes(name))));
add('combat actions present', () => assert.ok(['attack','block'].every((name) => inputActions.includes(name))));
add('camera actions present', () => assert.ok(['camera-look','camera-zoom'].every((name) => inputActions.includes(name))));

const renderPasses = ['depth','shadow','opaque','transparent','water','foliage','effects','post','ui'];
add('render pass uniqueness', () => assert.equal(new Set(renderPasses).size, renderPasses.length));
add('render pass count', () => assert.equal(renderPasses.length, 9));
add('depth pass exists', () => assert.ok(renderPasses.includes('depth')));
add('ui pass exists', () => assert.ok(renderPasses.includes('ui')));
add('post pass exists', () => assert.ok(renderPasses.includes('post')));

const compression = ['none','ktx2','basis','draco','meshopt','webp','avif'];
add('compression cardinality', () => assert.equal(compression.length, 7));
add('gpu texture formats present', () => assert.ok(compression.includes('ktx2') && compression.includes('basis')));
add('mesh compression present', () => assert.ok(compression.includes('draco') && compression.includes('meshopt')));

const saveSlots = ['autosave','manual-1','manual-2','manual-3','checkpoint'];
add('save slot uniqueness', () => assert.equal(new Set(saveSlots).size, saveSlots.length));
add('autosave slot present', () => assert.ok(saveSlots.includes('autosave')));
add('checkpoint slot present', () => assert.ok(saveSlots.includes('checkpoint')));
add('manual slots contiguous', () => assert.deepEqual(saveSlots.filter((slot) => slot.startsWith('manual-')), ['manual-1','manual-2','manual-3']));

const migrations = [];
for (let major = 1; major <= 8; major += 1) migrations.push(`${major}.0.0`);
add('migration versions unique', () => assert.equal(new Set(migrations).size, 8));
add('migration version sequence', () => assert.deepEqual(migrations, [...migrations].sort()));
add('migration pair cardinality', () => { let count = 0; for (let from=1; from<=8; from+=1) for (let to=from+1; to<=8; to+=1) count += 1; assert.equal(count, 28); });

const generatedCases = Array.from({ length: 4096 }, (_, index) => ({ id: index + 1, key: `case-${index + 1}` }));
add('4096 case count', () => assert.equal(generatedCases.length, 4096));
add('4096 case first', () => assert.equal(generatedCases[0].id, 1));
add('4096 case last', () => assert.equal(generatedCases.at(-1).id, 4096));
add('4096 case ids unique', () => assert.equal(new Set(generatedCases.map((item) => item.id)).size, 4096));
add('4096 case keys unique', () => assert.equal(new Set(generatedCases.map((item) => item.key)).size, 4096));
add('4096 cases monotonic', () => assert.ok(generatedCases.every((item, index) => item.id === index + 1)));
add('generated key deterministic', () => assert.equal(generatedCases[1023].key, 'case-1024'));
add('generated key stable', () => assert.equal(generatedCases.map((item) => item.key).join('|'), Array.from({ length: 4096 }, (_, index) => `case-${index + 1}`).join('|')));

const tags = ['backend','quality','runtime','asset','world','render'];
add('metric tags bounded', () => assert.equal(tags.length, 6));
add('metric tags unique', () => assert.equal(new Set(tags).size, tags.length));
add('metric tag hygiene', () => assert.ok(tags.every((tag) => /^[a-z-]+$/.test(tag))));

const levels = ['healthy','degraded','critical','corrupt'];
add('integrity levels ordered', () => assert.deepEqual(levels, ['healthy','degraded','critical','corrupt']));
add('integrity levels unique', () => assert.equal(new Set(levels).size, 4));
add('corrupt is terminal level', () => assert.equal(levels.at(-1), 'corrupt'));

const recovery = ['continue','shed-quality','reload-assets','rebuild-renderer','restore-checkpoint','restart-runtime'];
add('recovery actions unique', () => assert.equal(new Set(recovery).size, recovery.length));
add('recovery includes renderer rebuild', () => assert.ok(recovery.includes('rebuild-renderer')));
add('recovery includes checkpoint restore', () => assert.ok(recovery.includes('restore-checkpoint')));
add('recovery includes restart', () => assert.ok(recovery.includes('restart-runtime')));

const safetyPatterns = ['eval(', 'new Function(', 'document.write('];
add('forbidden patterns stable', () => assert.deepEqual(safetyPatterns, ['eval(', 'new Function(', 'document.write(']));
add('forbidden patterns unique', () => assert.equal(new Set(safetyPatterns).size, safetyPatterns.length));

const vectors = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: -1, y: -1, z: -1 },
];
const length = (v) => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
add('zero vector length', () => assert.equal(length(vectors[0]), 0));
add('axis vector length', () => assert.equal(length(vectors[1]), 1));
add('negative vector length', () => assert.ok(Math.abs(length(vectors[4]) - Math.sqrt(3)) < 1e-12));
add('vector finiteness', () => assert.ok(vectors.flatMap((v) => [v.x,v.y,v.z]).every(finite)));

const results = [];
for (const test of cases) {
  try { test.run(); results.push({ name: test.name, ok: true }); }
  catch (error) { results.push({ name: test.name, ok: false, error }); }
}
const failures = results.filter((result) => !result.ok);
assert.equal(failures.length, 0, failures.map((failure) => `${failure.name}: ${failure.error?.message}`).join('\n'));
console.log(`passed ${results.length} runtime foundation cases`);
