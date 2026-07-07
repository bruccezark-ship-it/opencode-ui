import { createEffect, createMemo, createResource, createSignal, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import {
  PREVIEW_INSPECTOR_MESSAGES,
  injectPreviewInspector,
  type PreviewElementSelection,
} from "@/pages/session/preview-inspector"
import {
  previewPhaseMessageKey,
  resolvePreviewStartPlan,
  type PreviewRunPhase,
} from "@/pages/session/preview-project"
import { ensurePreviewDevServer, stopPreviewDevServer, type PreviewStartError } from "@/pages/session/preview-runner"
import { fileText, loadProjectStructure } from "@/pages/session/preview-structure"
import {
  normalizePreviewUrl,
  previewHostFromServer,
  probePreviewUrl,
  resolvePreviewTarget,
} from "@/pages/session/preview-url"
import { Persist, persisted } from "@/utils/persist"

const PROBE_INTERVAL_MS = 3000

export function SessionPreviewTab() {
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const uiOrigin = createMemo(() => window.location.origin)

  const [store, setStore] = persisted(
    Persist.serverWorkspace(serverSDK().scope, sdk().directory, "preview-url"),
    createStore({
      override: "" as string,
      ptyId: "" as string,
    }),
  )

  const [draft, setDraft] = createSignal("")
  const [reloadKey, setReloadKey] = createSignal(0)
  const [reachable, setReachable] = createSignal<boolean | undefined>()
  const [draftTouched, setDraftTouched] = createSignal(false)
  const [phase, setPhase] = createSignal<PreviewRunPhase>("idle")
  const [startError, setStartError] = createSignal<PreviewStartError | undefined>()
  const [startToken, setStartToken] = createSignal(0)
  const [autoStart, setAutoStart] = createSignal(true)
  const [stopping, setStopping] = createSignal(false)
  const [editMode, setEditMode] = createSignal(false)
  let iframeRef: HTMLIFrameElement | undefined

  const readFile = async (path: string) => {
    const result = await sdk().client.file.read({ path })
    return fileText(result.data)
  }

  const listFiles = async (path: string) => {
    const result = await sdk().client.file.list({ path })
    return result.data ?? []
  }

  const [projectStructure, { refetch: refetchStructure }] = createResource(
    () => `${serverSDK().scope}\0${sdk().directory}`,
    () => loadProjectStructure(readFile, listFiles),
  )

  const previewHost = createMemo(() => previewHostFromServer(sdk().url))
  const remoteHost = createMemo(() => previewHost() !== "localhost")

  const previewTarget = createMemo(() => {
    const structure = projectStructure()
    if (!structure || structure.kind === "unknown") return
    return resolvePreviewTarget({
      kind: structure.kind,
      packageJson: structure.packageJson,
      viteConfig: structure.viteConfig,
      host: previewHost(),
      rootFiles: structure.rootFiles,
    })
  })

  const startPlan = createMemo(() => {
    const structure = projectStructure()
    const preview = previewTarget()
    if (!structure || !preview) return
    return resolvePreviewStartPlan({
      structure,
      host: previewHost(),
      remote: remoteHost(),
      preview,
    })
  })

  const activeUrl = createMemo(() => {
    const override = normalizePreviewUrl(store.override)
    if (override) return override
    if (!startPlan()) return ""
    return previewTarget()?.url ?? ""
  })

  createEffect(() => {
    if (draftTouched()) return
    const url = activeUrl()
    if (url) setDraft(url)
  })

  createEffect(() => {
    const url = activeUrl()
    if (!url) {
      setReachable(undefined)
      return
    }

    let cancelled = false
    const check = async () => {
      const ok = await probePreviewUrl(url)
      if (!cancelled) setReachable(ok)
    }

    void check()
    const timer = setInterval(() => {
      void check()
    }, PROBE_INTERVAL_MS)

    onCleanup(() => {
      cancelled = true
      clearInterval(timer)
    })
  })

  createEffect(() => {
    if (store.override) {
      setPhase("idle")
      return
    }

    if (!autoStart()) return

    const plan = startPlan()
    if (!plan || projectStructure.loading) return
    startToken()
    setStartError(undefined)

    const abort = new AbortController()
    const ptyId = untrack(() => store.ptyId) || undefined

    void ensurePreviewDevServer({
      client: sdk().client,
      plan,
      serverUrl: sdk().url,
      ptyId,
      signal: abort.signal,
      onPhase: setPhase,
      onPtyId: (next) => {
        if (untrack(() => store.ptyId) !== next) setStore("ptyId", next)
      },
      onError: setStartError,
    }).then((ready) => {
      if (abort.signal.aborted) return
      if (ready) setReloadKey((key) => key + 1)
    })

    onCleanup(() => abort.abort())
  })

  const postToPreview = (message: { type: string; enabled?: boolean }) => {
    iframeRef?.contentWindow?.postMessage(message, "*")
  }

  const activateEditMode = () => {
    if (!injectPreviewInspector(iframeRef, uiOrigin())) {
      postToPreview({ type: PREVIEW_INSPECTOR_MESSAGES.inject, uiOrigin: uiOrigin() })
    }
    postToPreview({ type: PREVIEW_INSPECTOR_MESSAGES.edit, enabled: true })
  }

  createEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object") return
      if (data.type === PREVIEW_INSPECTOR_MESSAGES.ready) {
        if (editMode()) activateEditMode()
        return
      }
      if (data.type !== PREVIEW_INSPECTOR_MESSAGES.selected) return
      const payload = data.payload as PreviewElementSelection | undefined
      if (!payload?.selector) return
      prompt.context.add({
        type: "preview",
        url: payload.url ?? activeUrl(),
        selector: payload.selector,
        tagName: payload.tagName,
        id: payload.id,
        className: payload.className,
        text: payload.text,
        html: payload.html,
      })
    }

    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  createEffect(() => {
    if (!editMode()) {
      postToPreview({ type: PREVIEW_INSPECTOR_MESSAGES.edit, enabled: false })
      return
    }

    activateEditMode()

    const retry = window.setInterval(() => {
      if (!editMode()) return
      activateEditMode()
    }, 250)

    onCleanup(() => window.clearInterval(retry))
  })

  const commitUrl = () => {
    const next = normalizePreviewUrl(draft())
    if (!next) return
    setStore("override", next)
    setDraft(next)
    setDraftTouched(false)
    setPhase("idle")
    setReloadKey((key) => key + 1)
  }

  const resetUrl = () => {
    setStore("override", "")
    setDraftTouched(false)
    setAutoStart(true)
    setStartToken((token) => token + 1)
    setReloadKey((key) => key + 1)
  }

  const refresh = () => {
    void refetchStructure()
    setAutoStart(true)
    setStartToken((token) => token + 1)
    setReloadKey((key) => key + 1)
  }

  const stopServer = async () => {
    if (stopping()) return
    setStopping(true)
    setEditMode(false)
    await stopPreviewDevServer({
      client: sdk().client,
      ptyId: store.ptyId || undefined,
    })
    setStore("ptyId", "")
    setAutoStart(false)
    setPhase("idle")
    setReachable(false)
    setStartError(undefined)
    setReloadKey((key) => key + 1)
    setStopping(false)
  }

  const openExternal = () => {
    const url = activeUrl()
    if (!url) return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const statusKey = createMemo(() => previewPhaseMessageKey(phase()))
  const showIframe = createMemo(() => activeUrl() && (phase() === "ready" || reachable() === true || store.override))
  const showStatusBar = createMemo(
    () => !showIframe() && (Boolean(statusKey()) || (!autoStart() && phase() === "idle" && Boolean(startPlan()))),
  )
  const canStopServer = createMemo(() => {
    if (store.override || !startPlan()) return false
    if (store.ptyId) return true
    const current = phase()
    return current === "starting" || current === "waiting" || current === "ready"
  })
  const canEditPreview = createMemo(() => showIframe() && !store.override && Boolean(startPlan()?.useInspector))
  const previewContextCount = createMemo(
    () => prompt.context.items().filter((item) => item.type === "preview").length,
  )

  createEffect(() => {
    if (!showIframe()) setEditMode(false)
  })

  const toggleEditMode = () => {
    if (!canEditPreview()) return
    const next = !editMode()
    setEditMode(next)
    if (next) activateEditMode()
  }

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-weaker-base bg-background-base">
        <div class="min-w-0 flex-1">
          <TextInputV2
            value={draft()}
            onInput={(event) => {
              setDraftTouched(true)
              setDraft(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              commitUrl()
            }}
            placeholder={language.t("session.preview.urlPlaceholder")}
            aria-label={language.t("session.preview.urlPlaceholder")}
          />
        </div>
        <TooltipV2 value={language.t("session.preview.go")}>
          <IconButtonV2
            variant="ghost"
            size="small"
            icon={<Icon name="check" />}
            aria-label={language.t("session.preview.go")}
            onClick={commitUrl}
          />
        </TooltipV2>
        <Show when={store.override}>
          <TooltipV2 value={language.t("session.preview.reset")}>
            <IconButtonV2
              variant="ghost"
              size="small"
              icon={<Icon name="close" />}
              aria-label={language.t("session.preview.reset")}
              onClick={resetUrl}
            />
          </TooltipV2>
        </Show>
        <TooltipV2 value={language.t("session.preview.refresh")}>
          <IconButtonV2
            variant="ghost"
            size="small"
            icon={<Icon name="reset" />}
            aria-label={language.t("session.preview.refresh")}
            onClick={refresh}
          />
        </TooltipV2>
        <Show when={canStopServer()}>
          <TooltipV2 value={language.t("session.preview.stop")}>
            <IconButtonV2
              variant="ghost"
              size="small"
              icon={<Icon name="stop" />}
              aria-label={language.t("session.preview.stop")}
              disabled={stopping()}
              onClick={() => void stopServer()}
            />
          </TooltipV2>
        </Show>
        <Show when={canEditPreview()}>
          <TooltipV2
            value={
              editMode()
                ? language.t("session.preview.editModeOff")
                : language.t("session.preview.editModeOn")
            }
          >
            <IconButtonV2
              variant={editMode() ? "contrast" : "ghost"}
              size="small"
              icon={<Icon name="edit" />}
              aria-label={language.t("session.preview.edit")}
              aria-pressed={editMode()}
              onClick={toggleEditMode}
            />
          </TooltipV2>
        </Show>
        <TooltipV2 value={language.t("session.preview.openExternal")}>
          <IconButton
            icon="expand"
            variant="ghost"
            size="small"
            aria-label={language.t("session.preview.openExternal")}
            onClick={openExternal}
          />
        </TooltipV2>
      </div>

      <Show when={editMode()}>
        <div class="shrink-0 px-3 py-1.5 text-11-regular text-text-weak border-b border-border-weaker-base bg-background-stronger">
          {language.t("session.preview.editHint", { count: String(previewContextCount()) })}
        </div>
      </Show>

      <Show when={previewTarget()?.url && !store.override}>
        <div class="shrink-0 px-3 py-1.5 text-11-regular text-text-weak border-b border-border-weaker-base bg-background-stronger truncate">
          {language.t("session.preview.target", { url: previewTarget()!.url })}
          <Show when={startPlan()?.label}>
            <span class="opacity-70"> · {startPlan()!.label}</span>
          </Show>
        </div>
      </Show>

      <Show
        when={!projectStructure.loading}
        fallback={
          <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">
            {language.t("session.preview.detecting")}
          </div>
        }
      >
        <Show
          when={activeUrl()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2 text-12-regular text-text-weak">
              <Show
                when={projectStructure()?.kind === "node" && previewTarget() && !startPlan()}
                fallback={
                  <>
                    <div>{language.t("session.preview.noProject")}</div>
                    <div>{language.t("session.preview.noProjectHint")}</div>
                  </>
                }
              >
                <div>{language.t("session.preview.noDevScript")}</div>
              </Show>
            </div>
          }
        >
          {(url) => (
            <>
              <Show when={showStatusBar()}>
                <div class="shrink-0 px-3 py-2 text-12-regular text-text-weak border-b border-border-weaker-base bg-background-stronger">
                  <div>
                    {!autoStart() && phase() === "idle"
                      ? language.t("session.preview.stopped")
                      : language.t(statusKey()!)}
                  </div>
                  <Show when={phase() === "failed" && startError()}>
                    {(error) => (
                      <div class="mt-1 text-11-regular text-text-weaker space-y-0.5">
                        <Show when={error().command}>
                          <div class="truncate">{language.t("session.preview.command", { command: error().command! })}</div>
                        </Show>
                        <Show when={error().exitCode !== undefined}>
                          <div>{language.t("session.preview.exitCode", { code: String(error().exitCode) })}</div>
                        </Show>
                        <Show when={error().message}>
                          <div class="truncate">{error().message}</div>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
              <Show when={showIframe()}>
                <iframe
                  ref={(element) => {
                    iframeRef = element
                  }}
                  onLoad={() => {
                    if (editMode()) activateEditMode()
                  }}
                  key={`${reloadKey()}:${url()}`}
                  src={url()}
                  title={language.t("session.tab.preview")}
                  class="flex-1 min-h-0 w-full border-0 bg-background-base"
                  classList={{
                    "ring-2 ring-inset ring-border-brand-base": editMode(),
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  )
}
