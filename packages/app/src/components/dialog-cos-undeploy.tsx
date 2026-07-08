import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import { startCosUndeploy, type UndeploySseEvent } from "@/pages/session/cos-deploy"

type DialogCosUndeployProps = {
  projectRoot: string
  domain: string
  onComplete?: () => void
}

type Phase = "progress" | "success"

export function DialogCosUndeploy(props: DialogCosUndeployProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()

  const deployCtx = () => ({
    client: sdk().client,
    serverUrl: sdk().url,
    directory: sdk().directory,
    projectRoot: props.projectRoot,
  })

  const [phase, setPhase] = createSignal<Phase>("progress")
  const [steps, setSteps] = createStore<Array<{ step: number; total: number; name: string; message?: string }>>([])
  const [statusLines, setStatusLines] = createSignal<string[]>([])
  const [result, setResult] = createStore({
    domain: props.domain,
    cdnStatus: "" as string,
    dnsStatus: "" as string,
    cosDeleted: 0,
    cosSkipped: false,
    cosSkipReason: undefined as string | undefined,
  })

  let abort: AbortController | undefined

  function handleEvent(event: UndeploySseEvent) {
    if (event.type === "step-start") {
      setSteps((items) => {
        const next = [...items.filter((item) => item.step !== event.step), {
          step: event.step,
          total: event.total,
          name: event.name,
        }]
        next.sort((a, b) => a.step - b.step)
        return next
      })
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
    if (event.type === "complete") {
      setResult({
        domain: event.result.domain,
        cdnStatus: event.result.cdnStatus,
        dnsStatus: event.result.dnsStatus,
        cosDeleted: event.result.cosDeleted,
        cosSkipped: event.result.cosSkipped,
        cosSkipReason: event.result.cosSkipReason,
      })
      setPhase("success")
      props.onComplete?.()
    }
  }

  async function startUndeploy() {
    abort?.abort()
    abort = new AbortController()

    try {
      await startCosUndeploy(
        deployCtx(),
        {
          projectRoot: props.projectRoot,
          domain: props.domain,
        },
        handleEvent,
        abort.signal,
      )
    } catch (error) {
      if (abort.signal.aborted) return
      showToast({
        variant: "error",
        title: language.t("session.preview.undeployCos.failed"),
        description: error instanceof Error ? error.message : undefined,
      })
      dialog.close()
    }
  }

  onMount(() => {
    void startUndeploy()
  })

  function close() {
    abort?.abort()
    dialog.close()
  }

  return (
    <Dialog
      title={language.t("session.preview.undeployCos.title", { domain: props.domain })}
      class="w-full max-w-[560px] mx-auto"
    >
      <div class="flex flex-col gap-5 p-6 pt-0">
        <Switch>
          <Match when={phase() === "progress"}>
            <div class="flex flex-col gap-3">
              <For each={steps}>
                {(step) => (
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-base">
                      {step.name} ({step.step}/{step.total})
                    </div>
                    <Show when={step.message}>
                      <div class="text-12-regular text-text-weak">{step.message}</div>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={statusLines().length > 0}>
                <div class="max-h-32 overflow-y-auto text-12-regular text-text-weak whitespace-pre-wrap">
                  <For each={statusLines()}>{(line) => <div>{line}</div>}</For>
                </div>
              </Show>
            </div>
          </Match>

          <Match when={phase() === "success"}>
            <div class="flex flex-col gap-2 text-12-regular text-text-base">
              <div>{language.t("session.preview.undeployCos.success")}</div>
              <div>{language.t("session.preview.undeployCos.domain", { domain: result.domain })}</div>
              <div>{language.t("session.preview.undeployCos.cdnStatus", { status: result.cdnStatus })}</div>
              <div>{language.t("session.preview.undeployCos.dnsStatus", { status: result.dnsStatus })}</div>
              <Show
                when={result.cosSkipped}
                fallback={
                  <div>
                    {language.t("session.preview.undeployCos.cosDeleted", { count: result.cosDeleted })}
                  </div>
                }
              >
                <div>{result.cosSkipReason ?? language.t("session.preview.undeployCos.cosSkipped")}</div>
              </Show>
            </div>
          </Match>
        </Switch>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
