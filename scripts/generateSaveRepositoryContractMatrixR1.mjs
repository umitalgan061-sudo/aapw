#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = 'artifacts/persistence/save-repository-contract.matrix';
const VERSIONS = [1, 2, 3, 4];
const BACKENDS = ['local', 'indexeddb', 'hybrid', 'memory'];
const PAYLOADS = ['tiny', 'player', 'world', 'large'];
const CORRUPTION = ['none', 'checksum', 'schema', 'size'];
const SLOTS = ['missing', 'fresh', 'stale', 'duplicate'];
const EVENTS = ['normal', 'autosave', 'manual', 'recovery'];

function expected({ version, corruption, slot, payload }) {
  if (corruption === 'checksum' || corruption === 'schema') return 'reject-integrity';
  if (corruption === 'size' || payload === 'large') return 'reject-size';
  if (slot === 'missing') return 'create-or-not-found';
  if (slot === 'stale') return 'reject-stale';
  if (version === 4) return 'reject-version';
  if (version === 1 || version === 2) return 'migrate-v3';
  return 'accept-v3';
}
function payloadBytes(payload) { return payload === 'tiny' ? 512 : payload === 'player' ? 8192 : payload === 'world' ? 65536 : 900000; }
function backendReady(backend) { return backend !== 'indexeddb' || typeof indexedDB !== 'undefined'; }
function row(id, version, backend, payload, corruption, slot, event) {
  return [id, version, backend, payload, payloadBytes(payload), corruption, slot, event, expected({ version, corruption, slot, payload }), backendReady(backend) ? 1 : 0, version <= 3 ? 1 : 0, event === 'recovery' ? 1 : 0].join('|');
}

function build() {
  const rows = [];
  let id = 1;
  for (const version of VERSIONS) {
    for (const backend of BACKENDS) {
      for (const payload of PAYLOADS) {
        for (const corruption of CORRUPTION) {
          for (const slot of SLOTS) {
            for (const event of EVENTS) {
              rows.push(row(String(id).padStart(4, '0'), version, backend, payload, corruption, slot, event));
              id += 1;
            }
          }
        }
      }
    }
  }
  return rows;
}

export function validateRows(rows) {
  if (rows.length !== 4096) throw new Error(`expected 4096 cases, got ${rows.length}`);
  const ids = new Set(rows.map((rowValue) => rowValue.split('|', 1)[0]));
  if (ids.size !== 4096) throw new Error(`expected 4096 unique ids, got ${ids.size}`);
  if (rows.some((rowValue) => rowValue.split('|').length !== 12)) throw new Error('save contract rows must have 12 fields');
  return true;
}

export async function main() {
  const rows = build();
  validateRows(rows);
  await mkdir('artifacts/persistence', { recursive: true });
  const header = [
    '# AAPW save repository deterministic contract corpus R1',
    '# 4 versions x 4 backends x 4 payload classes x 4 corruption modes x 4 slot states x 4 lifecycle events = 4096 cases',
    '# fields=id|version|backend|payload|payloadBytes|corruption|slot|event|expected|backendReady|versionSupported|recoveryPath',
  ].join('\n');
  await writeFile(OUT, `${header}\n${rows.join('\n')}\n`, 'utf8');
  console.log(`wrote ${rows.length} save contract cases`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
