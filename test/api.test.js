const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createServer } = require('../server');

let server, base;

before(async () => {
  server = createServer(openDb(':memory:'));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
};

test('engineers, skills and ratings round-trip', async () => {
  const e = await call('POST', '/api/engineers', { name: 'Ada', team: 'Core', role: 'Staff' });
  assert.equal(e.status, 201);
  const s = await call('POST', '/api/skills', { name: 'Go', category: 'Languages' });
  assert.equal(s.status, 201);

  assert.equal((await call('PUT', `/api/ratings/${e.body.id}/${s.body.id}`, { level: 4, wants_to_learn: false })).status, 200);
  let state = (await call('GET', '/api/state')).body;
  assert.equal(state.ratings.length, 1);
  assert.equal(state.ratings[0].level, 4);

  // Setting level 0 with no interest clears the rating
  await call('PUT', `/api/ratings/${e.body.id}/${s.body.id}`, { level: 0 });
  state = (await call('GET', '/api/state')).body;
  assert.equal(state.ratings.length, 0);

  const csv = await call('GET', '/api/export.csv');
  assert.match(csv.body, /^Engineer,Team,Role,Languages \/ Go\nAda,Core,Staff,\n$/);
});

test('validation and conflicts', async () => {
  assert.equal((await call('POST', '/api/engineers', { name: '  ' })).status, 400);
  await call('POST', '/api/skills', { name: 'Rust' });
  assert.equal((await call('POST', '/api/skills', { name: 'Rust' })).status, 409);
  assert.equal((await call('PUT', '/api/ratings/1/1', { level: 9 })).status, 400);
  assert.equal((await call('PUT', '/api/ratings/999/1', { level: 3 })).status, 404);
  assert.equal((await call('DELETE', '/api/engineers/999')).status, 404);
});

test('deleting an engineer cascades to ratings', async () => {
  const e = await call('POST', '/api/engineers', { name: 'Grace' });
  const s = await call('POST', '/api/skills', { name: 'COBOL' });
  await call('PUT', `/api/ratings/${e.body.id}/${s.body.id}`, { level: 5 });
  await call('DELETE', `/api/engineers/${e.body.id}`);
  const state = (await call('GET', '/api/state')).body;
  assert.ok(!state.ratings.some((r) => r.engineer_id === e.body.id));
});

test('static files are served and traversal is blocked', async () => {
  const index = await call('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /Skills Tracker/);
  assert.notEqual((await call('GET', '/../db.js')).status, 200);
});
