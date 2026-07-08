import {
  formatRouteDiscoverySummary,
  formatRoutePreview,
  pickDefaultRouteDiscoveryOption,
  type RouteDiscoveryOption,
  type RouteDiscoverySelectResult,
} from "@opencode-ai/deploy-core"
import type { DeployInputAction } from "./stdin-bridge.js"
import type { SseEvent } from "./types.js"

type Emit = (event: SseEvent) => void | Promise<void>

export function createRouteDiscoverySelectHandler(
  emit: Emit,
  waitForInput: (() => Promise<DeployInputAction>) | undefined,
  configuredRouteFile?: string,
) {
  return async (options: RouteDiscoveryOption[]): Promise<RouteDiscoverySelectResult | undefined> => {
    const routerOptions = options.filter((option) => option.method === "routerFile")

    if (routerOptions.length === 0) {
      if (options.length === 0) return undefined
      if (options.length === 1) return options[0]
      return pickDefaultRouteDiscoveryOption(options, configuredRouteFile)
    }

    if (!waitForInput) {
      const selected = pickDefaultRouteDiscoveryOption(routerOptions, configuredRouteFile)
      if (selected) {
        await emit({ type: "status", message: `使用路由表: ${formatRouteDiscoverySummary(selected)}` })
      }
      return selected
    }

    const sessionId = crypto.randomUUID()
    await emit({
      type: "route-discovery",
      sessionId,
      options: routerOptions.map((option) => ({
        id: option.id,
        label: option.label,
        routeCount: option.routes.length,
        routePreview: formatRoutePreview(option.routes),
      })),
    })

    while (true) {
      const input = await waitForInput()

      if (input.action === "route-discovery-cancel" && input.sessionId === sessionId) {
        throw new Error("用户取消路由选择")
      }

      if (input.action === "route-discovery-browser" && input.sessionId === sessionId) {
        await emit({ type: "status", message: "已选择浏览器爬取链接" })
        return "browser"
      }

      if (input.action === "route-discovery-select" && input.sessionId === sessionId) {
        const selected = routerOptions.find((option) => option.id === input.optionId)
        if (!selected) continue
        await emit({ type: "status", message: `使用路由表: ${formatRouteDiscoverySummary(selected)}` })
        return selected
      }
    }
  }
}
