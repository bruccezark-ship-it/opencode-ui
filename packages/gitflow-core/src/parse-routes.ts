import type { GitflowFramework } from "./types.js"

export type ParseRoutesResult = {
  paths: string[]
  error?: string
}

function extractRouteArray(content: string, framework: GitflowFramework): string | undefined {
  const isVue = framework === "Vue"

  if (isVue) {
    const routeArrayRegex = /routes\s*:\s*\[([\s\S]*?)\](?=\s*[,)])/
    let arrayMatch = routeArrayRegex.exec(content)
    if (!arrayMatch) {
      arrayMatch = /export\s+const\s+routes[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(content)
    }
    return arrayMatch?.[1]
  }

  const routeArrayRegex = /export\s+const\s+routes[\s\S]*?=\s*\[([\s\S]*?)\];/
  let arrayMatch = routeArrayRegex.exec(content)
  if (!arrayMatch) {
    arrayMatch = /createBrowserRouter\s*\(\s*\[([\s\S]*?)\](?=\s*[,)])/.exec(content)
  }
  return arrayMatch?.[1]
}

function extractPaths(routeArrayBody: string): string[] {
  const pathRegex = /path\s*:\s*['"`]([^'"`]+)['"`]/g
  const paths: string[] = []
  let match: RegExpExecArray | null

  while ((match = pathRegex.exec(routeArrayBody)) !== null) {
    const p = match[1]
    if (p === "*" || p === "/*" || p.includes(":")) continue
    paths.push(p)
  }

  return paths
}

function parseWithFramework(content: string, framework: GitflowFramework): ParseRoutesResult {
  const body = extractRouteArray(content, framework)
  if (!body) {
    return { paths: [], error: "未能找到路由定义数组" }
  }

  const paths = extractPaths(body)
  if (paths.length === 0) {
    return { paths: [], error: "未能解析到任何路由路径" }
  }

  return { paths }
}

/**
 * 从路由文件内容解析所有路由路径（与 gitflow sitemap 脚本逻辑一致）。
 */
export function parseRoutesFromContent(content: string, framework: GitflowFramework): ParseRoutesResult {
  if (!content.trim()) {
    return { paths: [], error: "路由文件为空" }
  }

  const primary = parseWithFramework(content, framework)
  if (primary.paths.length > 0) return primary

  if (framework === "General" || framework === "Unknown") {
    for (const fallback of ["React", "Vue"] as const) {
      const result = parseWithFramework(content, fallback)
      if (result.paths.length > 0) return result
    }
  }

  return primary
}
