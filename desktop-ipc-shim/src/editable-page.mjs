/**
 * Page-side editable PPTX helpers — plain ESM, never run through tsx.
 * All prep helpers are nested inside runDomToPptx so page.evaluate serialization works.
 */

export const editablePageFns = {
  showAllSlides: function showAllSlides(slideSelector, w, h) {
    var slides = Array.prototype.slice
      .call(document.querySelectorAll(slideSelector))
      .filter(function (el) {
        return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
      });
    for (var i = 0; i < slides.length; i++) {
      var el = slides[i];
      el.style.setProperty("opacity", "1", "important");
      el.style.setProperty("visibility", "visible", "important");
      el.style.setProperty("position", "absolute", "important");
      el.style.setProperty("left", "0", "important");
      el.style.setProperty("top", "0", "important");
      if (w > 0) el.style.setProperty("width", w + "px", "important");
      if (h > 0) el.style.setProperty("height", h + "px", "important");
      el.style.setProperty("box-sizing", "border-box", "important");
      ["active", "visible", "is-active", "current"].forEach(function (c) {
        el.classList.add(c);
      });
    }
    return slides.length;
  },

  collectImportedStylesheetUrls: function collectImportedStylesheetUrls() {
    var urls = new Set();
    var pattern = /@import\s+(?:url\(\s*)?(?:(["'])([\s\S]*?)\1|([^"')\s;]+))\s*\)?[^;]*;/gi;
    document.querySelectorAll("style").forEach(function (style) {
      var text = style.textContent || "";
      var match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        var raw = match[2] || match[3];
        if (!raw) continue;
        try {
          urls.add(new URL(raw, document.baseURI).href);
        } catch (_) {}
      }
    });
    return Array.from(urls);
  },

  runDomToPptx: async function runDomToPptx(
    slideSelector,
    _layeredBackgrounds,
    phase,
    importedStylesheetOverrides,
  ) {
    function stripFamilyQuotes(name) {
      return (name || "").replace(/^["']|["']$/g, "").trim();
    }

    function isFontLocallyAvailable(family) {
      if (!family || !document.fonts || typeof document.fonts.check !== "function") return false;
      try {
        return document.fonts.check('16px "' + family + '"') || document.fonts.check("16px " + family);
      } catch (_) {
        return false;
      }
    }

    // Platform-only CJK faces that Chromium may *name* in CSS but cannot embed.
    // On Windows/WPS these resolve to 宋体 when missing — map to embeddable Noto.
    var PLATFORM_CJK_TO_NOTO = {
      "pingfang sc": "Noto Sans SC",
      "pingfang tc": "Noto Sans TC",
      "pingfang hk": "Noto Sans TC",
      "苹方": "Noto Sans SC",
      "蘋方-繁": "Noto Sans TC",
      "microsoft yahei": "Noto Sans SC",
      "microsoft yahei ui": "Noto Sans SC",
      "微软雅黑": "Noto Sans SC",
      "microsoft jhenghei": "Noto Sans TC",
      "微軟正黑體": "Noto Sans TC",
      "hiragino sans gb": "Noto Sans SC",
      "hiragino sans": "Noto Sans JP",
      "hiragino kaku gothic pro": "Noto Sans JP",
      "hiragino kaku gothic pron": "Noto Sans JP",
      "hiragino mincho pro": "Noto Serif JP",
      "songti sc": "Noto Serif SC",
      "stsong": "Noto Serif SC",
      "simsun": "Noto Serif SC",
      "宋体": "Noto Serif SC",
      "simhei": "Noto Sans SC",
      "黑体": "Noto Sans SC",
      "heiti sc": "Noto Sans SC",
      "heiti tc": "Noto Sans TC",
      "kaiti sc": "Noto Serif SC",
      "楷体": "Noto Serif SC",
      "fangsong": "Noto Serif SC",
      "仿宋": "Noto Serif SC",
    };

    function notoSubstituteFor(family) {
      var key = stripFamilyQuotes(family).toLowerCase();
      if (PLATFORM_CJK_TO_NOTO[key]) return PLATFORM_CJK_TO_NOTO[key];
      if (/pingfang|苹方|蘋方/i.test(key)) return "Noto Sans SC";
      if (/yahei|雅黑/i.test(key)) return "Noto Sans SC";
      if (/hiragino.*mincho|明朝/i.test(key)) return "Noto Serif JP";
      if (/hiragino|heiti|黑体|gothic/i.test(key)) return /tc|hk|繁|jheng/i.test(key) ? "Noto Sans TC" : "Noto Sans SC";
      if (/song|宋|kai|楷|fang|仿|mincho|serif/i.test(key)) return "Noto Serif SC";
      return null;
    }

    function cjkPromotedFontFamily(fontFamily, text) {
      var cjkText =
        /[\u2E80-\u2FDF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;
      var cjkFamily =
        /noto\s*(sans|serif)\s*(sc|tc|hk|jp|kr|cjk)|source\s*han|pingfang|hiragino|heiti|songti|kaiti|fangsong|microsoft\s*(yahei|jhenghei)|yahei|simsun|simhei|mingliu|meiryo|ms\s*(gothic|mincho)|malgun|nanum|gulim|batang|dotum|思源|苹方|黑体|宋体|楷体|仿宋|微软雅黑|明體|明朝|ゴシック/i;
      if (!fontFamily || !cjkText.test(text || "")) return null;
      var families = fontFamily
        .split(",")
        .map(function (f) {
          return f.trim();
        })
        .filter(Boolean);
      if (families.length < 2) return null;
      // Prefer a CJK face that is actually available (or already Noto), not just
      // the first CJK name in the authored stack (often PingFang on mac templates).
      var cjkIndexes = [];
      for (var i = 0; i < families.length; i++) {
        if (cjkFamily.test(stripFamilyQuotes(families[i]))) cjkIndexes.push(i);
      }
      if (cjkIndexes.length === 0) return null;
      var pick = cjkIndexes.find(function (idx) {
        var name = stripFamilyQuotes(families[idx]);
        return /^noto\s/i.test(name) || isFontLocallyAvailable(name);
      });
      if (pick == null) pick = cjkIndexes[0];
      if (pick <= 0 && isFontLocallyAvailable(stripFamilyQuotes(families[0]))) return null;
      if (pick <= 0) return null;
      return [families[pick]]
        .concat(
          families.filter(function (_f, i) {
            return i !== pick;
          }),
        )
        .join(", ");
    }

    function promoteCjkTypefaces(slides) {
      var touched = new Set();
      for (var s = 0; s < slides.length; s++) {
        var walker = document.createTreeWalker(slides[s], NodeFilter.SHOW_TEXT);
        for (var node = walker.nextNode(); node; node = walker.nextNode()) {
          var el = node.parentElement;
          if (!el || touched.has(el)) continue;
          touched.add(el);
          var combined = "";
          for (var i = 0; i < el.childNodes.length; i++) {
            var child = el.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) combined += child.nodeValue || "";
          }
          if (!combined.trim()) continue;
          var style = getComputedStyle(el);
          var promoted = cjkPromotedFontFamily(style.fontFamily, combined);
          if (promoted) el.style.setProperty("font-family", promoted, "important");
        }
      }
    }

    function remapUnavailableTypefaces(slides) {
      var touched = new Set();
      for (var s = 0; s < slides.length; s++) {
        var walker = document.createTreeWalker(slides[s], NodeFilter.SHOW_TEXT);
        for (var node = walker.nextNode(); node; node = walker.nextNode()) {
          var el = node.parentElement;
          if (!el || touched.has(el)) continue;
          touched.add(el);
          var combined = "";
          for (var i = 0; i < el.childNodes.length; i++) {
            var child = el.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) combined += child.nodeValue || "";
          }
          if (!combined.trim()) continue;
          var style = getComputedStyle(el);
          var families = style.fontFamily
            .split(",")
            .map(function (f) {
              return f.trim();
            })
            .filter(Boolean);
          if (families.length === 0) continue;
          var rewritten = [];
          var changed = false;
          for (var fi = 0; fi < families.length; fi++) {
            var raw = families[fi];
            var name = stripFamilyQuotes(raw);
            var key = name.toLowerCase();
            var generic =
              /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont)$/i.test(
                name,
              );
            if (generic) {
              rewritten.push(raw);
              continue;
            }
            var forced = PLATFORM_CJK_TO_NOTO[key] || notoSubstituteFor(name);
            // Always rewrite known platform-only faces (PingFang/YaHei/…): even when
            // font check lies via fallback, they cannot be embedded into PPTX.
            if (forced && (PLATFORM_CJK_TO_NOTO[key] || !isFontLocallyAvailable(name))) {
              rewritten.push('"' + forced + '"');
              changed = true;
            } else {
              rewritten.push(raw);
            }
          }
          var lead = stripFamilyQuotes(rewritten[0] || "");
          var leadKey = lead.toLowerCase();
          var leadForced = PLATFORM_CJK_TO_NOTO[leadKey] || notoSubstituteFor(lead);
          if (leadForced && (PLATFORM_CJK_TO_NOTO[leadKey] || !isFontLocallyAvailable(lead))) {
            rewritten = ['"' + leadForced + '"'].concat(
              rewritten.filter(function (f) {
                return stripFamilyQuotes(f).toLowerCase() !== leadForced.toLowerCase();
              }),
            );
            changed = true;
          }
          if (changed) el.style.setProperty("font-family", rewritten.join(", "), "important");
        }
      }
    }

    function bakeTextTypography(slides) {
      for (var s = 0; s < slides.length; s++) {
        slides[s].querySelectorAll("*").forEach(function (el) {
          var text = (el.innerText || el.textContent || "").trim();
          if (!text) return;
          var hasHeavyChild = false;
          for (var i = 0; i < el.children.length; i++) {
            var tag = el.children[i].tagName;
            if (
              tag !== "BR" &&
              tag !== "WBR" &&
              tag !== "SPAN" &&
              tag !== "STRONG" &&
              tag !== "EM" &&
              tag !== "B" &&
              tag !== "I" &&
              tag !== "A" &&
              tag !== "CODE" &&
              tag !== "MARK"
            ) {
              hasHeavyChild = true;
              break;
            }
          }
          if (hasHeavyChild && el.children.length > 3) return;
          var style = getComputedStyle(el);
          el.style.setProperty("font-family", style.fontFamily, "important");
          el.style.setProperty("font-size", style.fontSize, "important");
          el.style.setProperty("font-weight", style.fontWeight, "important");
          el.style.setProperty("font-style", style.fontStyle, "important");
          el.style.setProperty("letter-spacing", style.letterSpacing, "important");
          if (style.lineHeight && style.lineHeight !== "normal") {
            el.style.setProperty("line-height", style.lineHeight, "important");
          }
          el.style.setProperty("color", style.color, "important");
          el.style.setProperty("text-align", style.textAlign, "important");
        });
      }
    }

    function stabilizeLargeSingleLineText(slides) {
      for (var s = 0; s < slides.length; s++) {
        slides[s].querySelectorAll("*").forEach(function (el) {
          var rawText = el.innerText || el.textContent || "";
          var text = rawText.replace(/\s+/g, " ").trim();
          if (!text || rawText.indexOf("\n") !== -1) return;
          var style = getComputedStyle(el);
          var fontSizePx = Number.parseFloat(style.fontSize);
          if (!Number.isFinite(fontSizePx) || fontSizePx < 96) return;
          var lineHeightPx = Number.parseFloat(style.lineHeight);
          if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0 || lineHeightPx > fontSizePx * 1.05) return;
          var rect = el.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) return;
          var justify =
            style.textAlign === "center" || style.textAlign === "-webkit-center"
              ? "center"
              : style.textAlign === "right" || style.textAlign === "end"
                ? "flex-end"
                : "flex-start";
          el.style.setProperty("display", "flex", "important");
          el.style.setProperty("align-items", "center", "important");
          el.style.setProperty("justify-content", justify, "important");
          el.style.setProperty("width", rect.width + "px", "important");
          el.style.setProperty("height", rect.height + "px", "important");
          el.style.setProperty("line-height", "normal", "important");
          el.style.setProperty("white-space", "nowrap", "important");
          el.style.setProperty("overflow", "visible", "important");
        });
      }
    }

    function stabilizeAuthoredHeadingLines(slides) {
      for (var s = 0; s < slides.length; s++) {
        slides[s].querySelectorAll("h1, h2, h3").forEach(function (heading) {
          if (heading.querySelector("br")) {
            heading.style.setProperty("white-space", "nowrap", "important");
          }
        });
      }
    }

    function freezeLayoutBoxes(slides) {
      function hasFixedLike(el, style) {
        return (
          style.width.endsWith("px") ||
          style.maxWidth.endsWith("px") ||
          style.flexGrow === "0" ||
          el.classList.contains("fig") ||
          el.classList.contains("cover-art") ||
          el.classList.contains("scene") ||
          el.classList.contains("cia-wrap") ||
          el.classList.contains("center-fig") ||
          el.classList.contains("icon-card") ||
          el.classList.contains("ic")
        );
      }

      function isInlineOnlyTag(el) {
        return /^(SPAN|A|STRONG|EM|B|I|CODE|MARK|WBR|SMALL|U|S|SUB|SUP|LABEL)$/i.test(el.tagName);
      }

      function isFreezeCandidate(el, style) {
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (style.display === "inline") return false;
        if (isInlineOnlyTag(el) && style.display !== "inline-block" && style.display !== "block") return false;
        var text = (el.innerText || "").trim();
        var isNamedBlock =
          /^(H[1-6]|P|LI|BUTTON|TD|TH|DT|DD|FIGCAPTION|BLOCKQUOTE|DIV|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|MAIN|NAV)$/i.test(
            el.tagName,
          );
        var isTextBlock =
          !!text &&
          (isNamedBlock ||
            style.display === "block" ||
            style.display === "flex" ||
            style.display === "grid" ||
            style.display === "inline-block" ||
            style.display === "table-cell");
        return isTextBlock || hasFixedLike(el, style);
      }

      function hasFreezeAncestor(el, slide) {
        var p = el.parentElement;
        while (p && p !== slide) {
          if (p.getAttribute("data-od-pptx-freeze") === "1") return true;
          p = p.parentElement;
        }
        return false;
      }

      for (var s = 0; s < slides.length; s++) {
        var slide = slides[s];
        var slideRect = slide.getBoundingClientRect();
        slide.style.setProperty("width", Math.round(slideRect.width) + "px", "important");
        slide.style.setProperty("height", Math.round(slideRect.height) + "px", "important");

        // Pass 1: outermost candidates only (avoid freezing nested span/p pairs to
        // conflicting boxes — that was inflating/shrinking PPT text frames).
        var candidates = [];
        slide.querySelectorAll("*").forEach(function (el) {
          if (el.closest("svg")) return;
          var style = getComputedStyle(el);
          if (!isFreezeCandidate(el, style)) return;
          var rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          candidates.push({ el: el, style: style, rect: rect });
        });

        candidates.forEach(function (item) {
          if (hasFreezeAncestor(item.el, slide)) return;
          item.el.setAttribute("data-od-pptx-freeze", "1");
          var boxW = Math.max(1, Math.ceil(item.rect.width));
          // +1px absorbs subpixel / CJK metric drift between Chromium and PPT.
          var boxH = Math.max(1, Math.ceil(item.rect.height + 1));
          item.el.style.setProperty("width", boxW + "px", "important");
          item.el.style.setProperty("max-width", boxW + "px", "important");
          item.el.style.setProperty("height", boxH + "px", "important");
          item.el.style.setProperty("box-sizing", "border-box", "important");
          item.el.style.setProperty("overflow", "visible", "important");
        });

        slide.querySelectorAll("*").forEach(function (el) {
          if (el.closest("svg")) return;
          var style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return;

          if (
            style.paddingTop !== "0px" ||
            style.paddingRight !== "0px" ||
            style.paddingBottom !== "0px" ||
            style.paddingLeft !== "0px"
          ) {
            el.style.setProperty(
              "padding",
              style.paddingTop +
                " " +
                style.paddingRight +
                " " +
                style.paddingBottom +
                " " +
                style.paddingLeft,
              "important",
            );
          }
          if (style.gap && style.gap !== "normal") {
            el.style.setProperty("gap", style.gap, "important");
          }
        });
      }
    }

    function isTransparentColor(input) {
      var value = (input || "").trim().toLowerCase();
      return value === "" || value === "transparent" || value === "rgba(0, 0, 0, 0)";
    }

    function ensureExplicitSlideBackgrounds(slides) {
      for (var s = 0; s < slides.length; s++) {
        var slide = slides[s];
        slide.querySelectorAll(":scope > [data-od-pptx-bg]").forEach(function (el) {
          el.remove();
        });
        var candidates = [];
        for (var el = slide; el; el = el.parentElement) candidates.push(el);
        if (document.body && candidates.indexOf(document.body) < 0) candidates.push(document.body);
        if (document.documentElement && candidates.indexOf(document.documentElement) < 0) {
          candidates.push(document.documentElement);
        }
        var background = null;
        for (var i = 0; i < candidates.length; i++) {
          var style = getComputedStyle(candidates[i]);
          var bgColor = style.backgroundColor;
          var bgImage = style.backgroundImage;
          var hasImage = bgImage && bgImage !== "none";
          var hasColor = bgColor && !isTransparentColor(bgColor);
          if (!hasImage && !hasColor) continue;
          background = {
            color: hasColor ? bgColor : "rgb(255, 255, 255)",
            image: bgImage,
            position: style.backgroundPosition,
            size: style.backgroundSize,
            repeat: style.backgroundRepeat,
            origin: style.backgroundOrigin,
            clip: style.backgroundClip,
          };
          break;
        }
        if (!background) continue;
        var bg = document.createElement("div");
        bg.setAttribute("data-od-pptx-bg", "true");
        bg.setAttribute("aria-hidden", "true");
        bg.style.setProperty("position", "absolute", "important");
        bg.style.setProperty("inset", "0", "important");
        bg.style.setProperty("z-index", "-1000002", "important");
        bg.style.setProperty("pointer-events", "none", "important");
        bg.style.setProperty("background-color", background.color, "important");
        bg.style.setProperty("background-image", background.image, "important");
        bg.style.setProperty("background-position", background.position, "important");
        bg.style.setProperty("background-size", background.size, "important");
        bg.style.setProperty("background-repeat", background.repeat, "important");
        bg.style.setProperty("background-origin", background.origin, "important");
        bg.style.setProperty("background-clip", background.clip, "important");
        var slideStyle = getComputedStyle(slide);
        if (slideStyle.position === "static") slide.style.setProperty("position", "relative", "important");
        if (slideStyle.overflow === "visible") slide.style.setProperty("overflow", "hidden", "important");
        slide.style.setProperty("background-color", background.color, "important");
        Array.from(slide.children).forEach(function (child) {
          if (child.getAttribute("data-od-pptx-bg") === "true") return;
          var childStyle = getComputedStyle(child);
          if (childStyle.position === "static") child.style.setProperty("position", "relative", "important");
          if (childStyle.zIndex === "auto") child.style.setProperty("z-index", "1", "important");
        });
        slide.prepend(bg);
      }
    }

    // Rasterize at ≥4× CSS box so PPT pictures stay sharp when scaled.
    var SVG_RASTER_SCALE = 4;
    var SVG_RASTER_MAX_EDGE = 8192;

    // Copy used/computed paints onto the clone so standalone SVG data-URLs keep
    // CSS-variable and currentColor styling (var(--accent), theme colors, etc.).
    function inlineSvgStyles(source, target) {
      var computed = getComputedStyle(source);
      var paintAttrs = ["fill", "stroke", "stop-color", "flood-color"];
      for (var p = 0; p < paintAttrs.length; p++) {
        var attr = paintAttrs[p];
        var used = computed.getPropertyValue(attr);
        if (used && String(used).trim() !== "") {
          target.setAttribute(attr, used);
        }
      }
      var extras = [
        ["stroke-width", "stroke-width"],
        ["stroke-linecap", "stroke-linecap"],
        ["stroke-linejoin", "stroke-linejoin"],
        ["stroke-dasharray", "stroke-dasharray"],
        ["stroke-opacity", "stroke-opacity"],
        ["fill-opacity", "fill-opacity"],
        ["opacity", "opacity"],
      ];
      for (var e = 0; e < extras.length; e++) {
        var cssName = extras[e][0];
        var outAttr = extras[e][1];
        var val = computed.getPropertyValue(cssName);
        if (val && val !== "" && val !== "auto" && val !== "normal") {
          target.setAttribute(outAttr, val);
        }
      }
      var styleAttr = target.getAttribute("style");
      if (styleAttr && /var\(|currentColor/i.test(styleAttr)) {
        target.removeAttribute("style");
      }
      var srcKids = source.children;
      var tgtKids = target.children;
      for (var i = 0; i < srcKids.length; i++) {
        if (tgtKids[i]) inlineSvgStyles(srcKids[i], tgtKids[i]);
      }
    }

    /**
     * Pin a rasterized SVG replacement to the same CSS box as the original.
     * Without this, position:absolute deco (corner marks, watermarks) collapses
     * into normal flow and stacks with title/body like body content.
     */
    function applyRasterImgGeometry(svg, img, slide, w, h) {
      var style = getComputedStyle(svg);
      var classAttr = svg.getAttribute("class");
      if (classAttr) img.setAttribute("class", classAttr);
      var ariaHidden = svg.getAttribute("aria-hidden");
      if (ariaHidden != null) img.setAttribute("aria-hidden", ariaHidden);
      img.setAttribute("alt", "");
      img.setAttribute("width", String(w));
      img.setAttribute("height", String(h));
      img.style.cssText =
        "display:block;width:" +
        w +
        "px;height:" +
        h +
        "px;margin:0;padding:0;border:0;max-width:none;max-height:none;";

      var position = style.position;
      if (position === "absolute" || position === "fixed") {
        var svgRect = svg.getBoundingClientRect();
        // Prefer the positioned containing block; fall back to the slide.
        var containing = svg.offsetParent;
        if (!containing || containing === document.body || containing === document.documentElement) {
          containing = slide;
        }
        var cRect = containing.getBoundingClientRect();
        var left = Math.round(svgRect.left - cRect.left);
        var top = Math.round(svgRect.top - cRect.top);
        img.style.setProperty("position", "absolute", "important");
        img.style.setProperty("left", left + "px", "important");
        img.style.setProperty("top", top + "px", "important");
        img.style.setProperty("right", "auto", "important");
        img.style.setProperty("bottom", "auto", "important");
        if (style.zIndex && style.zIndex !== "auto") {
          img.style.setProperty("z-index", style.zIndex, "important");
        }
        img.style.setProperty("pointer-events", "none", "important");
      }
      if (style.opacity && style.opacity !== "1") {
        img.style.setProperty("opacity", style.opacity, "important");
      }
      if (style.transform && style.transform !== "none") {
        img.style.setProperty("transform", style.transform, "important");
        img.style.setProperty("transform-origin", style.transformOrigin, "important");
      }
    }

    function rasterizeInlineSvgs(slides) {
      for (var s = 0; s < slides.length; s++) {
        var slide = slides[s];
        var svgs = Array.prototype.slice.call(slide.querySelectorAll("svg"));
        for (var i = 0; i < svgs.length; i++) {
          var svg = svgs[i];
          if (svg.getAttribute("data-od-pptx-rasterized") === "1") continue;
          var rect = svg.getBoundingClientRect();
          var w = Math.max(1, Math.round(rect.width));
          var h = Math.max(1, Math.round(rect.height));
          if (w < 2 || h < 2) continue;
          try {
            var style = getComputedStyle(svg);
            var color = style.color || "#000";
            var scale = SVG_RASTER_SCALE;
            var rw = Math.max(1, Math.round(w * scale));
            var rh = Math.max(1, Math.round(h * scale));
            var edge = Math.max(rw, rh);
            if (edge > SVG_RASTER_MAX_EDGE) {
              var fit = SVG_RASTER_MAX_EDGE / edge;
              rw = Math.max(1, Math.round(rw * fit));
              rh = Math.max(1, Math.round(rh * fit));
            }
            var clone = svg.cloneNode(true);
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            clone.setAttribute("width", String(rw));
            clone.setAttribute("height", String(rh));
            if (!clone.getAttribute("viewBox")) {
              if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
                var vb = svg.viewBox.baseVal;
                clone.setAttribute(
                  "viewBox",
                  vb.x + " " + vb.y + " " + vb.width + " " + vb.height,
                );
              } else {
                clone.setAttribute("viewBox", "0 0 " + w + " " + h);
              }
            }
            inlineSvgStyles(svg, clone);
            // Ensure currentColor paints resolve even if computed stroke was empty.
            clone.querySelectorAll("*").forEach(function (node) {
              ["fill", "stroke", "stop-color", "flood-color"].forEach(function (attr) {
                var val = node.getAttribute(attr);
                if (val && /currentColor/i.test(val)) node.setAttribute(attr, color);
              });
            });
            var xml = new XMLSerializer().serializeToString(clone);
            if (/currentColor/i.test(xml)) xml = xml.replace(/currentColor/gi, color);
            // Drop unresolved CSS vars — they render blank in standalone SVG images.
            if (/var\(/i.test(xml)) {
              xml = xml.replace(
                /\s(fill|stroke|stop-color|flood-color)="var\([^"]*\)"/gi,
                function (_m, attrName) {
                  if (String(attrName).toLowerCase() === "fill") return ' fill="none"';
                  return " " + attrName + '="' + color + '"';
                },
              );
            }
            var dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
            var img = document.createElement("img");
            img.setAttribute("data-od-pptx-rasterized", "1");
            img.setAttribute("data-od-pptx-raster-w", String(rw));
            img.setAttribute("data-od-pptx-raster-h", String(rh));
            applyRasterImgGeometry(svg, img, slide, w, h);
            img.src = dataUrl;
            svg.parentNode.insertBefore(img, svg);
            svg.remove();
          } catch (_) {}
        }
      }
    }

    async function waitForRasterImages(slides) {
      var imgs = [];
      for (var s = 0; s < slides.length; s++) {
        slides[s].querySelectorAll('img[data-od-pptx-rasterized="1"]').forEach(function (img) {
          imgs.push(img);
        });
      }
      await Promise.all(
        imgs.map(function (img) {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise(function (resolve) {
            var done = function () {
              resolve();
            };
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 1500);
          });
        }),
      );
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!img.src || img.src.indexOf("image/png") !== -1) continue;
        try {
          var targetW =
            Number(img.getAttribute("data-od-pptx-raster-w")) ||
            img.naturalWidth ||
            Number(img.getAttribute("width")) ||
            0;
          var targetH =
            Number(img.getAttribute("data-od-pptx-raster-h")) ||
            img.naturalHeight ||
            Number(img.getAttribute("height")) ||
            0;
          if (targetW < 1 || targetH < 1) continue;
          var canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          var ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, targetW, targetH);
          img.src = canvas.toDataURL("image/png");
        } catch (_) {}
      }
    }

    function normalizeSvgClassNames() {
      document.querySelectorAll("*").forEach(function (el) {
        var cn = el.className;
        if (cn != null && typeof cn !== "string") {
          try {
            Object.defineProperty(el, "className", {
              value: cn.baseVal != null ? cn.baseVal : "",
              configurable: true,
              writable: true,
            });
          } catch (_) {}
        }
      });
    }

    function importedStylesheetUrls(cssText, baseHref) {
      var urls = [];
      var importPattern =
        /@import\s+(?:url\(\s*)?(?:(["'])([\s\S]*?)\1|([^"')\s;]+))\s*\)?[^;]*;/gi;
      var match;
      while ((match = importPattern.exec(cssText)) !== null) {
        var raw = match[2] || match[3];
        if (!raw) continue;
        try {
          urls.push(new URL(raw, baseHref).href);
        } catch (_) {}
      }
      return urls;
    }

    function importedFontFaceCss(cssText, baseHref) {
      var faces = (cssText.match(/@font-face\s*\{[\s\S]*?\}/gi) || []).map(function (rule) {
        function value(property) {
          var m = rule.match(new RegExp(property + "\\s*:\\s*([^;]+)", "i"));
          return m ? m[1].trim() : "";
        }
        return {
          family: value("font-family").replace(/^['"]|['"]$/g, ""),
          rule: rule,
          style: value("font-style").toLowerCase() || "normal",
          unicodeRange: value("unicode-range"),
          weight: value("font-weight").toLowerCase() || "400",
        };
      });
      var preferredFace = new Map();
      faces.forEach(function (face) {
        var rank =
          face.style === "normal" ? (face.weight === "400" || face.weight === "normal" ? 0 : 1) : 2;
        var current = preferredFace.get(face.family);
        if (!current || rank < current.rank) {
          preferredFace.set(face.family, { rank: rank, style: face.style, weight: face.weight });
        }
      });
      var cjkFamilyName =
        /noto\s*(sans|serif)\s*(sc|tc|hk|jp|kr|cjk)|source\s*han|思源/i;
      var preferredRule = new Map();
      var cjkSubsetRules = new Map();
      faces.forEach(function (face) {
        var preferred = preferredFace.get(face.family);
        if (!preferred || preferred.style !== face.style || preferred.weight !== face.weight) return;
        if (cjkFamilyName.test(face.family) && face.unicodeRange) {
          var list = cjkSubsetRules.get(face.family) || [];
          list.push(face.rule);
          cjkSubsetRules.set(face.family, list);
          return;
        }
        var rank = face.unicodeRange === "" ? 0 : /U\+0000-00FF/i.test(face.unicodeRange) ? 1 : 2;
        var current = preferredRule.get(face.family);
        if (!current || rank < current.rank) preferredRule.set(face.family, { rank: rank, rule: face.rule });
      });
      function absolutize(rule) {
        return rule.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (_m, _q, raw) {
          try {
            return 'url("' + new URL(raw.trim(), baseHref).href + '")';
          } catch (_) {
            return 'url("' + raw.trim() + '")';
          }
        });
      }
      var out = [];
      preferredRule.forEach(function (entry) {
        out.push(absolutize(entry.rule));
      });
      cjkSubsetRules.forEach(function (rules) {
        // Cap subsets so embed stays bounded; prefer denser CJK ranges first.
        var sorted = rules.slice().sort(function (a, b) {
          var ua = (a.match(/unicode-range\s*:\s*([^;]+)/i) || [])[1] || "";
          var ub = (b.match(/unicode-range\s*:\s*([^;]+)/i) || [])[1] || "";
          var score = function (u) {
            if (/4E00|3400|9FFF|F900/i.test(u)) return 0;
            if (/0000-00FF/i.test(u)) return 2;
            return 1;
          };
          return score(ua) - score(ub);
        });
        sorted.slice(0, 48).forEach(function (rule) {
          out.push(absolutize(rule));
        });
      });
      return out.join("\n");
    }

    async function exposeImportedFontFaces(overrides) {
      var importedUrls = new Set();
      document.querySelectorAll("style").forEach(function (style) {
        importedStylesheetUrls(style.textContent || "", document.baseURI).forEach(function (url) {
          importedUrls.add(url);
        });
      });
      var listOverrides = overrides || [];
      // Seed with Node-prefetched stylesheets (Noto CJK fallbacks / Google Fonts)
      // so embed works even when the authored HTML has no @import.
      listOverrides.forEach(function (entry) {
        if (entry && entry.url) importedUrls.add(entry.url);
      });
      if (importedUrls.size === 0) return [];

      var visited = new Set();
      var fontFaceRules = [];

      async function collect(url) {
        if (visited.has(url)) return;
        visited.add(url);
        try {
          var override = listOverrides.find(function (entry) {
            return entry.url === url;
          });
          var response = override ? null : await fetch(url);
          if (response && !response.ok) throw new Error("HTTP " + response.status);
          var cssText = override ? override.cssText : await response.text();
          var nested = importedStylesheetUrls(cssText, url);
          for (var i = 0; i < nested.length; i++) await collect(nested[i]);
          var fontCss = importedFontFaceCss(cssText, url);
          if (fontCss) fontFaceRules.push(fontCss);
        } catch (_) {}
      }

      var list = Array.from(importedUrls);
      for (var i = 0; i < list.length; i++) await collect(list[i]);
      if (fontFaceRules.length === 0) return [];

      var combinedCss = fontFaceRules.join("\n");
      var styleEl = document.createElement("style");
      styleEl.setAttribute("data-od-pptx-imported-font-faces", "true");
      styleEl.textContent = combinedCss;
      document.head.appendChild(styleEl);

      var fontsByFamily = new Map();
      (combinedCss.match(/@font-face\s*\{[\s\S]*?\}/gi) || []).forEach(function (rule) {
        var family = (rule.match(/font-family\s*:\s*([^;]+)/i) || [])[1];
        if (!family) return;
        family = family.trim().replace(/^['"]|['"]$/g, "");
        var urls = fontsByFamily.get(family) || new Set();
        var um;
        var re = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
        while ((um = re.exec(rule)) !== null) {
          if (um[1]) urls.add(um[1]);
        }
        if (urls.size > 0) fontsByFamily.set(family, urls);
      });
      return Array.from(fontsByFamily, function (entry) {
        return { name: entry[0], urls: Array.from(entry[1]) };
      });
    }

    function htmlToPlainNotes(html) {
      var tmp = document.createElement("div");
      tmp.innerHTML = html || "";
      tmp.querySelectorAll("script,style").forEach(function (el) {
        el.remove();
      });
      tmp.querySelectorAll("br").forEach(function (br) {
        br.replaceWith("\n");
      });
      tmp.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6").forEach(function (block) {
        block.appendChild(document.createTextNode("\n"));
      });
      return (tmp.innerText || tmp.textContent || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    function readSpeakerNotesJson() {
      var tag = document.getElementById("speaker-notes");
      if (!tag) return [];
      try {
        var parsed = JSON.parse(tag.textContent || "[]");
        if (Array.isArray(parsed)) {
          return parsed.map(function (item) {
            if (typeof item === "string") return item.trim();
            if (item && typeof item.text === "string") return item.text.trim();
            return String(item ?? "").trim();
          });
        }
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.notes)) {
          return parsed.notes.map(function (item) {
            return String(item ?? "").trim();
          });
        }
      } catch (_) {}
      return [];
    }

    // Prefer per-slide .notes / aside.notes / .speaker-notes / data-*; fall back
    // to document #speaker-notes JSON array (deck-stage / OpenDesign convention).
    function collectSpeakerNotes(slides) {
      var jsonNotes = readSpeakerNotesJson();
      return slides.map(function (slide, index) {
        var noteEl = null;
        var noteCandidates = slide.querySelectorAll(
          ".notes, aside.notes, .speaker-notes, [data-speaker-notes]",
        );
        for (var ni = 0; ni < noteCandidates.length; ni++) {
          var cand = noteCandidates[ni];
          if (cand.closest(".notes-overlay, .overview, .thumb, .mini-slide")) continue;
          noteEl = cand;
          break;
        }
        if (noteEl) {
          var fromEl = htmlToPlainNotes(noteEl.innerHTML);
          if (fromEl) return fromEl;
        }
        var attr =
          slide.getAttribute("data-notes") ||
          slide.getAttribute("data-speaker-notes") ||
          slide.getAttribute("data-od-notes");
        if (attr && attr.trim()) return attr.trim();
        if (jsonNotes[index] && String(jsonNotes[index]).trim()) return String(jsonNotes[index]).trim();
        return "";
      });
    }

    function installSpeakerNotesHook(slides) {
      var notes = collectSpeakerNotes(slides);
      globalThis.__odPptxSlideNotes = function (index) {
        var text = notes[index] || "";
        return text.trim() ? text : "";
      };
      return notes.filter(Boolean).length;
    }

    try {
      var win = window;
      if (!win.domToPptx || typeof win.domToPptx.exportToPptx !== "function") {
        return { error: "dom-to-pptx engine did not load" };
      }
      var slides = Array.prototype.slice
        .call(document.querySelectorAll(slideSelector))
        .filter(function (el) {
          return !el.closest(".mini-slide, .overview, .notes-overlay, .thumb");
        });
      if (slides.length === 0) return { error: "no slides to export" };

      var importedFonts = await exposeImportedFontFaces(importedStylesheetOverrides || []);
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch (_) {}
      }

      if (phase !== "export-prepared") {
        ensureExplicitSlideBackgrounds(slides);
        // Resolve CJK faces to embeddable Noto *before* baking metrics / freezing
        // boxes, so Chromium layout and PPT typeface/metrics agree.
        promoteCjkTypefaces(slides);
        remapUnavailableTypefaces(slides);
        if (document.fonts && document.fonts.ready) {
          try {
            await document.fonts.ready;
          } catch (_) {}
        }
        bakeTextTypography(slides);
        stabilizeLargeSingleLineText(slides);
        stabilizeAuthoredHeadingLines(slides);
        freezeLayoutBoxes(slides);
        rasterizeInlineSvgs(slides);
        await waitForRasterImages(slides);
        normalizeSvgClassNames();
      }

      if (phase === "prepare") return { prepared: true };

      var notesCount = installSpeakerNotesHook(slides);
      var exportOpts = {
        fileName: "deck.pptx",
        skipDownload: true,
        autoEmbedFonts: true,
        // Raster path: CSS-sized / currentColor SVGs were already replaced with PNGs.
        svgAsVector: false,
      };
      if (importedFonts.length > 0) exportOpts.fonts = importedFonts;

      var blob;
      try {
        blob = await win.domToPptx.exportToPptx(slides, exportOpts);
      } finally {
        try {
          delete globalThis.__odPptxSlideNotes;
        } catch (_) {
          globalThis.__odPptxSlideNotes = undefined;
        }
      }
      if (!blob || typeof blob.arrayBuffer !== "function") {
        return { error: "dom-to-pptx returned no blob" };
      }
      var bytes = new Uint8Array(await blob.arrayBuffer());
      var binary = "";
      var CHUNK = 0x8000;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      }
      return { b64: btoa(binary), notesCount: notesCount };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};
