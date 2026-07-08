import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import {
  fetchServerDeployConfigFromProject,
  startServerDeploy,
  type ServerDeploySseEvent,
} from "@/pages/session/server-deploy"

type DialogServerPublishProps = {
  projectRoot: string
}

type Phase = "form" | "progress" | "success"

const DEFAULT_USERNAME = "root"
const DEFAULT_PATH = "/var/www/html/"

export function DialogServerPublish(props: DialogServerPublishProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()

  const deployCtx = createMemo(() => ({
    client: sdk().client,
    serverUrl: sdk().url,
    directory: sdk().directory,
    projectRoot: props.projectRoot,
  }))

  const [phase, setPhase] = createSignal<Phase>("form")
  const [deploying, setDeploying] = createSignal(false)
  const [formError, setFormError] = createSignal<string | undefined>()
  const [steps, setSteps] = createStore<Array<{ step: number; total: number; name: string; message?: string }>>([])
  const [statusLines, setStatusLines] = createSignal<string[]>([])
  const [result, setResult] = createStore({
    host: "",
    remotePath: "",
    uploaded: 0,
    url: "",
  })

  const [store, setStore] = createStore({
    host: "",
    username: DEFAULT_USERNAME,
    password: "",
    path: DEFAULT_PATH,
    domain: "",
    protocol: "http" as "http" | "https",
  })

  let abort: AbortController | undefined

  createEffect(() => {
    const root = props.projectRoot
    const directory = sdk().directory
    void loadConfig(root, directory)
  })

  async function loadConfig(projectRoot: string, workspaceDirectory: string) {
    try {
      const config = await fetchServerDeployConfigFromProject(
        sdk().client,
        projectRoot,
        workspaceDirectory,
      )
      if (config.host) setStore("host", config.host)
      if (config.username) setStore("username", config.username)
      if (config.path) setStore("path", config.path)
      if (config.domain) setStore("domain", config.domain)
      if (config.protocol) setStore("protocol", config.protocol)
    } catch {
      // server-config.json may not exist yet
    }
  }

  function resetProgress() {
    setSteps([])
    setStatusLines([])
    setResult({ host: "", remotePath: "", uploaded: 0, url: "" })
  }

  function handleEvent(event: ServerDeploySseEvent) {
    if (event.type === "error") {
      setFormError(event.message)
      showToast({
        variant: "error",
        title: language.t("session.preview.publishServer.failed"),
        description: event.message,
      })
      setPhase("form")
      return
    }
    if (event.type === "step-start") {
      setSteps((items) => [...items, { step: event.step, total: event.total, name: event.name }])
      return
    }
    if (event.type === "step-complete") {
      setSteps((items) => {
        const index = items.findIndex((item) => item.step === event.step)
        if (index < 0) return items
        const next = [...items]
        next[index] = { ...next[index], message: event.message }
        return next
      })
      return
    }
    if (event.type === "status") {
      setStatusLines((items) => [...items, event.message])
      return
    }
    if (event.type === "complete" && "uploaded" in event.result) {
      setResult({
        host: event.result.host,
        remotePath: event.result.remotePath,
        uploaded: event.result.uploaded,
        url: event.result.url,
      })
      if (event.result.host) setStore("host", event.result.host)
      if (event.result.remotePath) setStore("path", event.result.remotePath)
      if (event.result.domain) setStore("domain", event.result.domain)
      if (event.result.protocol) setStore("protocol", event.result.protocol)
      setPhase("success")
    }
  }

  async function startDeploy() {
    if (!store.host.trim() || !store.password.trim() || !store.domain.trim()) {
      setFormError(language.t("session.preview.publishServer.requiredFields"))
      return
    }
    resetProgress()
    setFormError(undefined)
    setDeploying(true)
    setPhase("progress")
    abort?.abort()
    abort = new AbortController()

    try {
      await startServerDeploy(
        deployCtx(),
        {
          projectRoot: props.projectRoot,
          host: store.host.trim(),
          username: store.username.trim() || DEFAULT_USERNAME,
          password: store.password,
          path: store.path.trim() || DEFAULT_PATH,
          domain: store.domain.trim(),
          protocol: store.protocol,
        },
        handleEvent,
        abort.signal,
      )
    } catch (error) {
      if (abort.signal.aborted) return
      const message = error instanceof Error ? error.message : language.t("session.preview.publishServer.failed")
      setFormError(message)
      showToast({
        variant: "error",
        title: language.t("session.preview.publishServer.failed"),
        description: message,
      })
      setPhase("form")
    } finally {
      setDeploying(false)
    }
  }

  function close() {
    abort?.abort()
    dialog.close()
  }

  const canSubmit = createMemo(
    () =>
      !deploying() &&
      store.host.trim().length > 0 &&
      store.password.trim().length > 0 &&
      store.domain.trim().length > 0,
  )

  return (
    <Dialog
      title={language.t("session.preview.publishServer.title")}
      class="w-full max-w-[560px] mx-auto [&_[data-slot=dialog-body]]:flex [&_[data-slot=dialog-body]]:min-h-0 [&_[data-slot=dialog-body]]:overflow-visible"
    >
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pt-0 pb-2">
          <Show when={formError()}>
            <div class="rounded-lg border border-border-warning-base bg-surface-warning-base/20 px-3 py-2 text-12-regular text-text-warning whitespace-pre-wrap">
              {formError()}
            </div>
          </Show>

          <Switch>
            <Match when={phase() === "form"}>
              <div class="flex flex-col gap-5">
                <TextField
                  autofocus
                  label={language.t("session.preview.publishServer.domain")}
                  placeholder={language.t("session.preview.publishServer.domainPlaceholder")}
                  value={store.domain}
                  onChange={(value) => setStore("domain", value)}
                />

                <div class="flex flex-col gap-2">
                  <label class="text-12-medium text-text-weak">{language.t("session.preview.publishServer.protocol")}</label>
                  <div class="flex gap-2">
                    <Button
                      type="button"
                      size="small"
                      variant={store.protocol === "http" ? "primary" : "ghost"}
                      onClick={() => setStore("protocol", "http")}
                    >
                      HTTP
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant={store.protocol === "https" ? "primary" : "ghost"}
                      onClick={() => setStore("protocol", "https")}
                    >
                      HTTPS
                    </Button>
                  </div>
                </div>

                <TextField
                  label={language.t("session.preview.publishServer.host")}
                  placeholder={language.t("session.preview.publishServer.hostPlaceholder")}
                  value={store.host}
                  onChange={(value) => setStore("host", value)}
                />

                <TextField
                  label={language.t("session.preview.publishServer.username")}
                  placeholder={DEFAULT_USERNAME}
                  value={store.username}
                  onChange={(value) => setStore("username", value)}
                />

                <TextField
                  type="password"
                  label={language.t("session.preview.publishServer.password")}
                  placeholder={language.t("session.preview.publishServer.passwordPlaceholder")}
                  value={store.password}
                  onChange={(value) => setStore("password", value)}
                />

                <TextField
                  label={language.t("session.preview.publishServer.path")}
                  placeholder={DEFAULT_PATH}
                  value={store.path}
                  onChange={(value) => setStore("path", value)}
                />

                <div class="text-12-regular text-text-weak">
                  {language.t("session.preview.publishServer.hint")}
                </div>
              </div>
            </Match>

            <Match when={phase() === "progress"}>
              <div class="space-y-3">
                <Show when={steps.length === 0 && statusLines().length === 0}>
                  <div class="text-12-regular text-text-weak">
                    {language.t("session.preview.publishServer.starting")}
                  </div>
                </Show>
                <For each={steps}>
                  {(step) => (
                    <div class="flex items-start gap-2 text-12-regular text-text-weak">
                      <Icon name={step.message ? "check" : "loader"} size="small" class="mt-0.5 shrink-0" />
                      <div>
                        <div>
                          [{step.step}/{step.total}] {step.name}
                        </div>
                        <Show when={step.message}>
                          <div class="text-11-regular text-text-weaker">{step.message}</div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
                <Show when={statusLines().length > 0}>
                  <div class="max-h-32 overflow-y-auto text-11-regular text-text-weaker space-y-0.5">
                    <For each={statusLines()}>{(line) => <div>{line}</div>}</For>
                  </div>
                </Show>
              </div>
            </Match>

            <Match when={phase() === "success"}>
              <div class="space-y-3 text-12-regular text-text-weak">
                <div class="text-text-base">{language.t("session.preview.publishServer.success")}</div>
                <Show when={result.url}>
                  <div class="break-all">
                    {language.t("session.preview.publishServer.resultUrl", { url: result.url })}
                  </div>
                </Show>
                <div>{language.t("session.preview.publishServer.resultHost", { host: result.host })}</div>
                <div class="break-all">
                  {language.t("session.preview.publishServer.resultPath", { path: result.remotePath })}
                </div>
                <div>{language.t("session.preview.publishServer.resultUploaded", { count: result.uploaded })}</div>
              </div>
            </Match>
          </Switch>
        </div>

        <div class="flex shrink-0 justify-end gap-2 border-t border-border-weaker-base px-6 pb-6 pt-4">
          <Button type="button" variant="ghost" size="large" onClick={close}>
            {phase() === "success" ? language.t("common.close") : language.t("common.cancel")}
          </Button>
          <Show when={phase() === "form"}>
            <Button
              type="button"
              variant="primary"
              size="large"
              disabled={!canSubmit()}
              onClick={() => void startDeploy()}
            >
              {language.t("session.preview.publishServer.confirm")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
