import { describe, it, expect } from 'vitest';
import { normalizeBasePath, resolveSpaFile } from './static-server.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('static-server', () => {
  it('normalizes base path', () => {
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('/app/')).toBe('/app');
  });

  it('falls back to index.html for spa routes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opencode-deploy-spa-'));
    await writeFile(join(dir, 'index.html'), '<html>home</html>', 'utf-8');

    const resolved = await resolveSpaFile(dir, '/about');
    expect(resolved).toBe(join(dir, 'index.html'));

    await rm(dir, { recursive: true, force: true });
  });

  it('resolves dedicated prerender html', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opencode-deploy-spa-'));
    await writeFile(join(dir, 'index.html'), '<html>home</html>', 'utf-8');
    await writeFile(join(dir, 'about.html'), '<html>about</html>', 'utf-8');

    const resolved = await resolveSpaFile(dir, '/about');
    expect(resolved).toBe(join(dir, 'about.html'));

    await rm(dir, { recursive: true, force: true });
  });
});
