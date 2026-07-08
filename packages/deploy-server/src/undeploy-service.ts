import {
  findRegistryEntry,
  findRegistrySiblings,
  loadDomainRegistry,
  loadGlobalConfig,
  parseCosPathToPrefix,
  removePublishedDomain,
  undeploy,
} from "@opencode-ai/deploy-core"
import type { SseEvent } from "./types.js"

type Emit = (event: SseEvent) => void

export async function listPublishedDomains(projectRoot: string) {
  const registry = await loadDomainRegistry(projectRoot)
  return {
    domains: registry.domains
      .map((entry) => ({
        domain: entry.domain,
        url: entry.url,
        cosPath: entry.cosPath,
        publishedAt: entry.publishedAt,
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
  }
}

export async function runUndeploy(
  input: { projectRoot: string; domain: string },
  emit: Emit,
) {
  const config = await loadGlobalConfig()
  const registry = await loadDomainRegistry(input.projectRoot)
  const entry = findRegistryEntry(registry, input.domain)

  if (!entry) {
    throw new Error(`域名 ${input.domain} 不在项目域名表中`)
  }

  const siblings = findRegistrySiblings(registry, entry.domain, entry.cosPath)
  const cosPrefix = parseCosPathToPrefix(entry.cosPath)

  const result = await undeploy(
    {
      domain: entry.domain,
      config,
      cosPrefix,
      registrySiblingDomains: siblings,
    },
    {
      onStepStart: (step, total, name) => {
        emit({ type: "step-start", step, total, name })
      },
      onStepComplete: (step, total, name, message) => {
        emit({ type: "step-complete", step, total, name, message })
      },
    },
  )

  await removePublishedDomain(input.projectRoot, entry.domain)
  emit({ type: "status", message: "已更新项目域名记录 (.opencode-deploy-domains.json)" })

  emit({
    type: "complete",
    result: {
      domain: result.domain,
      cdnStatus: result.cdnStatus,
      dnsStatus: result.dnsStatus,
      dnsSkipReason: result.dnsSkipReason,
      cosPrefix: result.cosPrefix,
      cosDeleted: result.cosDeleted,
      cosSkipped: result.cosSkipped,
      cosSkipReason: result.cosSkipReason,
    },
  })

  return result
}
