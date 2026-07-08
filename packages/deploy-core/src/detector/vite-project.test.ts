import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { detectViteProject, ProjectError } from './vite-project.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createProject(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-deploy-vite-'));
  tempDirs.push(dir);

  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf-8');
  }

  return dir;
}

describe('detectViteProject', () => {
  it('accepts project with vite in devDependencies', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({
        name: 'app',
        devDependencies: { vite: '^6.0.0' },
      }),
    });

    const info = await detectViteProject(root);
    expect(info.name).toBe('app');
    expect(info.outDir).toContain('dist');
  });

  it('accepts pnpm workspace app with vite.config but no local vite dependency', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({ name: 'sidaier' }),
      'vite.config.ts': 'export default { build: { outDir: "dist" } }',
    });

    const info = await detectViteProject(root);
    expect(info.name).toBe('sidaier');
    expect(info.outDir).toContain('dist');
  });

  it('rejects project without vite signals', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({ name: 'not-vite' }),
    });

    await expect(detectViteProject(root)).rejects.toThrow(ProjectError);
  });
});
