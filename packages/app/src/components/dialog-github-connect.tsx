import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { Link } from "@/components/link"
import { useLanguage } from "@/context/language"
import { useGitHubAuth } from "@/components/github/auth"
import { createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"

export function DialogGitHubConnect(props: { onConnected?: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const github = useGitHubAuth()
  const [store, setStore] = createStore({
    mode: "choose" as "choose" | "device" | "token" | "connecting",
    userCode: "",
    verificationUri: "",
    error: undefined as string | undefined,
  })
  const [token, setToken] = createSignal("")
  const alive = { value: true }

  onCleanup(() => {
    alive.value = false
  })

  async function finishConnect(nextToken: string) {
    setStore({ mode: "connecting", error: undefined })
    try {
      await github.saveToken(nextToken)
      if (!alive.value) return
      props.onConnected?.()
      dialog.close()
    } catch (error) {
      if (!alive.value) return
      setStore({
        mode: store.mode === "connecting" ? "token" : store.mode,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function startDeviceFlow() {
    setStore({ mode: "device", error: undefined })
    try {
      const device = await github.startDeviceFlow()
      if (!alive.value) return
      setStore({
        userCode: device.user_code,
        verificationUri: device.verification_uri,
      })
      const accessToken = await github.pollDeviceToken(device.device_code, device.interval, device.expires_in)
      if (!alive.value) return
      await finishConnect(accessToken)
    } catch (error) {
      if (!alive.value) return
      setStore({
        mode: "choose",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <Dialog title={language.t("github.connect.title")} transition>
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 text-14-regular text-text-base">{language.t("github.connect.description")}</div>
        <Switch>
          <Match when={store.mode === "connecting"}>
            <div class="px-2.5 flex items-center gap-3 text-14-regular text-text-base">
              <Spinner />
              <span>{language.t("github.connect.inProgress")}</span>
            </div>
          </Match>
          <Match when={store.mode === "device"}>
            <div class="px-2.5 flex flex-col gap-4 text-14-regular text-text-base">
              <div>
                {language.t("github.connect.device.prefix")}
                <Link href={store.verificationUri}>{language.t("github.connect.device.link")}</Link>
                {language.t("github.connect.device.suffix")}
              </div>
              <TextField label={language.t("github.connect.device.code")} value={store.userCode} readOnly copyable />
              <div class="flex items-center gap-3">
                <Spinner />
                <span>{language.t("github.connect.device.waiting")}</span>
              </div>
            </div>
          </Match>
          <Match when={store.mode === "token"}>
            <form
              class="px-2.5 flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void finishConnect(token())
              }}
            >
              <TextField
                autofocus
                type="password"
                label={language.t("github.connect.token.label")}
                placeholder={language.t("github.connect.token.placeholder")}
                value={token()}
                onChange={setToken}
                validationState={store.error ? "invalid" : undefined}
                error={store.error}
              />
              <div class="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setStore({ mode: "choose", error: undefined })}>
                  {language.t("common.goBack")}
                </Button>
                <Button type="submit" variant="primary">
                  {language.t("github.connect.action")}
                </Button>
              </div>
            </form>
          </Match>
          <Match when={true}>
            <div class="px-2.5 flex flex-col gap-4">
              <Show when={store.error}>
                <div class="text-14-regular text-text-critical-base">{store.error}</div>
              </Show>
              <Show when={github.deviceFlowEnabled()}>
                <Button variant="primary" onClick={() => void startDeviceFlow()}>
                  {language.t("github.connect.device.action")}
                </Button>
              </Show>
              <Button variant={github.deviceFlowEnabled() ? "ghost" : "primary"} onClick={() => setStore({ mode: "token", error: undefined })}>
                {language.t("github.connect.token.action")}
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
