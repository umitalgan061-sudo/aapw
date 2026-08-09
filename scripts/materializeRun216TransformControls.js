#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/jsm/controls/TransformControls.js';
const EXPECTED_GIT_BLOB_SHA = '1163078c49179a40d5a9d129c13d582e8369bf37';
const TARGET_PATH = path.join(REPO_ROOT, 'src', '3d', 'vendor', 'three', 'addons', 'controls', 'TransformControls.js');
const REQUEST_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(buffer).digest('hex');
}

function verifyExactSource(buffer, label) {
  const actual = gitBlobSha(buffer);
  if (actual !== EXPECTED_GIT_BLOB_SHA) {
    throw new Error(`${label} git blob SHA mismatch: expected ${EXPECTED_GIT_BLOB_SHA}, got ${actual}`);
  }
  return actual;
}

function downloadBuffer(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'Accept': 'text/plain, application/javascript;q=0.9, */*;q=0.1',
        'User-Agent': 'westeros-pwa-run216-materializer'
      }
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while fetching ${SOURCE_URL}`));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        downloadBuffer(nextUrl, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`TransformControls download failed with HTTP ${status}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`TransformControls download timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
  });
}

function verifyExistingTarget() {
  if (!fs.existsSync(TARGET_PATH)) {
    throw new Error(`TransformControls vendor file is missing: ${path.relative(REPO_ROOT, TARGET_PATH)}`);
  }
  const source = fs.readFileSync(TARGET_PATH);
  return verifyExactSource(source, 'Existing TransformControls vendor file');
}

function writeTargetAdditively(source) {
  fs.mkdirSync(path.dirname(TARGET_PATH), { recursive: true });

  if (fs.existsSync(TARGET_PATH)) {
    const hash = verifyExistingTarget();
    return { created: false, hash };
  }

  try {
    fs.writeFileSync(TARGET_PATH, source, { flag: 'wx' });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const hash = verifyExistingTarget();
      return { created: false, hash };
    }
    throw error;
  }

  const persisted = fs.readFileSync(TARGET_PATH);
  const hash = verifyExactSource(persisted, 'Persisted TransformControls vendor file');
  return { created: true, hash };
}

function runSelfTest() {
  const fixture = Buffer.from('hello\n', 'utf8');
  const fixtureSha = gitBlobSha(fixture);
  if (fixtureSha !== 'ce013625030ba8dba906f756967f9e9ca394464a') {
    throw new Error(`Git blob SHA self-test failed: ${fixtureSha}`);
  }

  let rejected = false;
  try {
    verifyExactSource(fixture, 'Self-test fixture');
  } catch (error) {
    rejected = /git blob SHA mismatch/.test(String(error && error.message));
  }
  if (!rejected) throw new Error('Exact-source mismatch self-test failed');

  console.log('[materializeRun216TransformControls] PASS: Git blob hashing and mismatch rejection verified');
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--self-test')) {
    runSelfTest();
    return;
  }

  if (args.has('--verify-only')) {
    const hash = verifyExistingTarget();
    console.log(`[materializeRun216TransformControls] PASS: existing vendor matches exact Three.js r160 blob ${hash}`);
    return;
  }

  const source = await downloadBuffer(SOURCE_URL);
  const downloadedHash = verifyExactSource(source, 'Downloaded Three.js r160 TransformControls');
  const result = writeTargetAdditively(source);
  const action = result.created ? 'created' : 'already exact';
  console.log(`[materializeRun216TransformControls] PASS: ${action}; ${path.relative(REPO_ROOT, TARGET_PATH)} = ${downloadedHash}`);
}

main().catch((error) => {
  console.error(`[materializeRun216TransformControls] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
