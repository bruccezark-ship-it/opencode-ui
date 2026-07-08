#!/usr/bin/env bun
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromiumExecutableExists, DEFAULT_BROWSERS_PATH } from "../src/browser-env.ts"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const browsersPath = DEFAULT_BROWSERS_PATH

async function installChromium(): Promise<void> {
  const require = createRequire(import.meta.url)
  const cliPath = join(dirname(require.resolve("playwright-core/package.json")), "cli.js")

  console.log(`正在安装 Chromium 到 ${browsersPath}（首次约 150MB）...`)

  const proc = Bun.spawn([process.execPath, cliPath, "install", "chromium"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
    stdio: ["inherit", "inherit", "inherit"],
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`playwright install chromium 失败（exit ${exitCode}）`)
  }
}

async function main() {
  if (process.env.SKIP_BROWSER_SETUP === "1") {
    console.log("SKIP_BROWSER_SETUP=1，跳过 Chromium 安装")
    return
  }

  if (await chromiumExecutableExists(browsersPath)) {
    console.log(`Chromium 已就绪：${browsersPath}`)
    return
  }

  await installChromium()

  if (!(await chromiumExecutableExists(browsersPath))) {
    throw new Error(`Chromium 安装后仍不可用，请检查目录：${browsersPath}`)
  }

  console.log("Chromium 安装完成")
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
