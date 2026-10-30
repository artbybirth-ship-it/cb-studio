"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Popover from "@/components/Popover";
import PanelClose from "@/components/PanelClose";

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
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  /** The panel stays open after this item (Align: several clicks in a row). */
  keepOpen?: boolean;
  /** A list that opens beside the panel (Animate's File › Import). */
  submenu?: ToolGroupSubItem[];
};
export type ToolGroupSubItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** Shown instead of the shortcut, e.g. "Coming soon". */
  note?: string;
  title?: string;
  onSelect: () => void;
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
  /** Any press on the button (click, hold or the corner mark): the rail highlights this group. */
  onPress?: () => void;
};

const LONG_PRESS_MS = 500;

export default function ToolGroup({ label, icon, title, active = false, onPrimary, items = [], children, panelTitle, panelClassName = "", buttonRef, onPress }: Props) {
  const ownRef = useRef<HTMLButtonElement>(null);
  const anchorRef = buttonRef || ownRef;
  const [open, setOpen] = useState(false);
  // The open submenu (File › Import) and its top inside the panel; it closes with the panel.
  const [submenu, setSubmenu] = useState<{ id: string; top: number } | null>(null);
  useEffect(() => { if (!open) setSubmenu(null); }, [open]);
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
          if (event.button !== 0) return;
          onPress?.();
          if (!hasPanel) return;
          longPressed.current = false;
          cancelPress();
          pressTimer.current = window.setTimeout(() => { longPressed.current = true; setOpen(true); }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onClick={(event) => {
          cancelPress();
          if (event.detail === 0) onPress?.(); // keyboard: Enter / Space
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
          <div className="cb-tool-flyout-head"><PanelClose onClose={() => setOpen(false)} label={`Close ${panelTitle || label}`} />{panelTitle || label}</div>
          {items.length > 0 && (
            <div className="cb-tool-flyout-grid">
              {items.map((item) => (
                <button key={item.id} type="button" role="menuitem" className={`cb-tool-flyout-item ${item.active || submenu?.id === item.id ? "active" : ""}`} disabled={item.disabled} title={item.title}
                  aria-haspopup={item.submenu ? "menu" : undefined} aria-expanded={item.submenu ? submenu?.id === item.id : undefined}
                  onClick={(event) => {
                    if (item.submenu) {
                      const top = event.currentTarget.offsetTop;
                      setSubmenu((current) => (current?.id === item.id ? null : { id: item.id, top }));
                      return;
                    }
                    if (!item.keepOpen) setOpen(false);
                    item.onSelect?.();
                  }}>
                  {item.icon}
                  <span>{item.label}{item.shortcut ? ` (${item.shortcut})` : ""}</span>
                </button>
              ))}
            </div>
          )}
          {submenu && (() => {
            const parent = items.find((item) => item.id === submenu.id);
            return parent?.submenu ? (
              <div className="cb-tool-submenu" role="menu" aria-label={parent.label} style={{ top: submenu.top }}>
                {parent.submenu.map((entry) => (
                  <button key={entry.id} type="button" role="menuitem" disabled={entry.disabled} title={entry.title || entry.note}
                    onClick={() => { setOpen(false); entry.onSelect(); }}>
                    <span>{entry.label}</span>
                    {(entry.note || entry.shortcut) && <kbd>{entry.note || entry.shortcut}</kbd>}
                  </button>
                ))}
              </div>
            ) : null;
          })()}
          {children}
        </Popover>
      )}
    </div>
  );
}
