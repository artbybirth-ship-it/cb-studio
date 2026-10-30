import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * Scrubby number boxes (Adobe, like the timeline's Ease control): press and drag left / right to
 * change the value live; Shift = 10× faster, Option/Alt = 0.1× (fine); Esc puts it back. A click
 * without a drag places the caret to type, as before. Every numeric entry in the app uses this.
 *
 * While a drag runs, the window gets "cb-scrub-start" and "cb-scrub-end", so the editor keeps the
 * whole drag as one undo step.
 */
export type ScrubOptions = {
  /** The value when the press starts; null = nothing to change (the box is empty). */
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Change per pixel dragged (default 1). */
  step?: number;
  /** Decimals kept (default 0: whole numbers). */
  decimals?: number;
  disabled?: boolean;
};

export const SCRUB_START = "cb-scrub-start";
export const SCRUB_END = "cb-scrub-end";
const DRAG_THRESHOLD = 3;

const canScrub = (input: HTMLInputElement, options: ScrubOptions) =>
  !options.disabled && !input.disabled && !input.readOnly && document.activeElement !== input && options.value != null && Number.isFinite(options.value);

/** Spread onto an <input>: `<input {...scrubProps({ value, onChange })} … />`. */
export function scrubProps(options: ScrubOptions) {
  return {
    "data-scrub": "",
    // Keeps the box from taking focus on press; a click without a drag focuses it on release.
    onMouseDown: (event: ReactMouseEvent<HTMLInputElement>) => {
      if (event.button === 0 && canScrub(event.currentTarget, options)) event.preventDefault();
    },
    onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      if (event.button !== 0 || !canScrub(input, options)) return;
      event.preventDefault();
      event.stopPropagation();
      const { onChange, min = -Infinity, max = Infinity, step = 1, decimals = 0 } = options;
      const start = options.value as number;
      const factor = 10 ** decimals;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      let lastX = startX;
      let offset = 0;
      let latest = start;
      let dragging = false;
      try { input.setPointerCapture(pointerId); } catch { /* pointer already gone */ }

      const finish = () => {
        input.removeEventListener("pointermove", move);
        input.removeEventListener("pointerup", up);
        input.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", escape, true);
        try { input.releasePointerCapture(pointerId); } catch { /* already released */ }
        document.body.classList.remove("cb-scrubbing");
        if (dragging) window.dispatchEvent(new Event(SCRUB_END));
      };
      const move = (moveEvent: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD) return;
          dragging = true;
          lastX = moveEvent.clientX;
          document.body.classList.add("cb-scrubbing");
          window.dispatchEvent(new Event(SCRUB_START));
          return;
        }
        offset += (moveEvent.clientX - lastX) * step * (moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1);
        lastX = moveEvent.clientX;
        const next = Math.max(min, Math.min(max, Math.round((start + offset) * factor) / factor));
        if (next !== latest) { latest = next; onChange(next); }
      };
      const up = () => {
        const clicked = !dragging;
        finish();
        if (clicked) { input.focus(); input.select(); }
      };
      const cancel = () => finish();
      const escape = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        if (dragging && latest !== start) onChange(start);
        finish();
      };
      input.addEventListener("pointermove", move);
      input.addEventListener("pointerup", up);
      input.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", escape, true);
    },
  };
}
