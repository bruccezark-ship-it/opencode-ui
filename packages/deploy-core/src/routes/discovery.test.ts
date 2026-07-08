import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { discoverRouteSources } from './discovery.js';

describe('discoverRouteSources', () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  async function createProject(structure: Record<string, string>): Promise<void> {
    projectRoot = await mkdtemp(join(tmpdir(), 'opencode-deploy-discovery-'));
    for (const [filePath, content] of Object.entries(structure)) {
      const fullPath = join(projectRoot, filePath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
    }
  }

  it('discovers router files', async () => {
    await createProject({
      'src/router/index.ts': "export default [{ path: '/' }];",
    });

    const sources = await discoverRouteSources(projectRoot);
    expect(sources).toEqual([{ kind: 'routerFile', path: 'src/router/index.ts' }]);
  });

  it('discovers pages directory as grouped candidate', async () => {
    await createProject({
      'src/pages/index.tsx': 'export default function Home() {}',
      'src/pages/about.tsx': 'export default function About() {}',
    });

    const sources = await discoverRouteSources(projectRoot);
    expect(sources).toEqual([
      {
        kind: 'pagesDir',
        dir: 'src/pages',
        files: ['src/pages/about.tsx', 'src/pages/index.tsx'],
      },
    ]);
  });

  it('discovers app router page files', async () => {
    await createProject({
      'app/page.tsx': 'export default function Home() {}',
      'app/blog/page.tsx': 'export default function Blog() {}',
    });

    const sources = await discoverRouteSources(projectRoot);
    expect(sources).toEqual([
      {
        kind: 'pagesDir',
        dir: 'app',
        files: ['app/blog/page.tsx', 'app/page.tsx'],
      },
    ]);
  });
});
