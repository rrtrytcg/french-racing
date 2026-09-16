import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);

function contentType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Create a static server rooted at rootDir. It deliberately binds locally by default. */
export function createServer({ rootDir = HERE, host = '127.0.0.1' } = {}) {
  const root = path.resolve(rootDir);
  return http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end(request.method === 'HEAD' ? undefined : 'Method Not Allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}`).pathname);
    } catch {
      response.writeHead(400);
      response.end(request.method === 'HEAD' ? undefined : 'Bad Request');
      return;
    }

    // URL decoding happens before the containment check so encoded traversal and
    // Windows separators cannot escape the document root.
    if (pathname.includes('\0')) {
      response.writeHead(400);
      response.end(request.method === 'HEAD' ? undefined : 'Bad Request');
      return;
    }
    const requested = path.resolve(root, `.${pathname}`);
    if (!isInside(root, requested)) {
      response.writeHead(403);
      response.end(request.method === 'HEAD' ? undefined : 'Forbidden');
      return;
    }

    let filePath = requested;
    try {
      const info = await fs.stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
      const realRoot = await fs.realpath(root);
      const realFile = await fs.realpath(filePath);
      if (!isInside(realRoot, realFile)) {
        response.writeHead(403);
        response.end(request.method === 'HEAD' ? undefined : 'Forbidden');
        return;
      }
      const body = request.method === 'HEAD' ? null : await fs.readFile(realFile);
      response.writeHead(200, {
        'content-type': contentType(realFile),
        'content-length': (await fs.stat(realFile)).size,
        'cache-control': 'no-cache',
      });
      response.end(body);
    } catch (error) {
      const missing = error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
      response.writeHead(missing ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : missing ? 'Not Found' : 'Internal Server Error');
    }
  });
}

export async function startServer({ rootDir = HERE, host = '127.0.0.1', port = Number(process.env.PORT || 4178), open = false } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${port}`);
  const server = createServer({ rootDir, host });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const printable = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${printable}/`;
  console.log(`French racing server listening at ${url}`);
  if (open) {
    // This is a fixed, local URL. Open it with the platform's default browser
    // without interpolating any request or environment supplied text.
    const opener = process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'start', '', url]]
      : ['xdg-open', [url]];
    execFile(opener[0], opener[1], { windowsHide: true }, () => {});
  }
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Classroom hosting: `node serve.mjs --host 0.0.0.0` exposes the game (and
  // the guest join links) on the local network. Default stays loopback-only.
  const hostFlag = process.argv.find((arg) => arg === '--host' || arg.startsWith('--host='));
  const hostArg = hostFlag ? (hostFlag.includes('=') ? hostFlag.split('=')[1] : process.argv[process.argv.indexOf(hostFlag) + 1]) : '';
  startServer({ host: hostArg || '127.0.0.1', open: process.argv.includes('--open') }).catch((error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error('Port 4178 is already in use. Close the other local server or set PORT to another port.');
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  });
}
