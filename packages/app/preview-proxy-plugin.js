const PROXY_PREFIX = "/__opencode_preview__"
const INSPECTOR_SCRIPT = '<script src="/opencode-preview-inspector.js"></script>'

function encodeHost(host) {
  return encodeURIComponent(host)
}

function decodeHost(encoded) {
  return decodeURIComponent(encoded)
}

function buildProxyPrefix(host, port) {
  return `${PROXY_PREFIX}/${encodeHost(host)}/${port}`
}

function parseProxyRequest(requestUrl) {
  if (!requestUrl.startsWith(PROXY_PREFIX)) return null
  const parsed = new URL(requestUrl, "http://127.0.0.1")
  const parts = parsed.pathname.slice(PROXY_PREFIX.length).split("/").filter(Boolean)
  if (parts.length < 2) return null
  const host = decodeHost(parts[0])
  const port = parts[1]
  const path = `/${parts.slice(2).join("/")}`
  const targetPath = path === "/" ? "/" : path.replace(/\/{2,}/g, "/")
  return {
    host,
    port,
    path: targetPath,
    search: parsed.search,
    prefix: buildProxyPrefix(host, port),
  }
}

function targetOrigin(host, port) {
  const numericPort = Number(port)
  const isDefault =
    (numericPort === 80 && !host.includes(":")) || (numericPort === 443 && !host.includes(":"))
  if (isDefault) return `http://${host}`
  return `http://${host}:${port}`
}

function targetUrl(route) {
  return `${targetOrigin(route.host, route.port)}${route.path}${route.search}`
}

async function fetchUpstream(upstream) {
  try {
    return await fetch(upstream, {
      headers: { accept: "*/*" },
      redirect: "follow",
    })
  } catch (error) {
    const parsed = new URL(upstream)
    if (parsed.hostname !== "localhost") throw error
    parsed.hostname = "127.0.0.1"
    return fetch(parsed.toString(), {
      headers: { accept: "*/*" },
      redirect: "follow",
    })
  }
}

function proxyErrorHtml(message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview unavailable</title></head><body style="font:14px/1.5 sans-serif;padding:24px;color:#444"><h2 style="margin:0 0 8px">Preview unavailable</h2><p style="margin:0">${message}</p></body></html>`
}

function injectInspector(html) {
  if (html.includes("opencode-preview-inspector.js")) return html
  if (html.includes("</head>")) return html.replace("</head>", `${INSPECTOR_SCRIPT}</head>`)
  if (html.includes("</body>")) return html.replace("</body>", `${INSPECTOR_SCRIPT}</body>`)
  return `${html}${INSPECTOR_SCRIPT}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function rewriteAssetUrls(body, route) {
  const prefix = route.prefix
  const port = route.port
  const host = route.host
  const origins = new Set([
    targetOrigin(host, port),
    targetOrigin("127.0.0.1", port),
    targetOrigin("localhost", port),
  ])

  let next = body
  for (const origin of origins) {
    next = next.replace(new RegExp(escapeRegExp(origin), "g"), prefix)
  }

  const skipPrefix = `(?!\\/)(?!__opencode_preview__)`
  next = next.replace(new RegExp(`(["'\`])\\/${skipPrefix}`, "g"), `$1${prefix}/`)
  next = next.replace(
    new RegExp(`(\\bimport\\s*\\(\\s*["'\`])\\/${skipPrefix}`, "g"),
    `$1${prefix}/`,
  )
  next = next.replace(
    new RegExp(`(\\simport\\s+[^;]*?\\sfrom\\s*["'\`])\\/${skipPrefix}`, "g"),
    `$1${prefix}/`,
  )
  next = next.replace(new RegExp(`(\\simport\\s*["'\`])\\/${skipPrefix}`, "g"), `$1${prefix}/`)
  return next
}

function rewritePreviewHtml(html, route) {
  return injectInspector(rewriteAssetUrls(html, route))
}

function shouldRewriteBody(contentType) {
  return (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("text/css") ||
    contentType.includes("json") ||
    contentType.includes("text/plain")
  )
}

const VITE_INTERNAL_PREFIX = /^\/@(vite|fs|id|react-refresh|vite-plugin|solid-refresh)/

function parseProxyRouteFromReferer(referer) {
  if (!referer) return null
  try {
    const url = new URL(referer)
    return parseProxyRequest(`${url.pathname}${url.search}`)
  } catch {
    return null
  }
}

async function proxyUpstreamResponse(req, res, route, requestPath) {
  const upstream = `${targetOrigin(route.host, route.port)}${requestPath}`

  try {
    const response = await fetchUpstream(upstream)
    const contentType = response.headers.get("content-type") || "application/octet-stream"
    let body = await response.text()

    if (shouldRewriteBody(contentType)) {
      body = contentType.includes("text/html") ? rewritePreviewHtml(body, route) : rewriteAssetUrls(body, route)
    }

    res.statusCode = response.status
    res.setHeader("content-type", contentType)
    res.setHeader("cache-control", "no-store")
    res.end(body)
  } catch (error) {
    res.statusCode = 502
    res.setHeader("content-type", "text/html; charset=utf-8")
    res.end(
      proxyErrorHtml(
        error instanceof Error ? error.message : "Could not reach the preview dev server.",
      ),
    )
  }
}

async function handleViteRefererProxy(req, res, next) {
  const requestPath = (req.url || "/").split("?")[0]
  if (!VITE_INTERNAL_PREFIX.test(requestPath)) return next()

  const route = parseProxyRouteFromReferer(req.headers.referer)
  if (!route) return next()

  await proxyUpstreamResponse(req, res, route, req.url || "/")
}

async function handlePreviewProxy(req, res, next) {
  const route = parseProxyRequest(req.url || "")
  if (!route) return next()

  await proxyUpstreamResponse(req, res, route, `${route.path}${route.search}`)
}

export function createPreviewProxyPlugin() {
  return {
    name: "opencode-preview-proxy",
    configureServer(server) {
      server.middlewares.use(handleViteRefererProxy)
      server.middlewares.use(handlePreviewProxy)
    },
  }
}

export { PROXY_PREFIX, buildProxyPrefix, parseProxyRequest, rewritePreviewHtml, targetUrl }
