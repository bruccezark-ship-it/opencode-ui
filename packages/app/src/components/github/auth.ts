import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { Persist, persisted } from "@/utils/persist"
import { GITHUB_DEVICE_CLIENT_ID, GITHUB_INTEGRATION_ID } from "./constants"
import { fetchGitHubUser } from "./api"

export type GitHubAuth = {
  token: string
  username?: string
}

type GitHubAuthStore = Record<string, GitHubAuth>

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type DeviceTokenResponse = {
  access_token?: string
  error?: string
  error_description?: string
}

export function useGitHubAuth() {
  const server = useServer()
  const serverSDK = useServerSDK()
  const [store, setStore] = persisted(Persist.global("github.auth.v1"), createStore<GitHubAuthStore>({}))

  const serverKey = createMemo(() => (server.current ? ServerConnection.key(server.current) : ""))
  const auth = createMemo(() => store[serverKey()] ?? { token: "", username: "" })

  const connected = () => !!auth().token.trim()

  async function hasServerIntegration() {
    const integration = serverSDK().client.v2?.integration
    if (!integration) return false

    const result = await integration.list().catch(() => undefined)
    const github = result?.data?.find((item) => item.id === GITHUB_INTEGRATION_ID)
    return (github?.connections?.length ?? 0) > 0
  }

  async function saveToken(token: string) {
    const trimmed = token.trim()
    if (!trimmed) throw new Error("Token is required")
    const key = serverKey()
    if (!key) throw new Error("Server is not connected")

    const user = await fetchGitHubUser(trimmed).catch((error) => {
      throw new Error(error instanceof Error ? error.message : "Invalid GitHub token")
    })
    setStore(key, { token: trimmed, username: user.login })

    const integrationClient = serverSDK().client.v2?.integration
    if (!integrationClient) return user.login

    const integration = await integrationClient
      .get({ integrationID: GITHUB_INTEGRATION_ID })
      .then((result) => result.data)
      .catch(() => undefined)

    if (integration?.methods?.some((method) => method.type === "key")) {
      await integrationClient.connect
        .key({
          integrationID: GITHUB_INTEGRATION_ID,
          key: trimmed,
          label: user.login ?? "GitHub",
        })
        .catch(() => undefined)
    }

    return user.login
  }

  function disconnect() {
    const key = serverKey()
    if (!key) return
    setStore(key, { token: "", username: "" })
  }

  async function startDeviceFlow() {
    if (!GITHUB_DEVICE_CLIENT_ID) {
      throw new Error("Missing VITE_GITHUB_CLIENT_ID")
    }

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_DEVICE_CLIENT_ID,
        scope: "read:user public_repo",
      }),
    })

    if (!response.ok) {
      throw new Error("Failed to start GitHub device authorization")
    }

    return response.json() as Promise<DeviceCodeResponse>
  }

  async function pollDeviceToken(deviceCode: string, interval: number, expiresIn: number) {
    if (!GITHUB_DEVICE_CLIENT_ID) {
      throw new Error("Missing VITE_GITHUB_CLIENT_ID")
    }

    const started = Date.now()
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    while (Date.now() - started < expiresIn * 1000) {
      await wait(Math.max(interval, 5) * 1000)

      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_DEVICE_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })

      const payload = (await response.json()) as DeviceTokenResponse
      if (payload.access_token) return payload.access_token
      if (payload.error && payload.error !== "authorization_pending" && payload.error !== "slow_down") {
        throw new Error(payload.error_description || payload.error)
      }
    }

    throw new Error("GitHub authorization timed out")
  }

  return {
    store: auth,
    connected,
    saveToken,
    disconnect,
    hasServerIntegration,
    startDeviceFlow,
    pollDeviceToken,
    deviceFlowEnabled: () => !!GITHUB_DEVICE_CLIENT_ID,
  }
}
