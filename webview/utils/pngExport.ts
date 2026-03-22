/**
 * pngExport — Shadow DOM-aware PNG capture utilities.
 *
 * html2canvas does not render Shadow DOM content by default.  This module
 * works around the limitation by walking the original element tree, finding
 * all custom elements that host a shadow root, and flattening their shadow
 * root content into the cloned document that html2canvas operates on.
 *
 * Usage:
 *   await downloadAsPng(cardElement, "my-card.png");
 */

import html2canvas from "html2canvas";

/**
 * Capture `element` as a PNG data-URI and trigger a browser download.
 *
 * @param element  The DOM element to capture (may contain Shadow DOM children).
 * @param filename Suggested download filename (default: "export.png").
 */
export async function downloadAsPng(element: HTMLElement, filename = "export.png"): Promise<void> {
  const dataUrl = await captureAsPng(element);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Capture `element` as a PNG data-URI.
 *
 * Adds temporary marker attributes to all Shadow DOM host descendants so that
 * the `onclone` callback can locate and flatten each shadow root into the
 * cloned document that html2canvas processes.
 */
export async function captureAsPng(element: HTMLElement): Promise<string> {
  const shadowHosts = new Map<string, HTMLElement>();
  let idCounter = 0;

  const markShadowHosts = (el: Element): void => {
    if ((el as HTMLElement).shadowRoot) {
      const markId = `__png-capture-${idCounter++}`;
      el.setAttribute("data-png-capture-id", markId);
      shadowHosts.set(markId, el as HTMLElement);
    }
    for (const child of Array.from(el.children)) {
      markShadowHosts(child);
    }
  };

  markShadowHosts(element);

  try {
    const bgColor = getComputedStyle(document.body).backgroundColor || "#1e1e1e";
    const canvas = await html2canvas(element, {
      allowTaint: true,
      // biome-ignore lint/style/useNamingConvention: html2canvas API property
      useCORS: true,
      backgroundColor: bgColor,
      scale: window.devicePixelRatio || 1,
      onclone: (clonedDoc: Document) => {
        // Flatten Shadow DOM first so that the subsequent rewrite also covers
        // any <style> elements injected by _flattenShadowIntoLight.
        for (const [markId, origEl] of shadowHosts) {
          const clonedEl = clonedDoc.querySelector<HTMLElement>(`[data-png-capture-id="${markId}"]`);
          if (clonedEl) {
            try {
              _flattenShadowIntoLight(origEl, clonedEl);
            } catch {
              // Skip this shadow host if flattening fails; html2canvas renders it as-is.
            }
          }
        }
        // Remove CSS functions unsupported by html2canvas from both stylesheet
        // text and inline style attributes in the cloned document.
        _rewriteUnsupportedCssInClone(clonedDoc);
      },
    });
    return canvas.toDataURL("image/png");
  } finally {
    for (const el of shadowHosts.values()) {
      el.removeAttribute("data-png-capture-id");
    }
  }
}

/**
 * Copy the shadow root of `original` into the light DOM of `clone` so that
 * html2canvas can render it.
 *
 * - Extracts CSS from the shadow root's style sheets and rewrites `:host`
 *   selectors to the element's tag name.
 * - Copies the shadow root's innerHTML and replaces `<slot>` elements with
 *   the matching slotted content from `original`.
 */
function _flattenShadowIntoLight(original: HTMLElement, clone: HTMLElement): void {
  const shadow = original.shadowRoot;
  if (!shadow) {
    return;
  }

  // Extract CSS rules from all shadow root style sheets.
  const styles: string[] = [];
  for (const sheet of Array.from(shadow.styleSheets)) {
    try {
      const stylesText = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      styles.push(stylesText);
    } catch {
      // Skip cross-origin or inaccessible sheets.
    }
  }

  // Rewrite :host selectors to the element's own tag name so they apply in
  // the cloned document's flat (non-shadow) context.
  const tag = original.tagName.toLowerCase();
  const cssText = styles
    .join("\n")
    .replace(/:host\(([^)]+)\)/g, `${tag}$1`)
    .replace(/:host\b/g, tag);

  if (cssText) {
    const styleEl = clone.ownerDocument.createElement("style");
    // Strip unsupported CSS functions so the element is already clean even before
    // the global _rewriteUnsupportedCssInClone pass runs over the cloned document.
    styleEl.textContent = _stripUnsupportedCssColorFunctions(cssText);
    clone.insertBefore(styleEl, clone.firstChild);
  }

  // Copy the shadow root's HTML, then replace <slot> placeholders with the
  // real slotted content from the original element.
  const shadowDiv = clone.ownerDocument.createElement("div");
  shadowDiv.innerHTML = shadow.innerHTML;

  for (const slot of Array.from(shadowDiv.querySelectorAll<HTMLSlotElement>("slot"))) {
    const slotName = slot.getAttribute("name");
    if (slotName) {
      // Named slot — find the matching slotted child.
      // Use CSS.escape to handle slot names with special characters.
      const slotted = original.querySelector(`[slot="${CSS.escape(slotName)}"]`);
      if (slotted) {
        slot.replaceWith(slotted.cloneNode(true));
      } else {
        slot.remove();
      }
    } else {
      // Default slot — collect all non-named-slotted children.
      const frag = clone.ownerDocument.createDocumentFragment();
      for (const child of Array.from(original.childNodes)) {
        if (!(child instanceof Element && child.hasAttribute("slot"))) {
          frag.appendChild(child.cloneNode(true));
        }
      }
      if (frag.hasChildNodes()) {
        slot.replaceWith(frag);
      } else {
        slot.remove();
      }
    }
  }

  clone.appendChild(shadowDiv);

  // Copy pixel data from the original shadow-root canvases to the newly cloned
  // canvases.  innerHTML creates blank <canvas> elements; html2canvas will render
  // them as empty unless we transfer the pixel data here.
  const origCanvases = Array.from(shadow.querySelectorAll<HTMLCanvasElement>("canvas"));
  const clonedCanvases = Array.from(shadowDiv.querySelectorAll<HTMLCanvasElement>("canvas"));
  for (let i = 0; i < Math.min(origCanvases.length, clonedCanvases.length); i++) {
    const orig = origCanvases[i];
    const cloned = clonedCanvases[i];
    if (orig.width > 0 && orig.height > 0) {
      cloned.width = orig.width;
      cloned.height = orig.height;
      try {
        cloned.getContext("2d")?.drawImage(orig, 0, 0);
      } catch {
        // Ignore SecurityError for tainted canvases (cross-origin image sources).
      }
    }
  }
}

/**
 * Remove CSS functions that html2canvas cannot parse from both `<style>`
 * elements and inline `style` attributes in a cloned document.
 *
 * html2canvas parses raw stylesheet text rather than relying on computed styles,
 * so modern color functions can cause a hard parse error. We replace them with
 * `transparent` which is a safe fallback for decorative backgrounds and borders.
 */
function _rewriteUnsupportedCssInClone(doc: Document): void {
  for (const style of Array.from(doc.querySelectorAll<HTMLStyleElement>("style"))) {
    if (style.textContent) {
      style.textContent = _stripUnsupportedCssColorFunctions(style.textContent);
    }
  }

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const styleAttr = el.getAttribute("style");
    if (styleAttr) {
      el.setAttribute("style", _stripUnsupportedCssColorFunctions(styleAttr));
    }
  }
}

/**
 * Remove all unsupported CSS color function calls from a CSS string by scanning
 * for balanced parentheses and replacing each call with `transparent`.
 *
 * A simple regex like `/color\([^)]+\)/g` would break on nested parens
 * (e.g. `color-mix(in srgb, var(--some-var) 80%, transparent)`), so we walk
 * the string character by character and track paren depth instead.
 */
function _stripUnsupportedCssColorFunctions(css: string): string {
  const prefixes = ["color-mix(", "color(", "lab(", "lch(", "oklab(", "oklch("];
  let result = "";
  let i = 0;
  while (i < css.length) {
    let nextIdx = -1;
    let nextPrefix = "";
    for (const prefix of prefixes) {
      const idx = css.indexOf(prefix, i);
      if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) {
        nextIdx = idx;
        nextPrefix = prefix;
      }
    }

    if (nextIdx === -1) {
      result += css.slice(i);
      break;
    }

    result += css.slice(i, nextIdx);

    // Skip the entire balanced function call.
    let depth = 0;
    let j = nextIdx + nextPrefix.length - 1;
    while (j < css.length) {
      if (css[j] === "(") {
        depth++;
      } else if (css[j] === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
      j++;
    }

    result += "transparent";
    i = j;
  }
  return result;
}
