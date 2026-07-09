import type { DetectResult, GitflowPackageManager } from "./types.js"

export type GitflowCommands = {
  installCmd: string
  buildCmd: string
  installWorkingDirectory: string
  buildWorkingDirectory: string
}

/**
 * 与 D:\self_cli\gitflow\src\prompts.mjs 保持一致的命令推导逻辑。
 */
export function resolveGitflowCommands(
  detected: DetectResult,
  packageManager: GitflowPackageManager,
): GitflowCommands {
  const isMonorepo = detected.isWorkspace && detected.isSubproject

  if (isMonorepo) {
    if (packageManager === "npm") {
      return {
        installCmd: "npm ci",
        buildCmd: "npm run build",
        installWorkingDirectory: detected.subprojectPath,
        buildWorkingDirectory: detected.subprojectPath,
      }
    }

    const filterTarget = detected.packageName || `./${detected.subprojectPath}`
    return {
      installCmd: "pnpm install --frozen-lockfile",
      buildCmd: `pnpm --filter ${filterTarget} build`,
      installWorkingDirectory: "",
      buildWorkingDirectory: "",
    }
  }

  if (packageManager === "pnpm") {
    return {
      installCmd: "pnpm install --frozen-lockfile",
      buildCmd: "pnpm run build",
      installWorkingDirectory: "",
      buildWorkingDirectory: "",
    }
  }

  if (packageManager === "yarn") {
    return {
      installCmd: "yarn install --frozen-lockfile",
      buildCmd: "yarn build",
      installWorkingDirectory: "",
      buildWorkingDirectory: "",
    }
  }

  return {
    installCmd: detected.hasPackageLock ? "npm ci" : "npm install",
    buildCmd: "npm run build",
    installWorkingDirectory: "",
    buildWorkingDirectory: "",
  }
}

function resolvePackageManager(input: string | undefined, detected: GitflowPackageManager, isMonorepo: boolean) {
  const allowed = isMonorepo ? (["npm", "pnpm"] as const) : (["npm", "pnpm", "yarn"] as const)
  const normalized = (input || "").toLowerCase()
  return (allowed as readonly string[]).includes(normalized) ? (normalized as GitflowPackageManager) : detected
}

export function resolveRoutesFile(detected: DetectResult, input?: string) {
  const trimmed = input?.trim()
  if (trimmed) return trimmed

  if (detected.routeCandidates.length > 0) {
    return detected.routeCandidates[0]
  }

  return detected.framework === "React" || detected.framework === "General"
    ? "src/routes.tsx"
    : "src/router/index.ts"
}

export function resolveRoutesFileFromChoice(detected: DetectResult, choice: string) {
  const trimmed = choice.trim()
  if (!trimmed) return resolveRoutesFile(detected)

  const index = Number.parseInt(trimmed, 10)
  if (
    !Number.isNaN(index) &&
    index >= 1 &&
    index <= detected.routeCandidates.length
  ) {
    return detected.routeCandidates[index - 1]
  }

  return trimmed
}

export type GitflowPromptInput = {
  routesFile?: string
  branch?: string
  domain?: string
  protocol?: "http" | "https"
  nodeVersion?: string
  pythonVersion?: string
  subprojectPackageManager?: GitflowPackageManager
  pnpmVersion?: string
  npmVersion?: string
  yarnVersion?: string
}

/**
 * 将 detect + 用户输入组装为与 gitflow CLI promptUser 相同结构的配置字段。
 */
export function buildPromptConfig(detected: DetectResult, input: GitflowPromptInput = {}) {
  const isMonorepo = detected.isWorkspace && detected.isSubproject
  const subprojectPackageManager = resolvePackageManager(
    input.subprojectPackageManager,
    detected.subprojectPackageManager,
    isMonorepo,
  )
  const commands = resolveGitflowCommands(detected, subprojectPackageManager)

  return {
    routesFile: resolveRoutesFile(detected, input.routesFile),
    branch: input.branch?.trim() || "master",
    domain: input.domain?.trim() || detected.defaultDomain,
    protocol: input.protocol === "http" ? ("http" as const) : ("https" as const),
    nodeVersion: input.nodeVersion?.trim() || detected.nodeVersion,
    pythonVersion: input.pythonVersion?.trim() || detected.pythonVersion,
    pnpmVersion: input.pnpmVersion?.trim() || detected.packageManagerVersions.pnpm,
    npmVersion: input.npmVersion?.trim() || detected.packageManagerVersions.npm,
    yarnVersion: input.yarnVersion?.trim() || detected.packageManagerVersions.yarn,
    subprojectPackageManager,
    ...commands,
    framework: detected.framework === "Unknown" ? ("General" as const) : detected.framework,
    bundler: detected.bundler,
    language: detected.language,
    isMonorepo,
    subprojectPath: detected.subprojectPath || "",
    packageName: detected.packageName || "",
    hasPackageLock: detected.hasPackageLock,
    distDir: "./dist",
    sitemapScript: "scripts/generate-sitemap.mjs",
    htmlMdScript: "scripts/generate-html-md.mjs",
  }
}
