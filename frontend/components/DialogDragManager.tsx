"use client";

import { useEffect } from "react";

/**
 * Makes every floating box movable, app-wide, with no code in the box itself:
 *  - a dialog (`role="dialog"`) drags by its direct `<header>`;
 *  - anything else drags by an element marked `data-drag-handle`.
 * The box that moves is the handle's parent (or the nearest `data-drag-box`). The offset is the CSS
 * `translate` property, so a box's own `transform` (e.g. centring) keeps working. Positions are
 * remembered per box for the session; double-clicking the handle puts the box back. Part of the
 * handle always stays on screen.
 */

const HANDLE = '[role="dialog"] > header, [data-drag-handle]';
// Pressing these inside a handle uses them instead of dragging.
const INTERACTIVE = 'button, input, select, textarea, a, label, [role="option"], [role="menuitem"], [contenteditable="true"]';
const STORAGE_KEY = "cb-dialog-positions";
const KEEP_VISIBLE = 60; // px of the handle kept inside the window horizontally

type Offset = { x: number; y: number };

const readPositions = (): Record<string, Offset> => {
  try { return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch { return {}; }
};
const writePosition = (key: string, offset: Offset | null) => {
  try {
    const positions = readPositions();
    if (offset) positions[key] = offset; else delete positions[key];
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch { /* storage blocked: positions just aren't remembered */ }
};

const boxOf = (handle: Element) => (handle.closest("[data-drag-box]") as HTMLElement | null) || (handle.parentElement as HTMLElement | null);

const keyOf = (box: HTMLElement) => {
  const owner = box.closest<HTMLElement>("[data-drag-id], [aria-label], [aria-labelledby]");
  if (!owner) return box.className.split(" ")[0] || "box";
  if (owner.dataset.dragId) return owner.dataset.dragId;
  const labelledBy = owner.getAttribute("aria-labelledby");
  return owner.getAttribute("aria-label") || (labelledBy && document.getElementById(labelledBy)?.textContent?.trim()) || box.className.split(" ")[0] || "box";
};

const currentOffset = (box: HTMLElement): Offset => ({ x: Number(box.dataset.dragX || 0), y: Number(box.dataset.dragY || 0) });

/** Clamps a wanted offset so the handle stays reachable, measured from where it is now. */
const clampOffset = (box: HTMLElement, handle: Element, wanted: Offset): Offset => {
  const now = currentOffset(box);
  const rect = handle.getBoundingClientRect();
  // The handle's rectangle without any offset.
  const left = rect.left - now.x, right = rect.right - now.x, top = rect.top - now.y;
  const keep = Math.min(KEEP_VISIBLE, rect.width);
  const minX = keep - right, maxX = window.innerWidth - keep - left;
  const minY = -top, maxY = window.innerHeight - Math.min(rect.height, 40) - top;
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, wanted.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, wanted.y))),
  };
};

const applyOffset = (box: HTMLElement, offset: Offset) => {
  box.dataset.dragX = String(offset.x);
  box.dataset.dragY = String(offset.y);
  box.style.translate = offset.x || offset.y ? `${offset.x}px ${offset.y}px` : "";
};

export default function DialogDragManager() {
  useEffect(() => {
    let drag: { box: HTMLElement; handle: Element; key: string; startX: number; startY: number; from: Offset; pointerId: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const handle = event.target.closest(HANDLE);
      if (!handle || event.target.closest(INTERACTIVE)) return;
      const box = boxOf(handle);
      if (!box) return;
      event.preventDefault(); // no text selection while dragging
      drag = { box, handle, key: keyOf(box), startX: event.clientX, startY: event.clientY, from: currentOffset(box), pointerId: event.pointerId };
      box.classList.add("cb-dragging");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      applyOffset(drag.box, clampOffset(drag.box, drag.handle, { x: drag.from.x + event.clientX - drag.startX, y: drag.from.y + event.clientY - drag.startY }));
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.box.classList.remove("cb-dragging");
      const offset = currentOffset(drag.box);
      if (offset.x !== drag.from.x || offset.y !== drag.from.y) writePosition(drag.key, offset);
      drag = null;
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(INTERACTIVE)) return;
      const handle = event.target.closest(HANDLE);
      const box = handle && boxOf(handle);
      if (!box) return;
      applyOffset(box, { x: 0, y: 0 });
      writePosition(keyOf(box), null);
    };

    // A box that opens goes back where the user last left it.
    const restore = (handle: Element) => {
      const box = boxOf(handle);
      if (!box || box.dataset.dragRestored) return;
      box.dataset.dragRestored = "1";
      const saved = readPositions()[keyOf(box)];
      if (saved) applyOffset(box, clampOffset(box, handle, saved));
    };
    const scan = (root: ParentNode) => root.querySelectorAll(HANDLE).forEach(restore);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(HANDLE)) restore(node);
          scan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan(document);

    // After the window shrinks, pull moved boxes back so their handle is still reachable.
    const onResize = () => {
      document.querySelectorAll<HTMLElement>("[data-drag-x]").forEach((box) => {
        const handle = box.querySelector(HANDLE) || (box.matches(HANDLE) ? box : null);
        if (handle) applyOffset(box, clampOffset(box, handle, currentOffset(box)));
      });
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return null;
}
