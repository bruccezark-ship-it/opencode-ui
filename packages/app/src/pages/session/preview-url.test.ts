import { describe, expect, test } from "bun:test"
import {
  avoidWebUiPortConflict,
  extractPortFromScript,
  extractPortFromViteConfig,
  findAvailablePreviewPort,
  previewHostFromServer,
  resolveProjectPreview,
  validatePreviewHtmlForTest,
} from "./preview-url"

describe("previewHostFromServer", () => {
  test("uses localhost for loopback servers", () => {
    expect(previewHostFromServer("http://127.0.0.1:4096")).toBe("localhost")
    expect(previewHostFromServer("http://localhost:4096")).toBe("localhost")
  })

  test("uses remote host for non-loopback servers", () => {
    expect(previewHostFromServer("http://192.168.1.10:4096")).toBe("192.168.1.10")
  })
})

describe("extractPortFromScript", () => {
  test("reads common port flags", () => {
    expect(extractPortFromScript("vite --port 4173")).toBe(4173)
    expect(extractPortFromScript("next dev -p 4000")).toBe(4000)
    expect(extractPortFromScript("PORT=8080 bun dev")).toBe(8080)
  })
})

describe("extractPortFromViteConfig", () => {
  test("reads server port from vite config", () => {
    const content = `export default { server: { port: 3333 } }`
    expect(extractPortFromViteConfig(content)).toBe(3333)
  })
})

describe("resolveProjectPreview", () => {
  test("detects vite default port", () => {
    const result = resolveProjectPreview({
      host: "localhost",
      packageJson: {
        scripts: { dev: "vite" },
        devDependencies: { vite: "^6.0.0" },
      },
    })
    expect(result.url).toBe("http://localhost:5173")
  })

  test("detects explicit script port", () => {
    const result = resolveProjectPreview({
      host: "localhost",
      packageJson: {
        scripts: { dev: "vite --port 3000" },
      },
    })
    expect(result.url).toBe("http://localhost:3000")
  })

  test("uses remote host from server url", () => {
    const result = resolveProjectPreview({
      host: previewHostFromServer("http://10.0.0.5:4096"),
      packageJson: {
        scripts: { dev: "next dev" },
        dependencies: { next: "15.0.0" },
      },
    })
    expect(result.url).toBe("http://10.0.0.5:3000")
  })

  test("detects vite from config when deps live in workspace catalog", () => {
    const result = resolveProjectPreview({
      host: "localhost",
      packageJson: {
        scripts: { dev: "bun --cwd packages/app dev" },
      },
      viteConfig: "export default { server: { port: 3000 } }",
      devScriptText: "vite",
    })
    expect(result.port).toBe(3000)
    expect(result.isVite).toBe(true)
  })
})

describe("findAvailablePreviewPort", () => {
  test("returns preferred port when free", async () => {
    const port = await findAvailablePreviewPort("localhost", 5173, {
      probe: async () => false,
    })
    expect(port).toBe(5173)
  })

  test("skips occupied ports", async () => {
    const port = await findAvailablePreviewPort("localhost", 5173, {
      probe: async (url) => url.includes(":5173") || url.includes(":5174"),
    })
    expect(port).toBe(5175)
  })
})
  test("falls back to 5173 when preview port matches current page", () => {
    expect(avoidWebUiPortConflict(3000, true, 3000)).toBe(5173)
    expect(avoidWebUiPortConflict(3000, true, 5173)).toBe(3000)
  })
})

describe("validatePreviewHtmlForTest", () => {
  test("rejects OpenCode shell HTML", () => {
    const html = '<html><head><title>OpenCode</title><script id="oc-theme-preload-script"></script></head></html>'
    expect(validatePreviewHtmlForTest(html, "http://localhost:3000")).toBe(false)
  })

  test("accepts vite dev server HTML", () => {
    expect(validatePreviewHtmlForTest('<script type="module" src="/@vite/client"></script>', "http://localhost:5173")).toBe(
      true,
    )
  })
})
