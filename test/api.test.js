const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');

let server;
let base;

test.before(async () => {
  const app = createApp(openDb(':memory:'));
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function login(email) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  return async (method, path, body) => {
    const isForm = body instanceof FormData;
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
}

test('requires authentication', async () => {
  const res = await fetch(`${base}/documents`);
  assert.equal(res.status, 401);
});

test('rejects a wrong password', async () => {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@ajaia.test', password: 'nope' }),
  });
  assert.equal(res.status, 401);
});

test('owner can create, rename, save and reopen a document with formatting intact', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: created } = await alice('POST', '/documents', { title: 'Plan' });
  const html = '<h1>Goals</h1><p><strong>Ship</strong> <em>fast</em> <u>and well</u></p><ul><li>one</li></ul>';
  const saved = await alice('PATCH', `/documents/${created.id}`, { title: 'Q4 plan', content: html, baseVersion: 1 });
  assert.equal(saved.status, 200);
  const { body } = await alice('GET', `/documents/${created.id}`);
  assert.equal(body.document.title, 'Q4 plan');
  assert.equal(body.document.content, html);
  assert.equal(body.role, 'owner');
});

test('sharing: access is denied until granted, viewers are read-only, only owners manage shares', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const { body: doc } = await alice('POST', '/documents', { title: 'Private' });

  assert.equal((await bob('GET', `/documents/${doc.id}`)).status, 404);

  const grant = await alice('POST', `/documents/${doc.id}/shares`, { email: 'bob@ajaia.test', role: 'viewer' });
  assert.equal(grant.status, 201);

  const listed = await bob('GET', '/documents');
  assert.ok(listed.body.shared.some((d) => d.id === doc.id && d.role === 'viewer'));
  assert.ok(!listed.body.owned.some((d) => d.id === doc.id));

  assert.equal((await bob('PATCH', `/documents/${doc.id}`, { content: '<p>hi</p>' })).status, 403);
  assert.equal((await bob('POST', `/documents/${doc.id}/shares`, { email: 'carol@ajaia.test' })).status, 403);

  await alice('POST', `/documents/${doc.id}/shares`, { email: 'bob@ajaia.test', role: 'editor' });
  assert.equal((await bob('PATCH', `/documents/${doc.id}`, { content: '<p>hi</p>' })).status, 200);

  const bobId = grant.body.shares[0].user_id;
  await alice('DELETE', `/documents/${doc.id}/shares/${bobId}`);
  assert.equal((await bob('GET', `/documents/${doc.id}`)).status, 404);
});

test('sharing validates input', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: doc } = await alice('POST', '/documents', {});
  assert.equal((await alice('POST', `/documents/${doc.id}/shares`, { email: 'ghost@ajaia.test' })).status, 404);
  assert.equal((await alice('POST', `/documents/${doc.id}/shares`, { email: 'alice@ajaia.test' })).status, 400);
  assert.equal((await alice('POST', `/documents/${doc.id}/shares`, { email: 'bob@ajaia.test', role: 'admin' })).status, 400);
});

test('saved content is sanitized', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: doc } = await alice('POST', '/documents', {});
  await alice('PATCH', `/documents/${doc.id}`, { content: '<p onclick="x()">ok</p><script>alert(1)</script>' });
  const { body } = await alice('GET', `/documents/${doc.id}`);
  assert.equal(body.document.content, '<p>ok</p>');
});

test('stale saves are rejected with 409', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: doc } = await alice('POST', '/documents', {});
  assert.equal((await alice('PATCH', `/documents/${doc.id}`, { content: '<p>a</p>', baseVersion: 1 })).status, 200);
  const stale = await alice('PATCH', `/documents/${doc.id}`, { content: '<p>b</p>', baseVersion: 1 });
  assert.equal(stale.status, 409);
});

test('title validation', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: doc } = await alice('POST', '/documents', {});
  assert.equal((await alice('PATCH', `/documents/${doc.id}`, { title: '   ' })).status, 400);
});

test('uploading a .txt or .md file creates an editable document; other types are rejected', async () => {
  const alice = await login('alice@ajaia.test');

  const txt = new FormData();
  txt.append('file', new Blob(['First paragraph\nstill first\n\nSecond <b>one</b>']), 'notes.txt');
  const up = await alice('POST', '/documents/import', txt);
  assert.equal(up.status, 201);
  const { body } = await alice('GET', `/documents/${up.body.id}`);
  assert.equal(body.document.title, 'notes');
  assert.equal(body.document.content, '<p>First paragraph<br />still first</p><p>Second &lt;b&gt;one&lt;/b&gt;</p>');

  const md = new FormData();
  md.append('file', new Blob(['# Hello\n\n- a\n- b']), 'readme.md');
  const mdRes = await alice('POST', '/documents/import', md);
  const mdDoc = await alice('GET', `/documents/${mdRes.body.id}`);
  assert.match(mdDoc.body.document.content, /<h1>Hello<\/h1>/);
  assert.match(mdDoc.body.document.content, /<ul>/);

  const bad = new FormData();
  bad.append('file', new Blob(['MZ']), 'virus.exe');
  assert.equal((await alice('POST', '/documents/import', bad)).status, 400);
});
