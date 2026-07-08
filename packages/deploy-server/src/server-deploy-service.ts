import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_SERVER_PATH,
  DEFAULT_SERVER_USERNAME,
  formatRouteDiscoverySummary,
  loadProjectConfig,
  loadServerConfig,
  normalizeDomain,
  pickDefaultRouteDiscoveryOption,
  resolveSiteBaseDomain,
  serverDeploy,
  validateDomain,
} from "@opencode-ai/deploy-core"
import type { SseEvent } from "./types.js"

export const SERVER_DEPLOY_CREDS_FILE = ".opencode-server-deploy-creds.json"

type Emit = (event: SseEvent) => void | Promise<void>

async function emitAndWait(emit: Emit, event: SseEvent) {
  await Promise.resolve(emit(event))
}

export type ServerDeployRequest = {
  projectRoot: string
  host: string
  username: string
  path: string
  domain: string
  protocol: "http" | "https"
}

export async function getServerDeployConfig(projectRoot: string) {
  const saved = await loadServerConfig(projectRoot)
  return {
    host: saved.host ?? "",
    username: saved.username ?? DEFAULT_SERVER_USERNAME,
    path: saved.path ?? DEFAULT_SERVER_PATH,
    domain: saved.domain ?? "",
    protocol: saved.protocol ?? "http",
  }
}

export async function readDeployPassword(projectRoot: string): Promise<string> {
  const fromEnv = process.env.OPENCODE_SERVER_DEPLOY_PASSWORD?.trim()
  if (fromEnv) {
    return fromEnv
  }

  const credsPath = join(projectRoot, SERVER_DEPLOY_CREDS_FILE)
  if (!existsSync(credsPath)) {
    throw new Error("未找到服务器登录凭据，请重试")
  }

  const raw = readFileSync(credsPath, "utf-8")
  try {
    unlinkSync(credsPath)
  } catch {
    // ignore cleanup errors
  }

  const parsed = JSON.parse(raw) as { password?: string }
  const password = parsed.password?.trim()
  if (!password) {
    throw new Error("服务器密码不能为空")
  }

  return password
}

function resolveServerSiteBaseUrl(domain: string, protocol: "http" | "https") {
  const validation = validateDomain(domain)
  if (validation !== true) {
    throw new Error(validation)
  }

  const normalized = normalizeDomain(domain)
  const siteBaseDomain = resolveSiteBaseDomain(normalized)
  return {
    domain: normalized,
    siteBaseUrl: `${protocol}://${siteBaseDomain}`,
  }
}

export async function runServerDeploy(request: ServerDeployRequest, emit: Emit) {
  const host = request.host.trim()
  const username = request.username.trim() || DEFAULT_SERVER_USERNAME
  const path = request.path.trim() || DEFAULT_SERVER_PATH
  const protocol = request.protocol === "https" ? "https" : "http"

  if (!host) {
    throw new Error("服务器主机 IP 不能为空")
  }

  const { domain, siteBaseUrl } = resolveServerSiteBaseUrl(request.domain, protocol)
  const password = await readDeployPassword(request.projectRoot)
  const projectConfig = await loadProjectConfig(request.projectRoot)

  const result = await serverDeploy(
    {
      projectRoot: request.projectRoot,
      host,
      username,
      password,
      remotePath: path,
      domain,
      protocol,
      siteBaseUrl,
    },
    {
      onStepStart: (step, total, name) => {
        emit({ type: "step-start", step, total, name })
      },
      onStepComplete: (step, total, name, message) => {
        emit({ type: "step-complete", step, total, name, message })
      },
      onStatus: (message) => {
        emit({ type: "status", message })
      },
      onRouteDiscoverySelect: async (options) => {
        if (options.length === 0) return undefined
        if (options.length === 1) {
          const option = options[0]
          if (!option) return undefined
          emit({ type: "status", message: `使用路由表: ${option.label}` })
          return option
        }
        const selected = pickDefaultRouteDiscoveryOption(options, projectConfig.routeFile)
        if (selected) {
          emit({ type: "status", message: `使用路由表: ${formatRouteDiscoverySummary(selected)}` })
        }
        return selected
      },
    },
  )

  await emitAndWait(emit, {
    type: "complete",
    result: {
      host: result.host,
      remotePath: result.remotePath,
      uploaded: result.uploaded,
      skipped: result.skipped,
      deleted: result.deleted,
      totalBytes: result.totalBytes,
      url: result.url,
      domain: result.domain,
      protocol: result.protocol,
    },
  })

  return result
}
