import type { DirectorySDK } from "@/context/sdk"
import {
  buildDeployCliArgs,
  runDeployCli,
  sendDeployVerification,
  setActiveDeployVerificationSender,
} from "@/pages/session/cos-deploy-runner"

export type DeployMode = "subdomain" | "domain"

export type DeploySettings = {
  protocol: "http" | "https"
  cdnHttps: boolean
  certId?: string
}

export type DeployStatus = {
  configured: boolean
  baseDomain?: string
  cosPrefix?: string
  protocol?: "http" | "https"
  cdnHttps?: boolean
  certId?: string
  project?: { name: string; version: string }
  error?: string
}

export type DeployPreview = {
  urls: string[]
  cdnDomains: string[]
  cosPrefix: string
  skipCdnAndDns: boolean
  expandedDomains?: string[]
  blockedDomains?: string[]
  dnsStatus: Array<{
    domain: string
    managedDns: boolean
    dnsZone?: string
    inAccount: boolean
    effective: boolean
  }>
  settings: DeploySettings
}

export type CdnVerifyRecord = {
  domain: string
  rootDomain: string
  host: string
  recordType: string
  value: string
  fqdn: string
}

export type DeploySseEvent =
  | { type: "step-start"; step: number; total: number; name: string }
  | { type: "step-complete"; step: number; total: number; name: string; message: string }
  | { type: "status"; message: string }
  | { type: "cdn-verification"; sessionId: string; record: CdnVerifyRecord }
  | {
      type: "complete"
      result: {
        url: string
        urls: string[]
        cosPath: string
        cdnEntries: Array<{ domain: string; cname: string; created: boolean }>
      }
    }
  | { type: "error"; message: string }

export type PublishedDomainSummary = {
  domain: string
  url: string
  cosPath: string
  publishedAt: string
}

export type DomainRegistryResult = {
  domains: PublishedDomainSummary[]
}

export type UndeployResult = {
  domain: string
  cdnStatus: "removed" | "not_found"
  dnsStatus: "deleted" | "not_found" | "skipped"
  dnsSkipReason?: string
  cosPrefix: string
  cosDeleted: number
  cosSkipped: boolean
  cosSkipReason?: string
}

export type UndeploySseEvent =
  | { type: "step-start"; step: number; total: number; name: string }
  | { type: "step-complete"; step: number; total: number; name: string; message: string }
  | { type: "status"; message: string }
  | { type: "complete"; result: UndeployResult }
  | { type: "error"; message: string }

export type DeployClient = {
  client: DirectorySDK["client"]
  serverUrl: string
  directory: string
  projectRoot: string
}

function deployArgs(input: {
  projectRoot: string
  mode: DeployMode
  target: string
  protocol?: "http" | "https"
  cdnHttps?: boolean
  certId?: string
  noClean?: boolean
}) {
  return buildDeployCliArgs({
    "project-root": input.projectRoot.replace(/\\/g, "/"),
    mode: input.mode,
    target: input.target,
    protocol: input.protocol,
    "cdn-https": input.cdnHttps,
    "cert-id": input.certId,
    "no-clean": input.noClean,
  })
}

function assertDeployResult<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`发布 CLI 未返回${label}`)
  }
  return value
}

export async function fetchDeployStatus(ctx: DeployClient) {
  const result = await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "status",
      args: ["--project-root", ctx.projectRoot.replace(/\\/g, "/")],
    },
  })
  return assertDeployResult(result.data as DeployStatus | undefined, "状态")
}

export async function previewCosDeploy(
  ctx: DeployClient,
  input: {
    projectRoot: string
    mode: DeployMode
    target: string
    protocol?: "http" | "https"
    cdnHttps?: boolean
    certId?: string
  },
) {
  const result = await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "preview",
      args: deployArgs(input),
    },
  })
  return assertDeployResult(result.data as DeployPreview | undefined, "预览结果")
}

export async function verifyCdnOwnership(input: { action: "verify" | "refresh" | "cancel" }) {
  sendDeployVerification(input.action)
  return { ok: input.action === "verify" }
}

export async function startCosDeploy(
  ctx: DeployClient,
  input: {
    projectRoot: string
    mode: DeployMode
    target: string
    protocol?: "http" | "https"
    cdnHttps?: boolean
    certId?: string
    noClean?: boolean
  },
  onEvent: (event: DeploySseEvent) => void,
  signal?: AbortSignal,
) {
  await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "deploy",
      args: deployArgs(input),
    },
    onEvent,
    onReady: (send) => setActiveDeployVerificationSender(send),
    signal,
  }).finally(() => setActiveDeployVerificationSender(undefined))
}

export async function fetchDomainRegistry(ctx: DeployClient) {
  const result = await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "domains",
      args: ["--project-root", ctx.projectRoot.replace(/\\/g, "/")],
    },
  })
  return assertDeployResult(result.data as DomainRegistryResult | undefined, "域名表")
}

export async function startCosUndeploy(
  ctx: DeployClient,
  input: {
    projectRoot: string
    domain: string
  },
  onEvent: (event: UndeploySseEvent) => void,
  signal?: AbortSignal,
) {
  await runDeployCli({
    client: ctx.client,
    serverUrl: ctx.serverUrl,
    directory: ctx.directory,
    projectRoot: ctx.projectRoot,
    command: {
      subcommand: "undeploy",
      args: [
        "--project-root",
        input.projectRoot.replace(/\\/g, "/"),
        "--domain",
        input.domain,
      ],
    },
    onEvent,
    signal,
  })
}
