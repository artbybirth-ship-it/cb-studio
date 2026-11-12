"use client";

/** The × at the left of a panel's header (every floating panel uses this one button). */
export default function PanelClose({ onClose, label = "Close" }: { onClose: () => void; label?: string }) {
  return (
    <button type="button" className="cb-panel-close" aria-label={label} title={`${label} (Esc)`} onClick={onClose}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
    </button>
  );
}
