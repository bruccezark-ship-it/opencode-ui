import { buildPromptConfig, type GitflowPromptInput } from "./prompts.js"
import type { DetectResult, GitflowConfig } from "./types.js"

export type GitflowUserInput = GitflowPromptInput

export function buildGitflowConfig(detected: DetectResult, input: GitflowUserInput = {}): GitflowConfig {
  const prompt = buildPromptConfig(detected, input)

  return {
    routesFile: prompt.routesFile,
    branch: prompt.branch,
    domain: prompt.domain,
    protocol: prompt.protocol,
    nodeVersion: prompt.nodeVersion,
    pythonVersion: prompt.pythonVersion,
    pnpmVersion: prompt.pnpmVersion,
    npmVersion: prompt.npmVersion,
    yarnVersion: prompt.yarnVersion,
    installCmd: prompt.installCmd,
    buildCmd: prompt.buildCmd,
    installWorkingDirectory: prompt.installWorkingDirectory,
    buildWorkingDirectory: prompt.buildWorkingDirectory,
    framework: prompt.framework,
    bundler: prompt.bundler,
    language: prompt.language,
    isMonorepo: prompt.isMonorepo,
    subprojectPath: prompt.subprojectPath,
    packageName: prompt.packageName,
    subprojectPackageManager: prompt.subprojectPackageManager,
    hasPackageLock: prompt.hasPackageLock,
    distDir: prompt.distDir,
    sitemapScript: prompt.sitemapScript,
    htmlMdScript: prompt.htmlMdScript,
  }
}
