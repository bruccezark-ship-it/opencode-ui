import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
] as const;

export interface ViteProjectInfo {
  name: string;
  version: string;
  root: string;
  outDir: string;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export async function detectViteProject(projectRoot: string): Promise<ViteProjectInfo> {
  const pkgPath = join(projectRoot, 'package.json');

  if (!existsSync(pkgPath)) {
    throw new ProjectError('当前目录不是有效的 Node.js 项目（缺少 package.json）');
  }

  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  if (!isViteProject(projectRoot, pkg)) {
    throw new ProjectError(
      '当前项目不是 Vite 项目（未找到 vite 依赖、vite.config 或 node_modules 中的 vite 包；pnpm workspace 子项目请确认存在 vite.config 且已 pnpm install）',
    );
  }

  const outDir = await resolveOutDir(projectRoot);

  return {
    name: pkg.name ?? 'unknown',
    version: pkg.version ?? '0.0.0',
    root: projectRoot,
    outDir,
  };
}

export async function resolveOutDir(
  projectRoot: string,
  projectOutputDir?: string,
): Promise<string> {
  if (projectOutputDir) {
    return join(projectRoot, projectOutputDir);
  }

  for (const configFile of VITE_CONFIG_FILES) {
    const configPath = join(projectRoot, configFile);
    if (!existsSync(configPath)) continue;

    const content = await readFile(configPath, 'utf-8');
    const outDirMatch = content.match(/outDir\s*:\s*['"`]([^'"`]+)['"`]/);
    if (outDirMatch) {
      return join(projectRoot, outDirMatch[1]);
    }
  }

  return join(projectRoot, 'dist');
}

/** 读取 vite.config 中的 base 路径 */
export async function resolveViteBasePath(projectRoot: string): Promise<string> {
  for (const configFile of VITE_CONFIG_FILES) {
    const configPath = join(projectRoot, configFile);
    if (!existsSync(configPath)) continue;

    const content = await readFile(configPath, 'utf-8');
    const baseMatch = content.match(/base\s*:\s*['"`]([^'"`]+)['"`]/);
    if (baseMatch) {
      return baseMatch[1];
    }
  }

  return '/';
}

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function hasViteConfig(projectRoot: string): boolean {
  return VITE_CONFIG_FILES.some((configFile) =>
    existsSync(join(projectRoot, configFile)),
  );
}

function hasViteDependency(pkg: PackageJson): boolean {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Boolean(deps.vite);
}

function canResolveVite(projectRoot: string): boolean {
  return existsSync(join(projectRoot, 'node_modules', 'vite', 'package.json'));
}

function isViteProject(projectRoot: string, pkg: PackageJson): boolean {
  return (
    hasViteDependency(pkg) ||
    hasViteConfig(projectRoot) ||
    canResolveVite(projectRoot)
  );
}
