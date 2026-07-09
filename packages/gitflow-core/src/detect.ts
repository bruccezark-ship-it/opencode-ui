import type { GitflowFileSystem } from "./filesystem.js"
import type { DetectResult, GitflowFramework, GitflowLanguage, GitflowPackageManager } from "./types.js"

function joinPath(base: string, name: string) {
  if (!base) return name
  if (!name) return base
  return `${base}/${name}`.replace(/\/+/g, "/")
}

function basename(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function relativePath(from: string, to: string) {
  const fromParts = from.replace(/\\/g, "/").split("/").filter(Boolean)
  const toParts = to.replace(/\\/g, "/").split("/").filter(Boolean)
  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++
  const up = fromParts.slice(i).map(() => "..")
  return [...up, ...toParts.slice(i)].join("/").replace(/\\/g, "/") || "."
}

function parsePackageManagerField(field: string | undefined) {
  if (!field || typeof field !== "string") return null
  const m = field.trim().match(/^(pnpm|npm|yarn)@(.+)$/)
  return m ? { name: m[1] as GitflowPackageManager, version: m[2] } : null
}

function normalizeNodeVersion(raw: string | undefined) {
  if (!raw) return null
  const cleaned = raw.replace(/^v/i, "").trim()
  if (/^lts/i.test(cleaned) || cleaned === "node") return null
  const m = cleaned.match(/(\d+)/)
  return m ? m[1] : null
}

function normalizePythonVersion(raw: string | undefined) {
  if (!raw) return null
  const m = raw.trim().match(/(\d+\.\d+)/)
  return m ? m[1] : null
}

function detectPnpmVersionFromLockfile(content: string | undefined) {
  if (!content) return null
  const m = content.match(/^lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)/m)
  if (!m) return null
  const major = parseInt(m[1], 10)
  if (major >= 9) return "9"
  if (major >= 6) return "8"
  return "7"
}

function detectNpmVersionFromLockfile(content: string | undefined) {
  if (!content) return null
  try {
    const lock = JSON.parse(content) as { npm?: string; lockfileVersion?: number }
    if (lock.npm && typeof lock.npm === "string") {
      return lock.npm.replace(/^npm@/, "")
    }
    const lv = lock.lockfileVersion
    if (typeof lv === "number") {
      if (lv >= 3) return "10"
      if (lv === 2) return "8"
      return "6"
    }
  } catch {
    /* ignore */
  }
  return null
}

async function detectPmVersionFromWorkflows(fs: GitflowFileSystem, root: string, pm: GitflowPackageManager) {
  const wfDir = joinPath(root, ".github/workflows")
  if (!(await fs.exists(wfDir))) return null

  const patterns: Record<GitflowPackageManager, RegExp> = {
    pnpm: /pnpm\/action-setup@v[\d.]+\s*\n\s*with:\s*\n\s*version:\s*['"]?([^\s'"]+)/,
    npm: /npm install -g npm@([^\s'"]+)|corepack prepare npm@([^\s'"]+)/,
    yarn: /corepack prepare yarn@([^\s'"]+)/,
  }
  const pattern = patterns[pm]

  try {
    const files = await fs.list(wfDir)
    for (const f of files) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue
      const content = await fs.read(joinPath(wfDir, f))
      if (!content) continue
      const m = content.match(pattern)
      if (m) return m[1] || m[2] || null
    }
  } catch {
    /* ignore */
  }
  return null
}

async function detectFromWorkflows(fs: GitflowFileSystem, root: string, field: "node" | "python") {
  const wfDir = joinPath(root, ".github/workflows")
  if (!(await fs.exists(wfDir))) return null

  const pattern = field === "node" ? /node-version:\s*['"]?(\d+)/ : /python-version:\s*['"]?(\d+\.\d+)/

  try {
    const files = await fs.list(wfDir)
    for (const f of files) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue
      const content = await fs.read(joinPath(wfDir, f))
      if (!content) continue
      const m = content.match(pattern)
      if (m) return m[1]
    }
  } catch {
    /* ignore */
  }
  return null
}

async function readPkgJson(fs: GitflowFileSystem, dir: string) {
  const content = await fs.read(joinPath(dir, "package.json"))
  if (!content) return null
  try {
    return JSON.parse(content) as {
      name?: string
      packageManager?: string
      volta?: Record<string, string>
      engines?: { node?: string }
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
      workspaces?: string[] | { packages?: string[] }
    }
  } catch {
    return null
  }
}

async function detectSinglePackageManagerVersion(
  fs: GitflowFileSystem,
  projectRoot: string,
  workspaceRoot: string,
  pkg: Awaited<ReturnType<typeof readPkgJson>>,
  pm: GitflowPackageManager,
  fallback: string,
) {
  const dirs = [projectRoot]
  if (workspaceRoot && workspaceRoot !== projectRoot) dirs.push(workspaceRoot)

  for (const dir of dirs) {
    const dirPkg = dir === projectRoot ? pkg : await readPkgJson(fs, dir)

    const fromField = parsePackageManagerField(dirPkg?.packageManager)
    if (fromField?.name === pm) return fromField.version

    if (dirPkg?.volta?.[pm]) return dirPkg.volta[pm]
  }

  if (pm === "pnpm") {
    for (const dir of dirs) {
      const content = await fs.read(joinPath(dir, "pnpm-lock.yaml"))
      const v = detectPnpmVersionFromLockfile(content)
      if (v) return v
    }
  }

  if (pm === "npm") {
    for (const dir of dirs) {
      const content = await fs.read(joinPath(dir, "package-lock.json"))
      const v = detectNpmVersionFromLockfile(content)
      if (v) return v
    }
  }

  for (const dir of dirs) {
    const fromWf = await detectPmVersionFromWorkflows(fs, dir, pm)
    if (fromWf) return fromWf
  }

  return fallback
}

async function detectPackageManagerVersions(
  fs: GitflowFileSystem,
  projectRoot: string,
  workspaceRoot: string,
  pkg: Awaited<ReturnType<typeof readPkgJson>>,
) {
  const defaults: Record<GitflowPackageManager, string> = { pnpm: "9", npm: "10", yarn: "4" }
  const result = { ...defaults }

  for (const pm of ["pnpm", "npm", "yarn"] as const) {
    result[pm] = await detectSinglePackageManagerVersion(fs, projectRoot, workspaceRoot, pkg, pm, defaults[pm])
  }
  return result
}

function normalizeDir(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (normalized === ".") return ""
  return normalized || ""
}

function dirname(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}

async function detectPackageManager(fs: GitflowFileSystem, projectDir: string): Promise<GitflowPackageManager> {
  const dir = normalizeDir(projectDir) || ""

  if (await fs.exists(joinPath(dir, "package-lock.json"))) return "npm"
  if (await fs.exists(joinPath(dir, "pnpm-lock.yaml"))) return "pnpm"
  if (await fs.exists(joinPath(dir, "yarn.lock"))) return "yarn"

  const pkg = await readPkgJson(fs, dir)
  const pm = pkg?.packageManager || ""
  if (pm.startsWith("npm")) return "npm"
  if (pm.startsWith("pnpm")) return "pnpm"
  if (pm.startsWith("yarn")) return "yarn"

  return "pnpm"
}

async function detectHasPackageLock(fs: GitflowFileSystem, projectDir: string) {
  return fs.exists(joinPath(normalizeDir(projectDir) || "", "package-lock.json"))
}

async function findPnpmWorkspaceRoot(fs: GitflowFileSystem, startDir: string) {
  let dir = normalizeDir(startDir) || ""
  let pnpmLockRoot: string | null = null

  while (true) {
    if (
      (await fs.exists(joinPath(dir, "pnpm-workspace.yaml"))) ||
      (await fs.exists(joinPath(dir, "pnpm-workspace.yml")))
    ) {
      return dir
    }

    if (await fs.exists(joinPath(dir, "pnpm-lock.yaml"))) {
      pnpmLockRoot = dir
    }

    const parent = dirname(dir)
    if (!parent && dir === "") break
    if (parent === dir) break
    dir = parent
  }

  const start = normalizeDir(startDir) || ""
  if (pnpmLockRoot !== null && pnpmLockRoot !== start) {
    return pnpmLockRoot
  }
  return pnpmLockRoot
}

type PnpmWorkspaceDetection = {
  isWorkspace: boolean
  isSubproject: boolean
  workspaceRoot: string
  subprojectPath: string
  packageName: string
}

/**
 * 第一步：识别 pnpm workspace 与子项目关系（对齐 self_cli/gitflow detect.mjs）
 */
async function detectPnpmWorkspace(
  fs: GitflowFileSystem,
  projectRoot: string,
  pkg: Awaited<ReturnType<typeof readPkgJson>>,
): Promise<PnpmWorkspaceDetection> {
  const normalizedRoot = normalizeDir(projectRoot) || ""
  const foundRoot = await findPnpmWorkspaceRoot(fs, normalizedRoot)
  const workspaceRoot = foundRoot ?? normalizedRoot

  const hasWorkspaceFile =
    (await fs.exists(joinPath(workspaceRoot, "pnpm-workspace.yaml"))) ||
    (await fs.exists(joinPath(workspaceRoot, "pnpm-workspace.yml")))
  const hasPnpmLock = await fs.exists(joinPath(workspaceRoot, "pnpm-lock.yaml"))
  const isWorkspace = hasWorkspaceFile || hasPnpmLock

  const subprojectPath = relativePath(workspaceRoot, normalizedRoot)
  const isSubproject = subprojectPath !== "" && subprojectPath !== "."

  return {
    isWorkspace,
    isSubproject,
    workspaceRoot,
    subprojectPath: isSubproject ? subprojectPath : "",
    packageName: pkg?.name || "",
  }
}

async function detectNodeVersion(
  fs: GitflowFileSystem,
  projectRoot: string,
  workspaceRoot: string,
  pkg: Awaited<ReturnType<typeof readPkgJson>>,
) {
  const dirs = [projectRoot]
  if (workspaceRoot && workspaceRoot !== projectRoot) dirs.push(workspaceRoot)

  for (const dir of dirs) {
    for (const file of [".nvmrc", ".node-version"]) {
      const content = await fs.read(joinPath(dir, file))
      const v = normalizeNodeVersion(content?.trim())
      if (v) return v
    }

    const dirPkg = dir === projectRoot ? pkg : await readPkgJson(fs, dir)
    if (dirPkg?.volta?.node) {
      const v = normalizeNodeVersion(dirPkg.volta.node)
      if (v) return v
    }
    if (dirPkg?.engines?.node) {
      const v = normalizeNodeVersion(dirPkg.engines.node)
      if (v) return v
    }

    const fromWf = await detectFromWorkflows(fs, dir, "node")
    if (fromWf) return fromWf
  }

  return "24"
}

async function detectPythonVersion(fs: GitflowFileSystem, projectRoot: string, workspaceRoot: string) {
  const dirs = [projectRoot]
  if (workspaceRoot && workspaceRoot !== projectRoot) dirs.push(workspaceRoot)

  for (const dir of dirs) {
    const pyVersion = await fs.read(joinPath(dir, ".python-version"))
    if (pyVersion) {
      const v = normalizePythonVersion(pyVersion.trim())
      if (v) return v
    }

    const runtime = await fs.read(joinPath(dir, "runtime.txt"))
    if (runtime) {
      const v = normalizePythonVersion(runtime.replace(/^python-?/i, ""))
      if (v) return v
    }

    const toolVersions = await fs.read(joinPath(dir, ".tool-versions"))
    if (toolVersions) {
      const m = toolVersions.match(/^python\s+(\S+)/m)
      if (m) {
        const v = normalizePythonVersion(m[1])
        if (v) return v
      }
    }

    const fromWf = await detectFromWorkflows(fs, dir, "python")
    if (fromWf) return fromWf
  }

  return "3.11"
}

function detectFramework(deps: Record<string, string>) {
  if (deps.react || deps["react-dom"]) return "React" as const
  if (deps.vue) return "Vue" as const
  return "Unknown" as const
}

async function detectBundler(fs: GitflowFileSystem, root: string, deps: Record<string, string>) {
  const hasViteConfig =
    (await fs.exists(joinPath(root, "vite.config.ts"))) ||
    (await fs.exists(joinPath(root, "vite.config.js"))) ||
    (await fs.exists(joinPath(root, "vite.config.mjs")))
  if (deps.vite || hasViteConfig) return "Vite" as const
  if (deps.webpack || deps["@vue/cli-service"]) return "Webpack" as const
  return "Unknown" as const
}

async function scanRouteFiles(fs: GitflowFileSystem, root: string, ext: string) {
  const srcDir = joinPath(root, "src")
  if (!(await fs.exists(srcDir))) return []

  const found: string[] = []

  async function walk(dir: string) {
    let entries: string[]
    try {
      entries = await fs.list(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const full = joinPath(dir, entry)
      if (await fs.isDirectory(full)) {
        if (!entry.startsWith(".") && entry !== "node_modules") await walk(full)
      } else if (entry.endsWith(`.${ext}`)) {
        try {
          const content = await fs.read(full)
          if (!content) continue
          if (/\b(createBrowserRouter|createRouter|Routes|Route\b.*\bpath\s*:|routes\s*:\s*\[)/.test(content)) {
            found.push(relativePath(root, full))
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  await walk(srcDir)
  return found
}

async function findRouteFiles(fs: GitflowFileSystem, root: string, framework: GitflowFramework, language: GitflowLanguage) {
  const ext = language === "TypeScript" ? "ts" : "js"
  const extx = language === "TypeScript" ? "tsx" : "jsx"
  const candidates: string[] = []

  const addIfExists = async (rel: string) => {
    if (await fs.exists(joinPath(root, rel))) candidates.push(rel)
  }

  if (framework === "React") {
    for (const e of [extx, ext]) {
      await addIfExists(`src/routes.${e}`)
      await addIfExists(`src/router.${e}`)
      await addIfExists(`src/router/index.${e}`)
      await addIfExists(`src/router/routes.${e}`)
      await addIfExists(`src/config/routes.${e}`)
    }
    for (const f of await scanRouteFiles(fs, root, extx)) {
      if (!candidates.includes(f)) candidates.push(f)
    }
  }

  if (framework === "Vue") {
    await addIfExists(`src/router/index.${ext}`)
    await addIfExists(`src/router.${ext}`)
    await addIfExists(`src/routes.${ext}`)
    for (const f of await scanRouteFiles(fs, root, ext)) {
      if (!candidates.includes(f)) candidates.push(f)
    }
  }

  if (candidates.length === 0) {
    candidates.push(framework === "React" ? `src/routes.${extx}` : `src/router/index.${ext}`)
  }

  return candidates
}

export async function detectProject(fs: GitflowFileSystem, projectRoot: string): Promise<DetectResult> {
  const normalizedRoot = normalizeDir(projectRoot)
  const pkgPath = joinPath(normalizedRoot, "package.json")
  if (!(await fs.exists(pkgPath))) {
    throw new Error(`未找到 package.json: ${pkgPath}\n请在 Vite 子项目目录下运行此命令`)
  }

  const pkgContent = await fs.read(pkgPath)
  if (!pkgContent) {
    throw new Error(`无法读取 package.json: ${pkgPath}`)
  }

  const pkg = JSON.parse(pkgContent) as {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  const framework = detectFramework(allDeps)
  const bundler = await detectBundler(fs, normalizedRoot, allDeps)
  const language: GitflowLanguage = (await fs.exists(joinPath(normalizedRoot, "tsconfig.json")))
    ? "TypeScript"
    : "JavaScript"
  const routeCandidates = await findRouteFiles(fs, normalizedRoot, framework, language)
  const workspace = await detectPnpmWorkspace(fs, normalizedRoot, pkg)
  const subprojectPackageManager = await detectPackageManager(fs, normalizedRoot)
  const hasPackageLock = await detectHasPackageLock(fs, normalizedRoot)
  const nodeVersion = await detectNodeVersion(fs, normalizedRoot, workspace.workspaceRoot, pkg)
  const pythonVersion = await detectPythonVersion(fs, normalizedRoot, workspace.workspaceRoot)
  const projectDirName = basename(normalizedRoot) || pkg.name || "project"
  const defaultDomain = `www.${projectDirName}.com`
  const packageManagerVersions = await detectPackageManagerVersions(
    fs,
    normalizedRoot,
    workspace.workspaceRoot,
    pkg,
  )

  return {
    framework,
    bundler,
    language,
    routeCandidates,
    projectRoot: normalizedRoot,
    subprojectPackageManager,
    hasPackageLock,
    nodeVersion,
    pythonVersion,
    projectDirName,
    defaultDomain,
    packageManagerVersions,
    ...workspace,
  }
}
