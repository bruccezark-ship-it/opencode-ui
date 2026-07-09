import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import type { PreviewMagicColorId, PreviewMark, PreviewRectMark } from "@/pages/session/preview-inspector"
import { normalizeCaptureRect } from "@/pages/session/preview-inspector"

const FREEHAND_WIDTH = 3
const RECT_STROKE_WIDTH = 2

export type PreviewMagicColorOption = {
  id: PreviewMagicColorId
  hex: string
  label: string
}

export type PreviewMagicMode = "rect" | "freehand"

export function PreviewCaptureOverlay(props: {
  active: boolean
  hint: string
  modeRectLabel: string
  modeFreehandLabel: string
  undoLabel: string
  clearLabel: string
  colors: PreviewMagicColorOption[]
  promptPlaceholder: string
  promptLabel: string
  selectFirstHint: string
  submitLabel: string
  cancelLabel: string
  sending: boolean
  onCancel: () => void
  onSubmit: (input: {
    marks: PreviewMark[]
    color: string
    colorId: PreviewMagicColorId
    prompt: string
    bounds: { width: number; height: number }
  }) => void
}) {
  let container: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined
  let promptPanel: HTMLFormElement | undefined

  const [mode, setMode] = createSignal<PreviewMagicMode>("rect")
  const [colorId, setColorId] = createSignal<PreviewMagicColorId>(props.colors[0]?.id ?? "red")
  const [prompt, setPrompt] = createSignal("")
  const [marks, setMarks] = createSignal<PreviewMark[]>([])
  const [draftPoints, setDraftPoints] = createSignal<Array<{ x: number; y: number }>>([])
  const [draftRect, setDraftRect] = createSignal<{ startX: number; startY: number; endX: number; endY: number } | undefined>()
  const [drawing, setDrawing] = createSignal(false)

  const activeColor = () => props.colors.find((item) => item.id === colorId()) ?? props.colors[0]

  const reset = () => {
    setMarks([])
    setDraftPoints([])
    setDraftRect(undefined)
    setDrawing(false)
    setPrompt("")
    redraw()
  }

  const resizeCanvas = () => {
    if (!container || !canvas) return
    const bounds = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(bounds.width * dpr))
    canvas.height = Math.max(1, Math.round(bounds.height * dpr))
    canvas.style.width = `${bounds.width}px`
    canvas.style.height = `${bounds.height}px`
    redraw()
  }

  const drawRectMark = (ctx: CanvasRenderingContext2D, mark: PreviewRectMark) => {
    ctx.save()
    ctx.fillStyle = mark.color + "33"
    ctx.fillRect(mark.left, mark.top, mark.width, mark.height)
    ctx.strokeStyle = mark.color
    ctx.lineWidth = mark.strokeWidth
    ctx.setLineDash([6, 4])
    ctx.strokeRect(
      mark.left + mark.strokeWidth / 2,
      mark.top + mark.strokeWidth / 2,
      mark.width - mark.strokeWidth,
      mark.height - mark.strokeWidth,
    )
    ctx.restore()
  }

  const drawFreehandMark = (
    ctx: CanvasRenderingContext2D,
    mark: Extract<PreviewMark, { type: "freehand" }>,
  ) => {
    if (mark.points.length < 2) return
    ctx.strokeStyle = mark.color
    ctx.lineWidth = mark.width
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(mark.points[0].x, mark.points[0].y)
    for (let i = 1; i < mark.points.length; i++) {
      ctx.lineTo(mark.points[i].x, mark.points[i].y)
    }
    ctx.stroke()
  }

  const drawDraftRect = (
    ctx: CanvasRenderingContext2D,
    draft: { startX: number; startY: number; endX: number; endY: number },
    color: string,
    bounds: { width: number; height: number },
  ) => {
    const rect = normalizeCaptureRect({
      startX: draft.startX,
      startY: draft.startY,
      endX: draft.endX,
      endY: draft.endY,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
    })
    if (!rect) return
    drawRectMark(ctx, {
      type: "rect",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      color,
      strokeWidth: RECT_STROKE_WIDTH,
    })
  }

  const redraw = () => {
    if (!canvas || !container) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const bounds = container.getBoundingClientRect()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    for (const mark of marks()) {
      if (mark.type === "rect") drawRectMark(ctx, mark)
      else drawFreehandMark(ctx, mark)
    }

    const color = activeColor()?.hex
    const draft = draftRect()
    if (color && draft) {
      drawDraftRect(ctx, draft, color, { width: bounds.width, height: bounds.height })
    }

    const points = draftPoints()
    if (color && points.length >= 2) {
      drawFreehandMark(ctx, {
        type: "freehand",
        points,
        color,
        width: FREEHAND_WIDTH,
      })
    }
  }

  createEffect(() => {
    if (!props.active) {
      reset()
      return
    }
    resizeCanvas()
  })

  createEffect(() => {
    marks()
    draftPoints()
    draftRect()
    mode()
    redraw()
  })

  createEffect(() => {
    if (!props.active || marks().length === 0) return
    queueMicrotask(() => {
      promptPanel
        ?.querySelector<HTMLInputElement>('[data-slot="text-input-v2-input"]')
        ?.focus()
    })
  })

  onCleanup(reset)

  const pointFromEvent = (event: PointerEvent) => {
    const bounds = container!.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!props.active || !container || props.sending) return
    if ((event.target as HTMLElement).closest("[data-magic-ui]")) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    if (mode() === "rect") {
      setDraftRect({ startX: point.x, startY: point.y, endX: point.x, endY: point.y })
    } else {
      setDraftPoints([point])
    }
    setDrawing(true)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drawing() || props.sending) return
    const point = pointFromEvent(event)
    if (mode() === "rect") {
      const draft = draftRect()
      if (!draft) return
      setDraftRect({ ...draft, endX: point.x, endY: point.y })
      return
    }
    setDraftPoints((items) => [...items, point])
  }

  const finishDrawing = (event?: PointerEvent) => {
    if (!container) return
    if (event?.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drawing()) return
    const color = activeColor()
    if (!color) return
    const bounds = container.getBoundingClientRect()

    if (mode() === "rect") {
      const draft = draftRect()
      setDrawing(false)
      setDraftRect(undefined)
      if (!draft) return
      const rect = normalizeCaptureRect({
        startX: draft.startX,
        startY: draft.startY,
        endX: draft.endX,
        endY: draft.endY,
        boundsWidth: bounds.width,
        boundsHeight: bounds.height,
      })
      if (!rect) return
      setMarks((items) => [
        ...items,
        {
          type: "rect",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          color: color.hex,
          strokeWidth: RECT_STROKE_WIDTH,
        },
      ])
      focusPrompt()
      return
    }

    const points = draftPoints()
    setDrawing(false)
    setDraftPoints([])
    if (points.length < 2) return
    setMarks((items) => [
      ...items,
      {
        type: "freehand",
        points,
        color: color.hex,
        width: FREEHAND_WIDTH,
      },
    ])
    focusPrompt()
  }

  const focusPrompt = () => {
    queueMicrotask(() => {
      promptPanel
        ?.querySelector<HTMLInputElement>('[data-slot="text-input-v2-input"]')
        ?.focus()
    })
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!drawing()) return
    event.preventDefault()
    finishDrawing(event)
  }

  const undo = () => {
    setMarks((items) => items.slice(0, -1))
  }

  const clearMarks = () => {
    setMarks([])
    setDraftPoints([])
    setDraftRect(undefined)
    setDrawing(false)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("[data-magic-prompt]")) return
    if (event.key === "Escape") {
      event.preventDefault()
      props.onCancel()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      event.preventDefault()
      undo()
    }
  }

  const canSubmit = () => marks().length > 0 && prompt().trim().length > 0 && !props.sending

  const submit = () => {
    if (!container || !canSubmit()) return
    const bounds = container.getBoundingClientRect()
    props.onSubmit({
      marks: marks(),
      color: activeColor()!.hex,
      colorId: colorId(),
      prompt: prompt().trim(),
      bounds: { width: bounds.width, height: bounds.height },
    })
  }

  return (
    <Show when={props.active}>
      <div
        ref={container}
        class="absolute inset-0 z-20 touch-none select-none"
        classList={{
          "cursor-crosshair": mode() === "rect" && marks().length === 0,
          "cursor-cell": mode() === "freehand" && marks().length === 0,
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        tabIndex={0}
        role="application"
        aria-label={props.hint}
      >
        <canvas ref={canvas} class="pointer-events-none absolute inset-0 h-full w-full" />

        <div
          data-magic-ui
          class="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border-weaker-base bg-background-base/95 px-3 py-2"
        >
          <span class="text-11-regular shrink-0 text-text-weak">{props.hint}</span>

          <div class="pointer-events-auto flex items-center gap-1 rounded-md border border-border-weaker-base p-0.5">
            <ButtonV2
              size="small"
              variant={mode() === "rect" ? "primary" : "ghost"}
              disabled={props.sending}
              onClick={() => setMode("rect")}
            >
              {props.modeRectLabel}
            </ButtonV2>
            <ButtonV2
              size="small"
              variant={mode() === "freehand" ? "primary" : "ghost"}
              disabled={props.sending}
              onClick={() => setMode("freehand")}
            >
              {props.modeFreehandLabel}
            </ButtonV2>
          </div>

          <div class="pointer-events-auto flex items-center gap-1">
            <IconButtonV2
              size="small"
              variant="ghost"
              icon={<Icon name="arrow-undo-down" />}
              aria-label={props.undoLabel}
              title={props.undoLabel}
              disabled={props.sending || marks().length === 0}
              onClick={undo}
            />
            <IconButtonV2
              size="small"
              variant="ghost"
              icon={<Icon name="trash" />}
              aria-label={props.clearLabel}
              title={props.clearLabel}
              disabled={props.sending || marks().length === 0}
              onClick={clearMarks}
            />
          </div>

          <div class="pointer-events-auto ml-auto flex items-center gap-1.5">
            <For each={props.colors}>
              {(color) => (
                <button
                  type="button"
                  class="size-6 rounded-full border-2 transition-transform"
                  classList={{
                    "scale-110 border-text-base": colorId() === color.id,
                    "border-transparent": colorId() !== color.id,
                  }}
                  style={{ "background-color": color.hex }}
                  title={color.label}
                  aria-label={color.label}
                  aria-pressed={colorId() === color.id}
                  disabled={props.sending}
                  onClick={() => setColorId(color.id)}
                />
              )}
            </For>
          </div>
        </div>

        <Show
          when={marks().length > 0}
          fallback={
            <div
              data-magic-ui
              class="pointer-events-none absolute inset-x-0 bottom-0 z-30 border-t border-border-weaker-base bg-background-base/95 px-3 py-3"
            >
              <p class="text-11-regular text-center text-text-weak">{props.selectFirstHint}</p>
            </div>
          }
        >
          <form
            ref={promptPanel}
            data-magic-ui
            data-magic-prompt
            class="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-border-weaker-base bg-background-base px-3 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <label class="text-12-medium text-text-base" for="preview-magic-prompt">
              {props.promptLabel}
            </label>
            <TextInputV2
              id="preview-magic-prompt"
              appearance="large"
              value={prompt()}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  props.onCancel()
                }
              }}
              placeholder={props.promptPlaceholder}
              aria-label={props.promptLabel}
              disabled={props.sending}
            />
            <div class="flex items-center justify-end gap-2">
              <ButtonV2 type="button" size="small" variant="ghost" disabled={props.sending} onClick={() => props.onCancel()}>
                {props.cancelLabel}
              </ButtonV2>
              <ButtonV2 type="submit" size="small" variant="primary" disabled={!canSubmit()}>
                {props.submitLabel}
              </ButtonV2>
            </div>
          </form>
        </Show>
      </div>
    </Show>
  )
}
