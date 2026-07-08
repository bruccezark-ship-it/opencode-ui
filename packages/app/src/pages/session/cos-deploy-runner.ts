import type { DirectorySDK } from "@/context/sdk"
import type { DeploySseEvent, UndeploySseEvent } from "@/pages/session/cos-deploy"
import type { ServerDeploySseEvent } from "@/pages/session/server-deploy"
import { previewLaunchPlatform } from "@/pages/session/preview-project"
import { formatServerError } from "@/utils/server-errors"
import { terminalWebSocketURL } from "@/utils/terminal-websocket-url"

const DEPLOY_EVENT_MARKER = "@@DEPLOY@@"
const DEPLOY_INPUT_MARKER = "@@DEPLOY_INPUT@@"
const DEPLOY_PTY_TITLE = "__opencode_cos_deploy__"
const DEPLOY_INPUT_FILE = ".opencode-deploy-input"
const SERVER_DEPLOY_CREDS_FILE = ".opencode-server-deploy-creds.json"
const POLL_INTERVAL_MS = 500

type DeployCliCommand = {
  subcommand:
    | "status"
    | "preview"
    | "deploy"
    | "domains"
    | "undeploy"
    | "server-config"
    | "server-deploy"
  args: string[]
}

type RunDeployCliInput = {
  client: DirectorySDK["client"]
  serverUrl: string
  directory: string
  projectRoot: string
  command: DeployCliCommand
  extraEnv?: Record<string, string>
  onEvent?: (
    event:
      | DeploySseEvent
      | UndeploySseEvent
      | ServerDeploySseEvent
      | { type: "result"; data: unknown }
  ) => void
  onReady?: (send: (action: "verify" | "refresh" | "cancel") => Promise<boolean>) => void
  signal?: AbortSignal
}

const STREAMING_DEPLOY_COMMANDS = new Set<DeployCliCommand["subcommand"]>([
  "deploy",
  "undeploy",
  "server-deploy",
])

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

type DeployStreamEvent =
  | DeploySseEvent
  | UndeploySseEvent
  | ServerDeploySseEvent
  | { type: "result"; data: unknown }

function parseEventPayload(payload: string): DeployStreamEvent | undefined {
  const candidates = [payload.trim(), payload.replace(/[\r\n]+/g, "")]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate) as DeployStreamEvent
    } catch {
      continue
    }
  }
}

function extractBalancedJson(text: string, start: number, end: number): string | undefined {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < end; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") {
      depth++
    } else if (char === "}") {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return undefined
}

function extractEventAfterMarker(cleaned: string, markerAt: number) {
  const jsonStart = cleaned.indexOf("{", markerAt + DEPLOY_EVENT_MARKER.length)
  if (jsonStart === -1) return

  const nextMarker = cleaned.indexOf(DEPLOY_EVENT_MARKER, markerAt + DEPLOY_EVENT_MARKER.length)
  const searchEnd = nextMarker === -1 ? cleaned.length : nextMarker
  const jsonText = extractBalancedJson(cleaned, jsonStart, searchEnd)
  if (!jsonText) return

  const parsed = parseEventPayload(jsonText)
  if (!parsed) return

  return { event: parsed, end: jsonStart + jsonText.length }
}

export function consumeDeployBuffer(buffer: string) {
  const events: DeployStreamEvent[] = []
  const cleaned = stripTerminalControl(buffer)
  let cursor = 0

  while (cursor < cleaned.length) {
    const markerAt = cleaned.indexOf(DEPLOY_EVENT_MARKER, cursor)
    if (markerAt === -1) break

    const extracted = extractEventAfterMarker(cleaned, markerAt)
    if (!extracted) {
      const nextMarker = cleaned.indexOf(DEPLOY_EVENT_MARKER, markerAt + DEPLOY_EVENT_MARKER.length)
      if (nextMarker === -1) {
        return { events, rest: cleaned.slice(markerAt) }
      }
      cursor = nextMarker
      continue
    }

    events.push(extracted.event)
    cursor = Math.max(extracted.end, markerAt + DEPLOY_EVENT_MARKER.length)
  }

  return { events, rest: "" }
}

function collectDeployEventsFromRawOutput(rawOutput: string) {
  const events: DeployStreamEvent[] = []
  const cleaned = stripTerminalControl(rawOutput)
  let cursor = 0

  while (cursor < cleaned.length) {
    const markerAt = cleaned.indexOf(DEPLOY_EVENT_MARKER, cursor)
    if (markerAt === -1) break

    const extracted = extractEventAfterMarker(cleaned, markerAt)
    if (!extracted) {
      cursor = markerAt + DEPLOY_EVENT_MARKER.length
      continue
    }

    events.push(extracted.event)
    cursor = Math.max(extracted.end, markerAt + DEPLOY_EVENT_MARKER.length)
  }

  return events
}

function recoverServerDeployCompleteFromRawOutput(rawOutput: string): ServerDeploySseEvent | undefined {
  const normalized = stripTerminalControl(rawOutput).replace(/[\r\n]+/g, "")
  const marker = '"type":"complete"'
  const markerAt = normalized.lastIndexOf(marker)
  if (markerAt === -1) return undefined

  const jsonStart = normalized.lastIndexOf("{", markerAt)
  if (jsonStart === -1) return undefined

  const jsonText = extractBalancedJson(normalized, jsonStart, normalized.length)
  if (!jsonText) return undefined

  const parsed = parseEventPayload(jsonText)
  if (parsed?.type !== "complete" || !("result" in parsed)) return undefined
  if (!parsed.result || typeof parsed.result !== "object" || !("host" in parsed.result)) return undefined
  return parsed as ServerDeploySseEvent
}

function recoverMissingDeployEvents(
  rawOutput: string,
  input: RunDeployCliInput,
  result: RunDeployCliResult,
  state: { sawComplete: boolean; lastError?: Error; uploadStepDone?: boolean },
) {
  if (state.sawComplete) return

  const recovered = collectDeployEventsFromRawOutput(rawOutput)
  const missing = recovered.filter((event) => {
    if (event.type === "complete") return true
    if (
      event.type === "step-complete" &&
      input.command.subcommand === "server-deploy" &&
      event.name === "上传到服务器" &&
      (event.message.includes("同步完成") || event.message.includes("上传完成"))
    ) {
      return true
    }
    return false
  })

  if (missing.length > 0) {
    applyDeployEvents(missing, input, result, state)
    return
  }

  const complete = recoverServerDeployCompleteFromRawOutput(rawOutput)
  if (complete) {
    applyDeployEvents([complete], input, result, state)
  }
}

function applyDeployEvents(
  events: DeployStreamEvent[],
  input: RunDeployCliInput,
  result: RunDeployCliResult,
  state: { sawComplete: boolean; lastError?: Error; uploadStepDone?: boolean },
  reject?: (error: Error) => void,
) {
  for (const payload of events) {
    if (payload.type === "result") {
      result.data = payload.data
      continue
    }

    if (payload.type === "complete") {
      state.sawComplete = true
    }

    if (
      payload.type === "step-complete" &&
      input.command.subcommand === "server-deploy" &&
      payload.name === "上传到服务器" &&
      (payload.message.includes("同步完成") || payload.message.includes("上传完成"))
    ) {
      state.uploadStepDone = true
    }

    input.onEvent?.(payload)
    if (payload.type === "error") {
      state.lastError = new Error(payload.message)
      reject?.(state.lastError)
      return false
    }
  }

  return true
}

function assertStreamingDeployFinished(
  command: DeployCliCommand["subcommand"],
  state: { sawComplete: boolean; lastError?: Error; uploadStepDone?: boolean },
  result: RunDeployCliResult,
  rawOutput: string,
  input: RunDeployCliInput,
) {
  if (!STREAMING_DEPLOY_COMMANDS.has(command)) return

  if (state.lastError) {
    throw state.lastError
  }

  if (
    !state.uploadStepDone &&
    command === "server-deploy" &&
    /上传到服务器/.test(rawOutput) &&
    /(同步完成|上传完成) \(\d+ 新文件/.test(rawOutput)
  ) {
    state.uploadStepDone = true
  }

  if (!state.sawComplete && state.uploadStepDone && command === "server-deploy") {
    const uploadedMatch = rawOutput.match(/(?:同步完成|上传完成) \((\d+) 新文件/)
    const hostMatch = rawOutput.match(/"host":"([^"]+)"/)
    const remotePathMatch = rawOutput.match(/"remotePath":"([^"]+)"/)
    const urlMatch = rawOutput.match(/"url":"([^"]+)"/)
    const domainMatch = rawOutput.match(/"domain":"([^"]+)"/)
    const protocolMatch = rawOutput.match(/"protocol":"(http|https)"/)
    input.onEvent?.({
      type: "complete",
      result: {
        host: hostMatch?.[1] ?? "",
        remotePath: remotePathMatch?.[1] ?? "",
        uploaded: uploadedMatch ? Number(uploadedMatch[1]) : 0,
        totalBytes: 0,
        url: urlMatch?.[1] ?? "",
        domain: domainMatch?.[1] ?? "",
        protocol: protocolMatch?.[1] === "https" ? "https" : "http",
      },
    })
    return
  }

  if (!state.sawComplete) {
    const snippet = stripTerminalControl(rawOutput).trim().slice(-800)
    throw new Error(
      `发布未正常完成（exitCode: ${result.exitCode ?? "unknown"}）${snippet ? `：${snippet}` : ""}`,
    )
  }
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

export async function writeServerDeployCredentials(
  client: DirectorySDK["client"],
  directory: string,
  projectRoot: string,
  password: string,
) {
  const payload = JSON.stringify({ password })
  const cwd = normalizeDeployPath(projectRoot)
  const script = [
    "const fs=require('node:fs')",
    "const path=require('node:path')",
    `fs.writeFileSync(path.join(process.cwd(), ${JSON.stringify(SERVER_DEPLOY_CREDS_FILE)}), ${JSON.stringify(payload)}, { mode: 0o600 })`,
  ].join(";")

  const created = await client.pty
    .create({
      directory,
      command: resolveDeployNodeRuntime(),
      args: ["-e", script],
      cwd,
      title: "__opencode_server_deploy_creds__",
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
      env: {
        ...deployBrowserEnv(),
        ...input.extraEnv,
      },
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

    const streamState = { sawComplete: false, lastError: undefined as Error | undefined, uploadStepDone: false }

    const messagePromise = new Promise<void>((resolve, reject) => {
      if (!socket) return resolve()

      const ingest = (chunk: string, final = false) => {
        if (chunk) {
          rawOutput += chunk
          buffer += chunk
        }

        const parsed = consumeDeployBuffer(buffer)
        buffer = final ? "" : parsed.rest
        if (!applyDeployEvents(parsed.events, input, result, streamState, reject)) return

        if (final && buffer.trim()) {
          const trailing = consumeDeployBuffer(buffer)
          applyDeployEvents(trailing.events, input, result, streamState, reject)
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
      applyDeployEvents(trailing.events, input, result, streamState)
    }

    recoverMissingDeployEvents(rawOutput, input, result, streamState)

    if (
      (input.command.subcommand === "status" ||
        input.command.subcommand === "preview" ||
        input.command.subcommand === "domains" ||
        input.command.subcommand === "server-config") &&
      result.data === undefined
    ) {
      const snippet = stripTerminalControl(rawOutput).trim().slice(-400)
      throw new Error(
        `发布 CLI 未返回结果（exitCode: ${result.exitCode ?? "unknown"}）${snippet ? `：${snippet}` : ""}`,
      )
    }

    assertStreamingDeployFinished(input.command.subcommand, streamState, result, rawOutput, input)

    return result
  } finally {
    input.signal?.removeEventListener("abort", abort)
    await cleanup()
  }
}
