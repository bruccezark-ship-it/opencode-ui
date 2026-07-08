import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import {
  analyzeProjectStructure,
  resolveBuildCommand,
} from './build-command.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTree(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(root, name);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}

async function createTempProject(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-deploy-build-'));
  tempDirs.push(dir);
  await createTree(dir, files);
  return dir;
}

describe('resolveBuildCommand', () => {
  it('detects standalone npm project from package.json scripts.build', async () => {
    const root = await createTempProject({
      'package.json': JSON.stringify({
        name: 'my-app',
        scripts: { build: 'vite build' },
      }),
      'package-lock.json': '',
      'vite.config.ts': 'export default {}',
    });

    const result = await resolveBuildCommand(root);
    expect(result.structure.kind).toBe('standalone');
    expect(result.structure.packageManager).toBe('npm');
    expect(result.command).toBe('npm run build');
    expect(result.source).toBe('package.json');
  });

  it('detects pnpm workspace sub-package', async () => {
    const root = await createTempProject({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({ name: 'monorepo', private: true }),
      'packages/app/package.json': JSON.stringify({
        name: 'app',
        scripts: { build: 'vite build' },
      }),
      'packages/app/vite.config.ts': 'export default {}',
    });

    const appRoot = join(root, 'packages', 'app');
    const result = await resolveBuildCommand(appRoot);
    expect(result.structure.kind).toBe('pnpm-workspace-package');
    expect(result.structure.workspaceRoot).toBe(root);
    expect(result.structure.packageManager).toBe('pnpm');
    expect(result.command).toBe('pnpm run build');
  });

  it('detects bun workspace sub-package', async () => {
    const root = await createTempProject({
      'bun.lock': '',
      'package.json': JSON.stringify({
        name: 'monorepo',
        private: true,
        workspaces: { packages: ['packages/*'] },
      }),
      'packages/app/package.json': JSON.stringify({
        name: '@scope/app',
        scripts: { build: 'vite build' },
      }),
      'packages/app/vite.config.ts': 'export default {}',
    });

    const appRoot = join(root, 'packages', 'app');
    const result = await resolveBuildCommand(appRoot);
    expect(result.structure.kind).toBe('bun-workspace-package');
    expect(result.structure.workspaceRoot).toBe(root);
    expect(result.structure.packageManager).toBe('bun');
    expect(result.command).toBe('bun run build');
  });

  it('falls back to package manager vite build when scripts.build is missing', async () => {
    const root = await createTempProject({
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({
        name: 'my-app',
        devDependencies: { vite: '^6.0.0' },
      }),
      'vite.config.ts': 'export default {}',
    });

    const result = await resolveBuildCommand(root);
    expect(result.command).toBe('pnpm exec vite build');
    expect(result.source).toBe('fallback');
  });

  it('respects .opencode-deployrc override', async () => {
    const root = await createTempProject({
      'package.json': JSON.stringify({
        name: 'my-app',
        scripts: { build: 'vite build' },
      }),
      'package-lock.json': '',
    });

    const result = await resolveBuildCommand(root, 'npm run build:prod');
    expect(result.command).toBe('npm run build:prod');
    expect(result.source).toBe('override');
  });
});

describe('analyzeProjectStructure', () => {
  it('treats workspace root itself as standalone', async () => {
    const root = await createTempProject({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({
        name: 'monorepo',
        scripts: { build: 'turbo build' },
      }),
    });

    const structure = await analyzeProjectStructure(root);
    expect(structure.kind).toBe('standalone');
    expect(structure.buildScript).toBe('turbo build');
  });
});
