import type { PackageJson } from "./preview-url"
import { extractPortFromViteConfig, previewHostFromServer } from "./preview-url"
import { parseScriptCwd } from "./preview-structure"

export const PREVIEW_PTY_TITLE = "__opencode_preview__"
export const PREVIEW_START_TIMEOUT_MS = 120_000

export type ProjectKind = "node" | "static" | "python" | "unknown"
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

export type ProjectStructure = {
  kind: ProjectKind
  rootDir: string
  rootFiles: string[]
  workspaceRootFiles: string[]
  packageJson: PackageJson | null
  workspacePackageJson: PackageJson | null
  viteConfig: string | null
}

export type PreviewStartPlan = {
  kind: ProjectKind
  label: string
  url: string
  port: number
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  /** Vite projects use the UI preview proxy for element picking (does not affect the start command). */
  useInspector?: boolean
}

export function detectPackageManager(input: {
  packageJson?: PackageJson | null
  workspacePackageJson?: PackageJson | null
  rootFiles: string[]
  workspaceRootFiles?: string[]
}) {
  const files = new Set([...(input.workspaceRootFiles ?? []), ...input.rootFiles].map((name) => name.toLowerCase()))
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun" as const
  if (files.has("pnpm-lock.yaml")) return "pnpm" as const
  if (files.has("yarn.lock")) return "yarn" as const
  if (files.has("package-lock.json")) return "npm" as const

  const manager = input.packageJson?.packageManager?.split("@")[0]
  if (manager === "bun" || manager === "pnpm" || manager === "yarn" || manager === "npm") return manager

  const workspaceManager = input.workspacePackageJson?.packageManager?.split("@")[0]
  if (workspaceManager === "bun" || workspaceManager === "pnpm" || workspaceManager === "yarn" || workspaceManager === "npm") {
    return workspaceManager
  }

  return "npm" as const
}

export function resolveDevScriptName(scripts: Record<string, string> | undefined) {
  if (!scripts) return
  if (scripts.dev) return "dev"
  if (scripts.serve) return "serve"
  if (scripts.start) return "start"
  if (scripts.preview) return "preview"
}

export function buildPackageManagerRun(manager: PackageManager, script: string, extraArgs: string[] = []) {
  switch (manager) {
    case "bun":
      return { command: "bun", args: ["run", script, ...extraArgs] }
    case "pnpm":
      return { command: "pnpm", args: ["run", script, ...extraArgs] }
    case "yarn":
      return { command: "yarn", args: [script, ...extraArgs] }
    default:
      return { command: "npm", args: ["run", script, ...extraArgs] }
  }
}

export function usesVite(input: { packageJson?: PackageJson | null; viteConfig?: string | null; script?: string }) {
  const deps = { ...input.packageJson?.dependencies, ...input.packageJson?.devDependencies }
  return Boolean(
    input.viteConfig ||
      deps?.vite ||
      deps?.["@vitejs/plugin-react"] ||
      input.script?.includes("vite"),
  )
}

export function usesNext(input: { packageJson?: PackageJson | null; script?: string }) {
  const deps = { ...input.packageJson?.dependencies, ...input.packageJson?.devDependencies }
  return Boolean(deps?.next || input.script?.includes("next"))
}

export function buildDevScriptExtraArgs(input: {
  remote: boolean
  packageJson?: PackageJson | null
  viteConfig?: string | null
  script?: string
  previewPort: number
}) {
  const flags: string[] = []
  if (input.remote && usesVite(input)) flags.push("--host")
  if (input.remote && usesNext(input)) flags.push("-H", "0.0.0.0")
  const configPort = input.viteConfig ? extractPortFromViteConfig(input.viteConfig) : undefined
  if (configPort && input.previewPort !== configPort) {
    flags.push("--port", String(input.previewPort), "--strictPort")
  }
  if (flags.length === 0) return []
  return ["--", ...flags]
}

export function previewLaunchPlatform(serverUrl: string) {
  if (previewHostFromServer(serverUrl) !== "localhost") return "unix" as const
  if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)) return "windows" as const
  return "unix" as const
}

export function formatPreviewShellCommand(input: { command: string; args: string[]; cwd?: string }) {
  const run = [input.command, ...input.args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ")
  if (!input.cwd) return run
  return `cd "${input.cwd}" && ${run}`
}

export function buildPreviewPtyLaunch(plan: PreviewStartPlan, platform: "windows" | "unix") {
  const script = formatPreviewShellCommand(plan)
  if (platform === "windows") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", script],
      env: plan.env,
    }
  }
  return {
    command: "sh",
    args: ["-lc", script],
    env: plan.env,
  }
}

function remoteDevEnv(remote: boolean) {
  if (!remote) return undefined
  return {
    HOST: "0.0.0.0",
    NUXT_HOST: "0.0.0.0",
  }
}

function previewEnv(remote: boolean) {
  return {
    BROWSER: "none",
    ...(remoteDevEnv(remote) ?? {}),
  }
}

function resolveNodeStartPlan(input: {
  structure: ProjectStructure
  host: string
  remote: boolean
  preview: { url: string; port: number }
  cwd?: string
  scriptPackageJson: PackageJson
  script: string
  label: string
}) {
  const scripts = input.scriptPackageJson.scripts ?? {}
  const devScript = scripts[input.script] ?? input.script
  const vite = usesVite({
    packageJson: input.structure.packageJson,
    viteConfig: input.structure.viteConfig,
    script: devScript,
  })
  const manager = detectPackageManager({
    packageJson: input.scriptPackageJson,
    workspacePackageJson: input.structure.workspacePackageJson,
    rootFiles: input.structure.rootFiles,
    workspaceRootFiles: input.structure.workspaceRootFiles,
  })
  const run = buildPackageManagerRun(
    manager,
    input.script,
    buildDevScriptExtraArgs({
      remote: input.remote,
      packageJson: input.structure.packageJson,
      viteConfig: input.structure.viteConfig,
      script: devScript,
      previewPort: input.preview.port,
    }),
  )

  return {
    kind: "node" as const,
    label: input.label,
    url: input.preview.url,
    port: input.preview.port,
    command: run.command,
    args: run.args,
    cwd: input.cwd,
    env: previewEnv(input.remote),
    useInspector: vite,
  }
}

export function detectProjectKind(rootFiles: string[], packageJson: PackageJson | null) {
  const files = new Set(rootFiles.map((name) => name.toLowerCase()))
  if (packageJson) return "node" as const
  if (files.has("index.html")) return "static" as const
  if (files.has("manage.py") || files.has("pyproject.toml") || files.has("requirements.txt")) return "python" as const
  return "unknown" as const
}

export function resolvePreviewStartPlan(input: {
  structure: ProjectStructure
  host: string
  remote: boolean
  preview: { url: string; port: number }
}): PreviewStartPlan | undefined {
  const { structure, host, remote, preview } = input

  if (structure.kind === "node" && structure.packageJson) {
    const workspace = structure.workspacePackageJson
    const workspaceDev = workspace?.scripts?.dev ?? workspace?.scripts?.start
    const delegatedCwd = workspaceDev ? parseScriptCwd(workspaceDev) : undefined
    const workspaceScript = workspace ? resolveDevScriptName(workspace.scripts ?? {}) : undefined

    if (
      structure.rootDir &&
      delegatedCwd === structure.rootDir &&
      workspace &&
      workspaceScript
    ) {
      return resolveNodeStartPlan({
        structure,
        host,
        remote,
        preview,
        cwd: undefined,
        scriptPackageJson: workspace,
        script: workspaceScript,
        label: `${detectPackageManager({
          packageJson: workspace,
          workspacePackageJson: workspace,
          rootFiles: structure.workspaceRootFiles,
          workspaceRootFiles: structure.workspaceRootFiles,
        })} run ${workspaceScript}`,
      })
    }

    const scripts = structure.packageJson.scripts ?? {}
    const script = resolveDevScriptName(scripts)
    if (!script) return

    return resolveNodeStartPlan({
      structure,
      host,
      remote,
      preview,
      cwd: structure.rootDir || undefined,
      scriptPackageJson: structure.packageJson,
      script,
      label: structure.rootDir ? `${detectPackageManager({
        packageJson: structure.packageJson,
        workspacePackageJson: structure.workspacePackageJson,
        rootFiles: structure.rootFiles,
        workspaceRootFiles: structure.workspaceRootFiles,
      })} run ${script} (${structure.rootDir})` : `${detectPackageManager({
        packageJson: structure.packageJson,
        workspacePackageJson: structure.workspacePackageJson,
        rootFiles: structure.rootFiles,
        workspaceRootFiles: structure.workspaceRootFiles,
      })} run ${script}`,
    })
  }

  if (structure.kind === "static") {
    return {
      kind: "static",
      label: "npx serve",
      url: preview.url,
      port: preview.port,
      command: "npx",
      args: ["--yes", "serve", "-l", String(preview.port)],
      env: previewEnv(remote),
    }
  }

  if (structure.kind === "python" && structure.rootFiles.some((file) => file === "manage.py")) {
    return {
      kind: "python",
      label: "python manage.py runserver",
      url: preview.url,
      port: preview.port,
      command: "python",
      args: ["manage.py", "runserver", `${remote ? "0.0.0.0" : host}:${preview.port}`],
      env: previewEnv(remote),
    }
  }

  return undefined
}

export type PreviewRunPhase = "idle" | "checking" | "starting" | "waiting" | "ready" | "failed"

export function previewPhaseMessageKey(phase: PreviewRunPhase) {
  switch (phase) {
    case "checking":
      return "session.preview.checking"
    case "starting":
      return "session.preview.starting"
    case "waiting":
      return "session.preview.waiting"
    case "failed":
      return "session.preview.failed"
    default:
      return undefined
  }
}
