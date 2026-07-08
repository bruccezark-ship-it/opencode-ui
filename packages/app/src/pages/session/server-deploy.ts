import type { DirectorySDK } from "@/context/sdk"
import {
  buildDeployCliArgs,
  runDeployCli,
  setActiveDeployInputSender,
  writeServerDeployCredentials,
} from "@/pages/session/cos-deploy-runner"
import { fileText } from "@/pages/session/preview-structure"

export const SERVER_CONFIG_FILE = "server-config.json"
export const DEFAULT_SERVER_USERNAME = "root"
export const DEFAULT_SERVER_PATH = "/var/www/html/"

export type ServerDeployConfig = {
  host: string
  username: string
  path: string
  domain: string
  protocol: "http" | "https"
}

export type ServerDeployResult = {
  host: string
  remotePath: string
  uploaded: number
  totalBytes: number
  url: string
  domain: string
  protocol: "http" | "https"
}

export type ServerDeploySseEvent =
  | { type: "step-start"; step: number; total: number; name: string }
  | { type: "step-complete"; step: number; total: number; name: string; message: string }
  | { type: "status"; message: string }
  | {
      type: "route-discovery"
      sessionId: string
      options: Array<{ id: string; label: string; routeCount: number; routePreview: string }>
    }
  | { type: "complete"; result: ServerDeployResult }
  | { type: "error"; message: string }

export type DeployClient = {
  client: DirectorySDK["client"]
  serverUrl: string
  directory: string
  projectRoot: string
}

function assertDeployResult<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`发布 CLI 未返回${label}`)
  }
  return value
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

function parseServerDeployConfig(content: string | undefined): ServerDeployConfig {
  if (!content?.trim()) {
    return {
      host: "",
      username: DEFAULT_SERVER_USERNAME,
      path: DEFAULT_SERVER_PATH,
      domain: "",
      protocol: "http",
    }
  }

  try {
    const parsed = JSON.parse(content) as Partial<ServerDeployConfig>
    return {
      host: parsed.host?.trim() ?? "",
      username: parsed.username?.trim() || DEFAULT_SERVER_USERNAME,
      path: parsed.path?.trim() || DEFAULT_SERVER_PATH,
      domain: parsed.domain?.trim() ?? "",
      protocol: parsed.protocol === "https" ? "https" : "http",
    }
  } catch {
    return {
      host: "",
      username: DEFAULT_SERVER_USERNAME,
      path: DEFAULT_SERVER_PATH,
      domain: "",
      protocol: "http",
    }
  }
}

export async function fetchServerDeployConfigFromProject(
  client: DirectorySDK["client"],
  projectRoot: string,
  workspaceDirectory: string,
): Promise<ServerDeployConfig> {
  const sameRoot = normalizePath(projectRoot) === normalizePath(workspaceDirectory)
  const result = sameRoot
    ? await client.file.read({ path: SERVER_CONFIG_FILE }).catch(() => undefined)
    : await client.file.read({ directory: projectRoot, path: SERVER_CONFIG_FILE }).catch(() => undefined)

  return parseServerDeployConfig(fileText(result?.data))
}

export async function fetchServerDeployConfig(ctx: DeployClient) {
  const fromFile = await fetchServerDeployConfigFromProject(
    ctx.client,
    ctx.projectRoot,
    ctx.directory,
  )
  if (fromFile.host) {
    return fromFile
  }

  const result = await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "server-config",
      args: ["--project-root", ctx.projectRoot.replace(/\\/g, "/")],
    },
  })
  return assertDeployResult(result.data as ServerDeployConfig | undefined, "服务器配置")
}

export async function startServerDeploy(
  ctx: DeployClient,
  input: {
    projectRoot: string
    host: string
    username: string
    password: string
    path: string
    domain: string
    protocol: "http" | "https"
  },
  onEvent: (event: ServerDeploySseEvent) => void,
  signal?: AbortSignal,
) {
  // 优先通过环境变量传递密码，避免凭据文件写入失败导致静默失败
  void writeServerDeployCredentials(ctx.client, ctx.directory, input.projectRoot, input.password).catch(
    () => undefined,
  )

  await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "server-deploy",
      args: buildDeployCliArgs({
        "project-root": input.projectRoot.replace(/\\/g, "/"),
        host: input.host,
        username: input.username,
        path: input.path,
        domain: input.domain,
        protocol: input.protocol,
      }),
    },
    extraEnv: {
      OPENCODE_SERVER_DEPLOY_PASSWORD: input.password,
    },
    onEvent,
    onReady: (send) => setActiveDeployInputSender(send),
    signal,
  }).finally(() => setActiveDeployInputSender(undefined))
}
