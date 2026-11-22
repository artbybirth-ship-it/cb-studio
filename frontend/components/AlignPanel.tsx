"use client";

import type { ReactNode } from "react";
import type { AlignAction } from "@/lib/layerTransform";

/** The Align flyout, drawn from the designer's Align.svg: icons use the SVG's own coordinates (each cell 37.37 x 28.75). */
const Cell = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 37.37 28.75" fill="currentColor" stroke="currentColor" strokeWidth=".5" aria-hidden="true">{children}</svg>
);
const R = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => <rect x={x} y={y} width={w} height={h} rx=".95" stroke="none" />;
const L = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => <line x1={x1} y1={y1} x2={x2} y2={y2} fill="none" />;

const icons: Record<string, ReactNode> = {
  left: <Cell><L x1={10.34} y1={4.92} x2={10.34} y2={21.82} /><R x={12.05} y={6.17} w={9.81} h={5.93} /><R x={12.05} y={14.64} w={15.81} h={5.93} /></Cell>,
  hcenter: <Cell><L x1={18.69} y1={4.44} x2={18.69} y2={23.34} /><R x={13.78} y={7.01} w={9.81} h={5.93} /><R x={10.78} y={14.84} w={15.81} h={5.93} /></Cell>,
  right: <Cell><L x1={27.12} y1={4.92} x2={27.12} y2={21.82} /><R x={15.6} y={6.17} w={9.81} h={5.93} /><R x={9.6} y={14.64} w={15.81} h={5.93} /></Cell>,
  both: <Cell><L x1={18.95} y1={4.44} x2={18.95} y2={23.34} /><L x1={9.5} y1={13.89} x2={28.39} y2={13.89} /><R x={14.04} y={10.93} w={9.81} h={5.93} /></Cell>,
  top: <Cell><L x1={10.17} y1={4.62} x2={27.07} y2={4.62} /><R x={19.89} y={6.32} w={5.93} h={9.81} /><R x={11.42} y={6.32} w={5.93} h={15.81} /></Cell>,
  vcenter: <Cell><L x1={8.76} y1={13.89} x2={27.65} y2={13.89} /><R x={19.15} y={8.98} w={5.93} h={9.81} /><R x={11.32} y={5.98} w={5.93} h={15.81} /></Cell>,
  bottom: <Cell><L x1={9.51} y1={22.13} x2={26.41} y2={22.13} /><R x={19.23} y={10.62} w={5.93} h={9.81} /><R x={10.76} y={4.61} w={5.93} h={15.81} /></Cell>,
  dTop: <Cell><L x1={9.61} y1={4.89} x2={28.5} y2={4.89} /><L x1={9.61} y1={14.89} x2={28.5} y2={14.89} /><R x={14.15} y={7.01} w={9.81} h={5.93} /><R x={12.1} y={16.84} w={13.9} h={5.93} /></Cell>,
  dMid: <Cell><L x1={9.24} y1={8.98} x2={28.13} y2={8.98} /><L x1={9.24} y1={18.81} x2={28.13} y2={18.81} /><R x={13.78} y={6.01} w={9.81} h={5.93} /><R x={11.32} y={15.84} w={14.73} h={5.93} /></Cell>,
  dBottom: <Cell><L x1={8.87} y1={22.77} x2={27.76} y2={22.77} /><L x1={8.87} y1={12.77} x2={27.76} y2={12.77} /><R x={13.41} y={14.72} w={9.81} h={5.93} /><R x={11.36} y={4.89} w={13.9} h={5.93} /></Cell>,
  dLeft: <Cell><L x1={9.64} y1={4.38} x2={9.64} y2={23.28} /><L x1={19.64} y1={4.38} x2={19.64} y2={23.28} /><R x={21.59} y={8.92} w={5.93} h={9.81} /><R x={11.76} y={6.88} w={5.93} h={13.9} /></Cell>,
  dCenter: <Cell><L x1={23.12} y1={4.44} x2={23.12} y2={23.34} /><L x1={13.29} y1={4.44} x2={13.29} y2={23.34} /><R x={20.16} y={8.98} w={5.93} h={9.81} /><R x={10.33} y={6.53} w={5.93} h={14.73} /></Cell>,
  dRight: <Cell><L x1={27.78} y1={4.38} x2={27.78} y2={23.28} /><L x1={17.78} y1={4.38} x2={17.78} y2={23.28} /><R x={19.73} y={8.92} w={5.93} h={9.81} /><R x={9.9} y={6.88} w={5.93} h={13.9} /></Cell>,
  spaceH: <Cell><L x1={12.34} y1={4.92} x2={12.34} y2={21.82} /><L x1={8.24} y1={10.85} x2={15.46} y2={10.85} /><L x1={8.23} y1={15.89} x2={15.45} y2={15.89} /><R x={14.05} y={5.17} w={9.81} h={5.93} /><R x={14.05} y={15.64} w={14.81} h={5.93} /></Cell>,
  spaceV: <Cell><L x1={10.23} y1={7.67} x2={27.12} y2={7.67} /><L x1={21.2} y1={3.57} x2={21.2} y2={10.79} /><L x1={16.16} y1={3.56} x2={16.16} y2={10.78} /><R x={20.95} y={9.37} w={5.93} h={9.81} /><R x={10.48} y={9.37} w={5.93} h={13.81} /></Cell>,
  stage: <Cell><polygon className="w" points="27.86,19.96 11.76,19.96 11.76,9.14 23.61,9.14 27.86,13.15" fill="none" strokeWidth="1" /><line className="w" x1="11.76" y1="8.14" x2="11.76" y2="5.36" /><line className="w" x1="10.76" y1="9.14" x2="7.98" y2="9.14" /></Cell>,
  selection: (
    <svg viewBox="0 0 37.37 28.75" aria-hidden="true">
      <path fill="#727272" d="M25.66 21.34H11.89a.18.18 0 0 1-.18-.18V7.4a.18.18 0 0 1 .18-.18h13.77a.18.18 0 0 1 .18.18v13.76a.18.18 0 0 1-.18.18zm-13.6-.35h13.42V7.58H12.06z" />
      {[9.41, 17.45, 25.48].flatMap((x) => [5.1, 13.13, 21.17].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="2.48" height="2.48" fill="#9f9f9f" />))}
    </svg>
  ),
  key: (
    <svg viewBox="0 0 37.37 28.75" aria-hidden="true">
      <path fill="#727272" d="M25.48 21.34H11.89a.18.18 0 0 1-.18-.18V7.4a.18.18 0 0 1 .18-.18h13.59a.18.18 0 0 1 .18.18v13.76a.18.18 0 0 1-.18.18zM12.06 20.99h13.24V7.58H12.06z" />
      {[9.41, 17.45, 25.48].flatMap((x) => [5.1, 13.13, 21.17].filter((y) => !(x === 17.45 && y === 13.13)).map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="2.48" height="2.48" fill="#9f9f9f" />))}
      <g transform="translate(-263.12,-205.16)"><path fill="#9f9f9f" d="M278.23,216.61c0,.07.04.15.09.2l.32.38c.04.05.1.08.18.08h.39v.46c0,.07.05.14.13.14l.48.02-.03.61c0,.08.07.15.15.16l.57.03-.1.9s.03.09.06.12l.64.74c-.46.8-.42,1.73.16,2.45.39.47.9.78,1.51.87.83.12,1.61-.23,2.11-.89.82-1.1.63-2.81-.67-3.45-.47-.23-1.37-.28-1.86-.09l-.26-.34-.71-.88-.2-.25c-.48-.59-.96-1.17-1.46-1.73l-.36-.38c-.5-.6-.75-.46-.83-.43-.16.08-.25.24-.26.41l-.04.88ZM282.68,222.58c-.25-.33-.09-.86.35-1.19s.99-.33,1.24,0,.1.87-.34,1.2-1,.32-1.25,0Z" /></g>
    </svg>
  ),
};

type Btn = { id: string; label: string; action?: AlignAction; active?: boolean; onClick?: () => void; note?: string };

export default function AlignPanel({ run, alignToStage, setAlignToStage }: { run: (action: AlignAction) => void; alignToStage: boolean; setAlignToStage: (value: boolean) => void }) {
  const group = (buttons: Btn[]) => (
    <div className="cb-ap-group" role="group">
      {buttons.map((b) => {
        const usable = Boolean(b.action || b.onClick);
        return (
          <button key={b.id} type="button" className={`cb-ap-btn ${b.active ? "active" : ""}`} disabled={!usable} aria-label={b.label} aria-pressed={b.active}
            title={usable ? b.label : `${b.label} (coming soon)`} onClick={() => { if (b.action) run(b.action); else b.onClick?.(); }}>
            {icons[b.id]}
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="cb-ap">
      <div className="cb-ap-label">Align Objects</div>
      {group([
        { id: "left", label: "Align left", action: "left" },
        { id: "hcenter", label: "Align horizontal centre", action: "hcenter" },
        { id: "right", label: "Align right", action: "right" },
        { id: "both", label: "Align centre" },
        { id: "top", label: "Align top", action: "top" },
        { id: "vcenter", label: "Align vertical centre", action: "vcenter" },
        { id: "bottom", label: "Align bottom", action: "bottom" },
      ])}
      <div className="cb-ap-label">Distribute Object</div>
      <div className="cb-ap-row">
        {group([
          { id: "dTop", label: "Distribute top edges" },
          { id: "dMid", label: "Distribute vertical centres (3 or more layers)", action: "vdistribute" },
          { id: "dBottom", label: "Distribute bottom edges" },
        ])}
        {group([
          { id: "dLeft", label: "Distribute left edges" },
          { id: "dCenter", label: "Distribute horizontal centres (3 or more layers)", action: "hdistribute" },
          { id: "dRight", label: "Distribute right edges" },
        ])}
      </div>
      <div className="cb-ap-row" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="cb-ap-label">Distribute Spacing</div>
          {group([{ id: "spaceH", label: "Distribute horizontal spacing" }, { id: "spaceV", label: "Distribute vertical spacing" }])}
        </div>
        <div>
          <div className="cb-ap-label">Align to:</div>
          {group([
            { id: "stage", label: "Align to stage", active: alignToStage, onClick: () => setAlignToStage(true) },
            { id: "selection", label: "Align to selection", active: !alignToStage, onClick: () => setAlignToStage(false) },
            { id: "key", label: "Align to key object" },
          ])}
        </div>
      </div>
    </div>
  );
}
