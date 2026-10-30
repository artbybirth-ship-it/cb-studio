import { useEffect, useRef } from "react";

/**
 * Esc closes panels, one per press: the panel opened last closes first. Panels (and modes such as
 * picking a colour on the canvas) register while they are open with useEscClose.
 *
 * While the caret is in a text box, Esc is left to that box first (it usually leaves the box);
 * if the box keeps the focus, Esc only leaves it. The next Esc closes the panel. Once nothing is
 * registered, Esc goes on to the editor's own shortcuts (leave a part, back to Select, …).
 *
 * The listener is added when this module loads, before any component's, so a panel's Esc never
 * also reaches an editor shortcut.
 */
type Entry = { close: () => void };
const stack: Entry[] = [];

const isTyping = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || stack.length === 0 || isTyping(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stack[stack.length - 1].close();
  }, true);
  // A text box that didn't handle Esc itself: Esc leaves it.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || stack.length === 0) return;
    if (isTyping(event.target) && document.activeElement === event.target) event.target.blur();
  });
}

/** While `open`, Esc calls onClose (after anything opened later has closed). */
export function useEscClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const entry: Entry = { close: () => closeRef.current() };
    stack.push(entry);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [open]);
}
