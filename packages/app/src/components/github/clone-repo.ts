import type { DirectorySDK } from "@/context/sdk"
import { resolveDeployNodeRuntime } from "@/pages/session/cos-deploy-runner"
import { GITHUB_CLONE_PTY_TITLE } from "./constants"

const POLL_INTERVAL_MS = 500
const MAX_WAIT_MS = 300_000

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

function joinPath(base: string, segment: string) {
  const normalizedBase = normalizePath(base)
  const normalizedSegment = segment.replace(/^\/+|\/+$/g, "")
  return `${normalizedBase}/${normalizedSegment}`
}

async function waitForPtyExit(client: DirectorySDK["client"], ptyId: string) {
  const started = Date.now()

  while (Date.now() - started < MAX_WAIT_MS) {
    const response = await client.pty.get({ ptyID: ptyId }).catch(() => undefined)
    const info = response?.data

    if (!info) {
      if (Date.now() - started >= 300) return { exitCode: 0 }
    } else if (info.status === "exited") {
      return { exitCode: info.exitCode ?? 0 }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  await client.pty.remove({ ptyID: ptyId }).catch(() => {})
  throw new Error("git clone timed out")
}

function buildCloneScript(targetDirectory: string, repoName: string, cloneUrl: string) {
  return [
    'const fs=require("fs")',
    'const path=require("path")',
    'const cp=require("child_process")',
    `const ROOT=${JSON.stringify(normalizePath(targetDirectory))}`,
    `const REPO=${JSON.stringify(repoName)}`,
    `const URL=${JSON.stringify(cloneUrl)}`,
    "const dest=path.join(ROOT, REPO)",
    "if (fs.existsSync(dest)) process.exit(0)",
    'const result=cp.spawnSync("git", ["clone", "--depth", "1", URL, REPO], { cwd: ROOT, stdio: "inherit", shell: process.platform==="win32" })',
    "process.exit(result.status ?? 1)",
  ].join(";")
}

export async function resolveGitHubProjectPath(input: {
  client: DirectorySDK["client"]
  serveDirectory: string
  targetDirectory: string
  repoName: string
  cloneUrl: string
}) {
  const targetDirectory = normalizePath(input.targetDirectory)
  const projectPath = joinPath(targetDirectory, input.repoName)
  const runtime = resolveDeployNodeRuntime() || "node"

  const created = await input.client.pty
    .create({
      directory: input.serveDirectory,
      command: runtime,
      args: ["-e", buildCloneScript(targetDirectory, input.repoName, input.cloneUrl)],
      title: GITHUB_CLONE_PTY_TITLE,
    })
    .catch(() => undefined)

  const pty = created?.data
  if (!pty) throw new Error("Failed to start git clone")

  const exit = await waitForPtyExit(input.client, pty.id)
  await input.client.pty.remove({ ptyID: pty.id }).catch(() => {})

  if (exit.exitCode !== 0 && exit.exitCode !== undefined) {
    throw new Error(`git clone failed (exit ${exit.exitCode})`)
  }

  return projectPath
}
