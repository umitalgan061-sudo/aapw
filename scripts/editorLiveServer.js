#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.WESTEROS_EDITOR_PORT) || 4173;
const HOST = '127.0.0.1';
const MODEL_EXTENSIONS = new Set(['.fbx', '.glb', '.gltf']);
const MAX_SAVE_BYTES = 10 * 1024 * 1024;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function humanName(file) {
  const base = path.basename(file, path.extname(file));
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryFor(relativeModelPath) {
  const parts = toPosix(relativeModelPath).split('/');
  if (parts[0] === 'settlements' && parts[1]) return parts[1];
  return parts[0] || 'models';
}

function walkModelFiles(root) {
  const modelRoot = path.join(root, 'assets', 'models');
  if (!fs.existsSync(modelRoot)) return [];
  const found = [];
  const stack = [modelRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
    }
  }
  return found.sort((a, b) => a.localeCompare(b, 'en'));
}

function modelDescriptor(root, fullPath) {
  const repoRelative = toPosix(path.relative(root, fullPath));
  const modelRelative = toPosix(path.relative(path.join(root, 'assets', 'models'), fullPath));
  const extension = path.extname(fullPath).toLowerCase();
  const digest = crypto.createHash('sha1').update(repoRelative).digest('hex').slice(0, 12);
  const siblingTextures = path.join(path.dirname(fullPath), 'textures');
  const descriptor = {
    id: `workspace-${digest}`,
    name: humanName(fullPath),
    category: categoryFor(modelRelative),
    format: extension.slice(1),
    src: repoRelative,
    sizeBytes: fs.statSync(fullPath).size,
  };
  if (extension === '.fbx' && fs.existsSync(siblingTextures) && fs.statSync(siblingTextures).isDirectory()) {
    descriptor.resourcePath = `${toPosix(path.relative(root, siblingTextures))}/`;
  }
  return descriptor;
}

function scanModels(root = DEFAULT_ROOT) {
  return walkModelFiles(root).map((fullPath) => modelDescriptor(root, fullPath));
}

function stableSceneString(scene) {
  return JSON.stringify(scene);
}

function assertScene(scene) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error('scene bir obje olmalı');
  if (!Array.isArray(scene.objects)) throw new Error('scene.objects dizisi eksik');
  if (!Array.isArray(scene.instanceGroups)) throw new Error('scene.instanceGroups dizisi eksik');
  if (!Number.isInteger(scene.schemaVersion)) throw new Error('scene.schemaVersion eksik');
  return scene;
}

function saveSceneRevision(root, scene) {
  assertScene(scene);
  const canonical = stableSceneString(scene);
  const revision = crypto.createHash('sha256').update(canonical).digest('hex');
  const shortRevision = revision.slice(0, 16);
  const revisionDir = path.join(root, 'scenes', 'editor-live');
  const revisionFile = path.join(revisionDir, `${shortRevision}.scene.json`);
  const journalFile = path.join(root, 'scenes', 'westeros-world.editor.ndjson');
  fs.mkdirSync(revisionDir, { recursive: true });

  let createdRevision = false;
  try {
    fs.writeFileSync(revisionFile, `${JSON.stringify(scene, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    createdRevision = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const relativeRevisionFile = toPosix(path.relative(root, revisionFile));
  const journalEntry = JSON.stringify({
    schema: 'westeros-editor-save/v1',
    revision,
    file: relativeRevisionFile,
    scene,
  });
  let appendedJournal = true;
  if (fs.existsSync(journalFile)) {
    const current = fs.readFileSync(journalFile, 'utf8');
    if (current.includes(`\"revision\":\"${revision}\"`)) appendedJournal = false;
  }
  if (appendedJournal) fs.appendFileSync(journalFile, `${journalEntry}\n`, 'utf8');

  return {
    revision,
    revisionFile: relativeRevisionFile,
    journalFile: toPosix(path.relative(root, journalFile)),
    createdRevision,
    appendedJournal,
  };
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.fbx': 'application/octet-stream',
    '.mp4': 'video/mp4',
    '.woff2': 'font/woff2',
  })[ext] || 'application/octet-stream';
}

function localOrigin(origin) {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) return null;
    return origin;
  } catch {
    return null;
  }
}

function setApiHeaders(req, res) {
  const origin = localOrigin(req.headers.origin);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(req, res, status, body) {
  setApiHeaders(req, res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(body)}\n`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SAVE_BYTES) {
        reject(Object.assign(new Error('İstek gövdesi 10 MB sınırını aşıyor.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(Object.assign(new Error(`Geçersiz JSON: ${error.message}`), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' ? 'editor.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
  return full;
}

function createEditorLiveServer({ root = DEFAULT_ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${HOST}`);
    try {
      if (req.method === 'OPTIONS' && requestUrl.pathname.startsWith('/__editor/')) {
        setApiHeaders(req, res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'GET' && requestUrl.pathname === '/__editor/health') {
        sendJson(req, res, 200, { ok: true, service: 'westeros-editor-live', root: resolvedRoot });
        return;
      }
      if (req.method === 'GET' && requestUrl.pathname === '/__editor/models') {
        const models = scanModels(resolvedRoot);
        sendJson(req, res, 200, { ok: true, count: models.length, models });
        return;
      }
      if (req.method === 'POST' && requestUrl.pathname === '/__editor/save') {
        const body = await readJsonBody(req);
        const saved = saveSceneRevision(resolvedRoot, body.scene);
        sendJson(req, res, 200, { ok: true, ...saved });
        return;
      }

      if (!['GET', 'HEAD'].includes(req.method || '')) {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
      }
      const file = safeStaticPath(resolvedRoot, requestUrl.pathname);
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const stat = fs.statSync(file);
      res.writeHead(200, {
        'content-type': contentType(file),
        'content-length': stat.size,
        'cache-control': 'no-store',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    } catch (error) {
      if (requestUrl.pathname.startsWith('/__editor/')) {
        sendJson(req, res, error.statusCode || 500, { ok: false, error: error.message });
      } else {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      }
    }
  });
}

function startEditorLiveServer({ root = DEFAULT_ROOT, port = DEFAULT_PORT } = {}) {
  const server = createEditorLiveServer({ root });
  server.listen(port, HOST, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`[editorLiveServer] ROOT: ${path.resolve(root)}`);
    console.log(`[editorLiveServer] EDITOR: http://${HOST}:${actualPort}/editor.html`);
    console.log(`[editorLiveServer] API: http://${HOST}:${actualPort}/__editor/health`);
  });
  return server;
}

if (require.main === module) startEditorLiveServer();

module.exports = { createEditorLiveServer, scanModels, saveSceneRevision, startEditorLiveServer };
