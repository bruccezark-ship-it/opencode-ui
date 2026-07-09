import { buildGitflowConfig, type GitflowUserInput } from "./config.js"
import { resolveGitflowCommands } from "./commands.js"
import { buildPromptConfig, resolveRoutesFile, type GitflowPromptInput } from "./prompts.js"
import { detectProject } from "./detect.js"
import { parseRoutesFromContent } from "./parse-routes.js"
import type { GitflowFileSystem } from "./filesystem.js"
import { generateHtmlMdScript } from "./generate-html-md-script.js"
import { generateSitemapScript } from "./generate-sitemap-script.js"
import { generateWorkflowYaml } from "./generate-workflow.js"
import type { DetectResult, GeneratedGitflowFiles, GitflowConfig, GitflowOutputPaths } from "./types.js"
import { GITFLOW_OUTPUT_PATHS } from "./types.js"

export function generateGitflowFiles(cfg: GitflowConfig): GeneratedGitflowFiles {
  return {
    workflow: generateWorkflowYaml(cfg),
    sitemapScript: generateSitemapScript(cfg),
    htmlMdScript: generateHtmlMdScript(cfg),
  }
}

export async function runGitflowDetection(fs: GitflowFileSystem, projectRoot: string): Promise<DetectResult> {
  const detected = await detectProject(fs, projectRoot)
  if (detected.framework === "Unknown") {
    detected.framework = "General"
  }
  return detected
}

export function createGitflowConfig(detected: DetectResult, input?: GitflowUserInput): GitflowConfig {
  return buildGitflowConfig(detected, input)
}

export { buildGitflowConfig, buildPromptConfig, detectProject, GITFLOW_OUTPUT_PATHS, parseRoutesFromContent, resolveGitflowCommands, resolveRoutesFile }
export type { GitflowPromptInput }
export type {
  DetectResult,
  GeneratedGitflowFiles,
  GitflowConfig,
  GitflowFileSystem,
  GitflowOutputPaths,
  GitflowUserInput,
}
