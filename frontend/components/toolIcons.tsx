/** Icons for the tool rail groups and their panels (24×24 line art, currentColor). */

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const SelectIcon = () => (
  <svg viewBox="31.86 37.09 32 32" aria-hidden="true"><path d="M55.58,56.94l-5.3-.88c-.65-.11-1.58-.07-1.88.51l-2.22,5.03c-.72,1.37-2.79.92-2.87-.63l-.88-15.6c-.08-1.34,1.49-2.12,2.52-1.25l11.88,10.15c1.18,1,.28,2.92-1.24,2.67Z" fill="none" stroke="currentColor" strokeMiterlimit="10" /></svg>
);
export const ScaleIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" strokeMiterlimit="10"><rect x="7.5" y="13.5" width="11" height="11" /><path d="M12.5 8.5h11v11" strokeDasharray="2 1.6" /><path d="M15.5 16.5l9-9M19.5 7.5h5v5" /></g></svg>
);
export const ReflectIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v20" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.8" /><path d="M14 10l-7 12h7z" fill="currentColor" /><path d="M18 10l7 12h-7z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
);
export const TransformIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="9" width="14" height="14" {...line} strokeDasharray="2 1.6" />{[9, 16, 23].map((x) => [9, 16, 23].map((y) => <rect key={`${x}-${y}`} x={x - 1.6} y={y - 1.6} width="3.2" height="3.2" fill={x === 16 && y === 16 ? "currentColor" : "#2b2b2b"} stroke="currentColor" strokeWidth="1" />))}</svg>
);
export const TextIcon = () => (
  <svg viewBox="31.86 152.09 32 32" aria-hidden="true"><path d="M47.86,160.92v14.34M55.49,160.92h-15.25M55.49,160.92v1.8M40.24,160.92v1.8M49.66,175.26h-3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const FileIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 6.5h8.5l4.5 4.5v14.5H10z" {...line} /><path d="M18.5 6.5V11H23" {...line} /><path d="M13.5 18.5a3 3 0 0 1 5.2-2M18.5 19.5a3 3 0 0 1-5.2 2" {...line} strokeWidth={1.2} /><path d="M18.9 14.6v1.9H17M13.1 23.4v-1.9H15" {...line} strokeWidth={1.2} /></svg>
);
export const NewIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 6.5h8.5l4.5 4.5v14.5H10z" {...line} /><path d="M16.5 14v8M12.5 18h8" {...line} /></svg>);
export const OpenIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6.5 10.5h6l2 2h10v11h-18z" {...line} /><path d="M6.5 23.5l3-7.5h18l-3 7.5" {...line} /></svg>);
export const SaveIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 7.5h13l3.5 3.5v13.5H8z" {...line} /><path d="M11.5 7.5v5.5h8V7.5M11.5 24.5v-7h9v7" {...line} /></svg>);
export const ExportIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v13M11 11l5-5 5 5" {...line} /><path d="M8 17.5v7h16v-7" {...line} /></svg>);
export const ColourIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="13" y="13" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" /><rect x="7.5" y="7.5" width="11" height="11" fill="currentColor" stroke="#2b2b2b" strokeWidth="1" /></svg>
);
export const FillIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="9" width="14" height="14" fill="currentColor" stroke="currentColor" strokeWidth="1" /></svg>);
export const StrokeIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="10" y="10" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" /></svg>);
export const SwapIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 12h14l-3.5-3.5M24 20H10l3.5 3.5" {...line} /></svg>);
export const RecolourIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="12" r="4" fill="#e0624f" /><circle cx="20" cy="11" r="4" fill="#e8c34d" /><circle cx="16" cy="19" r="4" fill="#4f8fe0" /><path d="M8 24h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
);
export const AlignIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25.5h18" {...line} /><rect x="9.5" y="9" width="5" height="13.5" fill="currentColor" /><rect x="17.5" y="14" width="5" height="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>);

/** Align panel icons: a line on the aligned edge or centre, two boxes. */
const AlignGlyph = ({ axis, at }: { axis: "x" | "y"; at: "start" | "center" | "end" }) => {
  const pos = at === "start" ? 7 : at === "center" ? 16 : 25;
  const boxes = axis === "x"
    ? [{ w: 12, h: 5, y: 9 }, { w: 7, h: 5, y: 18 }].map((b) => ({ ...b, x: at === "start" ? 7 : at === "center" ? 16 - b.w / 2 : 25 - b.w }))
    : [{ w: 5, h: 12, x: 9 }, { w: 5, h: 7, x: 18 }].map((b) => ({ ...b, y: at === "start" ? 7 : at === "center" ? 16 - b.h / 2 : 25 - b.h }));
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {axis === "x" ? <path d={`M${pos} 5v22`} {...line} /> : <path d={`M5 ${pos}h22`} {...line} />}
      {boxes.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={i === 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />)}
    </svg>
  );
};
export const AlignLeftIcon = () => <AlignGlyph axis="x" at="start" />;
export const AlignHCenterIcon = () => <AlignGlyph axis="x" at="center" />;
export const AlignRightIcon = () => <AlignGlyph axis="x" at="end" />;
export const AlignTopIcon = () => <AlignGlyph axis="y" at="start" />;
export const AlignVCenterIcon = () => <AlignGlyph axis="y" at="center" />;
export const AlignBottomIcon = () => <AlignGlyph axis="y" at="end" />;
export const DistributeHIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">{[8, 16, 24].map((x) => <g key={x}><rect x={x - 2.5} y="10" width="5" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d={`M${x} 6v20`} stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" /></g>)}</svg>
);
export const DistributeVIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">{[8, 16, 24].map((y) => <g key={y}><rect x="10" y={y - 2.5} width="12" height="5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d={`M6 ${y}h20`} stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" /></g>)}</svg>
);
