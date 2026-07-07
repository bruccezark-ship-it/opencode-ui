;(function () {
  window.addEventListener("message", function (event) {
    var data = event.data
    if (!data || typeof data !== "object") return
    if (data.type !== "oc-preview-inject" || !data.uiOrigin || window.__OPENCODE_PREVIEW_INSPECTOR__) return
    var script = document.createElement("script")
    script.src = data.uiOrigin + "/preview-inspector.js"
    script.crossOrigin = "anonymous"
    script.dataset.uiOrigin = data.uiOrigin
    script.dataset.ocInspector = "true"
    document.head.appendChild(script)
  })

  if (window.__OPENCODE_PREVIEW_INSPECTOR__) return
  window.__OPENCODE_PREVIEW_INSPECTOR__ = true

  var active = false
  var hoverEl = null
  var selectedEl = null
  var overlay = null
  var hoverBox = null
  var selectedBox = null

  function parentOrigin() {
    var script = document.currentScript
    if (script && script.dataset && script.dataset.uiOrigin) return script.dataset.uiOrigin
    return "*"
  }

  function post(type, payload) {
    if (!window.parent || window.parent === window) return
    window.parent.postMessage({ type: type, payload: payload }, parentOrigin())
  }

  function ensureOverlay() {
    if (overlay) return overlay
    overlay = document.createElement("div")
    overlay.id = "__oc_preview_inspector__"
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;"
    hoverBox = document.createElement("div")
    hoverBox.style.cssText =
      "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.12);border-radius:2px;pointer-events:none;display:none;box-sizing:border-box;"
    selectedBox = document.createElement("div")
    selectedBox.style.cssText =
      "position:fixed;border:2px solid #22c55e;background:rgba(34,197,94,0.12);border-radius:2px;pointer-events:none;display:none;box-sizing:border-box;"
    overlay.appendChild(hoverBox)
    overlay.appendChild(selectedBox)
    document.documentElement.appendChild(overlay)
    return overlay
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return ""
    if (el.id) return "#" + CSS.escape(el.id)
    var parts = []
    var current = el
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      var part = current.tagName.toLowerCase()
      if (current.id) {
        parts.unshift("#" + CSS.escape(current.id))
        break
      }
      if (current.classList && current.classList.length) {
        var classes = Array.from(current.classList)
          .filter(function (name) {
            return name && !/^oc-/.test(name)
          })
          .slice(0, 2)
        if (classes.length) part += "." + classes.map(function (c) { return CSS.escape(c) }).join(".")
      }
      var parent = current.parentElement
      if (parent) {
        var siblings = Array.from(parent.children).filter(function (node) {
          return node.tagName === current.tagName
        })
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
        }
      }
      parts.unshift(part)
      current = parent
    }
    return parts.join(" > ")
  }

  function positionBox(box, el) {
    if (!box || !el) return
    var rect = el.getBoundingClientRect()
    box.style.display = "block"
    box.style.left = rect.left + "px"
    box.style.top = rect.top + "px"
    box.style.width = rect.width + "px"
    box.style.height = rect.height + "px"
  }

  function hideBox(box) {
    if (!box) return
    box.style.display = "none"
  }

  function describe(el) {
    var text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()
    return {
      selector: cssPath(el),
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: typeof el.className === "string" ? el.className : undefined,
      text: text.slice(0, 240) || undefined,
      html: el.outerHTML.slice(0, 800),
      url: location.href,
    }
  }

  function setSelected(el) {
    selectedEl = el
    ensureOverlay()
    if (el) positionBox(selectedBox, el)
    else hideBox(selectedBox)
  }

  function onMouseMove(event) {
    if (!active) return
    var el = event.target
    if (!el || el === document.documentElement || el === document.body || overlay.contains(el)) return
    if (el === hoverEl) return
    hoverEl = el
    positionBox(hoverBox, el)
  }

  function onClick(event) {
    if (!active) return
    var el = event.target
    if (!el || el === document.documentElement || el === document.body || overlay.contains(el)) return
    event.preventDefault()
    event.stopPropagation()
    setSelected(el)
    post("oc-preview-element-selected", describe(el))
  }

  function setActive(next) {
    active = !!next
    ensureOverlay()
    document.documentElement.style.cursor = active ? "crosshair" : ""
    if (!active) {
      hoverEl = null
      hideBox(hoverBox)
      hideBox(selectedBox)
      selectedEl = null
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data
    if (!data || typeof data !== "object") return
    if (data.type === "oc-preview-edit") {
      setActive(!!data.enabled)
    }
  })

  document.addEventListener("mousemove", onMouseMove, true)
  document.addEventListener("click", onClick, true)

  post("oc-preview-inspector-ready", { url: location.href })
})()
