/**
 * Page-side helpers — plain ESM, never run through tsx transform
 * (nested functions would get __name injected and break page.evaluate).
 */

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const SLIDE_MIN_PX = 320;
export const SLIDE_MAX_PX = 8192;

export const HIDE_CHROME_SELECTOR =
  ".progress-bar, .notes-overlay, aside.notes, .speaker-notes, .deck-nav, .deck-hint, .deck-counter";

export const SLIDE_SELECTOR = ".slide, [data-screen-label], .deck-slide, .ppt-slide";
export const DECK_STAGE_SELECTOR = "deck-stage, #deck-stage, .deck-stage";

export function shouldCaptureAsDeck(hasSlides, deckSignal) {
  return hasSlides && deckSignal !== false;
}

export function injectBaseHref(doc, baseHref) {
  if (!baseHref) return doc;
  const tag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  return `<!doctype html><html><head>${tag}</head><body>${doc}</body></html>`;
}

function escapeHtmlAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function restoreActiveSlideCapture() {
  var layer = document.getElementById("__od_export_active_slide_capture");
  if (!layer) return;
  var placeholder = document.getElementById("__od_export_active_slide_placeholder");
  var liveSlide = layer.firstElementChild && layer.firstElementChild.firstElementChild;
  if (placeholder && placeholder.parentNode && liveSlide) {
    placeholder.parentNode.insertBefore(liveSlide, placeholder);
    placeholder.remove();
    var styles = layer.__odSourceStyles || [];
    for (var i = 0; i < styles.length; i++) {
      var entry = styles[i];
      if (entry.value) liveSlide.style.setProperty(entry.name, entry.value, entry.priority);
      else liveSlide.style.removeProperty(entry.name);
    }
  }
  layer.remove();
}

function activeSlideCaptureOffsetTransform(rect) {
  return "translate(" + -rect.x + "px," + -rect.y + "px)";
}

function pinCarouselSlidesForExport(slideSelector, w, h) {
  var body = document.body;
  if (!body) return false;
  var cs = window.getComputedStyle(body);
  if (cs.display !== "flex") return false;
  var dir = cs.flexDirection;
  if (dir !== "row" && dir !== "row-reverse") return false;
  var slides = Array.prototype.slice
    .call(document.querySelectorAll(slideSelector))
    .filter(function (el) {
      return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
    });
  if (slides.length < 2) return false;
  if (body.scrollWidth <= window.innerWidth * 1.2) return false;
  slides.forEach(function (el) {
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("left", "0", "important");
    el.style.setProperty("top", "0", "important");
    el.style.setProperty("width", w + "px", "important");
    el.style.setProperty("height", h + "px", "important");
    el.style.setProperty("flex", "none", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("scroll-snap-align", "unset", "important");
  });
  body.style.setProperty("display", "block", "important");
  body.style.setProperty("width", w + "px", "important");
  body.style.setProperty("height", h + "px", "important");
  body.style.setProperty("overflow", "hidden", "important");
  return true;
}

export const pageFns = {
  countRealSlides: function countRealSlides(slideSelector) {
    return Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      }).length;
  },

  prepareDeckStage: function prepareDeckStage(hideSelector, stageSelector) {
    document.querySelectorAll(hideSelector).forEach(function (el) {
      el.style.setProperty("display", "none", "important");
    });
    document.querySelectorAll(stageSelector).forEach(function (el) {
      el.setAttribute("noscale", "");
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("transform-origin", "top left", "important");
      // Pierce open shadow roots used by <deck-stage>: kill fit() scale and
      // centering grid so the authored canvas sits at (0,0) filling the stage.
      var root = el.shadowRoot;
      if (root) {
        var canvas = root.querySelector(".canvas");
        var stage = root.querySelector(".stage");
        if (canvas) {
          canvas.style.setProperty("transform", "none", "important");
          canvas.style.setProperty("transform-origin", "top left", "important");
          canvas.style.setProperty("position", "absolute", "important");
          canvas.style.setProperty("left", "0", "important");
          canvas.style.setProperty("top", "0", "important");
          canvas.style.setProperty("margin", "0", "important");
        }
        if (stage) {
          stage.style.setProperty("display", "block", "important");
          stage.style.setProperty("place-items", "unset", "important");
          stage.style.setProperty("justify-items", "unset", "important");
        }
      }
    });
    // Preview fit wrappers often keep transform:scale(...); strip for export.
    document.querySelectorAll(".deck, .deck-viewport, .pptx-frame, .slide-frame").forEach(function (el) {
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("transform-origin", "top left", "important");
      el.style.setProperty("zoom", "normal", "important");
    });
    var s = document.createElement("style");
    s.setAttribute("data-od-shim-export-lock", "1");
    s.textContent =
      "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}" +
      ".deck,.deck-viewport,.pptx-frame,.slide-frame,deck-stage,#deck-stage,.deck-stage{transform:none!important;transform-origin:top left!important}";
    (document.head || document.documentElement).appendChild(s);
  },

  pinDeckStage: function pinDeckStage(w, h, stageSelector) {
    var style = document.createElement("style");
    style.textContent =
      "html,body{margin:0!important;padding:0!important;width:" +
      w +
      "px!important;height:" +
      h +
      "px!important;overflow:hidden!important}" +
      ".deck," +
      stageSelector +
      "{width:" +
      w +
      "px!important;height:" +
      h +
      "px!important}";
    document.head.appendChild(style);
  },

  /**
   * Detect body{display:flex;flex-direction:row} carousels where each slide is
   * one viewport wide (100vw / horizontal scroll). Preview navigates these via
   * scrollLeft, not visibility toggles or fixed stacking.
   */
  isHorizontalScrollCarousel: function isHorizontalScrollCarousel(slideSelector) {
    var body = document.body;
    if (!body) return false;
    var cs = window.getComputedStyle(body);
    if (cs.display !== "flex") return false;
    var dir = cs.flexDirection;
    if (dir !== "row" && dir !== "row-reverse") return false;
    var slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    if (slides.length < 2) return false;
    return body.scrollWidth > window.innerWidth * 1.2;
  },

  /** Pin horizontal-scroll carousels to a fixed stack at (0,0) for export. */
  pinCarouselSlidesForExport: pinCarouselSlidesForExport,

  /** Minimal export prep for scroll carousels — never overflow:hidden (breaks scroll). */
  prepareScrollCarouselExport: function prepareScrollCarouselExport() {
    var style = document.createElement("style");
    style.setAttribute("data-od-shim-scroll-carousel", "1");
    style.textContent = "html,body{margin:0!important;padding:0!important}";
    document.head.appendChild(style);
  },

  /**
   * Match preview + __odCaptureSnapshot: scroll the strip so slide N fills the
   * viewport, then capture innerWidth x innerHeight at scroll offset 0.
   */
  scrollCarouselToSlide: function scrollCarouselToSlide(slideSelector, index) {
    var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var left = index * w;
    var targets = [document.scrollingElement, document.documentElement, document.body];
    for (var t = 0; t < targets.length; t++) {
      var el = targets[t];
      if (!el) continue;
      try {
        el.scrollLeft = left;
      } catch (_) {}
      try {
        el.scrollTo({ left: left, top: 0, behavior: "instant" });
      } catch (_) {
        try {
          el.scrollTo(left, 0);
        } catch (__) {}
      }
    }
    var slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    var activeClasses = ["active", "visible", "is-active", "current"];
    slides.forEach(function (node, k) {
      var el = node;
      var on = k === index;
      activeClasses.forEach(function (c) {
        el.classList.toggle(c, on);
      });
      el.toggleAttribute("data-od-deck-active", on);
    });
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var slide = slides[index];
          if (!slide) return resolve(null);
          var r = slide.getBoundingClientRect();
          resolve({ x: r.x, y: r.y, w: r.width, h: r.height, scrollLeft: left });
        });
      });
    });
  },

  lockExportGeometry: function lockExportGeometry(w, h, slideSelector, stageSelector) {
    document.querySelectorAll(stageSelector).forEach(function (el) {
      el.setAttribute("noscale", "");
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("width", w + "px", "important");
      el.style.setProperty("height", h + "px", "important");
      el.style.setProperty("position", "fixed", "important");
      el.style.setProperty("left", "0", "important");
      el.style.setProperty("top", "0", "important");
      el.style.setProperty("right", "auto", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("inset", "auto", "important");
      var root = el.shadowRoot;
      if (root) {
        var canvas = root.querySelector(".canvas");
        var stage = root.querySelector(".stage");
        if (canvas) {
          canvas.style.setProperty("transform", "none", "important");
          canvas.style.setProperty("transform-origin", "top left", "important");
          canvas.style.setProperty("position", "absolute", "important");
          canvas.style.setProperty("left", "0", "important");
          canvas.style.setProperty("top", "0", "important");
          canvas.style.setProperty("width", w + "px", "important");
          canvas.style.setProperty("height", h + "px", "important");
          canvas.style.setProperty("margin", "0", "important");
        }
        if (stage) {
          stage.style.setProperty("display", "block", "important");
          stage.style.setProperty("inset", "0", "important");
          stage.style.setProperty("place-items", "unset", "important");
        }
      }
    });
    document.querySelectorAll(".deck, .deck-viewport").forEach(function (el) {
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("width", w + "px", "important");
      el.style.setProperty("height", h + "px", "important");
      el.style.setProperty("margin", "0", "important");
      el.style.setProperty("position", "relative", "important");
      el.style.setProperty("left", "0", "important");
      el.style.setProperty("top", "0", "important");
    });
    var style = document.createElement("style");
    style.setAttribute("data-od-shim-export-pin", "1");
    style.textContent =
      "html,body{margin:0!important;padding:0!important;width:" +
      w +
      "px!important;height:" +
      h +
      "px!important;overflow:hidden!important}" +
      ".deck," +
      stageSelector +
      "{width:" +
      w +
      "px!important;height:" +
      h +
      "px!important;transform:none!important}" +
      slideSelector +
      "{box-sizing:border-box!important}";
    document.head.appendChild(style);
  },

  restoreActiveSlideCapture: restoreActiveSlideCapture,

  activeSlideCaptureOffsetTransform: activeSlideCaptureOffsetTransform,

  forceSlideFillStage: function forceSlideFillStage(slideSelector, index, w, h) {
    var slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    var el = slides[index];
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var underFilled = r.width < w * 0.92 || r.height < h * 0.92;
    var centeredSmall = r.width < w * 0.92 && r.x > 4;
    if (!underFilled && !centeredSmall) return false;
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("left", "0", "important");
    el.style.setProperty("top", "0", "important");
    el.style.setProperty("width", w + "px", "important");
    el.style.setProperty("height", h + "px", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("max-height", "none", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("transform", "none", "important");
    el.style.setProperty("zoom", "normal", "important");
    return true;
  },

  measureSlide: function measureSlide(slideSelector, stageSelector) {
    function positiveCssNumber(value) {
      if (typeof value === "number") return Number.isFinite(value) && value > 1 ? value : null;
      if (typeof value !== "string") return null;
      const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim());
      if (!match) return null;
      const n = Number(match[1]);
      return Number.isFinite(n) && n > 1 ? n : null;
    }
    function sizePair(w, h) {
      const width = positiveCssNumber(w);
      const height = positiveCssNumber(h);
      return width != null && height != null ? { w: width, h: height } : null;
    }
    function deckStageAuthoredSize(stage) {
      const byProp = sizePair(stage.designWidth, stage.designHeight);
      if (byProp) return byProp;
      const byAttr = sizePair(stage.getAttribute("width"), stage.getAttribute("height"));
      if (byAttr) return byAttr;
      const byStyle = sizePair(stage.style && stage.style.width, stage.style && stage.style.height);
      if (byStyle) return byStyle;
      const computed = window.getComputedStyle && window.getComputedStyle(stage);
      const byComputed = computed ? sizePair(computed.width, computed.height) : null;
      if (byComputed) return byComputed;
      return sizePair(stage.offsetWidth, stage.offsetHeight);
    }
    function measureAuthored(el) {
      const stage = el.closest(stageSelector);
      const stageSize = stage ? deckStageAuthoredSize(stage) : null;
      if (stageSize) return stageSize;
      const attrSize = sizePair(el.getAttribute("width"), el.getAttribute("height"));
      if (attrSize) return attrSize;
      const styleSize = sizePair(el.style && el.style.width, el.style && el.style.height);
      if (styleSize) return styleSize;
      const computed = window.getComputedStyle && window.getComputedStyle(el);
      const computedSize = computed ? sizePair(computed.width, computed.height) : null;
      if (computedSize) return computedSize;
      return sizePair(el.offsetWidth, el.offsetHeight);
    }

    const slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    if (slides.length === 0) return null;
    for (let i = 0; i < slides.length; i++) {
      const authored = measureAuthored(slides[i]);
      if (authored) return authored;
      const r = slides[i].getBoundingClientRect();
      if (r.width > 1 && r.height > 1) return { w: r.width, h: r.height };
    }
    return null;
  },

  showSlide: function showSlide(slideSelector, index) {
    (function restoreCapture() {
      var layer = document.getElementById("__od_export_active_slide_capture");
      if (!layer) return;
      var placeholder = document.getElementById("__od_export_active_slide_placeholder");
      var liveSlide = layer.firstElementChild && layer.firstElementChild.firstElementChild;
      if (placeholder && placeholder.parentNode && liveSlide) {
        placeholder.parentNode.insertBefore(liveSlide, placeholder);
        placeholder.remove();
        var styles = layer.__odSourceStyles || [];
        for (var i = 0; i < styles.length; i++) {
          var entry = styles[i];
          if (entry.value) liveSlide.style.setProperty(entry.name, entry.value, entry.priority);
          else liveSlide.style.removeProperty(entry.name);
        }
      }
      layer.remove();
    })();
    const slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    const activeClasses = ["active", "visible", "is-active", "current"];
    const activeAttributes = ["data-od-deck-active"];
    slides.forEach(function (node, k) {
      const el = node;
      const on = k === index;
      el.style.setProperty("transition", "none", "important");
      el.style.setProperty("animation", "none", "important");
      el.style.setProperty("opacity", on ? "1" : "0", "important");
      el.style.setProperty("visibility", on ? "visible" : "hidden", "important");
      el.style.setProperty("pointer-events", on ? "auto" : "none", "important");
      el.style.setProperty("z-index", on ? "999" : "0", "important");
      activeClasses.forEach(function (c) {
        el.classList.toggle(c, on);
      });
      activeAttributes.forEach(function (a) {
        el.toggleAttribute(a, on);
      });
    });
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          const el = slides[index];
          if (!el) return resolve(null);
          const r = el.getBoundingClientRect();
          resolve({ x: r.x, y: r.y, w: r.width, h: r.height });
        });
      });
    });
  },

  restackActiveSlide: function restackActiveSlide(slideSelector, index, w, h) {
    (function restoreCapture() {
      var layer = document.getElementById("__od_export_active_slide_capture");
      if (!layer) return;
      var placeholder = document.getElementById("__od_export_active_slide_placeholder");
      var liveSlide = layer.firstElementChild && layer.firstElementChild.firstElementChild;
      if (placeholder && placeholder.parentNode && liveSlide) {
        placeholder.parentNode.insertBefore(liveSlide, placeholder);
        placeholder.remove();
        var styles = layer.__odSourceStyles || [];
        for (var i = 0; i < styles.length; i++) {
          var entry = styles[i];
          if (entry.value) liveSlide.style.setProperty(entry.name, entry.value, entry.priority);
          else liveSlide.style.removeProperty(entry.name);
        }
      }
      layer.remove();
    })();
    const slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    const el = slides[index];
    if (!el) return;
    const layer = document.createElement("div");
    layer.id = "__od_export_active_slide_capture";
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "position:fixed!important;left:0!important;top:0!important;width:" +
      w +
      "px!important;height:" +
      h +
      "px!important;margin:0!important;padding:0!important;overflow:hidden!important;z-index:2147483647!important;pointer-events:none!important";

    const offset = document.createElement("div");
    offset.style.cssText =
      "position:absolute!important;left:0!important;top:0!important;width:" +
      w +
      "px!important;height:" +
      h +
      "px!important;transform-origin:top left!important";

    const sourceStyleNames = ["opacity", "visibility", "pointer-events", "z-index"];
    layer.__odSourceStyles = sourceStyleNames.map(function (name) {
      return {
        name: name,
        priority: el.style.getPropertyPriority(name),
        value: el.style.getPropertyValue(name),
      };
    });
    const placeholder = document.createElement("template");
    placeholder.id = "__od_export_active_slide_placeholder";
    el.parentNode.insertBefore(placeholder, el);
    layer.appendChild(offset);
    document.body.appendChild(layer);
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("visibility", "visible", "important");
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("z-index", "2147483647", "important");
    offset.appendChild(el);
    const liveRect = el.getBoundingClientRect();
    offset.style.setProperty(
      "transform",
      "translate(" + -liveRect.x + "px," + -liveRect.y + "px)",
      "important",
    );
  },

  waitFontsAndFrames: function waitFontsAndFrames() {
    const fontsReady =
      document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function"
        ? document.fonts.ready.then(function () {
            return true;
          }).catch(function () {
            return true;
          })
        : Promise.resolve(true);
    return fontsReady.then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            resolve(true);
          });
        });
      });
    });
  },

  pageMetrics: function pageMetrics() {
    return {
      w: Math.max(document.documentElement.scrollWidth, (document.body && document.body.scrollWidth) || 0, 1),
      h: Math.max(document.documentElement.scrollHeight, (document.body && document.body.scrollHeight) || 0, 1),
    };
  },
};
