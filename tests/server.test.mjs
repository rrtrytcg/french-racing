import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../serve.mjs';

async function withServer(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'french-racing-'));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>APEX</title>');
  await writeFile(path.join(root, 'nested', 'data.json'), '{"ok":true}');
  const server = createServer({ rootDir: root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try { await run({ base, root }); } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

function rawGet(urlPath, port) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: urlPath, method: 'GET' }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('serves index and preserves MIME types, including HEAD', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /APEX/);
    const head = await fetch(`${base}/nested/data.json`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.match(head.headers.get('content-type'), /^application\/json/);
    assert.equal(await head.text(), '');
  });
});

test('rejects traversal after URL decoding and returns 404 for absent files', async () => {
  await withServer(async ({ base }) => {
    for (const suffix of ['/../package.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/%2e%2e%5cpackage.json']) {
      const response = await fetch(`${base}${suffix}`);
      assert.ok([403, 404].includes(response.status), `${suffix}: ${response.status}`);
      assert.doesNotMatch(await response.text(), /dependencies|scripts/);
    }
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  });
});

test('raw encoded traversal never serves a file outside the root', async () => {
  await withServer(async ({ root }) => {
    const server = createServer({ rootDir: root });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const response = await rawGet('/%2e%2e%2fpackage.json', port);
      assert.equal(response.status, 403);
      assert.doesNotMatch(response.body, /dependencies|scripts/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
