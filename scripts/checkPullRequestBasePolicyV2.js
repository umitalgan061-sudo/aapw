#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);

function listWorkflowFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && WORKFLOW_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(rootDir, entry.name))
    .sort();
}

function hasPullRequestTrigger(source) {
  return /^\s*pull_request\s*:/m.test(source);
}

function hasYamlBaseSha(source) {
  return /^\s*BASE_SHA\s*:/m.test(source);
}

function hasExactMainComparison(source) {
  return /git\s+rev-parse\s+origin\/main/.test(source) && /\$BASE_SHA/.test(source);
}

function hasLivePullRequestBase(source) {
  return /github\.event\.pull_request\.base\.sha/.test(source);
}

function hasExactPullRequestHeadCheckout(source) {
  return /uses:\s*actions\/checkout@[\s\S]{0,1000}?ref:\s*\$\{\{[^}]*github\.event\.pull_request\.head\.sha/.test(source);
}

function topLevelPermissionsBlock(source) {
  return source.match(/^permissions\s*:\s*\n((?:[ \t].*(?:\n|$))*)/m)?.[1] ?? '';
}

function hasTopLevelWritePermission(source) {
  const block = topLevelPermissionsBlock(source);
  return /\bwrite-all\b/i.test(block) || /^\s{2}[A-Za-z0-9_-]+\s*:\s*write\s*$/mi.test(block);
}

function isMandatoryReadOnlyExactMainPrGate(source) {
  return hasPullRequestTrigger(source)
    && hasYamlBaseSha(source)
    && hasExactMainComparison(source)
    && !hasTopLevelWritePermission(source);
}

function scanWorkflow(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  if (!isMandatoryReadOnlyExactMainPrGate(source)) return { filePath, checked: false, issues };

  if (!hasLivePullRequestBase(source)) {
    issues.push('read-only pull_request exact-main workflow does not derive BASE_SHA from github.event.pull_request.base.sha');
  }
  if (!hasExactPullRequestHeadCheckout(source)) {
    issues.push('read-only pull_request exact-main workflow does not checkout github.event.pull_request.head.sha explicitly');
  }
  return { filePath, checked: true, issues };
}

export function scanPullRequestBasePolicy(rootDir = '.github/workflows') {
  const results = listWorkflowFiles(rootDir).map(scanWorkflow);
  const checked = results.filter((result) => result.checked);
  const violations = checked.flatMap((result) => result.issues.map((message) => ({ filePath: result.filePath, message })));
  return { results, checked, violations };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeFixture(dir, name, body) {
  fs.writeFileSync(path.join(dir, name), body, 'utf8');
}

function safeFixture() {
  return `name: safe\non:\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\nenv:\n  BASE_SHA: 0123456789012345678901234567890123456789\njobs:\n  validate:\n    env:\n      BASE_SHA: \${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || '0123456789012345678901234567890123456789' }}\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}\n      - run: |\n          git fetch origin main\n          test "$(git rev-parse origin/main)" = "$BASE_SHA"\n`;
}

function staleFixture() {
  return `name: stale\non:\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\nenv:\n  BASE_SHA: 0123456789012345678901234567890123456789\njobs:\n  validate:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n      - run: |\n          git fetch origin main\n          test "$(git rev-parse origin/main)" = "$BASE_SHA"\n`;
}

function syntheticFixture() {
  return `name: synthetic\non:\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  validate:\n    env:\n      BASE_SHA: \${{ github.event.pull_request.base.sha }}\n    steps:\n      - uses: actions/checkout@v4\n      - run: |\n          git fetch origin main\n          test "$(git rev-parse origin/main)" = "$BASE_SHA"\n`;
}

function archivalWriteFixture() {
  return `name: archival\non:\n  pull_request:\n    branches: [main]\npermissions:\n  contents: write\nenv:\n  BASE_SHA: 0123456789012345678901234567890123456789\njobs:\n  publish:\n    steps:\n      - uses: actions/checkout@v4\n      - run: |\n          git fetch origin main\n          test "$(git rev-parse origin/main)" = "$BASE_SHA"\n`;
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aapw-pr-base-policy-v2-'));
  try {
    const safeDir = path.join(root, 'safe');
    fs.mkdirSync(safeDir);
    writeFixture(safeDir, 'safe.yml', safeFixture());
    const safe = scanPullRequestBasePolicy(safeDir);
    assert(safe.checked.length === 1, 'safe fixture was not inspected');
    assert(safe.violations.length === 0, `safe fixture failed: ${JSON.stringify(safe.violations)}`);

    const staleDir = path.join(root, 'stale');
    fs.mkdirSync(staleDir);
    writeFixture(staleDir, 'stale.yml', staleFixture());
    const stale = scanPullRequestBasePolicy(staleDir);
    assert(stale.violations.some((violation) => violation.message.includes('derive BASE_SHA')), 'stale BASE_SHA fixture was not rejected');

    const syntheticDir = path.join(root, 'synthetic');
    fs.mkdirSync(syntheticDir);
    writeFixture(syntheticDir, 'synthetic.yml', syntheticFixture());
    const synthetic = scanPullRequestBasePolicy(syntheticDir);
    assert(synthetic.violations.some((violation) => violation.message.includes('head.sha')), 'synthetic checkout fixture was not rejected');

    const archivalDir = path.join(root, 'archival');
    fs.mkdirSync(archivalDir);
    writeFixture(archivalDir, 'archival.yml', archivalWriteFixture());
    const archival = scanPullRequestBasePolicy(archivalDir);
    assert(archival.checked.length === 0 && archival.violations.length === 0, 'archival self-publishing workflow should be out of mandatory read-only scope');

    console.log('[checkPullRequestBasePolicyV2] SELF-TEST PASS: stale base, synthetic head and archival-write boundaries are all classified correctly');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const rootDir = process.argv[2] || '.github/workflows';
  const report = scanPullRequestBasePolicy(rootDir);
  if (report.violations.length > 0) {
    console.error(`[checkPullRequestBasePolicyV2] FAIL: ${report.violations.length} violation(s) across ${report.checked.length} mandatory read-only exact-main PR workflow(s)`);
    for (const violation of report.violations) console.error(`- ${violation.filePath}: ${violation.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[checkPullRequestBasePolicyV2] PASS: ${report.checked.length} mandatory read-only exact-main PR workflow(s) use live PR base + exact PR head checkout`);
}

main();
