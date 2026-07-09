(function () {
  var OUTLINE = "opencode-preview-outline"
  var PARENT_READY = "opencode-preview-parent-ready"
  var CAPTURE_REQUEST = "opencode-preview-capture-request"
  var CAPTURE_RESULT = "opencode-preview-capture-result"
  var QUERY_LOCATION = "opencode-preview-query-location"
  var LOCATION_RESULT = "opencode-preview-location-result"
  var MAX_TEXT = 120
  var MAX_LANDMARKS = 20
  var TRANSPARENT_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

  function trim(s, max) {
    var t = (s || "").replace(/\s+/g, " ").trim()
    return t.length > max ? t.slice(0, max) + "…" : t
  }

  function meaningfulElement(el) {
    if (!el || el === document.documentElement || el === document.body) return null
    var node = el
    while (node && node !== document.body) {
      var tag = node.tagName ? node.tagName.toLowerCase() : ""
      if (tag && tag !== "html" && tag !== "body" && tag !== "svg" && tag !== "path") return node
      node = node.parentElement
    }
    return el
  }

  function elementAtPoint(x, y) {
    var target = meaningfulElement(document.elementFromPoint(x, y))
    if (!target) return null
    var box = target.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return null
    return {
      selector: selector(target),
      tag: target.tagName.toLowerCase(),
      text: trim(target.textContent, MAX_TEXT),
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    }
  }

  function selector(el) {
    if (el.id) return "#" + el.id
    var tag = el.tagName.toLowerCase()
    var parent = el.parentElement
    if (!parent) return tag
    var siblings = [].slice.call(parent.children).filter(function (c) {
      return c.tagName === el.tagName
    })
    if (siblings.length === 1) return tag
    return tag + ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")"
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false
    var rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function outline() {
    var headings = []
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]").forEach(function (el) {
      if (!isVisible(el)) return
      var text = trim(el.textContent, MAX_TEXT)
      if (!text) return
      var level = /^H(\d)$/i.test(el.tagName) ? Number(el.tagName.slice(1)) : 1
      headings.push({ level: level, text: text, selector: selector(el) })
    })
    var landmarks = []
    var roots = document.querySelectorAll("main,[role=main]")
    var root = roots.length ? roots[0] : document.body
    var count = 0
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode() && count < MAX_LANDMARKS) {
      var text = trim(walker.currentNode.textContent, MAX_TEXT)
      if (!text) continue
      var el = walker.currentNode.parentElement
      if (!el || !isVisible(el)) continue
      landmarks.push({ role: "text", text: text, selector: selector(el) })
      count++
    }
    return {
      type: OUTLINE,
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      headings: headings,
      landmarks: landmarks,
      capturedAt: Date.now(),
    }
  }

  function sendOutline() {
    try {
      var target = window.opener || window.parent
      if (!target || target === window) return
      target.postMessage(outline(), "*")
    } catch (e) {}
  }

  function intersectsViewport(box, rect) {
    return !(
      box.bottom <= rect.top ||
      box.top >= rect.bottom ||
      box.right <= rect.left ||
      box.left >= rect.right
    )
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      if (!url || url === "none") return resolve(null)
      var img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = function () {
        resolve(img)
      }
      img.onerror = function () {
        resolve(null)
      }
      img.src = url
    })
  }

  function parseBackgroundUrl(value) {
    if (!value || value === "none") return null
    var match = value.match(/url\(["']?([^"')]+)["']?\)/)
    return match ? match[1] : null
  }

  function copyComputedSize(cloneEl, origEl) {
    var style = window.getComputedStyle(origEl)
    cloneEl.style.width = style.width
    cloneEl.style.height = style.height
    cloneEl.style.maxWidth = style.maxWidth
    cloneEl.style.maxHeight = style.maxHeight
    cloneEl.style.minWidth = style.minWidth
    cloneEl.style.minHeight = style.minHeight
    cloneEl.style.objectFit = style.objectFit
    cloneEl.style.display = style.display
  }

  function prepareCloneForCapture(clone, original) {
    var cloneImgs = clone.querySelectorAll("img")
    var origImgs = original.querySelectorAll("img")
    for (var i = 0; i < cloneImgs.length; i++) {
      var cloneImg = cloneImgs[i]
      var origImg = origImgs[i]
      if (!origImg) continue
      copyComputedSize(cloneImg, origImg)
      cloneImg.setAttribute("src", TRANSPARENT_PIXEL)
      cloneImg.removeAttribute("srcset")
      cloneImg.removeAttribute("sizes")
    }
    clone.querySelectorAll("script").forEach(function (node) {
      node.remove()
    })
  }

  function drawLoadedImage(ctx, image, box, rect, objectFit) {
    var dx = box.left - rect.left
    var dy = box.top - rect.top
    var nw = image.naturalWidth
    var nh = image.naturalHeight
    if (!nw || !nh) return
    objectFit = objectFit || "fill"
    if (objectFit === "cover" || objectFit === "contain") {
      var scale =
        objectFit === "cover"
          ? Math.max(box.width / nw, box.height / nh)
          : Math.min(box.width / nw, box.height / nh)
      var drawW = nw * scale
      var drawH = nh * scale
      var drawX = dx + (box.width - drawW) / 2
      var drawY = dy + (box.height - drawH) / 2
      ctx.drawImage(image, 0, 0, nw, nh, drawX, drawY, drawW, drawH)
      return
    }
    ctx.drawImage(image, 0, 0, nw, nh, dx, dy, box.width, box.height)
  }

  function whenImageReady(img) {
    return new Promise(function (resolve) {
      if (img.complete) {
        resolve(img)
        return
      }
      var done = false
      var finish = function () {
        if (done) return
        done = true
        resolve(img)
      }
      img.addEventListener("load", finish, { once: true })
      img.addEventListener("error", finish, { once: true })
      setTimeout(finish, 2000)
    })
  }

  function paintImageElement(ctx, el, rect) {
    var box = el.getBoundingClientRect()
    if (!intersectsViewport(box, rect) || box.width <= 0 || box.height <= 0) return Promise.resolve()
    var objectFit = window.getComputedStyle(el).objectFit
    return whenImageReady(el).then(function (img) {
      if (!img.complete || img.naturalWidth <= 0) return
      try {
        drawLoadedImage(ctx, img, box, rect, objectFit)
        return
      } catch (e) {}
      var url = img.currentSrc || img.src
      if (!url || url.indexOf("data:") === 0) return
      return loadImage(url).then(function (loaded) {
        if (!loaded) return
        drawLoadedImage(ctx, loaded, box, rect, objectFit)
      })
    })
  }

  function paintMediaElement(ctx, el, rect) {
    var box = el.getBoundingClientRect()
    if (!intersectsViewport(box, rect) || box.width <= 0 || box.height <= 0) return Promise.resolve()
    if (el.tagName === "IMG") return paintImageElement(ctx, el, rect)
    return Promise.resolve().then(function () {
      try {
        if (el.tagName === "VIDEO") {
          if (el.readyState < 2 || el.videoWidth <= 0) return
          var dx = box.left - rect.left
          var dy = box.top - rect.top
          ctx.drawImage(el, dx, dy, box.width, box.height)
          return
        }
        if (el.tagName === "CANVAS") {
          var cdx = box.left - rect.left
          var cdy = box.top - rect.top
          ctx.drawImage(el, cdx, cdy, box.width, box.height)
        }
      } catch (e) {}
    })
  }

  function paintMediaElements(ctx, rect) {
    var nodes = document.querySelectorAll("img, video, canvas, picture img")
    var tasks = []
    for (var i = 0; i < nodes.length; i++) {
      tasks.push(paintMediaElement(ctx, nodes[i], rect))
    }
    return Promise.all(tasks)
  }

  function paintBackgroundImages(ctx, rect) {
    var elements = document.querySelectorAll("*")
    var tasks = []
    for (var i = 0; i < elements.length; i++) {
      ;(function (el) {
        var style = window.getComputedStyle(el)
        var url = parseBackgroundUrl(style.backgroundImage)
        if (!url) return
        var box = el.getBoundingClientRect()
        if (!intersectsViewport(box, rect) || box.width <= 0 || box.height <= 0) return
        tasks.push(
          loadImage(url).then(function (image) {
            if (!image) return
            try {
              var dx = box.left - rect.left
              var dy = box.top - rect.top
              ctx.save()
              ctx.beginPath()
              ctx.rect(dx, dy, box.width, box.height)
              ctx.clip()
              var size = style.backgroundSize || "cover"
              if (size === "cover" || size === "contain") {
                var scale = size === "cover"
                  ? Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight)
                  : Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
                var drawW = image.naturalWidth * scale
                var drawH = image.naturalHeight * scale
                var drawX = dx + (box.width - drawW) / 2
                var drawY = dy + (box.height - drawH) / 2
                ctx.drawImage(image, drawX, drawY, drawW, drawH)
              } else {
                ctx.drawImage(image, dx, dy, box.width, box.height)
              }
              ctx.restore()
            } catch (e) {}
          }),
        )
      })(elements[i])
    }
    return Promise.all(tasks)
  }

  function renderForeignObjectLayer(ctx, rect, width, height) {
    return new Promise(function (resolve) {
      var scrollX = window.scrollX || window.pageXOffset || 0
      var scrollY = window.scrollY || window.pageYOffset || 0
      var offsetX = -(rect.left + scrollX)
      var offsetY = -(rect.top + scrollY)
      var html = document.documentElement
      var clone = html.cloneNode(true)
      prepareCloneForCapture(clone, html)
      var serialized = new XMLSerializer().serializeToString(clone)
      var svg =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        width +
        '" height="' +
        height +
        '">' +
        '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="transform:translate(' +
        offsetX +
        "px," +
        offsetY +
        "px);width:" +
        html.scrollWidth +
        "px;height:" +
        html.scrollHeight +
        'px;">' +
        serialized +
        "</div></foreignObject></svg>"

      var img = new Image()
      img.onload = function () {
        try {
          ctx.drawImage(img, 0, 0, width, height)
        } catch (e) {}
        resolve()
      }
      img.onerror = function () {
        resolve()
      }
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    })
  }

  function captureRegion(rect) {
    return new Promise(function (resolve) {
      var dpr = window.devicePixelRatio || 1
      var width = Math.max(1, Math.round(rect.width))
      var height = Math.max(1, Math.round(rect.height))
      var canvas = document.createElement("canvas")
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      var ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve("")
        return
      }
      ctx.scale(dpr, dpr)

      var viewportRect = {
        left: rect.left,
        top: rect.top,
        right: rect.left + width,
        bottom: rect.top + height,
      }

      var bodyStyle = window.getComputedStyle(document.body)
      ctx.fillStyle =
        bodyStyle.backgroundColor && bodyStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
          ? bodyStyle.backgroundColor
          : "#ffffff"
      ctx.fillRect(0, 0, width, height)

      paintBackgroundImages(ctx, viewportRect)
        .then(function () {
          return renderForeignObjectLayer(ctx, rect, width, height)
        })
        .then(function () {
          return paintMediaElements(ctx, viewportRect)
        })
        .then(function () {
          resolve(canvas.toDataURL("image/png"))
        })
        .catch(function () {
          return paintMediaElements(ctx, viewportRect).finally(function () {
            try {
              resolve(canvas.toDataURL("image/png"))
            } catch (e) {
              resolve("")
            }
          })
        })
    })
  }

  function sendCaptureResult(requestId, rect, queryPoint, error) {
    var payload = {
      type: CAPTURE_RESULT,
      requestId: requestId,
      url: location.href,
      pathname: location.pathname,
      outline: {
        title: document.title,
        headings: outline().headings,
        landmarks: outline().landmarks,
      },
    }
    if (queryPoint && typeof queryPoint.x === "number" && typeof queryPoint.y === "number") {
      var target = elementAtPoint(queryPoint.x, queryPoint.y)
      if (target) payload.targetElement = target
    }
    if (error) {
      payload.error = error
    } else {
      captureRegion(rect)
        .then(function (dataUrl) {
          payload.dataUrl = dataUrl
          post(payload)
        })
        .catch(function (err) {
          payload.error = err && err.message ? err.message : "capture failed"
          post(payload)
        })
      return
    }
    post(payload)
  }

  function post(payload) {
    try {
      var target = window.opener || window.parent
      if (!target || target === window) return
      target.postMessage(payload, "*")
    } catch (e) {}
  }

  window.addEventListener("message", function (event) {
    var data = event.data
    if (!data || typeof data !== "object") return
    if (data.type === PARENT_READY) {
      sendOutline()
      return
    }
    if (data.type === QUERY_LOCATION && data.requestId) {
      post({
        type: LOCATION_RESULT,
        requestId: String(data.requestId),
        url: location.href,
        pathname: location.pathname,
      })
      return
    }
    if (data.type === CAPTURE_REQUEST && data.requestId && data.rect) {
      sendCaptureResult(String(data.requestId), data.rect, data.queryPoint)
    }
  })

  var push = history.pushState.bind(history)
  history.pushState = function () {
    push.apply(history, arguments)
    sendOutline()
  }
  var replace = history.replaceState.bind(history)
  history.replaceState = function () {
    replace.apply(history, arguments)
    sendOutline()
  }
  window.addEventListener("popstate", sendOutline)
  if (document.readyState === "complete" || document.readyState === "interactive") sendOutline()
  else document.addEventListener("DOMContentLoaded", sendOutline)
  var burst = 0
  var fast = setInterval(function () {
    sendOutline()
    burst++
    if (burst >= 12) clearInterval(fast)
  }, 400)
  setInterval(sendOutline, 2000)
})()
