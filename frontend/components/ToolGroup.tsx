"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import Popover from "@/components/Popover";

/**
 * A tool rail group (Illustrator): a labelled button whose corner mark shows it holds more tools.
 * A plain click runs `onPrimary` (the group's current tool), or opens the panel when there is none;
 * a half-second press, or a click on the corner mark, opens the panel beside the rail.
 */
export type ToolGroupItem = {
  id: string;
  label: string;
  /** Shown after the label, e.g. "V" → "Select (V)". */
  shortcut?: string;
  icon: ReactNode;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  /** The panel stays open after this item (Align: several clicks in a row). */
  keepOpen?: boolean;
};

type Props = {
  label: string;
  icon: ReactNode;
  title: string;
  active?: boolean;
  onPrimary?: () => void;
  items?: ToolGroupItem[];
  /** Extra panel content below the items (Align options). */
  children?: ReactNode;
  panelTitle?: string;
  panelClassName?: string;
  /** Lets the editor anchor other popovers (Open Project's recent list) to this button. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
};

const LONG_PRESS_MS = 500;

export default function ToolGroup({ label, icon, title, active = false, onPrimary, items = [], children, panelTitle, panelClassName = "", buttonRef }: Props) {
  const ownRef = useRef<HTMLButtonElement>(null);
  const anchorRef = buttonRef || ownRef;
  const [open, setOpen] = useState(false);
  const pressTimer = useRef(0);
  const longPressed = useRef(false);
  const hasPanel = items.length > 1 || Boolean(children);

  const cancelPress = () => window.clearTimeout(pressTimer.current);
  return (
    <div className={`cb-tool-group ${active ? "active" : ""}`}>
      <span className="cb-tool-group-label" aria-hidden="true">{label}</span>
      <button
        type="button"
        ref={anchorRef}
        className={`cb-tool-group-button ${active ? "active" : ""} ${open ? "open" : ""}`}
        aria-label={label}
        aria-haspopup={hasPanel ? "menu" : undefined}
        aria-expanded={hasPanel ? open : undefined}
        aria-pressed={onPrimary ? active : undefined}
        title={hasPanel ? `${title} · hold, or click the corner mark, for more` : title}
        onPointerDown={(event) => {
          if (!hasPanel || event.button !== 0) return;
          longPressed.current = false;
          cancelPress();
          pressTimer.current = window.setTimeout(() => { longPressed.current = true; setOpen(true); }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onClick={(event) => {
          cancelPress();
          if (longPressed.current) { longPressed.current = false; return; }
          const onMark = (event.target as HTMLElement).closest?.(".cb-tool-group-mark");
          if (hasPanel && (onMark || !onPrimary)) { setOpen((value) => !value); return; }
          onPrimary?.();
        }}
      >
        {icon}
        {hasPanel && <span className="cb-tool-group-mark" aria-hidden="true" />}
      </button>
      {hasPanel && (
        <Popover open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} placement="right" offset={10} className={`cb-tool-flyout ${panelClassName}`} aria-label={panelTitle || label}>
          <div className="cb-tool-flyout-head">{panelTitle || label}</div>
          {items.length > 0 && (
            <div className="cb-tool-flyout-grid">
              {items.map((item) => (
                <button key={item.id} type="button" role="menuitem" className={`cb-tool-flyout-item ${item.active ? "active" : ""}`} disabled={item.disabled} title={item.title}
                  onClick={() => { if (!item.keepOpen) setOpen(false); item.onSelect(); }}>
                  {item.icon}
                  <span>{item.label}{item.shortcut ? ` (${item.shortcut})` : ""}</span>
                </button>
              ))}
            </div>
          )}
          {children}
        </Popover>
      )}
    </div>
  );
}
