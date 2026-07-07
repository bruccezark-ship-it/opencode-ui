import { Component, For, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { getDirectory, getFilename, getFilenameTruncated } from "@opencode-ai/core/util/path"
import type { ContextItem } from "@/context/prompt"

type PromptContextItem = ContextItem & { key: string }

type ContextItemsProps = {
  items: PromptContextItem[]
  active: (item: PromptContextItem) => boolean
  openComment: (item: PromptContextItem) => void
  remove: (item: PromptContextItem) => void
  t: (key: string) => string
}

const PreviewFileContextItem: Component<{
  item: Extract<PromptContextItem, { type: "file" }>
  selected: boolean
  openComment: ContextItemsProps["openComment"]
  remove: ContextItemsProps["remove"]
  t: ContextItemsProps["t"]
}> = (props) => {
  const directory = getDirectory(props.item.path)
  const filename = getFilename(props.item.path)
  const label = getFilenameTruncated(props.item.path, 14)

  return (
    <TooltipV2
      value={
        <span class="flex max-w-[300px]">
          <span class="text-text-invert-base truncate-start [unicode-bidi:plaintext] min-w-0">{directory}</span>
          <span class="shrink-0">{filename}</span>
        </span>
      }
      placement="top"
      openDelay={800}
    >
      <div
        classList={{
          "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 cursor-default transition-all transition-transform shadow-xs-border hover:shadow-xs-border-hover": true,
          "hover:bg-surface-interactive-weak": !!props.item.commentID && !props.selected,
          "bg-surface-interactive-hover hover:bg-surface-interactive-hover shadow-xs-border-hover": props.selected,
          "bg-background-stronger": !props.selected,
        }}
        onClick={() => props.openComment(props.item)}
      >
        <div class="flex items-center gap-1.5">
          <FileIcon node={{ path: props.item.path, type: "file" }} class="shrink-0 size-3.5" />
          <div class="flex items-center text-[12px] min-w-0 font-medium leading-5">
            <span class="text-text-strong whitespace-nowrap">{label}</span>
            <Show when={props.item.selection}>
              {(sel) => (
                <span class="text-text-weak whitespace-nowrap shrink-0">
                  {sel().startLine === sel().endLine
                    ? `:${sel().startLine}`
                    : `:${sel().startLine}-${sel().endLine}`}
                </span>
              )}
            </Show>
          </div>
          <IconButton
            type="button"
            icon="close-small"
            variant="ghost"
            class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
            onClick={(e) => {
              e.stopPropagation()
              props.remove(props.item)
            }}
            aria-label={props.t("prompt.context.removeFile")}
          />
        </div>
        <Show when={props.item.comment}>
          {(comment) => <div class="text-12-regular text-text-strong ml-5 pr-1 truncate">{comment()}</div>}
        </Show>
      </div>
    </TooltipV2>
  )
}

const PreviewElementContextItem: Component<{
  item: Extract<PromptContextItem, { type: "preview" }>
  selected: boolean
  remove: ContextItemsProps["remove"]
  t: ContextItemsProps["t"]
}> = (props) => {
  const label = props.item.id ? `${props.item.tagName}#${props.item.id}` : props.item.tagName

  return (
    <TooltipV2 value={props.item.selector} placement="top" openDelay={800}>
      <div
        classList={{
          "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[220px] h-12 cursor-default transition-all shadow-xs-border": true,
          "bg-background-stronger": true,
        }}
      >
        <div class="flex items-center gap-1.5">
          <Icon name="window-cursor" class="shrink-0 size-3.5 text-text-weak" />
          <div class="flex flex-col min-w-0 text-[12px] leading-5">
            <span class="text-text-strong truncate">{label}</span>
            <Show when={props.item.text}>
              {(text) => <span class="text-text-weak truncate text-11-regular">{text()}</span>}
            </Show>
          </div>
          <IconButton
            type="button"
            icon="close-small"
            variant="ghost"
            class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
            onClick={(e) => {
              e.stopPropagation()
              props.remove(props.item)
            }}
            aria-label={props.t("prompt.context.removeFile")}
          />
        </div>
      </div>
    </TooltipV2>
  )
}

export const PromptContextItems: Component<ContextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
        <For each={props.items}>
          {(item) => {
            const selected = props.active(item)

            return (
              <Show
                when={item.type === "preview"}
                fallback={
                  <PreviewFileContextItem
                    item={item}
                    selected={selected}
                    openComment={props.openComment}
                    remove={props.remove}
                    t={props.t}
                  />
                }
              >
                <PreviewElementContextItem item={item} selected={selected} remove={props.remove} t={props.t} />
              </Show>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
