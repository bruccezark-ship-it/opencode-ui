import {
  areAllCdnDomainsConfigured,
  ConfigError,
  deploy,
  detectViteProject,
  enrichDeployPlanDns,
  expandCdnDomains,
  formatRouteDiscoverySummary,
  getDnsZoneDetails,
  getRootDomain,
  loadDeployConfig,
  normalizeDomain,
  normalizeSubdomain,
  pickDefaultRouteDiscoveryOption,
  ProjectError,
  resolveDeployPlan,
  resolveOutDir,
  resolveSiteBaseDomain,
  resolveSubdomainPlan,
  validateDomain,
  validateSubdomain,
  type DeployPlan,
} from "@opencode-ai/deploy-core"
import type { DeployPreviewRequest, DeployStartRequest, SseEvent } from "./types.js"

type Emit = (event: SseEvent) => void

type VerificationAction = "verify" | "refresh" | "cancel"
type WaitForVerificationAction = () => Promise<VerificationAction>

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

async function buildPlan(request: DeployPreviewRequest) {
  const config = await loadDeployConfig(request.projectRoot)
  const target = request.target.trim()

  if (request.mode === "subdomain") {
    const validation = validateSubdomain(target)
    if (validation !== true) throw new Error(validation)
    return resolveSubdomainPlan(normalizeSubdomain(target), config.domain.baseDomain, config.cos.prefix)
  }

  const validation = validateDomain(target)
  if (validation !== true) throw new Error(validation)
  return resolveDeployPlan(target, config.domain.baseDomain, config.cos.prefix)
}

function applyDeploySettings(
  config: Awaited<ReturnType<typeof loadDeployConfig>>,
  request: DeployPreviewRequest,
) {
  const protocol = request.protocol ?? config.domain.protocol
  const cdnHttps = request.cdnHttps ?? config.cdn.https
  const certId = request.certId?.trim() || config.cdn.certId

  return {
    ...config,
    domain: { ...config.domain, protocol },
    cdn: { ...config.cdn, https: cdnHttps, certId },
  }
}

export async function getDeployStatus(projectRoot: string) {
  try {
    const config = await loadDeployConfig(projectRoot)
    const project = await detectViteProject(projectRoot)
    return {
      configured: true,
      baseDomain: config.domain.baseDomain,
      cosPrefix: config.cos.prefix,
      protocol: config.domain.protocol,
      cdnHttps: config.cdn.https,
      certId: config.cdn.certId,
      project: { name: project.name, version: project.version },
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      return { configured: false, error: error.message }
    }
    if (error instanceof ProjectError) {
      return { configured: true, error: error.message }
    }
    throw error
  }
}

export async function previewDeploy(request: DeployPreviewRequest) {
  const config = await loadDeployConfig(request.projectRoot)
  const plan = await buildPlan(request)
  const enriched = await enrichDeployPlanDns(plan, config)
  const settings = applyDeploySettings(config, request)
  const protocol = settings.domain.protocol

  let skipCdnAndDns = false
  try {
    skipCdnAndDns = await areAllCdnDomainsConfigured(
      settings,
      enriched.domains.map((entry) => entry.fullDomain),
    )
  } catch {
    skipCdnAndDns = false
  }

  const dnsStatus = await Promise.all(
    enriched.domains.map(async (entry) => {
      const zoneKey = entry.dnsZone ?? entry.fullDomain
      const details = await getDnsZoneDetails(settings, zoneKey).catch(() => undefined)
      return {
        domain: entry.fullDomain,
        managedDns: entry.managedDns,
        dnsZone: entry.dnsZone,
        inAccount: details?.inAccount ?? false,
        effective: details?.effective ?? false,
      }
    }),
  )

  const inputDomain = request.mode === "domain" ? normalizeDomain(request.target) : undefined
  const expanded =
    inputDomain && request.mode === "domain" ? expandCdnDomains(inputDomain) : undefined

  return {
    urls: enriched.domains.map((entry) => `${protocol}://${entry.fullDomain}`),
    cdnDomains: enriched.domains.map((entry) => entry.fullDomain),
    cosPrefix: enriched.cosPrefix,
    skipCdnAndDns,
    expandedDomains: expanded && expanded.length > 1 ? expanded : undefined,
    dnsStatus,
    settings: {
      protocol,
      cdnHttps: settings.cdn.https,
      certId: settings.cdn.certId,
    },
  }
}

export async function runDeploy(
  request: DeployStartRequest,
  emit: Emit,
  waitForVerificationAction?: WaitForVerificationAction,
) {
  let config = await loadDeployConfig(request.projectRoot)
  const plan = await enrichDeployPlanDns(await buildPlan(request), config)
  config = applyDeploySettings(config, request)

  if (config.cdn.https && !config.cdn.certId) {
    throw new Error("已开启 CDN HTTPS，但未配置证书 ID")
  }

  const project = await detectViteProject(request.projectRoot)
  const outDir = await resolveOutDir(request.projectRoot, config.project.outputDir)

  let skipCdnAndDns = false
  try {
    skipCdnAndDns = await areAllCdnDomainsConfigured(
      config,
      plan.domains.map((entry) => entry.fullDomain),
    )
  } catch {
    skipCdnAndDns = false
  }

  const inputDomain = request.mode === "domain" ? normalizeDomain(request.target) : undefined
  const siteBaseDomain = inputDomain
    ? resolveSiteBaseDomain(inputDomain)
    : resolveSiteBaseDomain(plan.primaryDomain)
  const siteBaseUrl = `${config.domain.protocol}://${siteBaseDomain}`

  const result = await deploy(
    {
      projectRoot: request.projectRoot,
      cosPrefix: plan.cosPrefix,
      domains: plan.domains,
      config,
      outDir,
      siteBaseUrl,
    },
    {
      noClean: request.noClean,
      skipCdnAndDns,
      onRouteDiscoverySelect: async (options) => {
        if (options.length === 0) return undefined
        if (options.length === 1) {
          const option = options[0]
          if (!option) return undefined
          emit({ type: "status", message: `使用路由表: ${option.label}` })
          return option
        }
        const selected = pickDefaultRouteDiscoveryOption(options, config.project.routeFile)
        if (selected) {
          emit({ type: "status", message: `使用路由表: ${formatRouteDiscoverySummary(selected)}` })
        }
        return selected
      },
      onCdnVerificationRequired: skipCdnAndDns
        ? undefined
        : async (ctx) => {
            if (!waitForVerificationAction) {
              throw new Error("CDN 域名归属验证需要交互式输入，但未提供输入通道")
            }

            const sessionId = crypto.randomUUID()
            emit({
              type: "cdn-verification",
              sessionId,
              record: {
                domain: ctx.record.domain,
                rootDomain: ctx.record.rootDomain,
                host: ctx.record.host,
                recordType: ctx.record.recordType,
                value: ctx.record.value,
                fqdn: ctx.record.fqdn,
              },
            })

            while (true) {
              const action = await waitForVerificationAction()

              if (action === "cancel") {
                throw new Error("用户取消 CDN 域名归属验证")
              }

              if (action === "refresh") {
                emit({ type: "status", message: "正在刷新 CDN 验证记录..." })
                const record = await ctx.refresh()
                emit({
                  type: "cdn-verification",
                  sessionId,
                  record: {
                    domain: record.domain,
                    rootDomain: record.rootDomain,
                    host: record.host,
                    recordType: record.recordType,
                    value: record.value,
                    fqdn: record.fqdn,
                  },
                })
                continue
              }

              emit({ type: "status", message: "收到验证请求，正在检查 DNS TXT 记录..." })
              const dnsCheck = await withTimeout(ctx.checkDns(), 15_000, {
                ok: false,
                fqdn: ctx.record.fqdn,
                expected: ctx.record.value,
                found: [] as string[],
                message: "DNS 查询超时（15s），请确认 _cdnauth TXT 记录已添加后重试",
              })
              if (!dnsCheck.ok) {
                emit({ type: "status", message: dnsCheck.message })
                continue
              }

              emit({ type: "status", message: "DNS 记录已生效，正在请求 CDN 验证..." })
              const verified = await withTimeout(ctx.verify(), 30_000, false)
              if (!verified) {
                emit({ type: "status", message: "CDN 域名归属验证未通过，请确认 TXT 记录值正确" })
                continue
              }

              emit({ type: "status", message: "CDN 域名归属验证通过" })
              return
            }
          },
      onStepStart: (step, total, name) => {
        emit({ type: "step-start", step, total, name })
      },
      onStepComplete: (step, total, name, message) => {
        emit({ type: "step-complete", step, total, name, message })
      },
      onStatus: (message) => {
        emit({ type: "status", message })
      },
    },
  )

  emit({
    type: "complete",
    result: {
      url: result.url,
      urls: result.urls,
      cosPath: result.cosPath,
      cdnEntries: result.cdnEntries,
    },
  })

  return {
    result,
    plan,
    project,
  }
}

export function summarizePlan(plan: DeployPlan, protocol: "http" | "https") {
  return {
    urls: plan.domains.map((entry) => `${protocol}://${entry.fullDomain}`),
    cdnDomains: plan.domains.map((entry) => entry.fullDomain),
    cosPrefix: plan.cosPrefix,
    rootDomain: getRootDomain(plan.primaryDomain),
  }
}
