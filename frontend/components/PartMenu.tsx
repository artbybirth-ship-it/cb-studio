"use client";

/**
 * The right-click menu of a part inside a pose (the older pose view's, now shared with the native pose editor: one menu UI for every pose).
 * A click on a part offers Cut … Delete Layer; on empty stage only the pastes. "Back to Scene" steps out. `canSwap` adds Swap with
 * copied part (the native editor has it).
 */
export type PartAction = "cut" | "copy" | "paste" | "pasteFront" | "pasteBack" | "toFront" | "forward" | "backward" | "toBack" | "duplicate"
  | "flipH" | "flipV" | "pivot" | "group" | "ungroup" | "hide" | "lock" | "delete" | "swap" | "back";

export default function PartMenu({ x, y, hasPart, canSwap, onAction }: { x: number; y: number; hasPart: boolean; canSwap?: boolean; onAction: (action: PartAction) => void }) {
  const item = (action: PartAction, label: string, keys?: string, title?: string) => (
    <button type="button" role="menuitem" data-action={action} title={title} onClick={() => onAction(action)}>{label}{keys && <kbd>{keys}</kbd>}</button>
  );
  return (
    <div className="cb-frame-menu cb-symbol-menu" role="menu" style={{ left: x, top: y, maxHeight: "calc(100vh - 16px)", overflowY: "auto" }} onPointerDown={(event) => event.stopPropagation()}
      ref={(element) => {
        // A long menu opened low on the screen slides up so that all of it can be reached.
        if (!element) return;
        const box = element.getBoundingClientRect();
        if (box.bottom > window.innerHeight - 8) element.style.top = `${Math.max(8, window.innerHeight - 8 - box.height)}px`;
        if (box.right > window.innerWidth - 8) element.style.left = `${Math.max(8, window.innerWidth - 8 - box.width)}px`;
      }}>
      {hasPart ? <>
        {item("cut", "Cut", "⌘X")}
        {item("copy", "Copy", "⌘C")}
        {item("paste", "Paste", "⌘V")}
        {item("pasteFront", "Paste in Front", "⌘F")}
        {item("pasteBack", "Paste in Back", "⌘B")}
        {canSwap && item("swap", "Swap with Copied Part", undefined, "The picked part becomes the copied part, in the same place and with the same animation, on every keyframe of its layer")}
        <span className="cb-frame-menu-sep" aria-hidden="true" />
        {item("toFront", "Bring to Front", "⇧⌘↑")}
        {item("forward", "Bring Forward", "⌘↑")}
        {item("backward", "Send Backward", "⌘↓")}
        {item("toBack", "Send to Back", "⇧⌘↓")}
        <span className="cb-frame-menu-sep" aria-hidden="true" />
        {item("duplicate", "Duplicate Layer", "⌘D")}
        {item("flipH", "Flip Horizontal", "H")}
        {item("flipV", "Flip Vertical", "⇧H")}
        {item("pivot", "Reset Registration Point")}
        {item("group", "Group in Folder", "⌘G")}
        {item("ungroup", "Ungroup", "⇧⌘G")}
        {item("hide", "Hide Layer")}
        {item("lock", "Lock Layer")}
        {item("delete", "Delete Layer", "⌫")}
      </> : <>
        {item("paste", "Paste", "⌘V")}
        {item("pasteFront", "Paste in Front", "⌘F")}
        {item("pasteBack", "Paste in Back", "⌘B")}
      </>}
      {item("back", "Back to Scene", "Esc")}
    </div>
  );
}
