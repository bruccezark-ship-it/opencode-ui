#!/usr/bin/env bun
import { initDeployBrowserEnv } from "./browser-env.js"

initDeployBrowserEnv()

import { join } from "node:path"
import { emitEvent } from "./protocol.js"
import { createStdinBridge } from "./stdin-bridge.js"
import {
  getDeployStatus,
  previewDeploy,
  runDeploy,
} from "./deploy-service.js"
import { runConfigCommand } from "./config-command.js"
import type { DeployPreviewRequest, DeployStartRequest } from "./types.js"

function usage() {
  process.stderr.write(`Usage:
  opencode-deploy config [--init]
  opencode-deploy status --project-root <path>
  opencode-deploy preview --project-root <path> --mode <subdomain|domain> --target <value> [options]
  opencode-deploy deploy --project-root <path> --mode <subdomain|domain> --target <value> [options]

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
    emitEvent({ type: "result", data })
    return
  }

  if (command === "preview") {
    const data = await previewDeploy(readRequest(flags))
    emitEvent({ type: "result", data })
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
    } finally {
      stdin.close()
    }
    return
  }

  usage()
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  emitEvent({ type: "error", message })
  process.exit(1)
})
