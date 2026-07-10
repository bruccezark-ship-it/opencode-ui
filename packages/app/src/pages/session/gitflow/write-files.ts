import type { DirectorySDK } from "@/context/sdk"
import { resolveDeployNodeRuntime } from "@/pages/session/cos-deploy-runner"
import { formatServerError } from "@/utils/server-errors"

const GITFLOW_PTY_TITLE = "__opencode_gitflow_write__"
const TEMP_DIR = ".opencode-gitflow-write"
const POLL_INTERVAL_MS = 500
const MAX_WAIT_MS = 120_000
const BASE64_CHUNK_SIZE = 1200

function normalizeDeployPath(path: string) {
  return path.replace(/\\/g, "/")
}

function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "")
}

/** 用 opencode serve 已知的 directory 推导项目根，避免浏览器拼的绝对路径在服务端无效 */
export function resolveServeProjectRoot(
  directory: string,
  projectRoot: string,
  projectRelativeDir?: string,
) {
  const serveDirectory = normalizeDeployPath(directory)
  const relative = projectRelativeDir?.replace(/^\/+|\/+$/g, "")
  if (relative) return `${serveDirectory}/${relative}`

  const normalizedRoot = normalizeDeployPath(projectRoot)
  if (normalizedRoot === serveDirectory) return serveDirectory
  return normalizedRoot
}

function resolveRuntimes() {
  const custom = import.meta.env.VITE_GITFLOW_NODE_RUNTIME?.trim()
  if (custom) return [custom]
  return [resolveDeployNodeRuntime() || "node"]
}

async function waitForPtyExit(client: DirectorySDK["client"], ptyId: string) {
  const started = Date.now()

  while (Date.now() - started < MAX_WAIT_MS) {
    const response = await client.pty.get({ ptyID: ptyId }).catch(() => undefined)
    const info = response?.data

    if (!info) {
      // opencode serve 对 node -e 短命令会立即退出并移除 PTY，此时 get 返回 404，不代表失败。
      if (Date.now() - started >= 300) return { exitCode: 0 }
    } else if (info.status === "exited") {
      return { exitCode: info.exitCode ?? 0 }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  await client.pty.remove({ ptyID: ptyId }).catch(() => {})
  throw new Error("写入文件超时")
}

function utf8ToBase64(content: string) {
  const bytes = new TextEncoder().encode(content)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function splitBase64(value: string) {
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += BASE64_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + BASE64_CHUNK_SIZE))
  }
  return chunks.length > 0 ? chunks : [""]
}

export function buildGitflowManifest(files: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalizeRelativePath(path), utf8ToBase64(content)]),
  )
}

export function buildBinaryManifest(files: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(files).map(([path, base64]) => [normalizeRelativePath(path), base64]),
  )
}

function buildRootedScript(projectRoot: string, body: string) {
  return [
    'const fs=require("fs")',
    'const path=require("path")',
    `const ROOT=${JSON.stringify(normalizeDeployPath(projectRoot))}`,
    body,
  ].join(";")
}

async function runPtyScript(input: {
  client: DirectorySDK["client"]
  directory: string
  script: string
  errorMessage: string
}) {
  const runtimes = resolveRuntimes()
  let lastError: Error | undefined

  for (const runtime of runtimes) {
    const created = await input.client.pty
      .create({
        directory: input.directory,
        command: runtime,
        args: ["-e", input.script],
        title: GITFLOW_PTY_TITLE,
      })
      .catch((error) => {
        lastError = new Error(`${input.errorMessage}: ${formatServerError(error)}`)
        return undefined
      })

    const pty = created?.data
    if (!pty) continue

    const exit = await waitForPtyExit(input.client, pty.id)
    await input.client.pty.remove({ ptyID: pty.id }).catch(() => {})

    if (exit.exitCode === 0 || exit.exitCode === undefined) return

    lastError = new Error(`${input.errorMessage} (exit ${exit.exitCode}, runtime ${runtime})`)
  }

  throw lastError ?? new Error(input.errorMessage)
}

async function writeHostManifest(input: {
  client: DirectorySDK["client"]
  directory: string
  projectRoot: string
  projectRelativeDir?: string
  manifest: Record<string, string>
  tempDirPrefix: string
  finalizeErrorMessage: string
}) {
  const serveProjectRoot = resolveServeProjectRoot(
    input.directory,
    input.projectRoot,
    input.projectRelativeDir,
  )
  const sessionId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const tempDir = `${input.tempDirPrefix}/${sessionId}`
  const manifestPayload = utf8ToBase64(JSON.stringify(input.manifest))
  const chunks = splitBase64(manifestPayload)

  await runPtyScript({
    client: input.client,
    directory: input.directory,
    script: buildRootedScript(
      serveProjectRoot,
      `fs.mkdirSync(path.join(ROOT, ${JSON.stringify(tempDir)}), { recursive: true })`,
    ),
    errorMessage: "无法在 opencode serve 上准备写入目录",
  })

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!
    const payloadPath = pathExpr(tempDir, "manifest.b64")
    const script =
      index === 0
        ? buildRootedScript(serveProjectRoot, `fs.writeFileSync(${payloadPath}, ${JSON.stringify(chunk)})`)
        : buildRootedScript(serveProjectRoot, `fs.appendFileSync(${payloadPath}, ${JSON.stringify(chunk)})`)

    await runPtyScript({
      client: input.client,
      directory: input.directory,
      script,
      errorMessage: "无法上传生成文件到 opencode serve",
    })
  }

  const finalizeScript = buildRootedScript(
    serveProjectRoot,
    [
      `const raw=fs.readFileSync(${pathExpr(tempDir, "manifest.b64")}, "utf8")`,
      'const manifest=JSON.parse(Buffer.from(raw, "base64").toString("utf8"))',
      "for (const [rel, encoded] of Object.entries(manifest)) {",
      "  const full=path.join(ROOT, rel)",
      "  fs.mkdirSync(path.dirname(full), { recursive: true })",
      '  fs.writeFileSync(full, Buffer.from(encoded, "base64"))',
      "}",
      `fs.rmSync(path.join(ROOT, ${JSON.stringify(tempDir)}), { recursive: true, force: true })`,
    ].join(";"),
  )

  await runPtyScript({
    client: input.client,
    directory: input.directory,
    script: finalizeScript,
    errorMessage: input.finalizeErrorMessage,
  })
}

/**
 * 通过 opencode serve 的 PTY 在服务端机器写入文件。
 * directory = SDK 会话目录；脚本内用 ROOT 绝对路径写文件，不依赖 PTY cwd。
 */
export async function writeGitflowFiles(input: {
  client: DirectorySDK["client"]
  directory: string
  projectRoot: string
  projectRelativeDir?: string
  files: Record<string, string>
}) {
  await writeHostManifest({
    client: input.client,
    directory: input.directory,
    projectRoot: input.projectRoot,
    projectRelativeDir: input.projectRelativeDir,
    manifest: buildGitflowManifest(input.files),
    tempDirPrefix: TEMP_DIR,
    finalizeErrorMessage: `无法写入文件 (${Object.keys(input.files).join(", ")})`,
  })
}

const HOST_BINARY_TEMP_DIR = ".opencode-host-write"

/** 通过 PTY 将 base64 编码的二进制文件写入宿主机项目目录。 */
export async function writeHostBinaryFiles(input: {
  client: DirectorySDK["client"]
  directory: string
  projectRoot: string
  projectRelativeDir?: string
  files: Record<string, string>
}) {
  await writeHostManifest({
    client: input.client,
    directory: input.directory,
    projectRoot: input.projectRoot,
    projectRelativeDir: input.projectRelativeDir,
    manifest: buildBinaryManifest(input.files),
    tempDirPrefix: HOST_BINARY_TEMP_DIR,
    finalizeErrorMessage: `无法写入文件 (${Object.keys(input.files).join(", ")})`,
  })
}

function pathExpr(tempDir: string, name: string) {
  return `path.join(ROOT, ${JSON.stringify(`${tempDir}/${name}`)})`
}
