/*
 * APEX / French Racing headless browser smoke test.
 *
 * The unit suite covers the engine and content contract, but it cannot prove
 * that app.mjs boots, renders the circuit and plays a race in a real browser.
 * This script drives a full solo race and a local-grid start through the Chrome
 * DevTools Protocol, captures screenshots, and fails on uncaught page errors.
 *
 * It uses only Node built-ins (global fetch and WebSocket) and an installed
 * Chromium browser, so it stays dependency-free. Run it with `npm run qa:browser`.
 *
 * Environment overrides:
 *   CHROME_PATH  explicit browser executable
 *   QA_PORT      local static-server port (default: ephemeral)
 *   QA_SHOTS     screenshot directory (default: OS temp dir)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.EDGE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  return CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

async function waitForJson(url, tries = 80) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Server or debugger not ready yet.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const messageId = ++id;
          pending.set(messageId, { res, rej });
          ws.send(JSON.stringify({ id: messageId, method, params }));
        });
      },
      on(fn) { listeners.add(fn); },
      close() { ws.close(); },
    });
    ws.onerror = () => reject(new Error('Could not open the DevTools socket'));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(JSON.stringify(message.error)));
        else res(message.result);
      } else {
        for (const fn of listeners) fn(message);
      }
    };
  });
}

const DRIVER_STEP = `(() => {
  const q = (selector) => document.querySelector(selector);
  const enabled = (selector) => { const el = q(selector); return el && !el.disabled; };
  if (q('[data-action="restart"]')) return { action: 'podium' };
  if (enabled('[data-action="commit"]')) { q('[data-action="commit"]').click(); return { action: 'commit' }; }
  if (enabled('[data-action="jumble-submit"]')) { q('[data-action="jumble-submit"]').click(); return { action: 'jumble-submit' }; }
  if (enabled('[data-token-id]')) return { action: 'jumble' };
  if (enabled('#typed-answer')) return { action: 'typed' };
  if (enabled('[data-gear]')) { q('[data-gear]').click(); return { action: 'gear' }; }
  if (enabled('[data-action="observe"]')) { q('[data-action="observe"]').click(); return { action: 'observe' }; }
  return { action: 'wait' };
})()`;

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('No Chromium browser found. Set CHROME_PATH to run the browser smoke test.');
    process.exitCode = 1;
    return;
  }

  const shotDir = process.env.QA_SHOTS || path.join(os.tmpdir(), 'apex-qa');
  mkdirSync(shotDir, { recursive: true });
  const profile = mkdtempSync(path.join(os.tmpdir(), 'apex-qa-profile-'));

  const server = createServer({ rootDir: ROOT });
  await new Promise((resolve) => server.listen(Number(process.env.QA_PORT) || 0, '127.0.0.1', resolve));
  const gamePort = server.address().port;
  const gameUrl = `http://127.0.0.1:${gamePort}/`;

  let chrome;
  let cdp;
  try {
    let debugWs = '';
    chrome = spawn(browser, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      `--window-size=${process.env.QA_WINDOW || '1280,720'}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--hide-scrollbars', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.stderr.on('data', (chunk) => {
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(String(chunk));
      if (match) debugWs = match[1];
    });
    for (let attempt = 0; attempt < 100 && !debugWs; attempt += 1) await sleep(100);
    if (!debugWs) throw new Error('Chromium did not expose a DevTools endpoint');
    const debugPort = new URL(debugWs).port;

    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = targets.find((target) => target.type === 'page') || targets[0];
    cdp = await connect(page.webSocketDebuggerUrl);

    const errors = [];
    cdp.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails?.exception?.description || 'uncaught exception');
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        const text = message.params.entry.text || '';
        if (!/favicon/i.test(text)) errors.push(text);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    let shot = 0;
    const capture = async (label) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(shotDir, `${String(++shot).padStart(2, '0')}-${label}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    };
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'page evaluation failed');
      return result.result?.value;
    };

    await cdp.send('Page.navigate', { url: gameUrl });
    await sleep(900);
    const shots = [await capture('setup')];

    const title = await evaluate(`document.title`);
    if (title !== 'APEX · French racing lab') throw new Error(`unexpected title: ${title}`);

    await evaluate(`document.querySelector('[data-action="start"]').click()`);
    await sleep(500);
    shots.push(await capture('race-start'));

    const seen = new Set();
    let reachedPodium = false;
    for (let step = 0; step < 1500 && !reachedPodium; step += 1) {
      const result = await evaluate(DRIVER_STEP);
      if (result.action === 'jumble') {
        if (!seen.has('challenge')) { shots.push(await capture('challenge')); seen.add('challenge'); }
        await evaluate(`document.querySelector('[data-token-id]').click()`);
      } else if (result.action === 'typed') {
        if (!seen.has('challenge')) { shots.push(await capture('challenge')); seen.add('challenge'); }
        await evaluate(`(() => {
          document.querySelector('#typed-answer').value = 'Je suis très detendu';
          document.querySelector('[data-action="typed-submit"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        })()`);
      } else if (result.action === 'podium') {
        reachedPodium = true;
      } else {
        await sleep(70);
      }
    }
    if (!reachedPodium) throw new Error('solo race never reached the podium screen');

    await sleep(300);
    shots.push(await capture('podium'));
    const classification = await evaluate(`[...document.querySelectorAll('.final-table tbody tr')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim())`);
    if (!classification.length) throw new Error('podium screen has no classification rows');

    await evaluate(`document.querySelector('[data-action="restart"]').click()`);
    await sleep(250);
    await evaluate(`document.querySelector('[data-mode="local"]').click()`);
    await sleep(250);
    await evaluate(`document.querySelector('[data-action="start"]').click()`);
    await sleep(400);
    const localHeading = await evaluate(`document.querySelector('#main h1')?.textContent`);
    if (!localHeading || !/Harbour circuit/.test(localHeading)) throw new Error('local grid did not start');
    shots.push(await capture('local-grid'));

    if (errors.length) throw new Error(`page errors: ${JSON.stringify(errors)}`);

    console.log('Browser smoke test passed.');
    console.log(`Classification: ${classification.join(' | ')}`);
    console.log(`Screenshots: ${shots.join(', ')}`);
  } finally {
    try { cdp?.close(); } catch {}
    try { chrome?.kill(); } catch {}
    await new Promise((resolve) => server.close(resolve));
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error(`Browser smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
