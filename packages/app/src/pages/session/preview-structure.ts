import type { FileContent } from "@opencode-ai/sdk/v2"
import {
  detectProjectKind,
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

export function parseScriptCwd(script: string) {
  const match = script.match(/(?:^|\s)--cwd\s+(\S+)/)
  return match?.[1]
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

function joinPath(base: string, name: string) {
  if (!base) return name
  return `${base}/${name}`
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

function buildProjectStructure(snapshot: DirectorySnapshot, workspace: DirectorySnapshot): ProjectStructure {
  return {
    kind: detectProjectKind(snapshot.rootFiles, snapshot.packageJson),
    rootDir: snapshot.rootDir,
    rootFiles: snapshot.rootFiles,
    workspaceRootFiles: workspace.rootFiles,
    packageJson: snapshot.packageJson,
    workspacePackageJson: workspace.packageJson,
    viteConfig: snapshot.viteConfig,
  }
}

function isRunnableApp(snapshot: DirectorySnapshot) {
  if (!snapshot.packageJson) return false
  const scripts = snapshot.packageJson.scripts ?? {}
  if (scripts.dev || scripts.serve || scripts.start || scripts.preview) return true
  return packageJsonUsesVite(snapshot.packageJson, snapshot.viteConfig)
}

export async function loadProjectStructure(
  read: (path: string) => Promise<unknown>,
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>,
): Promise<ProjectStructure> {
  const root = await snapshotDirectory(read, list, "")

  if (isRunnableApp(root) && (root.viteConfig || packageJsonUsesVite(root.packageJson, root.viteConfig))) {
    return buildProjectStructure(root, root)
  }

  const delegatedCwd = parseScriptCwd(root.packageJson?.scripts?.dev ?? root.packageJson?.scripts?.start ?? "")
  if (delegatedCwd) {
    const delegated = await snapshotDirectory(read, list, delegatedCwd)
    if (isRunnableApp(delegated)) {
      return buildProjectStructure(delegated, root)
    }
  }

  for (const candidate of MONOREPO_APP_CANDIDATES) {
    const snapshot = await snapshotDirectory(read, list, candidate)
    if (isRunnableApp(snapshot)) {
      return buildProjectStructure(snapshot, root)
    }
  }

  const packages = await list("packages").catch(() => [])
  for (const entry of packages) {
    if (entry.type && entry.type !== "directory") continue
    const snapshot = await snapshotDirectory(read, list, joinPath("packages", entry.name))
    if (isRunnableApp(snapshot) && packageJsonUsesVite(snapshot.packageJson, snapshot.viteConfig)) {
      return buildProjectStructure(snapshot, root)
    }
  }

  return buildProjectStructure(root, root)
}
