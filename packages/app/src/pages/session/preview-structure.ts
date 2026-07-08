import type { FileContent } from "@opencode-ai/sdk/v2"
import {
  detectProjectKind,
  isPreviewStartable,
  type ProjectStructure,
} from "@/pages/session/preview-project"
import {
  parsePackageJson,
  type PackageJson,
  VITE_CONFIG_CANDIDATES,
} from "@/pages/session/preview-url"

export function fileText(data: unknown): string | undefined {
  if (typeof data === "string") return data
  if (!data || typeof data !== "object") return undefined
  const file = data as FileContent
  if (file.type === "binary") return undefined
  if (typeof file.content === "string") return file.content
  return undefined
}

export const MONOREPO_APP_CANDIDATES = [
  "packages/app",
  "apps/web",
  "apps/app",
  "apps/frontend",
  "web",
  "frontend",
  "client",
] as const

export const WORKSPACE_SCAN_DIRS = ["packages", "apps"] as const

export function parseScriptCwd(script: string) {
  const match = script.match(/(?:^|\s)--cwd\s+(\S+)/)
  return match?.[1]
}

export function parseScriptFilter(script: string) {
  const match = script.match(/(?:^|\s)(?:--filter|-F)\s+(\S+)/)
  return match?.[1]?.replace(/^['"]|['"]$/g, "")
}

export function scriptUsesVite(script: string | undefined) {
  if (!script) return false
  return /\bvite\b/.test(script)
}

export function packageJsonUsesVite(packageJson: PackageJson | null | undefined, viteConfig: string | null | undefined) {
  if (viteConfig) return true
  const deps = { ...packageJson?.dependencies, ...packageJson?.devDependencies }
  if (deps?.vite || deps?.["@vitejs/plugin-react"] || deps?.["@vitejs/plugin-vue"]) return true
  const scripts = packageJson?.scripts ?? {}
  return Object.values(scripts).some((script) => scriptUsesVite(script))
}

type DirectorySnapshot = {
  rootDir: string
  rootFiles: string[]
  packageJson: PackageJson | null
  viteConfig: string | null
}

async function readOptionalFile(read: (path: string) => Promise<unknown>, path: string) {
  try {
    return fileText(await read(path))
  } catch {
    return undefined
  }
}

export function joinPath(base: string, name: string) {
  if (!base) return name
  if (!name) return base
  return `${base}/${name}`
}

export function normalizeRelativePath(path: string) {
  const parts: string[] = []
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join("/")
}

export function relativeAppDirFromSdk(sdkPackagePath: string, appPackagePath: string) {
  if (sdkPackagePath === appPackagePath) return ""
  const sdkParts = sdkPackagePath.split("/").filter(Boolean)
  const appParts = appPackagePath.split("/").filter(Boolean)
  let shared = 0
  while (shared < sdkParts.length && shared < appParts.length && sdkParts[shared] === appParts[shared]) {
    shared++
  }
  const ups = sdkParts.length - shared
  const upPath = Array.from({ length: ups }, () => "..").join("/")
  const downPath = appParts.slice(shared).join("/")
  if (!upPath) return downPath
  if (!downPath) return upPath
  return `${upPath}/${downPath}`
}

export function relativePathFromTo(from: string, to: string) {
  const normalize = (input: string) => input.replace(/\\/g, "/").replace(/\/+$/, "")
  const fromParts = normalize(from).split("/").filter(Boolean)
  const toParts = normalize(to).split("/").filter(Boolean)
  let shared = 0
  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared].toLowerCase() === toParts[shared].toLowerCase()
  ) {
    shared++
  }
  const ups = fromParts.length - shared
  const upPath = Array.from({ length: ups }, () => "..").join("/")
  const downPath = toParts.slice(shared).join("/")
  if (!upPath) return downPath
  if (!downPath) return upPath
  return `${upPath}/${downPath}`
}

export function packagePathFromWorktree(worktree: string, sdkDirectory: string) {
  if (worktree === sdkDirectory) return ""
  return relativePathFromTo(worktree, sdkDirectory)
}

export function climbPath(level: number) {
  return Array.from({ length: level }, () => "..").join("/")
}

export function isWorkspaceRoot(snapshot: DirectorySnapshot) {
  if (snapshot.rootFiles.some((file) => file.toLowerCase() === "pnpm-workspace.yaml")) return true
  const workspaces = snapshot.packageJson?.workspaces
  if (workspaces) return true
  if (snapshot.rootFiles.some((file) => file.toLowerCase() === "pnpm-lock.yaml") && snapshot.packageJson) return true
  return false
}

async function snapshotDirectory(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  rootDir: string,
): Promise<DirectorySnapshot> {
  const entries = await list(rootDir).catch(() => [])
  const rootFiles = entries.map((entry) => entry.name)
  const packageContent = await readOptionalFile(read, joinPath(rootDir, "package.json"))
  const packageJson = packageContent ? parsePackageJson(packageContent) : null

  let viteConfig: string | null = null
  for (const name of VITE_CONFIG_CANDIDATES) {
    const content = await readOptionalFile(read, joinPath(rootDir, name))
    if (content) {
      viteConfig = content
      break
    }
  }

  return { rootDir, rootFiles, packageJson, viteConfig }
}

function buildProjectStructure(
  snapshot: DirectorySnapshot,
  workspace: DirectorySnapshot,
  meta?: { workspaceRootDir?: string; packagePath?: string; sdkPackagePath?: string },
): ProjectStructure {
  const packagePath = meta?.packagePath ?? snapshot.rootDir
  const sdkPackagePath = meta?.sdkPackagePath ?? packagePath
  const rootDir = meta?.workspaceRootDir
    ? relativeAppDirFromSdk(sdkPackagePath, packagePath)
    : snapshot.rootDir

  return {
    kind: detectProjectKind(snapshot.rootFiles, snapshot.packageJson),
    rootDir,
    rootFiles: snapshot.rootFiles,
    workspaceRootFiles: workspace.rootFiles,
    packageJson: snapshot.packageJson,
    workspacePackageJson: workspace.packageJson,
    viteConfig: snapshot.viteConfig,
    workspaceRootDir: meta?.workspaceRootDir ?? "",
    packagePath,
  }
}

function isRunnableApp(snapshot: DirectorySnapshot) {
  if (!snapshot.packageJson) return false
  const scripts = snapshot.packageJson.scripts ?? {}
  if (scripts.dev || scripts.serve || scripts.start || scripts.preview) return true
  return packageJsonUsesVite(snapshot.packageJson, snapshot.viteConfig)
}

async function resolvePackagePathFromWorkspace(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  workspacePath: string,
  packageName?: string,
) {
  if (!packageName) return undefined

  const root = await snapshotDirectory(read, list, workspacePath)
  if (root.packageJson?.name === packageName) return ""

  for (const base of WORKSPACE_SCAN_DIRS) {
    const entries = await list(joinPath(workspacePath, base)).catch(() => [])
    for (const entry of entries) {
      if (entry.type && entry.type !== "directory") continue
      const packagePath = joinPath(base, entry.name)
      const snapshot = await snapshotDirectory(read, list, joinPath(workspacePath, packagePath))
      if (snapshot.packageJson?.name === packageName) return packagePath
    }
  }

  return undefined
}

function isPnpmWorkspace(snapshot: DirectorySnapshot) {
  return (
    snapshot.rootFiles.some((file) => file.toLowerCase() === "pnpm-workspace.yaml") ||
    snapshot.rootFiles.some((file) => file.toLowerCase() === "pnpm-lock.yaml")
  )
}

export type PreviewStructureOptions = {
  worktreeRootDir?: string
  sdkPackagePath?: string
  readWorktree?: (path: string) => Promise<unknown>
  listWorktree?: (path: string) => Promise<Array<{ name: string; type?: string }>>
}

async function attachWorktreeContext(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  cwd: DirectorySnapshot,
  structure: ProjectStructure,
  options: PreviewStructureOptions,
): Promise<ProjectStructure> {
  if (!options.readWorktree || !options.listWorktree) return structure

  const workspace = await snapshotDirectory(options.readWorktree, options.listWorktree, "")
  if (!isWorkspaceRoot(workspace)) return structure

  const worktreeRootDir = options.worktreeRootDir ?? structure.workspaceRootDir ?? ""
  const sdkPackagePath = options.sdkPackagePath ?? ""
  const packagePath =
    (await resolvePackagePathFromWorkspace(
      options.readWorktree,
      options.listWorktree,
      "",
      structure.packageJson?.name ?? cwd.packageJson?.name,
    )) ??
    structure.packagePath ??
    sdkPackagePath

  return {
    ...structure,
    workspaceRootDir: worktreeRootDir,
    workspacePackageJson: workspace.packageJson,
    workspaceRootFiles: workspace.rootFiles,
    packagePath,
    rootDir: worktreeRootDir || packagePath ? relativeAppDirFromSdk(sdkPackagePath, packagePath) : structure.rootDir,
  }
}

async function resolveFromWorktree(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  cwd: DirectorySnapshot,
  options: PreviewStructureOptions,
): Promise<ProjectStructure | undefined> {
  if (!options.readWorktree || !options.listWorktree) return undefined

  const workspace = await snapshotDirectory(options.readWorktree, options.listWorktree, "")
  if (!isWorkspaceRoot(workspace)) return undefined

  const worktreeRootDir = options.worktreeRootDir ?? ""
  const sdkPackagePath = options.sdkPackagePath ?? ""

  if (isRunnableApp(cwd)) {
    const packagePath =
      (await resolvePackagePathFromWorkspace(
        options.readWorktree,
        options.listWorktree,
        "",
        cwd.packageJson?.name,
      )) ?? sdkPackagePath
    return buildProjectStructure(cwd, workspace, {
      workspaceRootDir: worktreeRootDir,
      packagePath,
      sdkPackagePath,
    })
  }

  return resolveMonorepoStructure(options.readWorktree, options.listWorktree, "", workspace, {
    workspaceRootDir: worktreeRootDir,
    sdkPackagePath,
  })
}

async function enrichWithWorkspaceContext(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  cwd: DirectorySnapshot,
  structure: ProjectStructure,
): Promise<ProjectStructure> {
  if (structure.workspaceRootDir) return structure

  for (let level = 1; level <= 8; level++) {
    const workspacePath = climbPath(level)
    const workspace = await snapshotDirectory(read, list, workspacePath)
    if (!isWorkspaceRoot(workspace)) continue
    if (!isPnpmWorkspace(workspace)) return structure

    const sdkPackagePath =
      (await resolvePackagePathFromWorkspace(read, list, workspacePath, cwd.packageJson?.name)) ?? ""
    const packagePath =
      (await resolvePackagePathFromWorkspace(read, list, workspacePath, structure.packageJson?.name)) ??
      structure.packagePath

    if (!structure.packageJson?.name && !cwd.packageJson?.name) return structure

    return {
      ...structure,
      workspaceRootDir: workspacePath,
      workspacePackageJson: workspace.packageJson,
      workspaceRootFiles: workspace.rootFiles,
      packagePath,
      rootDir: relativeAppDirFromSdk(sdkPackagePath, packagePath),
    }
  }

  return structure
}

async function resolveMonorepoStructure(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  basePath: string,
  workspace: DirectorySnapshot,
  meta?: { workspaceRootDir?: string; sdkPackagePath?: string },
): Promise<ProjectStructure | undefined> {
  const prefix = (segment: string) => (basePath ? joinPath(basePath, segment) : segment)

  const root = await snapshotDirectory(read, list, prefix(""))

  if (isRunnableApp(root) && (root.viteConfig || packageJsonUsesVite(root.packageJson, root.viteConfig))) {
    return buildProjectStructure(root, workspace, {
      workspaceRootDir: meta?.workspaceRootDir ?? "",
      packagePath: normalizeRelativePath(prefix("")),
      sdkPackagePath: meta?.sdkPackagePath ?? normalizeRelativePath(prefix("")),
    })
  }

  const delegatedCwd = parseScriptCwd(workspace.packageJson?.scripts?.dev ?? workspace.packageJson?.scripts?.start ?? "")
  if (delegatedCwd) {
    const delegated = await snapshotDirectory(read, list, prefix(delegatedCwd))
    if (isRunnableApp(delegated)) {
      return buildProjectStructure(delegated, workspace, {
        workspaceRootDir: meta?.workspaceRootDir ?? "",
        packagePath: delegatedCwd,
        sdkPackagePath: meta?.sdkPackagePath ?? "",
      })
    }
  }

  for (const candidate of MONOREPO_APP_CANDIDATES) {
    const snapshot = await snapshotDirectory(read, list, prefix(candidate))
    if (isRunnableApp(snapshot)) {
      return buildProjectStructure(snapshot, workspace, {
        workspaceRootDir: meta?.workspaceRootDir ?? "",
        packagePath: candidate,
        sdkPackagePath: meta?.sdkPackagePath ?? "",
      })
    }
  }

  for (const base of WORKSPACE_SCAN_DIRS) {
    const entries = await list(prefix(base)).catch(() => [])
    for (const entry of entries) {
      if (entry.type && entry.type !== "directory") continue
      const candidate = joinPath(base, entry.name)
      const snapshot = await snapshotDirectory(read, list, prefix(candidate))
      if (isRunnableApp(snapshot)) {
        return buildProjectStructure(snapshot, workspace, {
          workspaceRootDir: meta?.workspaceRootDir ?? "",
          packagePath: candidate,
          sdkPackagePath: meta?.sdkPackagePath ?? "",
        })
      }
      const nested = await list(prefix(candidate)).catch(() => [])
      for (const nestedEntry of nested) {
        if (nestedEntry.type && nestedEntry.type !== "directory") continue
        const nestedCandidate = joinPath(candidate, nestedEntry.name)
        const nestedSnapshot = await snapshotDirectory(read, list, prefix(nestedCandidate))
        if (isRunnableApp(nestedSnapshot)) {
          return buildProjectStructure(nestedSnapshot, workspace, {
            workspaceRootDir: meta?.workspaceRootDir ?? "",
            packagePath: nestedCandidate,
            sdkPackagePath: meta?.sdkPackagePath ?? "",
          })
        }
      }
    }
  }

  return undefined
}

export async function loadProjectStructure(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
  options?: PreviewStructureOptions,
): Promise<ProjectStructure> {
  const cwd = await snapshotDirectory(read, list, "")
  let structure = await resolveMonorepoStructure(read, list, "", cwd, cwd)

  if (!structure || !isPreviewStartable(structure)) {
    const fromWorktree = await resolveFromWorktree(read, list, cwd, options ?? {})
    if (fromWorktree && isPreviewStartable(fromWorktree)) structure = fromWorktree
  }

  if (!structure || !isPreviewStartable(structure)) {
    for (let level = 1; level <= 8; level++) {
      const workspacePath = climbPath(level)
      const workspace = await snapshotDirectory(read, list, workspacePath)
      if (!isWorkspaceRoot(workspace)) continue

      const workspaceRootDir = workspacePath
      const sdkPackagePath =
        (await resolvePackagePathFromWorkspace(read, list, workspacePath, cwd.packageJson?.name)) ?? ""

      if (isRunnableApp(cwd)) {
        const packagePath =
          (await resolvePackagePathFromWorkspace(read, list, workspacePath, cwd.packageJson?.name)) ?? ""
        structure = buildProjectStructure(cwd, workspace, {
          workspaceRootDir,
          packagePath,
          sdkPackagePath,
        })
        break
      }

      const fromWorkspace = await resolveMonorepoStructure(read, list, workspacePath, workspace, {
        workspaceRootDir,
        sdkPackagePath,
      })
      if (fromWorkspace && isPreviewStartable(fromWorkspace)) {
        structure = fromWorkspace
        break
      }
    }
  }

  structure = structure ?? buildProjectStructure(cwd, cwd)
  structure = await attachWorktreeContext(read, list, cwd, structure, options ?? {})
  if (!options?.readWorktree) {
    structure = await enrichWithWorkspaceContext(read, list, cwd, structure)
  }
  return structure
}
