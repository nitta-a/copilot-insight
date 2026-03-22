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
    for (const child of el.children) {
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
        for (const [markId, origEl] of shadowHosts) {
          const clonedEl = clonedDoc.querySelector<HTMLElement>(`[data-png-capture-id="${markId}"]`);
          if (clonedEl) {
            _flattenShadowIntoLight(origEl, clonedEl);
          }
        }
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
      styles.push(Array.from(sheet.cssRules).map((r) => r.cssText).join("\n"));
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
    styleEl.textContent = cssText;
    clone.insertBefore(styleEl, clone.firstChild);
  }

  // Copy the shadow root's HTML, then replace <slot> placeholders with the
  // real slotted content from the original element.
  const shadowDiv = clone.ownerDocument.createElement("div");
  shadowDiv.innerHTML = shadow.innerHTML;

  for (const slot of shadowDiv.querySelectorAll<HTMLSlotElement>("slot")) {
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
}
