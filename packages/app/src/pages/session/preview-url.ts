export type PackageJson = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
}

const DEFAULT_PORTS = {
  vite: 5173,
  next: 3000,
  nuxt: 3000,
  reactScripts: 3000,
  angular: 4200,
  generic: 3000,
} as const

export function previewHostFromServer(serverUrl: string) {
  try {
    const url = new URL(serverUrl)
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1"
    return loopback ? "localhost" : url.hostname
  } catch {
    return "localhost"
  }
}

export function extractPortFromScript(script: string) {
  const patterns = [/--port(?:=|\s+)(\d+)/, /(?:^|\s)-p(?:=|\s+)(\d+)/, /\bPORT=(\d+)/]
  for (const pattern of patterns) {
    const match = script.match(pattern)
    if (match) return Number(match[1])
  }
}

export function extractPortFromViteConfig(content: string) {
  const serverBlock = content.match(/server\s*:\s*\{[\s\S]*?\}/)
  if (serverBlock) {
    const port = serverBlock[0].match(/\bport\s*:\s*(\d+)/)
    if (port) return Number(port[1])
  }
  const direct = content.match(/\bport\s*:\s*(\d+)/)
  if (direct) return Number(direct[1])
}

export function resolveProjectPreview(input: {
  packageJson?: PackageJson | null
  viteConfig?: string | null
  host: string
  devScriptText?: string
}) {
  const deps = { ...input.packageJson?.dependencies, ...input.packageJson?.devDependencies }
  const scripts = input.packageJson?.scripts ?? {}
  const devScript = input.devScriptText ?? scripts.dev ?? scripts.start ?? scripts.serve ?? scripts.preview

  let port = devScript ? extractPortFromScript(devScript) : undefined

  if (!port && input.viteConfig) {
    port = extractPortFromViteConfig(input.viteConfig)
  }

  const isVite =
    Boolean(input.viteConfig) ||
    Boolean(deps?.vite || deps?.["@vitejs/plugin-react"] || deps?.["@vitejs/plugin-vue"]) ||
    Boolean(devScript && /\bvite\b/.test(devScript))

  if (!port) {
    if (isVite) {
      port = DEFAULT_PORTS.vite
    } else if (deps?.next || devScript?.includes("next")) {
      port = DEFAULT_PORTS.next
    } else if (deps?.nuxt || devScript?.includes("nuxt")) {
      port = DEFAULT_PORTS.nuxt
    } else if (deps?.["react-scripts"]) {
      port = DEFAULT_PORTS.reactScripts
    } else if (deps?.["@angular/core"]) {
      port = DEFAULT_PORTS.angular
    } else {
      port = DEFAULT_PORTS.generic
    }
  }

  port = avoidWebUiPortConflict(port, isVite)

  return {
    url: `http://${input.host}:${port}`,
    port,
    isVite,
  }
}

export function avoidWebUiPortConflict(port: number, isVite: boolean, currentPort?: number) {
  let current = currentPort
  if (current === undefined && typeof window !== "undefined") {
    current = Number(window.location.port || (window.location.protocol === "https:" ? 443 : 80))
  }
  if (current === undefined || port !== current) return port
  if (isVite) return DEFAULT_PORTS.vite
  return port === 3000 ? 5173 : port + 1
}

export function vitePortOverrideArgs(requestedPort: number, configPort: number | undefined) {
  if (!configPort || requestedPort === configPort) return []
  return ["--", "--port", String(requestedPort), "--strictPort"]
}

export function buildPreviewUrl(host: string, port: number) {
  return `http://${host}:${port}`
}

export async function findAvailablePreviewPort(
  host: string,
  preferredPort: number,
  options?: { maxAttempts?: number; probe?: (url: string) => Promise<boolean> },
) {
  const maxAttempts = options?.maxAttempts ?? 30
  const probe = options?.probe ?? probePreviewUrl
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferredPort + offset
    const occupied = await probe(buildPreviewUrl(host, port))
    if (!occupied) return port
  }
  return preferredPort
}

export function normalizePreviewUrl(input: string) {
  const value = input.trim()
  if (!value) return ""
  if (/^https?:\/\//i.test(value)) return value
  return `http://${value}`
}

export function parsePackageJson(content: string) {
  try {
    return JSON.parse(content) as PackageJson
  } catch {
    return null
  }
}

export async function probePreviewUrl(url: string, timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      mode: "cors",
    })
    if (!response.ok) return false
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("text/html")) return true
    const html = await response.text()
    return validatePreviewHtml(html, url)
  } catch {
    try {
      await fetch(url, { method: "GET", mode: "no-cors", signal: controller.signal, cache: "no-store" })
      return !sameOrigin(url)
    } catch {
      return false
    }
  } finally {
    clearTimeout(timer)
  }
}

function sameOrigin(url: string) {
  if (typeof window === "undefined") return false
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return false
  }
}

function isOpenCodeShell(html: string) {
  return (
    html.includes('id="oc-theme-preload-script"') ||
    html.includes("/src/entry.tsx") ||
    html.includes("<title>OpenCode</title>")
  )
}

function validatePreviewHtml(html: string, url: string) {
  if (isOpenCodeShell(html)) return false
  if (html.includes("@vite/client") || html.includes("/@vite/")) return true
  if (html.includes("__next") || html.includes("webpack-dev-server")) return true

  if (sameOrigin(url)) {
    return /<!doctype html/i.test(html) || /<html[\s>]/i.test(html)
  }

  return /<!doctype html/i.test(html) || /<html[\s>]/i.test(html)
}

export function validatePreviewHtmlForTest(html: string, url: string) {
  return validatePreviewHtml(html, url)
}

export const VITE_CONFIG_CANDIDATES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
] as const

export function resolvePreviewTarget(input: {
  kind: "node" | "static" | "python" | "unknown"
  packageJson?: PackageJson | null
  viteConfig?: string | null
  host: string
  rootFiles?: string[]
}) {
  if (input.kind === "static") {
    return { url: buildPreviewUrl(input.host, DEFAULT_PORTS.generic), port: DEFAULT_PORTS.generic }
  }

  if (input.kind === "python" && input.rootFiles?.includes("manage.py")) {
    return { url: buildPreviewUrl(input.host, 8000), port: 8000 }
  }

  if (input.kind === "node" && input.packageJson) {
    const scripts = input.packageJson.scripts ?? {}
    const devScript = scripts.dev ?? scripts.start ?? scripts.serve ?? scripts.preview
    return resolveProjectPreview({
      packageJson: input.packageJson,
      viteConfig: input.viteConfig ?? null,
      host: input.host,
      devScriptText: devScript,
    })
  }

  return undefined
}
