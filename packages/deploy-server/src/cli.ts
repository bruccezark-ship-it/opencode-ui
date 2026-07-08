#!/usr/bin/env bun
import { initDeployBrowserEnv } from "./browser-env.js"

initDeployBrowserEnv()

import { join } from "node:path"
import { emitEvent, drainDeployOutput } from "./protocol.js"
import { createStdinBridge } from "./stdin-bridge.js"
import {
  getDeployStatus,
  previewDeploy,
  runDeploy,
} from "./deploy-service.js"
import { listPublishedDomains, runUndeploy } from "./undeploy-service.js"
import { getServerDeployConfig, runServerDeploy } from "./server-deploy-service.js"
import { runConfigCommand } from "./config-command.js"
import type { DeployPreviewRequest, DeployStartRequest } from "./types.js"

function usage() {
  process.stderr.write(`Usage:
  opencode-deploy config [--init]
  opencode-deploy status --project-root <path>
  opencode-deploy preview --project-root <path> --mode <subdomain|domain> --target <value> [options]
  opencode-deploy deploy --project-root <path> --mode <subdomain|domain> --target <value> [options]
  opencode-deploy domains --project-root <path>
  opencode-deploy undeploy --project-root <path> --domain <domain>
  opencode-deploy server-config --project-root <path>
  opencode-deploy server-deploy --project-root <path> --host <ip> --username <user> --path <remote-path> --domain <domain> [--protocol <http|https>]

Options:
  --protocol <http|https>
  --cdn-https
  --cert-id <id>
  --no-clean
`)
  process.exit(1)
}

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv
  if (!command) usage()

  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg) continue
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === "cdn-https" || key === "no-clean" || key === "init") {
      flags[key] = true
      continue
    }
    const value = rest[++i]
    if (!value) usage()
    flags[key] = value
  }

  return { command, flags, positional }
}

function readRequest(flags: Record<string, string | boolean>): DeployPreviewRequest {
  const projectRoot = String(flags["project-root"] ?? "")
  const mode = String(flags.mode ?? "") as DeployPreviewRequest["mode"]
  const target = String(flags.target ?? "")

  if (!projectRoot || !mode || !target) usage()

  return {
    projectRoot,
    mode,
    target,
    protocol: flags.protocol ? (String(flags.protocol) as "http" | "https") : undefined,
    cdnHttps: flags["cdn-https"] === true ? true : undefined,
    certId: flags["cert-id"] ? String(flags["cert-id"]) : undefined,
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))

  if (command === "config") {
    await runConfigCommand(flags)
    return
  }

  if (command === "status") {
    const projectRoot = String(flags["project-root"] ?? "")
    if (!projectRoot) usage()
    const data = await getDeployStatus(projectRoot)
    await emitEvent({ type: "result", data })
    return
  }

  if (command === "preview") {
    const data = await previewDeploy(readRequest(flags))
    await emitEvent({ type: "result", data })
    return
  }

  if (command === "deploy") {
    const request = readRequest(flags) as DeployStartRequest
    if (flags["no-clean"] === true) request.noClean = true

    const inputFile = join(request.projectRoot, ".opencode-deploy-input")
    const stdin = createStdinBridge({ inputFile })

    try {
      await runDeploy(request, emitEvent, async () => {
        const input = await stdin.next()
        return input.action
      })
      await drainDeployOutput()
    } finally {
      stdin.close()
    }
    return
  }

  if (command === "domains") {
    const projectRoot = String(flags["project-root"] ?? "")
    if (!projectRoot) usage()
    const data = await listPublishedDomains(projectRoot)
    await emitEvent({ type: "result", data })
    return
  }

  if (command === "undeploy") {
    const projectRoot = String(flags["project-root"] ?? "")
    const domain = String(flags.domain ?? "")
    if (!projectRoot || !domain) usage()
    await runUndeploy({ projectRoot, domain }, emitEvent)
    await drainDeployOutput()
    return
  }

  if (command === "server-config") {
    const projectRoot = String(flags["project-root"] ?? "")
    if (!projectRoot) usage()
    const data = await getServerDeployConfig(projectRoot)
    await emitEvent({ type: "result", data })
    return
  }

  if (command === "server-deploy") {
    const projectRoot = String(flags["project-root"] ?? "")
    const host = String(flags.host ?? "")
    const username = String(flags.username ?? "root")
    const path = String(flags.path ?? "/var/www/html/")
    const domain = String(flags.domain ?? "")
    const protocol = String(flags.protocol ?? "http") === "https" ? "https" : "http"
    if (!projectRoot || !host || !domain) usage()
    await runServerDeploy({ projectRoot, host, username, path, domain, protocol }, emitEvent)
    await drainDeployOutput()
    return
  }

  usage()
}

main()
  .then(() => {
    process.exitCode = 0
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    await emitEvent({ type: "error", message }).catch(() => undefined)
    await drainDeployOutput().catch(() => undefined)
    process.exit(1)
  })
