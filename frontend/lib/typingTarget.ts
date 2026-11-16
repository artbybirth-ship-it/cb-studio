/**
 * Whether a key press is going into something the user types in (a text or number box, a text
 * area, a drop-down list, editable text). Shortcuts like Cmd+Z leave those alone so typing works.
 * A checkbox, radio button, button, slider or colour well is not one: ticking "Include Stroke" and
 * then pressing Cmd+Z still undoes the scene.
 */
const NOT_TYPING = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "input") return !NOT_TYPING.has(((element as HTMLInputElement).type || "text").toLowerCase());
  return tag === "textarea" || tag === "select" || element.isContentEditable;
}
