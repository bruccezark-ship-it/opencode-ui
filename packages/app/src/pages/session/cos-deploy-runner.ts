import type { DirectorySDK } from "@/context/sdk"
import type { DeploySseEvent } from "@/pages/session/cos-deploy"
import { previewLaunchPlatform } from "@/pages/session/preview-project"
import { formatServerError } from "@/utils/server-errors"
import { terminalWebSocketURL } from "@/utils/terminal-websocket-url"

const DEPLOY_EVENT_MARKER = "@@DEPLOY@@"
const DEPLOY_INPUT_MARKER = "@@DEPLOY_INPUT@@"
const DEPLOY_PTY_TITLE = "__opencode_cos_deploy__"
const DEPLOY_INPUT_FILE = ".opencode-deploy-input"
const POLL_INTERVAL_MS = 500

type DeployCliCommand = {
  subcommand: "status" | "preview" | "deploy"
  args: string[]
}

type RunDeployCliInput = {
  client: DirectorySDK["client"]
  serverUrl: string
  directory: string
  projectRoot: string
  command: DeployCliCommand
  onEvent?: (event: DeploySseEvent) => void
  onReady?: (send: (action: "verify" | "refresh" | "cancel") => Promise<boolean>) => void
  signal?: AbortSignal
}

type RunDeployCliResult = {
  data?: unknown
  exitCode?: number
}

let activeSendVerification:
  | ((action: "verify" | "refresh" | "cancel") => Promise<boolean>)
  | undefined

export function setActiveDeployVerificationSender(
  sender: ((action: "verify" | "refresh" | "cancel") => Promise<boolean>) | undefined,
) {
  activeSendVerification = sender
}

export async function sendDeployVerification(action: "verify" | "refresh" | "cancel") {
  if (!activeSendVerification) throw new Error("当前没有进行中的发布验证会话")
  const sent = await activeSendVerification(action)
  if (!sent) throw new Error("发布进程连接已断开，无法发送验证指令")
}

function deployCliPath() {
  const script = import.meta.env.VITE_DEPLOY_CLI_SCRIPT
  if (!script) {
    throw new Error("未配置 VITE_DEPLOY_CLI_SCRIPT，请在 .env 中设置 deploy CLI 脚本路径")
  }
  return script
}

export function resolveDeployBrowsersPath(cliScript?: string) {
  const override = import.meta.env.VITE_PLAYWRIGHT_BROWSERS_PATH
  if (override) return override.replace(/\\/g, "/")

  const script = normalizeDeployPath(resolveDeployCliScript(cliScript))
  const match = script.match(/^(.*)\/(?:src\/cli\.ts|dist\/cli\.js)$/)
  if (match) return `${match[1]}/browsers`

  throw new Error("无法从 VITE_DEPLOY_CLI_SCRIPT 推导浏览器目录，请设置 VITE_PLAYWRIGHT_BROWSERS_PATH")
}

export function resolveDeployCliScript(cliScript?: string) {
  const configured = normalizeDeployPath(cliScript ?? deployCliPath())
  if (configured.endsWith("/src/cli.ts")) {
    return configured.replace(/\/src\/cli\.ts$/, "/dist/cli.js")
  }
  return configured
}

export function resolveDeployNodeRuntime() {
  return import.meta.env.VITE_DEPLOY_NODE_RUNTIME?.trim() || "node"
}

export function deployBrowserEnv(cliScript?: string): Record<string, string> {
  return {
    PLAYWRIGHT_BROWSERS_PATH: resolveDeployBrowsersPath(cliScript),
      OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL: "1",
  }
}

function normalizeDeployPath(path: string) {
  return path.replace(/\\/g, "/")
}

function quoteCmdArg(value: string) {
  if (!/[\s"&|^<>]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function quoteShArg(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function formatDeployShellCommand(command: DeployCliCommand, projectRoot: string, scriptPath?: string) {
  const script = resolveDeployCliScript(scriptPath)
  const parts = [
    resolveDeployNodeRuntime(),
    script,
    command.subcommand,
    ...command.args.map((arg) => normalizeDeployPath(arg)),
  ]
  const run = parts.map(quoteCmdArg).join(" ")
  const cwd = quoteCmdArg(normalizeDeployPath(projectRoot))
  return { run, cwd }
}

export function buildDeployPtyLaunch(command: DeployCliCommand, projectRoot: string, _serverUrl: string) {
  const script = resolveDeployCliScript()
  const runtime = resolveDeployNodeRuntime()
  const args = [
    script,
    command.subcommand,
    ...command.args.map((arg) => normalizeDeployPath(arg)),
  ]
  const cwd = normalizeDeployPath(projectRoot)

  // 直接启动 node，避免 shell 包装导致 stdin 无法送达（CDN 验证会卡住）
  return { command: runtime, args, cwd }
}

function buildLaunch(command: DeployCliCommand, projectRoot: string, serverUrl: string) {
  return buildDeployPtyLaunch(command, projectRoot, serverUrl)
}

function stripTerminalControl(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
}

function parseEventPayload(payload: string) {
  const candidates = [payload.trim(), payload.replace(/[\r\n]+/g, "")]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate) as DeploySseEvent | { type: "result"; data: unknown }
    } catch {
      continue
    }
  }
}

function extractEventAfterMarker(cleaned: string, markerAt: number) {
  const jsonStart = cleaned.indexOf("{", markerAt + DEPLOY_EVENT_MARKER.length)
  if (jsonStart === -1) return

  const nextMarker = cleaned.indexOf(DEPLOY_EVENT_MARKER, markerAt + DEPLOY_EVENT_MARKER.length)
  const searchEnd = nextMarker === -1 ? cleaned.length : nextMarker
  const jsonEnd = cleaned.lastIndexOf("}", searchEnd - 1)
  if (jsonEnd <= jsonStart) return

  const parsed = parseEventPayload(cleaned.slice(jsonStart, jsonEnd + 1))
  if (!parsed) return

  return { event: parsed, end: jsonEnd + 1 }
}

export function consumeDeployBuffer(buffer: string) {
  const events: Array<DeploySseEvent | { type: "result"; data: unknown }> = []
  const cleaned = stripTerminalControl(buffer)
  let cursor = 0

  while (cursor < cleaned.length) {
    const markerAt = cleaned.indexOf(DEPLOY_EVENT_MARKER, cursor)
    if (markerAt === -1) break

    const extracted = extractEventAfterMarker(cleaned, markerAt)
    if (!extracted) {
      return { events, rest: cleaned.slice(markerAt) }
    }

    events.push(extracted.event)
    cursor = Math.max(extracted.end, markerAt + DEPLOY_EVENT_MARKER.length)
  }

  return { events, rest: "" }
}

function applyDeployEvents(
  events: Array<DeploySseEvent | { type: "result"; data: unknown }>,
  input: RunDeployCliInput,
  result: RunDeployCliResult,
  reject?: (error: Error) => void,
) {
  for (const payload of events) {
    if (payload.type === "result") {
      result.data = payload.data
      continue
    }

    input.onEvent?.(payload)
    if (payload.type === "error") {
      reject?.(new Error(payload.message))
      return false
    }
  }

  return true
}

async function waitForPtyExit(client: DirectorySDK["client"], ptyId: string, signal?: AbortSignal) {
  while (!signal?.aborted) {
    const response = await client.pty.get({ ptyID: ptyId }).catch(() => undefined)
    const info = response?.data
    if (!info) return { exitCode: 1 }
    if (info.status === "exited") return { exitCode: info.exitCode }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return { exitCode: undefined }
}

export function buildDeployCliArgs(input: Record<string, string | boolean | undefined>) {
  const args: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === false || value === "") continue
    if (value === true) {
      args.push(`--${key}`)
      continue
    }
    args.push(`--${key}`, String(value))
  }
  return args
}

async function appendDeployInputViaFile(
  client: DirectorySDK["client"],
  directory: string,
  projectRoot: string,
  action: "verify" | "refresh" | "cancel",
) {
  const line = `${DEPLOY_INPUT_MARKER}${JSON.stringify({ action })}\n`
  const cwd = normalizeDeployPath(projectRoot)
  const script = [
    "const fs=require('node:fs')",
    "const path=require('node:path')",
    `fs.appendFileSync(path.join(process.cwd(), ${JSON.stringify(DEPLOY_INPUT_FILE)}), ${JSON.stringify(line)})`,
  ].join(";")

  const created = await client.pty
    .create({
      directory,
      command: resolveDeployNodeRuntime(),
      args: ["-e", script],
      cwd,
      title: "__opencode_deploy_input__",
    })
    .catch(() => undefined)

  const pty = created?.data
  if (!pty) return false

  const exit = await waitForPtyExit(client, pty.id)
  await client.pty.remove({ ptyID: pty.id }).catch(() => {})
  return exit.exitCode === 0 || exit.exitCode === undefined
}

export async function runDeployCli(input: RunDeployCliInput): Promise<RunDeployCliResult> {
  const launch = buildLaunch(input.command, input.projectRoot, input.serverUrl)
  const created = await input.client.pty
    .create({
      directory: input.directory,
      command: launch.command,
      args: launch.args,
      cwd: "cwd" in launch ? launch.cwd : normalizeDeployPath(input.projectRoot),
      title: DEPLOY_PTY_TITLE,
      env: deployBrowserEnv(),
    })
    .catch((error) => {
      throw new Error(formatServerError(error, undefined, "无法创建发布进程"))
    })

  const pty = created.data
  if (!pty) throw new Error("无法创建发布进程")

  let buffer = ""
  let rawOutput = ""
  let result: RunDeployCliResult = {}
  let socket: WebSocket | undefined
  let disposed = false

  const cleanup = async () => {
    if (disposed) return
    disposed = true
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close(1000)
    }
    await input.client.pty.remove({ ptyID: pty.id }).catch(() => {})
  }

  const abort = () => {
    void cleanup()
  }

  input.signal?.addEventListener("abort", abort, { once: true })

  try {
    const ticket = await input.client.pty
      .connectToken({ ptyID: pty.id, directory: input.directory }, { throwOnError: false })
      .then((response) => response.data?.ticket)
      .catch(() => undefined)

    await new Promise<void>((resolve, reject) => {
      socket = new WebSocket(
        terminalWebSocketURL({
          url: input.serverUrl,
          id: pty.id,
          directory: input.directory,
          cursor: 0,
          ticket,
        }),
      )

      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new Error("发布进程连接失败")), { once: true })
    })

    const sendInput = async (action: "verify" | "refresh" | "cancel") => {
      let sent = false
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(`${DEPLOY_INPUT_MARKER}${JSON.stringify({ action })}\r\n`)
        sent = true
      }

      if (input.command.subcommand === "deploy") {
        const fileSent = await appendDeployInputViaFile(
          input.client,
          input.directory,
          input.projectRoot,
          action,
        )
        return sent || fileSent
      }

      return sent
    }

    input.onReady?.(sendInput)

    const messagePromise = new Promise<void>((resolve, reject) => {
      if (!socket) return resolve()

      const ingest = (chunk: string, final = false) => {
        if (chunk) {
          rawOutput += chunk
          buffer += chunk
        }

        const parsed = consumeDeployBuffer(buffer)
        buffer = final ? "" : parsed.rest
        if (!applyDeployEvents(parsed.events, input, result, reject)) return

        if (final && buffer.trim()) {
          const trailing = consumeDeployBuffer(buffer)
          applyDeployEvents(trailing.events, input, result, reject)
        }
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) return
        const chunk = typeof event.data === "string" ? event.data : ""
        if (!chunk) return
        ingest(chunk)
      }

      socket.addEventListener("message", handleMessage)
      socket.addEventListener("close", () => {
        ingest("", true)
        resolve()
      }, { once: true })
    })

    const [exit] = await Promise.all([waitForPtyExit(input.client, pty.id, input.signal), messagePromise])
    result.exitCode = exit.exitCode

    if (buffer.trim()) {
      const trailing = consumeDeployBuffer(`${buffer}\n`)
      applyDeployEvents(trailing.events, input, result)
    }

    if (
      (input.command.subcommand === "status" || input.command.subcommand === "preview") &&
      result.data === undefined
    ) {
      const snippet = stripTerminalControl(rawOutput).trim().slice(-400)
      throw new Error(
        `发布 CLI 未返回结果（exitCode: ${result.exitCode ?? "unknown"}）${snippet ? `：${snippet}` : ""}`,
      )
    }

    return result
  } finally {
    input.signal?.removeEventListener("abort", abort)
    await cleanup()
  }
}
