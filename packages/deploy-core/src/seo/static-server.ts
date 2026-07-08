import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { lookup } from 'mime-types';

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') {
    return '';
  }

  const trimmed = basePath.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

async function resolveSpaFile(outDir: string, pathname: string): Promise<string> {
  const safePath = pathname.replace(/\.\./g, '') || '/';
  const relativePath = safePath.startsWith('/') ? safePath.slice(1) : safePath;
  const candidate = join(outDir, relativePath);

  try {
    const fileStat = await stat(candidate);
    if (fileStat.isFile()) {
      return candidate;
    }

    if (fileStat.isDirectory()) {
      const indexPath = join(candidate, 'index.html');
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  } catch {
    // fall through
  }

  if (!extname(candidate)) {
    const htmlPath = `${candidate}.html`;
    if (existsSync(htmlPath)) {
      return htmlPath;
    }
  }

  return join(outDir, 'index.html');
}

/** 启动 SPA 静态服务，支持 history 路由回退到 index.html */
export async function startSpaStaticServer(
  outDir: string,
  basePath = '/',
): Promise<{ url: string; close: () => Promise<void> }> {
  const normalizedBase = normalizeBasePath(basePath);

  const server = createServer(async (req, res) => {
    try {
      let pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

      if (normalizedBase && !pathname.startsWith(normalizedBase)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      if (normalizedBase) {
        pathname = pathname.slice(normalizedBase.length) || '/';
      }

      const filePath = await resolveSpaFile(outDir, pathname);
      const content = await readFile(filePath);
      const contentType = lookup(extname(filePath)) || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}${normalizedBase || ''}`.replace(/\/$/, '') || `http://127.0.0.1:${port}`;

  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export { resolveSpaFile, normalizeBasePath };
