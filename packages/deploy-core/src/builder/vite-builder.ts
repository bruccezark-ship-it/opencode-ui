import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { join } from 'node:path';

export interface BuildOptions {
  cwd: string;
  command: string;
  outDir: string;
  env?: Record<string, string>;
  verbose?: boolean;
}

export interface BuildResult {
  outDir: string;
  duration: number;
  fileCount: number;
  totalBytes: number;
}

export class BuildError extends Error {
  constructor(message: string, public readonly output?: string) {
    super(message);
    this.name = 'BuildError';
  }
}

function createBuildEnv(cwd: string, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const localBin = join(cwd, 'node_modules', '.bin');
  const basePath = process.env.PATH ?? process.env.Path ?? '';
  const mergedPath = existsSync(localBin)
    ? `${localBin}${path.delimiter}${basePath}`
    : basePath;

  return {
    ...process.env,
    NODE_ENV: 'production',
    PATH: mergedPath,
    Path: mergedPath,
    ...extraEnv,
  };
}

function ensureProjectReady(cwd: string): void {
  if (!existsSync(join(cwd, 'node_modules'))) {
    throw new BuildError('未找到 node_modules，请先在项目目录执行 npm install 或 pnpm install');
  }
}

async function countFiles(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        count++;
        const fileStat = await stat(fullPath);
        bytes += fileStat.size;
      }
    }
  }

  await walk(dir);
  return { count, bytes };
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const start = Date.now();
  ensureProjectReady(options.cwd);

  const [cmd, ...args] = options.command.split(/\s+/);

  try {
    await execa(cmd, args, {
      cwd: options.cwd,
      env: createBuildEnv(options.cwd, options.env),
      stdio: options.verbose ? 'inherit' : 'pipe',
    });
  } catch (error) {
    const execaError = error as { stderr?: string; stdout?: string; message: string };
    const output = [execaError.stdout, execaError.stderr].filter(Boolean).join('\n');
    const hint = output.includes('不是内部或外部命令') || output.includes('not recognized')
      ? '\n提示: 请确认项目已安装依赖 (npm install)，且 devDependencies 中包含 vite'
      : '';
    throw new BuildError(`构建失败: ${execaError.message}${hint}`, output);
  }

  const { count, bytes } = await countFiles(options.outDir);
  const duration = Date.now() - start;

  return {
    outDir: options.outDir,
    duration,
    fileCount: count,
    totalBytes: bytes,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
