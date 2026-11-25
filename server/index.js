// UniTalk server (prototype)
// - Menyajikan file statis dari folder /public
// - Endpoint POST /api/translate  -> { text, from, to }  =>  { translation, provider }
//
// Tanpa dependency: cukup Node.js >= 22.9.
// TUGAS 5 (Backend & Multi-device) akan mengembangkan file ini (room, WebSocket, deploy).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateText } from './translate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const MAX_TEXT_LENGTH = 1000;
const LANG_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

// Cross-origin isolation -> ONNX Runtime WASM bisa multi-thread (inference CPU jauh lebih cepat).
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

const MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limitBytes = 16_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Body terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Body harus JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleTranslate(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Pakai method POST' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const { text, from, to } = body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return sendJson(res, 400, { error: 'Teks kosong' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return sendJson(res, 400, { error: `Teks maksimal ${MAX_TEXT_LENGTH} karakter` });
  }
  if (!LANG_CODE.test(from ?? '') || !LANG_CODE.test(to ?? '')) {
    return sendJson(res, 400, { error: 'Kode bahasa tidak valid' });
  }

  try {
    const result = await translateText(text.trim(), from, to);
    return sendJson(res, 200, result);
  } catch (err) {
    console.error('[translate] gagal:', err.message);
    return sendJson(res, 502, { error: 'Gagal menerjemahkan. Cek koneksi internet lalu coba lagi.' });
  }
}

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendJson(res, 400, { error: 'URL tidak valid' });
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  try {
    const data = await readFile(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...ISOLATION_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - tidak ditemukan');
  }
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/translate') return handleTranslate(req, res);
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  UniTalk jalan di  http://localhost:${PORT}`);
  console.log('  Buka pakai Google Chrome / Microsoft Edge, lalu izinkan mikrofon.\n');
});
