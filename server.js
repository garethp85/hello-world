const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, 'Request body too large');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function requireText(value, field, max = 100) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} is required`);
  if (value.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return value.trim();
}

function optionalText(value, field, max = 100) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  if (value.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return value.trim();
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(state) {
  const levels = new Map(state.ratings.map((r) => [`${r.engineer_id}:${r.skill_id}`, r]));
  const header = ['Engineer', 'Team', 'Role', ...state.skills.map((s) => `${s.category} / ${s.name}`)];
  const rows = state.engineers.map((e) => [
    e.name,
    e.team,
    e.role,
    ...state.skills.map((s) => {
      const r = levels.get(`${e.id}:${s.id}`);
      if (!r) return '';
      return `${r.level}${r.wants_to_learn ? '*' : ''}`;
    }),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function createServer(store) {
  async function api(req, res, parts) {
    const [resource, a, b] = parts;
    const method = req.method;

    if (resource === 'state' && method === 'GET') return send(res, 200, store.state());

    if (resource === 'export.csv' && method === 'GET') {
      res.setHeader('Content-Disposition', 'attachment; filename="skills-matrix.csv"');
      return send(res, 200, exportCsv(store.state()), 'text/csv; charset=utf-8');
    }

    if (resource === 'engineers') {
      if (method === 'POST' && !a) {
        const body = await readJson(req);
        const id = store.addEngineer({
          name: requireText(body.name, 'Name'),
          team: optionalText(body.team, 'Team'),
          role: optionalText(body.role, 'Role'),
        });
        return send(res, 201, { id });
      }
      if (method === 'PUT' && a) {
        const body = await readJson(req);
        const ok = store.updateEngineer(parseId(a), {
          name: requireText(body.name, 'Name'),
          team: optionalText(body.team, 'Team'),
          role: optionalText(body.role, 'Role'),
        });
        return ok ? send(res, 200, { ok }) : send(res, 404, { error: 'Engineer not found' });
      }
      if (method === 'DELETE' && a) {
        return store.deleteEngineer(parseId(a)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Engineer not found' });
      }
    }

    if (resource === 'skills') {
      if (method === 'POST' && !a) {
        const body = await readJson(req);
        const id = store.addSkill({
          name: requireText(body.name, 'Name'),
          category: optionalText(body.category, 'Category'),
        });
        return send(res, 201, { id });
      }
      if (method === 'PUT' && a) {
        const body = await readJson(req);
        const ok = store.updateSkill(parseId(a), {
          name: requireText(body.name, 'Name'),
          category: optionalText(body.category, 'Category'),
        });
        return ok ? send(res, 200, { ok }) : send(res, 404, { error: 'Skill not found' });
      }
      if (method === 'DELETE' && a) {
        return store.deleteSkill(parseId(a)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Skill not found' });
      }
    }

    if (resource === 'ratings' && method === 'PUT' && a && b) {
      const body = await readJson(req);
      const level = body.level ?? 0;
      if (!Number.isInteger(level) || level < 0 || level > 5) throw new HttpError(400, 'Level must be an integer from 0 to 5');
      store.setRating(parseId(a), parseId(b), { level, wants_to_learn: Boolean(body.wants_to_learn) });
      return send(res, 200, { ok: true });
    }

    throw new HttpError(404, 'Not found');
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) {
        await api(req, res, pathname.slice(5).split('/').filter(Boolean));
      } else if (req.method === 'GET') {
        serveStatic(req, res, pathname);
      } else {
        send(res, 405, { error: 'Method not allowed' });
      }
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (/UNIQUE constraint failed/.test(err.message)) return send(res, 409, { error: 'That name already exists' });
      if (/FOREIGN KEY constraint failed/.test(err.message)) return send(res, 404, { error: 'Engineer or skill not found' });
      console.error(err);
      send(res, 500, { error: 'Internal server error' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const store = openDb();
  createServer(store).listen(port, () => {
    console.log(`Skills tracker running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
