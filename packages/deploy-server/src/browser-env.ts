import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
export const DEFAULT_BROWSERS_PATH = join(packageRoot, "browsers")

export function resolveDeployBrowsersPath(cliScriptPath?: string): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (override) return override.replace(/\\/g, "/")

  if (cliScriptPath) {
    const normalized = cliScriptPath.replace(/\\/g, "/")
    const match = normalized.match(/^(.*)\/(?:src\/cli\.ts|dist\/cli\.js)$/)
    if (match) return `${match[1]}/browsers`
  }

  return DEFAULT_BROWSERS_PATH.replace(/\\/g, "/")
}

export function buildDeployBrowserEnv(cliScriptPath?: string): Record<string, string> {
  return {
    PLAYWRIGHT_BROWSERS_PATH: resolveDeployBrowsersPath(cliScriptPath),
    OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL: "1",
  }
}

export async function chromiumExecutableExists(browsersPath: string): Promise<boolean> {
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath

  try {
    const { chromium } = await import("playwright-core")
    const executablePath = chromium.executablePath()
    return Boolean(executablePath && existsSync(executablePath))
  } catch {
    return false
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previous
  }
}

/** 在加载 deploy-core 之前调用，固定使用项目内 Chromium 并禁用运行时下载 */
export function initDeployBrowserEnv(): void {
  const env = buildDeployBrowserEnv()
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }
}
