// llsc-pump server — static files + per-user JSON API. No dependencies.
// User comes from the X-Auth-User header (set by Traefik after login).
// Local dev: DEV_USER=joel PORT=8080 node server.js
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = parseInt(process.env.PORT || '80', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATIC_DIR = process.env.STATIC_DIR || __dirname;
const DEV_USER = process.env.DEV_USER || '';

const MAX_JSON = 5 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const STATIC_DENY = new Set(['server.js']);

// JSON documents per user; value = default when the file does not exist yet
const DOCS = {
  exercises: [],
  workout: null,
  favourites: [],
  history: [],
  weights: [],
};

// ---- helpers ----
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req, MAX_JSON);
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

function getUser(req) {
  const raw = req.headers['x-auth-user'] || DEV_USER;
  const user = String(raw).trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(user) ? user : null;
}

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function readDoc(user, name) {
  try { return JSON.parse(await fsp.readFile(path.join(DATA_DIR, user, name + '.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return DOCS[name]; throw e; }
}

function writeDoc(user, name, value) {
  return writeAtomic(path.join(DATA_DIR, user, name + '.json'), JSON.stringify(value));
}

// Serialise read-modify-write per user so concurrent appends don't lose data
const locks = new Map();
function withLock(user, fn) {
  const prev = locks.get(user) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(user, next.catch(() => {}));
  return next;
}

function imagePath(user, id) {
  return path.join(DATA_DIR, user, 'images', id + '.jpg');
}

// ---- API ----
async function handleApi(req, res, user, parts) {
  const [resource, id] = parts;
  const method = req.method;

  if (resource === 'me' && method === 'GET') return send(res, 200, { user });

  // Whole-document resources: GET returns it, PUT replaces it
  if (resource in DOCS && !id) {
    if (method === 'GET') return send(res, 200, await readDoc(user, resource));
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      await withLock(user, () => writeDoc(user, resource, body));
      return send(res, 200, { ok: true });
    }
  }

  // Append entries (history sessions, weight log)
  if ((resource === 'history' || resource === 'weights') && id === 'append' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!Array.isArray(body)) return send(res, 400, { error: 'array expected' });
    await withLock(user, async () => {
      const list = await readDoc(user, resource);
      await writeDoc(user, resource, list.concat(body));
    });
    return send(res, 200, { ok: true });
  }

  if (resource === 'images') {
    if (!id && method === 'GET') {
      let files = [];
      try { files = await fsp.readdir(path.join(DATA_DIR, user, 'images')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      // { id: mtimeMs } — the client uses mtime as cache-busting version
      const result = {};
      for (const f of files.filter(f => /^\d+\.jpg$/.test(f))) {
        const st = await fsp.stat(path.join(DATA_DIR, user, 'images', f));
        result[parseInt(f, 10)] = Math.round(st.mtimeMs);
      }
      return send(res, 200, result);
    }
    if (!/^\d+$/.test(id || '')) return send(res, 400, { error: 'bad id' });
    const file = imagePath(user, id);
    if (method === 'GET') {
      try {
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' });
        return res.end(data);
      } catch (e) { if (e.code === 'ENOENT') return send(res, 404, { error: 'not found' }); throw e; }
    }
    if (method === 'PUT') {
      const data = await readBody(req, MAX_IMAGE);
      await writeAtomic(file, data);
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      await fsp.rm(file, { force: true });
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'not found' });
}

// ---- static ----
async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const ext = path.extname(rel).toLowerCase();
  const file = path.join(STATIC_DIR, rel);
  if (rel.includes('/') || rel.startsWith('.') || STATIC_DENY.has(rel) || !STATIC_TYPES[ext] ||
      !file.startsWith(STATIC_DIR)) {
    return send(res, 404, 'Not found', 'text/plain');
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/api/')) {
      const user = getUser(req);
      if (!user) return send(res, 401, { error: 'no user' });
      res.setHeader('Cache-Control', 'no-store');
      return await handleApi(req, res, user, pathname.slice(5).split('/').filter(Boolean));
    }
    await handleStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => {
  console.log(`llsc-pump on :${PORT}, data in ${DATA_DIR}` + (DEV_USER ? `, DEV_USER=${DEV_USER}` : ''));
});
