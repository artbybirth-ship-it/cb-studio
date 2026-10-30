"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  /** Element the popover is attached to; clicks inside it do not count as "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Preferred side; bottom/top flip to the other side when there is more room there. "right"
   *  opens beside the anchor, top-aligned (tool rail flyouts). */
  placement?: "bottom" | "top" | "right";
  /** start/end align that edge with the anchor; stretch matches the anchor width. */
  align?: "start" | "end" | "stretch";
  /** Never narrower than the anchor. */
  matchAnchorWidth?: boolean;
  offset?: number;
  className?: string;
  role?: string;
  "aria-label"?: string;
  children: ReactNode;
};

const VIEWPORT_MARGIN = 8;

/**
 * Menu rendered into document.body with fixed positioning, so scroll areas and
 * overflow:hidden panels can never clip it. Keeps itself inside the viewport.
 */
export default function Popover({
  open, anchorRef, onClose, placement = "bottom", align = "start", matchAnchorWidth = false,
  offset = 6, className = "", role = "menu", "aria-label": ariaLabel, children,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const [side, setSide] = useState(placement);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    if (placement === "right") {
      const height = Math.min(popover.scrollHeight, viewportHeight - VIEWPORT_MARGIN * 2);
      const top = Math.min(Math.max(VIEWPORT_MARGIN, rect.top), viewportHeight - height - VIEWPORT_MARGIN);
      const left = Math.min(rect.right + offset, viewportWidth - popover.offsetWidth - VIEWPORT_MARGIN);
      setSide("right");
      setStyle({ top, left, ["--cb-popover-max-height" as string]: `${viewportHeight - VIEWPORT_MARGIN * 2}px` });
      return;
    }
    const spaceBelow = viewportHeight - rect.bottom - offset - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - offset - VIEWPORT_MARGIN;
    const naturalHeight = popover.scrollHeight;
    const preferred = placement === "bottom" ? spaceBelow : spaceAbove;
    const other = placement === "bottom" ? spaceAbove : spaceBelow;
    const nextSide = naturalHeight > preferred && other > preferred ? (placement === "bottom" ? "top" : "bottom") : placement;
    const available = Math.max(80, nextSide === "bottom" ? spaceBelow : spaceAbove);
    const height = Math.min(naturalHeight, available);

    const minWidth = matchAnchorWidth || align === "stretch" ? rect.width : 0;
    const width = Math.min(Math.max(popover.offsetWidth, minWidth), viewportWidth - VIEWPORT_MARGIN * 2);
    const rawLeft = align === "end" ? rect.right - width : rect.left;
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rawLeft), viewportWidth - width - VIEWPORT_MARGIN);
    const top = nextSide === "bottom" ? rect.bottom + offset : rect.top - offset - height;

    setSide(nextSide);
    setStyle({
      top, left,
      ...(align === "stretch" ? { width: rect.width } : minWidth ? { minWidth } : {}),
      ["--cb-popover-max-height" as string]: `${available}px`,
    });
  }, [align, anchorRef, matchAnchorWidth, offset, placement]);

  useLayoutEffect(() => {
    if (!open) { setStyle(null); return; }
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reposition); };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open, reposition]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={popoverRef} className={`cb-popover ${className}`} data-side={side} role={role} aria-label={ariaLabel}
      // Hidden for the first frame until it has been measured and placed.
      style={style ?? { top: 0, left: 0, visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
