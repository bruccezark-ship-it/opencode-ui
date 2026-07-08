#!/usr/bin/env node
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { crawlSpaRoutes } from "@opencode-ai/deploy-core"

process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  "D:/opencodewebui_v0/opencode-ui/packages/deploy-server/browsers"
process.env.OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL = "1"

async function startSpaStaticServer(outDir) {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
    const file = pathname === "/" ? join(outDir, "index.html") : join(outDir, pathname.slice(1))
    const target = existsSync(file) ? file : join(outDir, "index.html")
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(await readFile(target))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }
}

const outDir = await mkdtemp(join(tmpdir(), "deploy-crawl-test-"))
await writeFile(
  join(outDir, "index.html"),
  `<!doctype html><html><body><main id="app"><a href="/about">About</a></main></body></html>`,
)
await writeFile(join(outDir, "about.html"), `<!doctype html><html><body><main>About page</main></body></html>`)

const server = await startSpaStaticServer(outDir)
const started = Date.now()
try {
  const result = await crawlSpaRoutes({
    serverUrl: server.url,
    onStatus: (message) => console.log(message),
    maxPages: 5,
    maxDepth: 1,
  })
  console.log("routes:", result.routes)
  console.log("done in", Date.now() - started, "ms")
} finally {
  await server.close()
}
