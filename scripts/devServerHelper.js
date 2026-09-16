#!/usr/bin/env node
/**
 * devServerHelper.js — shared local static-file-server + Playwright bootstrap used by more than
 * one dev-only script (`smokeTestGame3D.js`, and now `collectPerfSnapshot.js`, run 59). Extracted
 * out of `smokeTestGame3D.js` (which originally defined both inline) rather than duplicated a
 * second time — same reasoning `game3dSmokeChecks*.js`'s own three-way split already established
 * for this project: shared infra lives in one place, per-purpose logic stays in its own file.
 *
 * No behavior change for `smokeTestGame3D.js` — same static-server implementation, same
 * Playwright-resolution fallback order, moved verbatim.
 * @module scripts/devServerHelper
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.fbx': 'application/octet-stream',
	'.bin': 'application/octet-stream',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json',
};

/**
 * Starts a plain static file server over the repo root on an OS-assigned free port. No external
 * dependency — this is the only "network" involved, entirely local (127.0.0.1). The returned value
 * remains the native `http.Server`; `baseUrl` and promise-based `stop()` are additive conveniences
 * for focused browser QA scripts that do not need to repeat address/close boilerplate.
 *
 * Static responses include Content-Length and HEAD returns headers without streaming the body. That
 * mirrors normal Hosting/CDN behaviour and lets asset preflight code distinguish an unknown length
 * from an actual ~130-byte Git-LFS pointer instead of receiving an artificial zero-length response.
 * @returns {Promise<import('http').Server & {baseUrl:string, stop:()=>Promise<void>}>}
 */
function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT)) {
				res.writeHead(403);
				res.end('Forbidden');
				return;
			}
			if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404);
				res.end('Not found');
				return;
			}
			const stat = fs.statSync(filePath);
			const ext = path.extname(filePath).toLowerCase();
			res.writeHead(200, {
				'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
				'Content-Length': stat.size,
			});
			if (req.method === 'HEAD') {
				res.end();
				return;
			}
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500);
			res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
		const address = server.address();
		server.baseUrl = `http://127.0.0.1:${address.port}`;
		server.stop = () => new Promise((stopResolve, stopReject) => {
			server.close((error) => error ? stopReject(error) : stopResolve());
		});
		resolve(server);
	}));
}

/**
 * Resolves Playwright without assuming it's a local project dependency (this repo has none by
 * design). Tries plain `require('playwright')` first (works if installed locally or already on
 * Node's module path), then a common global-install location as a fallback.
 * @returns {object|null} The Playwright module, or null if unavailable anywhere tried.
 */
function loadPlaywright() {
	const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright'];
	for (const id of candidates) {
		try {
			return require(id);
		} catch (error) {
			// Try the next candidate.
		}
	}
	return null;
}

module.exports = { startStaticServer, loadPlaywright };
