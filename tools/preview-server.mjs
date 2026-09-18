// Local preview that answers like GitHub Pages: "download" serves download.html, a folder serves its index.html,
// a folder without "/" is redirected, and every unknown address gets 404.html. The short creator link
// "c/emelie" only works through that 404 page, so a plain file server cannot show it.
// Start it from anywhere: node tools/preview-server.mjs [port]   (default 8765, only on this computer)
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function kind(path) {
  try {
    const stats = statSync(path);
    return stats.isFile() ? 'file' : stats.isDirectory() ? 'folder' : null;
  } catch {
    return null;
  }
}

function notFound(root) {
  return { status: 404, file: join(root, '404.html') };
}

/** What GitHub Pages answers for an address: a file with its status, or a redirect for a folder without "/". */
export function resolveRequest(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound(root);
  }
  if (decoded.includes('\0')) return notFound(root);
  // normalize() removes "..", so nothing outside the website folder can be reached.
  const target = resolve(root, `.${normalize(`/${decoded}`)}`);
  if (target !== root && !target.startsWith(root + sep)) return notFound(root);

  const found = kind(target);
  if (found === 'file') return { status: 200, file: target };
  if (found === 'folder') {
    if (!pathname.endsWith('/')) return { status: 301, location: `${pathname}/` };
    const index = join(target, 'index.html');
    if (kind(index) === 'file') return { status: 200, file: index };
  }
  if (kind(`${target}.html`) === 'file') return { status: 200, file: `${target}.html` };
  return notFound(root);
}

export function startPreview(root, port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const answer = resolveRequest(root, url.pathname);
    if (answer.status === 301) {
      response.writeHead(301, { location: `${answer.location}${url.search}` });
      response.end();
      return;
    }
    response.writeHead(answer.status, { 'content-type': TYPES[extname(answer.file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(answer.file).pipe(response);
  });
  server.listen(port, '127.0.0.1', () => console.log(`PageBite website: http://localhost:${port}/`));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPreview(fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, ''), Number(process.argv[2] ?? 8765));
}
