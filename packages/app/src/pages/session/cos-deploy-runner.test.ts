import { describe, expect, test } from "bun:test"
import {
  buildDeployPtyLaunch,
  consumeDeployBuffer,
  deployBrowserEnv,
  formatDeployShellCommand,
  resolveDeployBrowsersPath,
  resolveDeployCliScript,
} from "./cos-deploy-runner"

const CLI = "D:/opencodewebui_v0/opencode-ui/packages/deploy-server/src/cli.ts"
const MARKER = "@@DEPLOY@@"

describe("buildDeployPtyLaunch", () => {
  test("launches node directly for stdin and file fallback support", () => {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      value: "Windows NT 10.0",
      configurable: true,
    })

    const launch = buildDeployPtyLaunch(
      {
        subcommand: "deploy",
        args: ["--project-root", "D:/projects/my-app", "--mode", "domain", "--target", "example.com"],
      },
      "D:/projects/my-app",
      "http://localhost:4096",
    )

    expect(launch.command).toBe("node")
    expect(launch.cwd).toBe("D:/projects/my-app")
    expect(launch.args[0]).toContain("/dist/cli.js")
    expect(launch.args).toContain("deploy")
    expect(launch.args).toContain("--mode")
    expect(launch.args).toContain("domain")
  })

  test("formats shell command with normalized paths", () => {
    const formatted = formatDeployShellCommand(
      {
        subcommand: "status",
        args: ["--project-root", "D:\\projects\\my-app"],
      },
      "D:\\projects\\my-app",
      CLI,
    )

    expect(formatted.run).toContain("D:/opencodewebui_v0/opencode-ui/packages/deploy-server/dist/cli.js")
    expect(formatted.run).toContain("node")
    expect(formatted.run).toContain("status")
    expect(formatted.cwd).toBe("D:/projects/my-app")
  })
})

describe("resolveDeployBrowsersPath", () => {
  test("derives browsers path from cli script", () => {
    expect(resolveDeployBrowsersPath(CLI)).toBe(
      "D:/opencodewebui_v0/opencode-ui/packages/deploy-server/browsers",
    )
    expect(resolveDeployCliScript(CLI)).toBe(
      "D:/opencodewebui_v0/opencode-ui/packages/deploy-server/dist/cli.js",
    )
  })

  test("builds pty env with local browsers path", () => {
    expect(deployBrowserEnv(CLI)).toEqual({
      PLAYWRIGHT_BROWSERS_PATH: "D:/opencodewebui_v0/opencode-ui/packages/deploy-server/browsers",
      OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL: "1",
    })
  })
})

describe("consumeDeployBuffer", () => {
  test("parses result marker without trailing newline", () => {
    const sample = `${MARKER}{"type":"result","data":{"configured":true}}`
    const parsed = consumeDeployBuffer(sample)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toEqual({ type: "result", data: { configured: true } })
  })

  test("parses wrapped terminal output with ansi and line breaks", () => {
    const sample =
      "\u001b[2J\u001b[H\u001b]0;C:\\Windows\\system32\\cmd.exe\u0007\u001b[?25h" +
      `${MARKER}{"type":"result","data":{"configured":true,"baseDomain":"aigo1.cloud",\n` +
      `"cosPrefix":"sites","protocol":"https","cdnHttps":false,"project":{"name":"miaod\n` +
      `a-react-admin","version":"0.0.1"}}}\u001b[K`

    const parsed = consumeDeployBuffer(sample)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toEqual({
      type: "result",
      data: {
        configured: true,
        baseDomain: "aigo1.cloud",
        cosPrefix: "sites",
        protocol: "https",
        cdnHttps: false,
        project: { name: "miaoda-react-admin", version: "0.0.1" },
      },
    })
  })

  test("parses user-reported wrapped output snippet", () => {
    const sample =
      `${MARKER}{"type":"result","data":{"configured":true,"baseDomain":"aigo1.cloud",\n` +
      `"cosPrefix":"sites","protocol":"https","cdnHttps":false,"project":{"name":"miaod\n` +
      `a-react-admin","version":"0.0.1"}}}`

    const parsed = consumeDeployBuffer(sample)
    expect(parsed.events).toHaveLength(1)
    expect((parsed.events[0] as { data: { project: { name: string } } }).data.project.name).toBe(
      "miaoda-react-admin",
    )
  })
})
