#!/usr/bin/env node

// Re-run the deterministic owner-approved registry after the PR #961 owner asset upload.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'assets_manifest.json');
const CREDITS_PATH = path.join(ROOT, 'CREDITS.md');
const ASSETS_ROOT = path.join(ROOT, 'assets');
const MODEL_EXTENSIONS = new Set(['.fbx', '.glb']);
const OWNER_LICENSE = 'UNKNOWN — owner-approved for runtime use (§33.3)';
const CREDIT_MARKER = '<!-- OWNER_APPROVED_MODEL_INVENTORY_V1 -->';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function repoPath(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function stableId(file) {
  const digest = crypto.createHash('sha256').update(file).digest('hex').slice(0, 16);
  const base = path.basename(file, path.extname(file))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 44) || 'model';
  return `owner_model_${base}_${digest}`;
}

function inferSource(file) {
  const lower = path.basename(file).toLowerCase();
  const hints = [
    ['meshy_ai_', 'Meshy AI (filename attribution; account/license tier unverified)'],
    ['by quaternius', 'Quaternius (filename attribution)'],
    ['poly by google', 'Poly by Google (filename attribution)'],
    ['by creativetrio', 'CreativeTrio (filename attribution)'],
    ['by kenney', 'Kenney (filename attribution)'],
    ['by zsky', 'Zsky (filename attribution)'],
    ['by madtrollstudio', 'madtrollstudio (filename attribution)'],
    ['by blaeksprut', 'blaeksprut (filename attribution)'],
    ['by 3donimus', '3Donimus (filename attribution)'],
    ['by danni bittman', 'Danni Bittman (filename attribution)'],
    ['by dawid2k', 'Dawid2K (filename attribution)'],
    ['by jacques fourie', 'Jacques Fourie (filename attribution)'],
    ['by jarlan perez', 'Jarlan Perez (filename attribution)'],
    ['hitem3d-', 'Hitem3d (filename attribution)']
  ];
  for (const [needle, source] of hints) if (lower.includes(needle)) return source;
  return 'Owner upload — original source not recorded';
}

function modelType(file) {
  const lower = file.toLowerCase();
  if (/(dragon|wyvern|wyrm)/.test(lower)) return 'creature_model';
  if (/(knight|warrior|farmer|king|witch|centurion|viking|character|adventurer|female|male)/.test(lower)) return 'character_model';
  if (/(tree|grass|flower|plant|rock|boulder|terrain|landscape|mountain|cliff|coast|river|snow)/.test(lower)) return 'environment_model';
  if (/(castle|house|barn|church|temple|tower|fortress|building|bridge|gate|wall|cabin|palace|ruin|arch|stable|barracks)/.test(lower)) return 'structure_model';
  if (/(bear|cat|dog|wolf|horse|cow|deer|stag|sheep|goat|lion|tiger|rhino|fox|bird|owl|seagull|buffalo|bison|alpaca|rabbit|mouse|rat|zebra|elephant|elk|cougar|coyote|monkey|badger|skunk|mongoose)/.test(lower)) return 'creature_model';
  return 'model';
}

function entryFor(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    id: stableId(file),
    file,
    type: modelType(file),
    source: inferSource(file),
    sourceUrl: null,
    license: OWNER_LICENSE,
    version: 1,
    format: ext === '.glb' ? 'glTF Binary (.glb)' : 'FBX',
    deprecated: false,
    replacedBy: null,
    notes: 'Owner-uploaded model discovered in assets/ after the 2026-08-13 quarantine dissolution. Runtime use is owner-approved by GOVERNANCE_FULL_GAME_DIRECTIVE.md §4; provenance is recorded conservatively and no license is inferred beyond available filename evidence.',
    dateAdded: '2026-08-14'
  };
}

function renderManifest(manifest) {
  const lines = ['{', '  "assets": ['];
  manifest.assets.forEach((entry, index) => {
    const compact = String(entry.id || '').startsWith('owner_model_');
    const body = compact
      ? `    ${JSON.stringify(entry)}`
      : JSON.stringify(entry, null, 2).split('\n').map((line) => `    ${line}`).join('\n');
    lines.push(`${body}${index === manifest.assets.length - 1 ? '' : ','}`);
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

function creditRow(entry) {
  const source = entry.source.replaceAll('|', '\\|');
  const file = entry.file.replaceAll('|', '\\|');
  return `| \`${entry.id}\` | \`${file}\` | ${source} | ${OWNER_LICENSE} |`;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
if (!Array.isArray(manifest.assets)) throw new Error('assets_manifest.json assets[] missing');

const registeredFiles = new Set(manifest.assets.map((entry) => entry.file));
const registeredIds = new Set(manifest.assets.map((entry) => entry.id));
const modelFiles = walk(ASSETS_ROOT)
  .map(repoPath)
  .filter((file) => MODEL_EXTENSIONS.has(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, 'en'));

const additions = modelFiles.filter((file) => !registeredFiles.has(file)).map(entryFor);
for (const entry of additions) {
  if (registeredIds.has(entry.id)) throw new Error(`Generated duplicate asset id: ${entry.id}`);
  registeredIds.add(entry.id);
}
manifest.assets.push(...additions);
fs.writeFileSync(MANIFEST_PATH, renderManifest(manifest));

let credits = fs.readFileSync(CREDITS_PATH, 'utf8');
let creditsSuffix = '';
const creditMarkerIndex = credits.indexOf(CREDIT_MARKER);
if (creditMarkerIndex >= 0) {
  const ownerHeadingIndex = credits.indexOf('\n## ', creditMarkerIndex + CREDIT_MARKER.length);
  const nextHeadingIndex = ownerHeadingIndex >= 0
    ? credits.indexOf('\n## ', ownerHeadingIndex + '\n## '.length)
    : -1;
  if (nextHeadingIndex >= 0) creditsSuffix = credits.slice(nextHeadingIndex).trim();
  credits = credits.slice(0, creditMarkerIndex);
}
credits = credits.trimEnd();
const allOwnerApproved = manifest.assets
  .filter((entry) => entry.license === OWNER_LICENSE && String(entry.file || '').match(/\.(fbx|glb)$/i))
  .sort((a, b) => a.file.localeCompare(b.file, 'en'));
const section = [
  '', '', CREDIT_MARKER,
  '## Owner-upload model inventory — runtime use approved (§33.3)', '',
  'Bu tablo `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §4 uyarınca runtime kullanımına sahip tarafından açıkça izin verilen, ancak lisansı ayrı ayrı doğrulanmamış model dosyalarını kaydeder. Dosya adında açık bir üretici/yazar ipucu varsa yalnızca **filename attribution** olarak gösterilir; lisans tahmin edilmez.', '',
  '| Asset ID | Dosya | Kaynak kaydı | Lisans |',
  '|---|---|---|---|',
  ...allOwnerApproved.map(creditRow), ''
].join('\n');
const suffix = creditsSuffix ? `\n${creditsSuffix}\n` : '';
fs.writeFileSync(CREDITS_PATH, `${credits}${section}${suffix}`);

const afterFiles = new Set(manifest.assets.map((entry) => entry.file));
const unresolved = modelFiles.filter((file) => !afterFiles.has(file));
if (unresolved.length) throw new Error(`Unresolved primary models: ${unresolved.length}`);

console.log(`[materializeOwnerApprovedModelManifest] PASS: discovered=${modelFiles.length}, added=${additions.length}, ownerApprovedCredits=${allOwnerApproved.length}`);
