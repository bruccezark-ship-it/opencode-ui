import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

type PackageManager = 'pnpm' | 'bun' | 'npm' | 'yarn';

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
};

export type ProjectStructureKind =
  | 'pnpm-workspace-package'
  | 'bun-workspace-package'
  | 'npm-workspace-package'
  | 'yarn-workspace-package'
  | 'standalone';

export type BuildCommandSource = 'override' | 'package.json' | 'fallback';

export interface ProjectStructureInfo {
  kind: ProjectStructureKind;
  packageManager: PackageManager;
  projectRoot: string;
  workspaceRoot?: string;
  packageName?: string;
  buildScript?: string;
}

export interface BuildCommandResolution {
  command: string;
  structure: ProjectStructureInfo;
  source: BuildCommandSource;
}

function hasLockfile(dir: string): boolean {
  return (
    existsSync(join(dir, 'pnpm-lock.yaml')) ||
    existsSync(join(dir, 'bun.lock')) ||
    existsSync(join(dir, 'bun.lockb')) ||
    existsSync(join(dir, 'yarn.lock')) ||
    existsSync(join(dir, 'package-lock.json'))
  );
}

function hasWorkspacesField(pkg: PackageJson): boolean {
  if (!pkg.workspaces) return false;
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces.length > 0;
  return (pkg.workspaces.packages?.length ?? 0) > 0;
}

async function readPackageJson(dir: string): Promise<PackageJson | undefined> {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  return JSON.parse(await readFile(pkgPath, 'utf-8')) as PackageJson;
}

function detectPackageManagerFromPackageJson(pkg: PackageJson | undefined): PackageManager | undefined {
  const value = pkg?.packageManager?.trim();
  if (!value) return undefined;
  if (value.startsWith('pnpm')) return 'pnpm';
  if (value.startsWith('bun')) return 'bun';
  if (value.startsWith('yarn')) return 'yarn';
  if (value.startsWith('npm')) return 'npm';
  return undefined;
}

export async function detectPackageManager(searchRoot: string): Promise<PackageManager> {
  let dir = searchRoot;
  while (true) {
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm';

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return detectPackageManagerFromPackageJson(await readPackageJson(searchRoot)) ?? 'npm';
}

async function findWorkspaceRoot(
  projectRoot: string,
): Promise<{ root: string; flavor: 'pnpm' | 'npm-yarn-bun' } | undefined> {
  let dir = projectRoot;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return { root: dir, flavor: 'pnpm' };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  dir = projectRoot;
  while (true) {
    const pkg = await readPackageJson(dir);
    if (pkg && hasWorkspacesField(pkg)) {
      return { root: dir, flavor: 'npm-yarn-bun' };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

function findLockfileRoot(projectRoot: string): string {
  let dir = projectRoot;
  while (true) {
    if (hasLockfile(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return projectRoot;
    dir = parent;
  }
}

function resolveWorkspacePackageKind(
  workspaceRoot: string,
  flavor: 'pnpm' | 'npm-yarn-bun',
): Exclude<ProjectStructureKind, 'standalone'> {
  if (flavor === 'pnpm') return 'pnpm-workspace-package';

  if (existsSync(join(workspaceRoot, 'yarn.lock'))) return 'yarn-workspace-package';
  if (existsSync(join(workspaceRoot, 'bun.lock')) || existsSync(join(workspaceRoot, 'bun.lockb'))) {
    return 'bun-workspace-package';
  }
  return 'npm-workspace-package';
}

export async function analyzeProjectStructure(projectRoot: string): Promise<ProjectStructureInfo> {
  const pkg = await readPackageJson(projectRoot);
  if (!pkg) {
    throw new Error('当前目录不是有效的 Node.js 项目（缺少 package.json）');
  }

  const workspace = await findWorkspaceRoot(projectRoot);
  const lockRoot = findLockfileRoot(projectRoot);
  const packageManager =
    detectPackageManagerFromPackageJson(await readPackageJson(lockRoot)) ??
    (await detectPackageManager(lockRoot));

  if (!workspace || normalize(projectRoot) === normalize(workspace.root)) {
    return {
      kind: 'standalone',
      packageManager,
      projectRoot,
      packageName: pkg.name,
      buildScript: pkg.scripts?.build,
    };
  }

  return {
    kind: resolveWorkspacePackageKind(workspace.root, workspace.flavor),
    packageManager,
    projectRoot,
    workspaceRoot: workspace.root,
    packageName: pkg.name,
    buildScript: pkg.scripts?.build,
  };
}

function pmRunBuild(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm run build';
    case 'bun':
      return 'bun run build';
    case 'yarn':
      return 'yarn run build';
    case 'npm':
      return 'npm run build';
  }
}

function pmExecViteBuild(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm exec vite build';
    case 'bun':
      return 'bunx vite build';
    case 'yarn':
      return 'yarn vite build';
    case 'npm':
      return 'npx vite build';
  }
}

export function formatProjectStructureKind(kind: ProjectStructureKind): string {
  switch (kind) {
    case 'pnpm-workspace-package':
      return 'pnpm workspace 子项目';
    case 'bun-workspace-package':
      return 'bun workspace 子项目';
    case 'npm-workspace-package':
      return 'npm workspace 子项目';
    case 'yarn-workspace-package':
      return 'yarn workspace 子项目';
    case 'standalone':
      return '独立 Vite 项目';
  }
}

export async function resolveBuildCommand(
  projectRoot: string,
  override?: string,
): Promise<BuildCommandResolution> {
  const structure = await analyzeProjectStructure(projectRoot);
  const trimmedOverride = override?.trim();

  if (trimmedOverride) {
    return { command: trimmedOverride, structure, source: 'override' };
  }

  if (structure.buildScript?.trim()) {
    return {
      command: pmRunBuild(structure.packageManager),
      structure,
      source: 'package.json',
    };
  }

  return {
    command: pmExecViteBuild(structure.packageManager),
    structure,
    source: 'fallback',
  };
}

export function resolveDependencyRoot(projectRoot: string, workspaceRoot?: string): string {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return projectRoot;
  }
  if (workspaceRoot && existsSync(join(workspaceRoot, 'node_modules'))) {
    return workspaceRoot;
  }
  return projectRoot;
}
