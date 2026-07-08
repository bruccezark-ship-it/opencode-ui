import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import {
  cancelRouteDiscovery,
  chooseBrowserRouteDiscovery,
  fetchDeployStatus,
  previewCosDeploy,
  selectRouteDiscoveryOption,
  startCosDeploy,
  verifyCdnOwnership,
  type CdnVerifyRecord,
  type DeployMode,
  type DeployPreview,
  type DeploySseEvent,
  type RouteDiscoveryOptionSummary,
} from "@/pages/session/cos-deploy"

type DialogCosPublishProps = {
  projectRoot: string
}

type Phase = "form" | "progress" | "route-discovery" | "verification" | "success"

export function DialogCosPublish(props: DialogCosPublishProps) {
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
  const [loading, setLoading] = createSignal(false)
  const [preview, setPreview] = createSignal<DeployPreview | undefined>()
  const [statusError, setStatusError] = createSignal<string | undefined>()
  const [baseDomain, setBaseDomain] = createSignal("")
  const [projectName, setProjectName] = createSignal("")
  const [steps, setSteps] = createStore<Array<{ step: number; total: number; name: string; message?: string }>>([])
  const [statusLines, setStatusLines] = createSignal<string[]>([])
  const [verification, setVerification] = createStore({
    sessionId: "",
    record: null as CdnVerifyRecord | null,
    message: undefined as string | undefined,
  })
  const [routeDiscovery, setRouteDiscovery] = createStore({
    sessionId: "",
    options: [] as RouteDiscoveryOptionSummary[],
    message: undefined as string | undefined,
  })
  const [result, setResult] = createStore({
    urls: [] as string[],
    cosPath: "",
    cdnEntries: [] as Array<{ domain: string; cname: string }>,
  })

  const [store, setStore] = createStore({
    mode: "subdomain" as DeployMode,
    target: "",
    protocol: "http" as "http" | "https",
    cdnHttps: false,
    certId: "",
  })

  let abort: AbortController | undefined

  createEffect(() => {
    void loadStatus()
  })

  async function loadStatus() {
    setLoading(true)
    setStatusError(undefined)
    try {
      const status = await fetchDeployStatus(deployCtx())
      if (!status) {
        setStatusError(language.t("session.preview.publishCos.serverUnavailable"))
        return
      }
      if (!status.configured) {
        setStatusError(status.error ?? language.t("session.preview.publishCos.configMissing"))
        return
      }
      if (status.error) {
        setStatusError(status.error)
      }
      if (status.baseDomain) setBaseDomain(status.baseDomain)
      if (status.project?.name) setProjectName(status.project.name)
      if (status.protocol) setStore("protocol", status.protocol)
      if (status.cdnHttps !== undefined) setStore("cdnHttps", status.cdnHttps)
      if (status.certId) setStore("certId", status.certId)
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : language.t("session.preview.publishCos.serverUnavailable"),
      )
    } finally {
      setLoading(false)
    }
  }

  const targetPlaceholder = createMemo(() =>
    store.mode === "subdomain"
      ? language.t("session.preview.publishCos.subdomainPlaceholder")
      : language.t("session.preview.publishCos.domainPlaceholder"),
  )

  const targetLabel = createMemo(() =>
    store.mode === "subdomain"
      ? language.t("session.preview.publishCos.subdomain")
      : language.t("session.preview.publishCos.domain"),
  )

  const blockedDomains = createMemo(() => preview()?.blockedDomains ?? [])

  createEffect(() => {
    const target = store.target
    const mode = store.mode
    const protocol = store.protocol
    const cdnHttps = store.cdnHttps
    const certId = store.certId

    if (!target.trim()) {
      setPreview(undefined)
      return
    }

    void mode
    void protocol
    void cdnHttps
    void certId

    const timer = window.setTimeout(() => {
      void refreshPreview({ silent: true })
    }, 500)

    onCleanup(() => window.clearTimeout(timer))
  })

  async function refreshPreview(options?: { silent?: boolean }) {
    if (!store.target.trim()) {
      setPreview(undefined)
      return
    }
    try {
      const next = await previewCosDeploy(deployCtx(), {
        projectRoot: props.projectRoot,
        mode: store.mode,
        target: store.target,
        protocol: store.protocol,
        cdnHttps: store.cdnHttps,
        certId: store.certId || undefined,
      })
      setPreview(next)
    } catch (error) {
      setPreview(undefined)
      if (!options?.silent) {
        showToast({
          variant: "error",
          title: language.t("session.preview.publishCos.previewFailed"),
          description: error instanceof Error ? error.message : undefined,
        })
      }
    }
  }

  function resetProgress() {
    setSteps([])
    setStatusLines([])
    setVerification({ sessionId: "", record: null, message: undefined })
    setRouteDiscovery({ sessionId: "", options: [], message: undefined })
    setResult({ urls: [], cosPath: "", cdnEntries: [] })
  }

  function handleEvent(event: DeploySseEvent) {
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
      if (verification.sessionId) {
        setVerification("message", event.message)
        if (event.message.includes("验证通过")) {
          setVerification({ sessionId: "", record: null, message: undefined })
          setPhase("progress")
        }
      }
      return
    }
    if (event.type === "route-discovery") {
      setRouteDiscovery({
        sessionId: event.sessionId,
        options: event.options,
        message: undefined,
      })
      setPhase("route-discovery")
      return
    }
    if (event.type === "cdn-verification") {
      setVerification({ sessionId: event.sessionId, record: event.record, message: undefined })
      setPhase("verification")
      return
    }
    if (event.type === "complete") {
      setResult({
        urls: event.result.urls,
        cosPath: event.result.cosPath,
        cdnEntries: event.result.cdnEntries.map((entry) => ({
          domain: entry.domain,
          cname: entry.cname,
        })),
      })
      setPhase("success")
    }
  }

  async function startDeploy() {
    if (!store.target.trim()) return
    resetProgress()
    setPhase("progress")
    abort?.abort()
    abort = new AbortController()

    try {
      await startCosDeploy(
        deployCtx(),
        {
          projectRoot: props.projectRoot,
          mode: store.mode,
          target: store.target,
          protocol: store.protocol,
          cdnHttps: store.cdnHttps,
          certId: store.certId || undefined,
        },
        handleEvent,
        abort.signal,
      )
    } catch (error) {
      if (abort.signal.aborted) return
      showToast({
        variant: "error",
        title: language.t("session.preview.publishCos.failed"),
        description: error instanceof Error ? error.message : undefined,
      })
      setPhase("form")
    }
  }

  async function runRouteDiscovery(action: "select" | "browser" | "cancel", optionId?: string) {
    if (!routeDiscovery.sessionId) return

    try {
      if (action === "select" && optionId) {
        await selectRouteDiscoveryOption({ sessionId: routeDiscovery.sessionId, optionId })
        setRouteDiscovery({ sessionId: "", options: [], message: undefined })
        setPhase("progress")
        return
      }
      if (action === "browser") {
        await chooseBrowserRouteDiscovery({ sessionId: routeDiscovery.sessionId })
        setRouteDiscovery({ sessionId: "", options: [], message: undefined })
        setPhase("progress")
        return
      }
      if (action === "cancel") {
        await cancelRouteDiscovery({ sessionId: routeDiscovery.sessionId })
        abort?.abort()
        setRouteDiscovery({ sessionId: "", options: [], message: undefined })
        setPhase("form")
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : language.t("session.preview.publishCos.routeDiscoveryFailed")
      setRouteDiscovery("message", message)
      showToast({
        variant: "error",
        title: language.t("session.preview.publishCos.routeDiscoveryFailed"),
        description: message,
      })
    }
  }

  async function runVerification(action: "verify" | "refresh" | "cancel") {
    if (!verification.sessionId) return

    try {
      await verifyCdnOwnership({ action })
      if (action === "cancel") {
        abort?.abort()
        setPhase("form")
        setVerification({ sessionId: "", record: null, message: undefined })
      }
      if (action === "verify" || action === "refresh") {
        setVerification("message", language.t("session.preview.publishCos.verificationPending"))
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : language.t("session.preview.publishCos.verifyFailed")
      setVerification("message", message)
      showToast({
        variant: "error",
        title: language.t("session.preview.publishCos.verifyFailed"),
        description: message,
      })
    }
  }

  function close() {
    abort?.abort()
    if (verification.sessionId) {
      void verifyCdnOwnership({ action: "cancel" }).catch(() => {})
    }
    if (routeDiscovery.sessionId) {
      void cancelRouteDiscovery({ sessionId: routeDiscovery.sessionId }).catch(() => {})
    }
    dialog.close()
  }

  return (
    <Dialog title={language.t("session.preview.publishCos.title")} class="w-full max-w-[560px] mx-auto">
      <div class="flex flex-col gap-5 p-6 pt-0">
        <Show when={statusError()}>
          <div class="rounded-lg border border-border-warning-base bg-surface-warning-base/20 px-3 py-2 text-12-regular text-text-weak whitespace-pre-wrap">
            {statusError()}
          </div>
        </Show>

        <Switch>
          <Match when={phase() === "form"}>
            <Show when={projectName()}>
              <div class="text-12-regular text-text-weak">
                {language.t("session.preview.publishCos.project", { name: projectName() })}
              </div>
            </Show>

            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">{language.t("session.preview.publishCos.mode")}</label>
              <div class="flex gap-2">
                <Button
                  type="button"
                  size="small"
                  variant={store.mode === "subdomain" ? "primary" : "ghost"}
                  onClick={() => {
                    setStore("mode", "subdomain")
                    setPreview(undefined)
                  }}
                >
                  {language.t("session.preview.publishCos.modeSubdomain")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant={store.mode === "domain" ? "primary" : "ghost"}
                  onClick={() => {
                    setStore("mode", "domain")
                    setPreview(undefined)
                  }}
                >
                  {language.t("session.preview.publishCos.modeDomain")}
                </Button>
              </div>
            </div>

            <Show when={blockedDomains().length > 0}>
              <div class="rounded-lg border border-border-warning-base bg-surface-warning-base/20 px-3 py-2 text-12-regular text-text-warning">
                {language.t("session.preview.publishCos.domainTaken", {
                  domains: blockedDomains().join("、"),
                })}
              </div>
            </Show>

            <TextField
              autofocus
              label={targetLabel()}
              description={
                store.mode === "subdomain" && baseDomain()
                  ? language.t("session.preview.publishCos.subdomainHint", { baseDomain: baseDomain() })
                  : undefined
              }
              placeholder={targetPlaceholder()}
              value={store.target}
              onChange={(value) => setStore("target", value)}
            />

            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-12-medium text-text-weak">{language.t("session.preview.publishCos.protocol")}</label>
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
                    onClick={() => {
                      setStore("protocol", "https")
                      setStore("cdnHttps", true)
                    }}
                  >
                    HTTPS
                  </Button>
                </div>
              </div>

              <label class="flex items-center gap-2 text-12-regular text-text-weak self-end pb-1">
                <input
                  type="checkbox"
                  checked={store.cdnHttps}
                  onChange={(event) => setStore("cdnHttps", event.currentTarget.checked)}
                />
                {language.t("session.preview.publishCos.cdnHttps")}
              </label>
            </div>

            <Show when={store.cdnHttps}>
              <TextField
                label={language.t("session.preview.publishCos.certId")}
                placeholder={language.t("session.preview.publishCos.certIdPlaceholder")}
                value={store.certId}
                onChange={(value) => setStore("certId", value)}
              />
            </Show>

            <div class="flex justify-end">
              <Button type="button" size="small" variant="ghost" disabled={!store.target.trim()} onClick={() => void refreshPreview()}>
                {language.t("session.preview.publishCos.preview")}
              </Button>
            </div>

            <Show when={preview()}>
              {(plan) => (
                <div class="rounded-lg border border-border-weaker-base bg-background-stronger px-3 py-3 text-12-regular text-text-weak space-y-1">
                  <div>{language.t("session.preview.publishCos.previewUrls", { urls: plan().urls.join(", ") })}</div>
                  <div>{language.t("session.preview.publishCos.previewCdn", { domains: plan().cdnDomains.join(", ") })}</div>
                  <div>{language.t("session.preview.publishCos.previewCos", { path: plan().cosPrefix })}</div>
                  <Show when={plan().expandedDomains}>
                    <div>{language.t("session.preview.publishCos.previewExpanded", { domains: plan().expandedDomains!.join(", ") })}</div>
                  </Show>
                  <Show when={plan().skipCdnAndDns}>
                    <div>{language.t("session.preview.publishCos.previewSkipCdn")}</div>
                  </Show>
                </div>
              )}
            </Show>
          </Match>

          <Match when={phase() === "progress"}>
            <div class="space-y-3">
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

          <Match when={phase() === "route-discovery" && routeDiscovery.sessionId}>
            <div class="space-y-3 text-12-regular text-text-weak">
              <div>{language.t("session.preview.publishCos.routeDiscoveryTitle")}</div>
              <div class="space-y-2">
                <For each={routeDiscovery.options}>
                  {(option) => (
                    <div class="rounded-lg border border-border-weaker-base bg-background-stronger px-3 py-3 space-y-2">
                      <div class="text-text-base">{option.label}</div>
                      <div class="text-11-regular text-text-weaker">
                        {language.t("session.preview.publishCos.routeDiscoveryCount", { count: option.routeCount })}
                      </div>
                      <div class="font-mono text-11-regular break-all text-text-weaker">{option.routePreview}</div>
                      <Button
                        type="button"
                        variant="primary"
                        size="small"
                        onClick={() => void runRouteDiscovery("select", option.id)}
                      >
                        {language.t("session.preview.publishCos.routeDiscoveryUseFile")}
                      </Button>
                    </div>
                  )}
                </For>
              </div>
              <Show when={routeDiscovery.message}>
                <div class="text-text-warning">{routeDiscovery.message}</div>
              </Show>
              <div class="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="small" onClick={() => void runRouteDiscovery("browser")}>
                  {language.t("session.preview.publishCos.routeDiscoveryUseBrowser")}
                </Button>
                <Button type="button" variant="ghost" size="small" onClick={() => void runRouteDiscovery("cancel")}>
                  {language.t("common.cancel")}
                </Button>
              </div>
            </div>
          </Match>

          <Match when={phase() === "verification" && verification.sessionId}>
            <div class="space-y-3 text-12-regular text-text-weak">
              <div>{language.t("session.preview.publishCos.verificationTitle", { domain: verification.record!.domain })}</div>
              <div class="rounded-lg border border-border-weaker-base bg-background-stronger px-3 py-3 space-y-1 font-mono text-11-regular">
                <div>{language.t("session.preview.publishCos.verificationZone", { zone: verification.record!.rootDomain })}</div>
                <div>{language.t("session.preview.publishCos.verificationType", { type: verification.record!.recordType })}</div>
                <div>{language.t("session.preview.publishCos.verificationHost", { host: verification.record!.host })}</div>
                <div class="break-all">{language.t("session.preview.publishCos.verificationValue", { value: verification.record!.value })}</div>
                <div class="break-all">{language.t("session.preview.publishCos.verificationFqdn", { fqdn: verification.record!.fqdn })}</div>
              </div>
              <Show when={verification.message}>
                <div class="text-text-warning">{verification.message}</div>
              </Show>
              <div class="flex flex-wrap gap-2">
                <Button type="button" variant="primary" size="small" onClick={() => void runVerification("verify")}>
                  {language.t("session.preview.publishCos.verify")}
                </Button>
                <Button type="button" variant="ghost" size="small" onClick={() => void runVerification("refresh")}>
                  {language.t("session.preview.publishCos.refreshVerification")}
                </Button>
                <Button type="button" variant="ghost" size="small" onClick={() => void runVerification("cancel")}>
                  {language.t("common.cancel")}
                </Button>
              </div>
            </div>
          </Match>

          <Match when={phase() === "success" && result.urls.length > 0}>
            <div class="space-y-3 text-12-regular text-text-weak">
              <div class="text-text-base">{language.t("session.preview.publishCos.success")}</div>
              <For each={result.urls}>
                {(url) => (
                  <a href={url} target="_blank" rel="noopener noreferrer" class="block text-text-interactive-base hover:underline break-all">
                    {url}
                  </a>
                )}
              </For>
              <div class="break-all">{language.t("session.preview.publishCos.cosPath", { path: result.cosPath })}</div>
              <For each={result.cdnEntries}>
                {(entry) => (
                  <div class="break-all">
                    {language.t("session.preview.publishCos.cdnCname", { domain: entry.domain, cname: entry.cname })}
                  </div>
                )}
              </For>
            </div>
          </Match>
        </Switch>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={close}>
            {phase() === "success" ? language.t("common.close") : language.t("common.cancel")}
          </Button>
          <Show when={phase() === "form"}>
            <Button
              type="button"
              variant="primary"
              size="large"
              disabled={loading() || !!statusError() || !store.target.trim() || blockedDomains().length > 0}
              onClick={() => void startDeploy()}
            >
              {language.t("session.preview.publishCos.confirm")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
