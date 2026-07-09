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
